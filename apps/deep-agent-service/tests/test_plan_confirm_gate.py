"""issue #3132（B7）—— 计划确认门的**引擎侧**反证。

三条钉死的实现要求，各有一条会红的断言：

1. **谓词 = 「本轮首次实质性计划写入」，不是每次 `write_todos`**。
   `write_todos` 在执行期会被反复调用把步骤标 `in_progress`/`completed`；
   `test_second_write_todos_in_same_run_never_interrupts` 是这条的专门反证——
   把「state 里已有 todos ⇒ 放行」那段删掉，它立刻红。

2. **fail 方向与 `_call_skill_requires_hitl` 相反**。
   那边配置缺失 ⇒ `True`（多问一次是安全的）；这边配置缺失 ⇒ `False`
   （多拦一次 = 给简单问答加门槛，直接违反判据 (b)）。
   `test_fail_direction_is_opposite_to_call_skill` 把两个谓词放在**同一份**
   「什么都没配」的 configurable 上对比，断言它们给出相反的答案——照抄错方向
   会让这条红，而不是悄悄通过。

3. **判据 (b)：简单问答不被加门**。步骤数低于阈值一律放行。
"""

import pytest


def _request(todos, state_todos=None):
    """构造一次 `write_todos` 调用请求。`state_todos` 是图状态里**已有**的 todos。"""
    from langgraph.prebuilt.tool_node import ToolCallRequest

    state = {"messages": []}
    if state_todos is not None:
        state["todos"] = state_todos
    return ToolCallRequest(
        tool_call={"id": "c1", "name": "write_todos", "args": {"todos": todos}, "type": "tool_call"},
        tool=None,
        state=state,
        runtime=None,
    )


def _call(configurable, request):
    """在给定 `configurable` 下调用谓词（不需要真编译图，同既有 call_skill 测试的手法）。"""
    import deep_agent_service.harness as harness_module

    original = harness_module.get_config
    harness_module.get_config = lambda: {"configurable": configurable}
    try:
        return harness_module._write_todos_requires_plan_confirmation(request)
    finally:
        harness_module.get_config = original


ENABLED = {"plan_confirm_min_steps": 2}


def test_first_substantive_plan_write_interrupts():
    """本轮首次写入一份 >= 阈值的计划 ⇒ 中断。这是整道门存在的理由。"""
    assert _call(ENABLED, _request([{"content": "a"}, {"content": "b"}, {"content": "c"}])) is True


def test_second_write_todos_in_same_run_never_interrupts():
    """⚠ **第 1 条要求的专门反证**：同一条 run 里第二次及以后的 `write_todos`
    不得再次中断。

    执行期的 `write_todos` 调用（把第一步标 `in_progress`）与首次计划写入在
    **args 上无法区分**——两者都是一份 >= 阈值的 todos 数组。唯一的区别是图状态里
    是否**已经**有 todos。撤掉谓词里 `if existing_todos: return False` 那段，
    这条立刻红，而真实链路会把执行切成一步一确认。
    """
    already_planned = [
        {"content": "a", "status": "in_progress"},
        {"content": "b", "status": "pending"},
        {"content": "c", "status": "pending"},
    ]
    assert _call(ENABLED, _request(already_planned, state_todos=already_planned)) is False


def test_simple_question_is_not_gated():
    """判据 (b)：0 步 / 1 步（简单问答、单步任务）一律不加门槛。

    把谓词改成恒 `True`（「照抄 call_skill 的方向」最容易写成的样子），这两条红。
    """
    assert _call(ENABLED, _request([])) is False
    assert _call(ENABLED, _request([{"content": "只有一步"}])) is False


def test_fail_direction_is_opposite_to_call_skill():
    """⚠ **第 2 条要求的机械门控**：两个谓词在**同一份**空 configurable 上必须
    给出相反的答案。

    `call_skill` 缺配置 ⇒ True（fail-closed，宁可多问一次批准）。
    `write_todos` 缺配置 ⇒ False（fail-open，多拦一次会给简单问答加门槛）。

    把新谓词照抄成 fail-closed，这条红——它不是在复述注释，而是把「方向相反」
    这件事变成一个会失败的断言。
    """
    from langgraph.prebuilt.tool_node import ToolCallRequest

    import deep_agent_service.harness as harness_module

    plan_request = _request([{"content": "a"}, {"content": "b"}])
    skill_request = ToolCallRequest(
        tool_call={"id": "c2", "name": "call_skill", "args": {"skill_stable_name": "x"}, "type": "tool_call"},
        tool=None,
        state={"messages": []},
        runtime=None,
    )

    original = harness_module.get_config
    harness_module.get_config = lambda: {"configurable": {}}
    try:
        skill_answer = harness_module._call_skill_requires_hitl(skill_request)
        plan_answer = harness_module._write_todos_requires_plan_confirmation(plan_request)
    finally:
        harness_module.get_config = original

    assert skill_answer is True, "call_skill 缺配置必须 fail-closed（既有语义，不许被本改动带偏）"
    assert plan_answer is False, "write_todos 缺配置必须 fail-open——多拦一次会给简单问答加门槛"
    assert skill_answer is not plan_answer, "两个谓词的 fail 方向必须相反"


@pytest.mark.parametrize("bad", [None, True, False, 0, -1, "2", 2.0, [], {}])
def test_bad_threshold_shapes_do_not_gate(bad):
    """阈值形状不对 ⇒ 不拦（同一个 fail-open 方向）。

    `True`/`False` 单列出来是因为 `bool` 是 `int` 的子类：不显式排除的话
    `True` 会被当成阈值 1，于是**单步任务也被加门**——判据 (b) 破在一个
    看不见的地方。
    """
    request = _request([{"content": "a"}, {"content": "b"}])
    assert _call({"plan_confirm_min_steps": bad}, request) is False


def test_build_interrupt_on_registers_write_todos_conditionally():
    """`write_todos` 必须以带 `when` 谓词的 `InterruptOnConfig` 注册，
    且**不得**混进 `DEFAULT_HITL_TOOL_NAMES`（那份清单里的工具是无条件 `True`，
    `write_todos` 若混进去等于每次调用都停）。"""
    from deep_agent_service.harness import (
        DEFAULT_HITL_TOOL_NAMES,
        _PLAN_CONFIRMATION_TOOL_NAME,
        build_interrupt_on,
    )

    assert _PLAN_CONFIRMATION_TOOL_NAME not in DEFAULT_HITL_TOOL_NAMES
    result = build_interrupt_on()
    entry = result[_PLAN_CONFIRMATION_TOOL_NAME]
    assert entry is not True, "write_todos 绝不能是无条件 True"
    assert callable(entry["when"])
    assert entry["allowed_decisions"] == ["approve", "edit", "reject"]

    # 既有四个 HITL 工具的注册形状一个字不变（本改动不碰它们）。
    for name in DEFAULT_HITL_TOOL_NAMES:
        if name == "call_skill":
            continue
        assert result[name] is True


def test_config_key_matches_contract_literal():
    """跨语言 parity：Python 侧的键名/工具名字面量必须与契约
    `PLAN_CONFIRM_MIN_STEPS_CONFIGURABLE_KEY` / `PLAN_CONFIRMATION_TOOL_NAME` 一致。
    契约侧有对应的一条断言（`plan-confirm-gate.test.ts`），两边共同锁住这个字面量。
    """
    from deep_agent_service.harness import _PLAN_CONFIRM_CONFIG_KEY, _PLAN_CONFIRMATION_TOOL_NAME

    assert _PLAN_CONFIRM_CONFIG_KEY == "plan_confirm_min_steps"
    assert _PLAN_CONFIRMATION_TOOL_NAME == "write_todos"
