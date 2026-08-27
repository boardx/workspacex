"""DA-02 的反证套件（rubric D1/D4/D8/D10）。

纪律：写完门控立刻造反证（本仓九次「全绿但空转」）。每条断言先确认
「缺了对应配置时它会红」，才有资格相信它绿的时候说明了什么——
test_todo_tool_absent_without_middleware 就是那条反向对照。
"""
from __future__ import annotations

import re
import tomllib
from pathlib import Path

from langchain_core.language_models.fake_chat_models import FakeListChatModel

from deep_agent_service.harness import build_checkpointer, build_middleware

SERVICE_ROOT = Path(__file__).resolve().parents[1]


def _tool_names(graph) -> set[str]:
    node = graph.nodes["tools"]
    bound = getattr(node, "bound", node)
    return set(getattr(bound, "tools_by_name", {}).keys())


def _fake_model():
    return FakeListChatModel(responses=["ok"])


def test_write_todos_present_with_harness_middleware():
    """D1：挂上 harness middleware 后，规划工具必须真实存在于编译图中。"""
    from deepagents import create_deep_agent

    graph = create_deep_agent(model=_fake_model(), middleware=build_middleware(_fake_model()))
    assert "write_todos" in _tool_names(graph)


def test_todo_tool_absent_without_middleware():
    """反向对照：0.7 起裸调用没有 write_todos——这正是基线 D1=0 的机械复现。

    如果未来某个版本把 TodoList 改回默认自带，这条会红，提醒我们移除冗余挂载
    并回评 rubric，而不是让「我们的配置」与「库的默认」悄悄叠加成两份。
    """
    from deepagents import create_deep_agent

    graph = create_deep_agent(model=_fake_model())
    assert "write_todos" not in _tool_names(graph)


def test_summarization_settings_pinned():
    """D8：trigger/keep 显式固定，不吃库默认（升级时默认值漂移不得改变上下文策略）。"""
    mw = build_middleware(_fake_model())
    summarizer = next(m for m in mw if type(m).__name__ == "SummarizationMiddleware")
    assert summarizer.trigger == ("tokens", 60000)
    assert summarizer.keep == ("messages", 20)
    # DA-09（#2051）：这一项此前吃库默认 4000，被 TC-4 抓出来是「静默丢弃老内容」的
    # 真原因（一次压缩丢四万多 token，只有最后 4000 进摘要器）。钉成与触发线同值，
    # 理由见 harness.py 的注释；把它改回小值会让 D8 悄悄退回「只有截断」。
    assert summarizer.trim_tokens_to_summarize == 60000, (
        "摘要输入预算必须覆盖一次压缩可能丢掉的全部内容，否则老内容根本进不了摘要"
    )


def test_precompletion_checklist_uses_official_middleware():
    """D7 退出前自检：用的是 deepagents 官方 `RubricMiddleware`，不是自建私有件。

    上游核实（2026-08-25，读 .venv 里锁定的 0.7.6 源码）：langchain 的 middleware
    导出里没有 completion/checklist 语义的件；deepagents 公开导出的
    `RubricMiddleware` 语义逐字对应「本来要结束时先对照清单评一遍，不合格就带着
    差距说明跳回模型」。这条断言同时是升级看守：哪天它从 `deepagents` 消失，
    这里当场红，而不是我们悄悄换成手写 hack。
    """
    from deepagents import RubricMiddleware

    from deep_agent_service.harness import RUBRIC_MAX_ITERATIONS

    mw = build_middleware(_fake_model())
    rubric = next((m for m in mw if isinstance(m, RubricMiddleware)), None)
    assert rubric is not None, "退出前自检必须挂在 middleware 栈上"
    # max_iterations 显式钉死（库默认 3），同 trigger/keep 的纪律。
    assert rubric.max_iterations == RUBRIC_MAX_ITERATIONS == 2


def test_precompletion_checklist_seed_is_graded_rollout(monkeypatch):
    """双轨反证（S1=B）：默认清单的播种默认关闭。

    `RubricMiddleware` 本身**无条件**挂——没有 rubric 时它逐字 no-op，挂上等于零
    行为变更。真正会改变每次收尾成本的是「往 state 里播默认清单」，那件由
    `DEEP_AGENT_PRECOMPLETION_CHECKLIST=1` 控制；未设时 middleware 清单里不该出现
    播种件，行为与接线前逐字相同。
    """
    from deep_agent_service.harness import build_precompletion_middleware

    monkeypatch.delenv("DEEP_AGENT_PRECOMPLETION_CHECKLIST", raising=False)
    off = [type(m).__name__ for m in build_precompletion_middleware(_fake_model())]
    assert off == ["RubricMiddleware"], f"未开灰度时不该播种默认清单，实际 {off}"

    monkeypatch.setenv("DEEP_AGENT_PRECOMPLETION_CHECKLIST", "1")
    on = [type(m).__name__ for m in build_precompletion_middleware(_fake_model())]
    assert on == ["_DefaultCompletionChecklistMiddleware", "RubricMiddleware"], (
        f"播种件必须排在 RubricMiddleware 之前（before_agent 按列表顺序串），实际 {on}"
    )


def test_default_checklist_does_not_override_caller_rubric():
    """播种只在调用方没给 rubric 时发生——`rubric` 是库声明的公开 I/O 字段，
    调用方传了自己的判据，我们不能用默认清单把它盖掉。"""
    from deep_agent_service.harness import (
        DEFAULT_COMPLETION_CHECKLIST,
        _DefaultCompletionChecklistMiddleware,
    )

    seeder = _DefaultCompletionChecklistMiddleware()
    assert seeder.before_agent({}, None) == {"rubric": DEFAULT_COMPLETION_CHECKLIST}
    assert seeder.before_agent({"rubric": "调用方自己的判据"}, None) is None


def test_checkpointer_none_without_dsn(monkeypatch):
    """D4 分环境：平台托管（无 DSN）时图上不带 checkpointer——带了会 GraphLoadError，
    见 guided_research_graph.py:226 的原始实测记录。"""
    monkeypatch.delenv("DEEP_AGENT_CHECKPOINT_DB", raising=False)
    assert build_checkpointer() is None


def test_checkpointer_fails_closed_on_bad_dsn(monkeypatch):
    """D4 fail-closed：DSN 设了但连不上必须在建图时炸，不许静默降级成无持久化。"""
    monkeypatch.setenv("DEEP_AGENT_CHECKPOINT_DB", "postgresql://nobody@127.0.0.1:1/void")
    import pytest

    with pytest.raises(Exception):
        build_checkpointer()


def test_version_floor_matches_lock():
    """D10：pyproject 地板与 uv.lock 锁定版本的 major.minor 必须一致。

    基线时地板 >=0.0.5、锁 0.7.6，差 15 个 minor——按地板装到的是另一个库。
    这条测试就是 backlog 承诺的「CI 门」：deep-agent-service 的测试在门控链上，
    地板漂移当场红，不需要新的 CI 配置。
    """
    pyproject = tomllib.loads((SERVICE_ROOT / "pyproject.toml").read_text())
    floor_spec = next(d for d in pyproject["project"]["dependencies"] if d.startswith("deepagents"))
    m = re.search(r">=(\d+)\.(\d+)", floor_spec)
    assert m, f"deepagents 依赖必须写明 >=major.minor 地板：{floor_spec}"
    floor = (int(m.group(1)), int(m.group(2)))

    lock_text = (SERVICE_ROOT / "uv.lock").read_text()
    lm = re.search(r'\[\[package\]\]\nname = "deepagents"\nversion = "(\d+)\.(\d+)\.', lock_text)
    assert lm, "uv.lock 里找不到 deepagents 锁定版本"
    locked = (int(lm.group(1)), int(lm.group(2)))

    assert floor == locked, (
        f"pyproject 地板 {floor} != uv.lock 锁定 {locked}——按地板安装会装到不同 minor 的库；"
        "升级 lock 时必须同步提地板（反之亦然）。"
    )


# ── DA-07（rubric D6）：人在环中断 + 恢复的活体反证（进程内真图，MemorySaver）──


def _hitl_graph(monkeypatch, *, calls: list[str] | None = None):
    """带 interrupt_on 的真编译图。模型是脚本化假模型：第一轮发起 dangerous_tool
    调用，第二轮直接作答——这样中断/恢复的全链路不需要任何网络或凭据。

    `calls`：传入一个列表时，dangerous_tool 每次真实执行都会把收到的 payload
    追加进去——reject/edit 测试靠这份记录断言「有没有真的跑」「跑的是谁的参数」，
    不是只看消息文本（消息断言 + 副作用记录双证，同 test_tool_call_limit_injects_correction
    的纪律）。"""
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.tools import tool
    from langgraph.checkpoint.memory import MemorySaver

    from deepagents import create_deep_agent
    from deep_agent_service.harness import build_interrupt_on

    monkeypatch.setenv("DEEP_AGENT_HITL_TOOLS", "dangerous_tool")
    sink = calls if calls is not None else []

    @tool
    def dangerous_tool(payload: str) -> str:
        """A tool that must not run without approval."""
        sink.append(payload)
        return f"EXECUTED:{payload}"

    class ScriptedToolCallingModel(GenericFakeChatModel):
        """GenericFakeChatModel 的基类 bind_tools 抛 NotImplementedError（实测）——
        deepagents 建图时要 bind 全套 harness 工具。脚本已定死要发什么调用，
        bind 在这里就是个 no-op：返回自身即可。"""

        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self

    model = ScriptedToolCallingModel(messages=iter([
        AIMessage(content="", tool_calls=[{"id": "c1", "name": "dangerous_tool", "args": {"payload": "x"}}]),
        AIMessage(content="done after approval"),
    ]))
    return create_deep_agent(
        model=model,
        tools=[dangerous_tool],
        interrupt_on=build_interrupt_on(),
        checkpointer=MemorySaver(),
    )


def test_hitl_interrupts_before_sensitive_tool(monkeypatch):
    """D6 正向：列入 DEEP_AGENT_HITL_TOOLS 的工具调用前，run 必须停在 interrupt——
    工具没有执行（消息里没有 EXECUTED），状态里挂着待裁决的中断。"""
    graph = _hitl_graph(monkeypatch)
    config = {"configurable": {"thread_id": "hitl-1"}}
    result = graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    assert "__interrupt__" in result, "run 应停在 interrupt 等人裁决"
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert not any("EXECUTED" in t for t in texts), "工具在批准前绝不能执行"


def test_hitl_resume_approve_runs_tool(monkeypatch):
    """D6 恢复：Command(resume=[approve]) 后工具真实执行、run 走到终稿。"""
    from langgraph.types import Command

    graph = _hitl_graph(monkeypatch)
    config = {"configurable": {"thread_id": "hitl-2"}}
    graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    # resume 形状是 {"decisions": [...]}，不是裸列表——0.7.6 的
    # HumanInTheLoopMiddleware.after_model 源码实测（interrupt(...)["decisions"]），
    # 传裸列表会 TypeError。这条注释就是那次红的存档。
    result = graph.invoke(Command(resume={"decisions": [{"type": "approve"}]}), config)
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert any("EXECUTED:x" in t for t in texts), "批准后工具必须真实执行"
    assert "__interrupt__" not in result


def test_hitl_resume_reject_tool_not_executed(monkeypatch):
    """D6 拒绝：Command(resume=[reject]) 后被拒的工具调用绝不能真实执行，
    run 必须优雅收尾（走到终稿的 AIMessage，不是挂死或裸异常）——不是只看
    消息文本里没有 EXECUTED，副作用计数（dangerous_tool 的调用次数）必须是 0，
    这才是「没有真实执行」的硬证据。

    langchain 0.7.6 HumanInTheLoopMiddleware._process_decision 源码实测
    （human_in_the_loop.py）：reject 分支把原始 tool_call 连同一条
    status="error" 的合成 ToolMessage 一起放回状态——进程内实测（本注释旁的
    反证）确认 ToolNode 遇到已有匹配 tool_call_id 的 ToolMessage 时不会重跑，
    dangerous_tool 真实调用次数钉在 0。"""
    from langgraph.types import Command

    calls: list[str] = []
    graph = _hitl_graph(monkeypatch, calls=calls)
    config = {"configurable": {"thread_id": "hitl-reject"}}
    graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    result = graph.invoke(Command(resume={"decisions": [{"type": "reject"}]}), config)

    assert calls == [], f"被拒绝的工具绝不能真实执行，实际记录到调用 {calls}"
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert not any("EXECUTED" in t for t in texts), "拒绝后消息里不该出现工具执行结果"
    assert any("rejected" in t.lower() for t in texts), "必须有明确的拒绝通告，不是静默丢弃"
    assert "__interrupt__" not in result, "拒绝后 run 必须走到终稿，不能停在半途"
    assert any(getattr(m, "content", "") == "done after approval" for m in result["messages"]), (
        "run 必须优雅收尾到脚本的下一轮回答，不是挂死或裸异常"
    )


# ── #2252：三个具名虚拟工具的真编译图反证（build_tools() 注册 + interrupt_on 真中断）──
#
# 与上面 `_hitl_graph`（合成的 `dangerous_tool`）不同，这里用的是
# `deep_agent_service.tools.build_tools()` 真实注册的
# `confirm_task_intent`/`fill_run_params`/`choose_execution_option`——证明的不是
# "HumanInTheLoopMiddleware 机制通"（那件事上面已经证过），而是"这三个具名工具
# 真的在 `tools` 列表里、真的会被真实图拦下、真的能用 resume 载荷推进"，也就是
# #2252 判定"永远不会被触发"这件事已经被堵上。


def _named_tool_graph(monkeypatch, tool_name: str, proposed_args: dict):
    """带 `build_interrupt_on()`（真实读 `DEEP_AGENT_HITL_TOOLS`）+
    `build_tools()`（真实注册的三个 #2252 工具，连同既有的 `list_org_skills`/
    `call_skill`）的真编译图。脚本化模型第一轮提议对指定工具的调用，第二轮直接作答。"""
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
    from langchain_core.messages import AIMessage
    from langgraph.checkpoint.memory import MemorySaver

    from deepagents import create_deep_agent
    from deep_agent_service.harness import build_interrupt_on
    from deep_agent_service.tools import build_tools

    monkeypatch.setenv("DEEP_AGENT_HITL_TOOLS", tool_name)

    class ScriptedToolCallingModel(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self

    model = ScriptedToolCallingModel(messages=iter([
        AIMessage(content="", tool_calls=[{"id": "c1", "name": tool_name, "args": proposed_args}]),
        AIMessage(content="done after decision"),
    ]))
    tools = build_tools(model)
    assert tool_name in {t.name for t in tools}, f"{tool_name} 必须真实存在于 build_tools() 返回的工具列表里"
    return create_deep_agent(
        model=model,
        tools=tools,
        interrupt_on=build_interrupt_on(),
        checkpointer=MemorySaver(),
    )


def test_confirm_task_intent_registered_and_interrupts(monkeypatch):
    """`confirm_task_intent` 真实注册进 `tools`，且列入 `DEEP_AGENT_HITL_TOOLS` 后
    模型一发起调用 run 就真的停在 interrupt——这正是 #2252 报告"模型没有东西可调用，
    三张卡片永远不会被触发"的反面：现在模型有东西可调用，且真的会被拦下。"""
    graph = _named_tool_graph(
        monkeypatch,
        "confirm_task_intent",
        {"requestId": "req-1", "understanding": "生成复盘", "assumptions": ["a", "b"]},
    )
    config = {"configurable": {"thread_id": "confirm-interrupt"}}
    result = graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    assert "__interrupt__" in result, "confirm_task_intent 必须在真实图里真的触发中断"
    interrupt_payload = str(result["__interrupt__"])
    assert "confirm_task_intent" in interrupt_payload
    assert "生成复盘" in interrupt_payload


def test_confirm_task_intent_resume_approve_uses_original_understanding(monkeypatch):
    from langgraph.types import Command

    graph = _named_tool_graph(
        monkeypatch,
        "confirm_task_intent",
        {"requestId": "req-1", "understanding": "生成复盘", "assumptions": ["同比", "截至7月底"]},
    )
    config = {"configurable": {"thread_id": "confirm-approve"}}
    graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    result = graph.invoke(Command(resume={"decisions": [{"type": "approve"}]}), config)
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert any("用户已确认对任务的理解：生成复盘" in t for t in texts)


def test_confirm_task_intent_resume_edit_uses_edited_assumptions_only(monkeypatch):
    """前端只会带回 `{assumptions}`（`ConfirmIntentDecision.editedArgs`，无
    `understanding`/`requestId`）——真实图上 resume 的是这个精简形状，不是完整原始参数。"""
    from langgraph.types import Command

    graph = _named_tool_graph(
        monkeypatch,
        "confirm_task_intent",
        {"requestId": "req-1", "understanding": "生成复盘", "assumptions": ["同比", "截至7月底"]},
    )
    config = {"configurable": {"thread_id": "confirm-edit"}}
    graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    result = graph.invoke(
        Command(resume={"decisions": [{
            "type": "edit",
            "edited_action": {"name": "confirm_task_intent", "args": {"assumptions": ["环比", "只看付费渠道"]}},
        }]}),
        config,
    )
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert any("用户修改了假设为：环比；只看付费渠道" in t for t in texts)


def test_fill_run_params_registered_and_interrupts(monkeypatch):
    graph = _named_tool_graph(
        monkeypatch,
        "fill_run_params",
        {"requestId": "req-2", "fields": [
            {"name": "region", "label": "地区", "aiGuess": "华东", "rationale": "上次提到过", "required": True, "currentValue": None},
        ]},
    )
    config = {"configurable": {"thread_id": "fill-interrupt"}}
    result = graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    assert "__interrupt__" in result, "fill_run_params 必须在真实图里真的触发中断"
    assert "fill_run_params" in str(result["__interrupt__"])


def test_fill_run_params_resume_edit_uses_name_value_pairs_only(monkeypatch):
    """前端 `full-rerun` 分支只带回 `{fields:[{name,value}]}`
    （`planFillParamsResume` 的 `resume-with-edits`），不是完整 `ParamField`。"""
    from langgraph.types import Command

    graph = _named_tool_graph(
        monkeypatch,
        "fill_run_params",
        {"requestId": "req-2", "fields": [
            {"name": "region", "label": "地区", "aiGuess": "华东", "rationale": "上次提到过", "required": True, "currentValue": None},
        ]},
    )
    config = {"configurable": {"thread_id": "fill-edit"}}
    graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    result = graph.invoke(
        Command(resume={"decisions": [{
            "type": "edit",
            "edited_action": {"name": "fill_run_params", "args": {"fields": [{"name": "region", "value": "华南"}]}},
        }]}),
        config,
    )
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert any("region='华南'" in t for t in texts)


def test_choose_execution_option_registered_and_interrupts(monkeypatch):
    graph = _named_tool_graph(
        monkeypatch,
        "choose_execution_option",
        {"requestId": "req-3", "options": [
            {"optionId": "opt-1", "title": "方案A", "effort": "低", "timeToValue": "1周", "expectedReturn": "小幅提升"},
            {"optionId": "opt-2", "title": "方案B", "effort": "高", "timeToValue": "1月", "expectedReturn": "大幅提升"},
        ]},
    )
    config = {"configurable": {"thread_id": "choose-interrupt"}}
    result = graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    assert "__interrupt__" in result, "choose_execution_option 必须在真实图里真的触发中断"
    assert "choose_execution_option" in str(result["__interrupt__"])


def test_choose_execution_option_resume_edit_selected_option_id_only(monkeypatch):
    """`choose_execution_option` 没有 approve 分支——唯一真正会重新调用工具的路径是
    `edit`，且只带回 `{selectedOptionId}`（`ChooseOptionDecision.editedArgs`）——**实测**：
    真编译图 resume 时 `edited_action.args` 就是这个精简载荷本身，`options` 不会跟着
    一起送回来，所以工具只能按 id 原样回显（与 `test_tools.py` 的
    `test_choose_execution_option_without_options_falls_back_to_the_raw_id` 同一事实，
    这里是它在真图 resume 路径上的反证）。"""
    from langgraph.types import Command

    graph = _named_tool_graph(
        monkeypatch,
        "choose_execution_option",
        {"requestId": "req-3", "options": [
            {"optionId": "opt-1", "title": "方案A", "effort": "低", "timeToValue": "1周", "expectedReturn": "小幅提升"},
            {"optionId": "opt-2", "title": "方案B", "effort": "高", "timeToValue": "1月", "expectedReturn": "大幅提升"},
        ]},
    )
    config = {"configurable": {"thread_id": "choose-edit"}}
    graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    result = graph.invoke(
        Command(resume={"decisions": [{
            "type": "edit",
            "edited_action": {"name": "choose_execution_option", "args": {"selectedOptionId": "opt-2"}},
        }]}),
        config,
    )
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert any("opt-2" in t for t in texts)


def test_choose_execution_option_reject_never_re_invokes_the_tool(monkeypatch):
    """`reject` 是「都不要」的逃生口——run 必须优雅收尾，工具绝不能带着模型最初提议的
    参数被重新执行（`ChooseOptionDecision` 判别联合根本没有 approve 分支）。"""
    from langgraph.types import Command

    graph = _named_tool_graph(
        monkeypatch,
        "choose_execution_option",
        {"requestId": "req-3", "options": [
            {"optionId": "opt-1", "title": "方案A", "effort": "低", "timeToValue": "1周", "expectedReturn": "小幅提升"},
        ]},
    )
    config = {"configurable": {"thread_id": "choose-reject"}}
    graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    result = graph.invoke(Command(resume={"decisions": [{"type": "reject"}]}), config)
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert not any("方案A" in t for t in texts), "拒绝后不能出现工具真实执行的确认文案"
    assert "__interrupt__" not in result, "拒绝后 run 必须走到终稿"


def test_hitl_resume_edit_uses_edited_args(monkeypatch):
    """D6 改参数放行：这条能力存在的核心价值——人改过的参数必须是实际执行时
    用的参数，不是模型原始提议的参数。

    resume 形状实测（HumanInTheLoopMiddleware._process_decision，edit 分支）：
    `Command(resume={"decisions": [{"type": "edit", "edited_action":
    {"name": <工具名>, "args": <完整参数 dict，不是 patch>}}]})`——`edited_action`
    直接构成新的 ToolCall(name=edited_action["name"], args=edited_action["args"])，
    args 整体替换而非合并，这与 apps/api 侧 #1848 实测的字段命名
    （edited_action.name / edited_action.args，args 是完整对象）一致，
    这里以 deep-agent-service 自己对 langchain.agents.middleware 的 inspect
    结果为准。"""
    from langgraph.types import Command

    calls: list[str] = []
    graph = _hitl_graph(monkeypatch, calls=calls)
    config = {"configurable": {"thread_id": "hitl-edit"}}
    graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    result = graph.invoke(
        Command(resume={"decisions": [{
            "type": "edit",
            "edited_action": {"name": "dangerous_tool", "args": {"payload": "edited-by-human"}},
        }]}),
        config,
    )

    assert calls == ["edited-by-human"], (
        f"实际执行必须用人改过的参数，模型原始提议是 payload='x'，实际记录到 {calls}"
    )
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert any("EXECUTED:edited-by-human" in t for t in texts), "工具结果必须体现改过的参数"
    assert not any("EXECUTED:x" in t for t in texts), "模型原始提议的参数绝不能被执行"
    assert "__interrupt__" not in result


def test_hitl_off_by_default(monkeypatch):
    """双轨反证：未设 DEEP_AGENT_HITL_TOOLS 时 build_interrupt_on 返回 None——
    行为与 DA-07 之前逐字相同，没有任何工具会被拦。"""
    monkeypatch.delenv("DEEP_AGENT_HITL_TOOLS", raising=False)
    from deep_agent_service.harness import build_interrupt_on

    assert build_interrupt_on() is None


def test_hitl_env_parsing(monkeypatch):
    from deep_agent_service.harness import build_interrupt_on

    monkeypatch.setenv("DEEP_AGENT_HITL_TOOLS", "call_skill, execute ,")
    assert build_interrupt_on() == {"call_skill": True, "execute": True}


# ── DA-08（rubric D8②）：大工具结果驱逐到虚拟文件系统的活体反证 ──


def _offload_graph(payload_chars: int):
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.tools import tool

    from deepagents import create_deep_agent
    from deep_agent_service.harness import build_middleware

    @tool
    def probe_tool() -> str:
        """Returns a payload of a controlled size."""
        return "X" * payload_chars

    class ScriptedModel(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self

    model = ScriptedModel(messages=iter([
        AIMessage(content="", tool_calls=[{"id": "c1", "name": "probe_tool", "args": {}}]),
        AIMessage(content="done"),
    ]))
    return create_deep_agent(model=model, tools=[probe_tool], middleware=build_middleware(model))


def test_large_tool_result_evicted_to_file():
    """超过阈值（1000 token ≈ 4KB）的工具输出必须被驱逐：正文只留文件引用，
    完整内容一字不丢地落在 state files——两半都断言，缺一半就是丢数据。"""
    out = _offload_graph(payload_chars=8000).invoke({"messages": [{"role": "user", "content": "go"}]})
    tool_msgs = [m for m in out["messages"] if type(m).__name__ == "ToolMessage"]
    assert len(tool_msgs) == 1
    body = str(tool_msgs[0].content)
    # 驱逐后的正文 = 文件引用 + 一段截断预览（实测 ~1600 字符）。断言口径：
    # 本体绝大部分已搬走（正文远小于 8000）且引用在场——不断言"一个 X 都没有"，
    # 预览是设计行为，帮模型不用 read_file 就知道结果大概长什么样。
    assert len(body) < 4000, f"正文应远小于本体（实际 {len(body)}）——驱逐没生效"
    assert "/large_tool_results/" in body, "正文必须留下文件引用路径"
    files = out.get("files") or {}
    stored = next((v for k, v in files.items() if "/large_tool_results/" in k), None)
    assert stored is not None, "完整结果必须落在虚拟文件系统里"
    content = stored if isinstance(stored, str) else str(stored)
    assert content.count("X") == 8000, "落盘内容必须一字不丢"


def test_small_tool_result_stays_inline():
    """反向：不超限的输出保持原样内联——驱逐不是无差别搬家，小结果搬走只会
    多一次 read_file 往返。"""
    out = _offload_graph(payload_chars=200).invoke({"messages": [{"role": "user", "content": "go"}]})
    tool_msgs = [m for m in out["messages"] if type(m).__name__ == "ToolMessage"]
    assert "X" * 200 in str(tool_msgs[0].content)
    assert not (out.get("files") or {}), "小结果不该产生任何落盘文件"


def test_evict_threshold_pinned():
    """阈值显式固定为 1000（≈4KB，rubric v2 口径），不吃库默认 20000——
    升级时默认值漂移不得悄悄改变上下文策略（与 Summarization 同一条纪律）。"""
    from deep_agent_service.harness import TOOL_RESULT_EVICT_TOKENS, build_middleware
    from langchain_core.language_models.fake_chat_models import FakeListChatModel

    assert TOOL_RESULT_EVICT_TOKENS == 1000
    mw = build_middleware(FakeListChatModel(responses=["ok"]))
    fs = next(m for m in mw if type(m).__name__ == "FilesystemMiddleware")
    assert getattr(fs, "_tool_token_limit_before_evict", None) == 1000  # 私有名，实测 vars() 确认


# ── DA-07d（rubric D7）：预算熔断 + 死循环纠偏 + 失败重试的活体反证 ──


def _looping_graph(n_tool_rounds: int, tool_fn=None):
    """脚本化模型连发 n 轮工具调用再收尾——模拟会循环的任务。"""
    import itertools
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.tools import tool

    from deepagents import create_deep_agent
    from deep_agent_service.harness import build_middleware

    calls = {"n": 0}

    @tool
    def spin_tool() -> str:
        """A tool the model keeps calling."""
        calls["n"] += 1
        if tool_fn is not None:
            return tool_fn(calls["n"])
        return f"round {calls['n']}"

    class ScriptedModel(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self

    def gen():
        for i in range(n_tool_rounds):
            yield AIMessage(content="", tool_calls=[{"id": f"c{i}", "name": "spin_tool", "args": {}}])
        while True:
            yield AIMessage(content="finally done")

    model = ScriptedModel(messages=gen())
    return create_deep_agent(model=model, tools=[spin_tool], middleware=build_middleware(model)), calls


def test_model_call_budget_ends_run_with_notice():
    """D7③ 熔断：模型调用到 25 次预算时 run 必须**优雅终止且带明确通告**——
    不是裸异常（那是崩溃不是熔断），也不是静默截断（rubric 点名禁止）。"""
    graph, _ = _looping_graph(n_tool_rounds=100)
    result = graph.invoke({"messages": [{"role": "user", "content": "go"}]},
                          {"recursion_limit": 300})
    texts = " ".join(str(getattr(m, "content", "")) for m in result["messages"])
    assert "finally done" not in texts, "100 轮循环的剧本不该自然走完——熔断必须先触发"
    assert "limit" in texts.lower(), "终止时必须有 limit 通告消息，静默截断不算熔断"


def test_tool_call_limit_injects_correction():
    """D7② 纠偏：工具调用超 40 次后，后续调用被拦截并注入超限消息（模型被迫收尾），
    真实工具执行次数被钉在阈值——纠偏不是计数器装饰。"""
    graph, calls = _looping_graph(n_tool_rounds=60)
    result = graph.invoke({"messages": [{"role": "user", "content": "go"}]},
                          {"recursion_limit": 300})
    from deep_agent_service.harness import RUN_TOOL_CALL_LIMIT
    assert calls["n"] <= RUN_TOOL_CALL_LIMIT, (
        f"真实执行 {calls['n']} 次，超过 {RUN_TOOL_CALL_LIMIT}——拦截没生效"
    )


def test_tool_retry_recovers_transient_failure():
    """D7① 重试：工具前两次抛错、第三次成功——run 必须拿到成功结果走到终稿，
    而不是把瞬时失败当终局。"""
    def flaky(n: int) -> str:
        if n <= 2:
            raise RuntimeError(f"transient failure {n}")
        return "recovered"

    graph, calls = _looping_graph(n_tool_rounds=1, tool_fn=flaky)
    result = graph.invoke({"messages": [{"role": "user", "content": "go"}]},
                          {"recursion_limit": 50})
    texts = " ".join(str(getattr(m, "content", "")) for m in result["messages"])
    assert calls["n"] == 3, f"应重试到第 3 次成功，实际执行 {calls['n']} 次"
    assert "recovered" in texts, "重试成功的结果必须回到对话"


def test_budget_thresholds_pinned():
    """阈值钉死（25/40），不吃库默认——升级漂移不得悄悄改变预算策略。"""
    from deep_agent_service.harness import RUN_MODEL_CALL_LIMIT, RUN_TOOL_CALL_LIMIT, build_middleware
    from langchain_core.language_models.fake_chat_models import FakeListChatModel

    assert (RUN_MODEL_CALL_LIMIT, RUN_TOOL_CALL_LIMIT) == (25, 40)
    mw = build_middleware(FakeListChatModel(responses=["ok"]))
    names = [type(m).__name__ for m in mw]
    for required in ["ToolCallLimitMiddleware", "ModelCallLimitMiddleware", "ToolRetryMiddleware"]:
        assert required in names


# ── DA-05（#1838，rubric D5）：具名研究子代理——委托真实发生的活体反证 ──
#
# task 工具实测参数形状（deepagents 0.7.6，进程内 t.args 直读，不是猜的）：
#   {"description": <给子代理的任务全文>, "subagent_type": <SubAgent["name"]>}
# SubAgent TypedDict 必填字段：name / description / system_prompt（⚠ 不是 prompt）。
# 下一个人照抄这个形状即可，不用再 inspect。


def _recording_model(script):
    """脚本化 + 记录每次模型调用收到的消息——「子代理真实执行」的证据就来自
    这份记录：它的第二轮输入必须包含 list_org_skills 的 ToolMessage。"""
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel

    class RecordingScriptedModel(GenericFakeChatModel):
        seen: list = []

        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):  # noqa: ANN001, ANN003
            type(self).seen.append(list(messages))
            return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    # 每次构造独立的记录容器（类属性默认共享，覆盖掉）
    model = RecordingScriptedModel(messages=iter(script))
    type(model).seen = []
    return model


def test_subagents_off_by_default(monkeypatch):
    """双轨反证：未设 DEEP_AGENT_SUBAGENTS_ENABLED 时返回 None——
    create_deep_agent 收到 None 与参数默认值逐字一致，行为与接线前完全相同。"""
    from deep_agent_service.harness import build_subagents

    monkeypatch.delenv("DEEP_AGENT_SUBAGENTS_ENABLED", raising=False)
    assert build_subagents(_fake_model()) is None
    monkeypatch.setenv("DEEP_AGENT_SUBAGENTS_ENABLED", "0")
    assert build_subagents(_fake_model()) is None


def test_subagent_config_pinned(monkeypatch):
    """配置钉死：名字/职责/system_prompt 指令/工具集/模型全部显式，不吃库默认。"""
    from deep_agent_service.harness import build_subagents

    monkeypatch.setenv("DEEP_AGENT_SUBAGENTS_ENABLED", "1")
    model = _fake_model()
    subagents = build_subagents(model)
    assert subagents is not None and len(subagents) == 1
    sa = subagents[0]
    assert sa["name"] == "org-skill-researcher"
    assert "调研" in sa["description"] and "汇总" in sa["description"]
    assert "list_org_skills" in sa["system_prompt"]
    assert [t.name for t in sa["tools"]] == ["list_org_skills", "call_skill"]
    assert sa["model"] is model, "子代理模型显式钉为主模型，不吃「继承」的库默认"


def test_task_tool_advertises_named_subagent(monkeypatch):
    """启用后主图 task 工具的描述里必须出现具名子代理——这是主模型「知道可以
    委托给谁」的唯一渠道；不出现，子代理就还是守着空气。"""
    from deepagents import create_deep_agent
    from deep_agent_service.harness import build_subagents

    monkeypatch.setenv("DEEP_AGENT_SUBAGENTS_ENABLED", "1")
    model = _fake_model()
    graph = create_deep_agent(model=model, subagents=build_subagents(model))
    task_tool = _task_tool(graph)
    assert "org-skill-researcher" in task_tool.description
    # 反向对照：不接 subagents 时 task 工具只有内建 general-purpose——基线 D5=0.3 的机械复现
    bare = create_deep_agent(model=_fake_model())
    assert "org-skill-researcher" not in _task_tool(bare).description


def _task_tool(graph):
    node = graph.nodes["tools"]
    bound = getattr(node, "bound", node)
    return getattr(bound, "tools_by_name", {})["task"]


def test_subagent_delegation_really_happens(monkeypatch):
    """D5 正证：主模型发 task 调用 → 具名子代理真实执行——三份互相独立的证据：
    ① 子代理自己的脚本模型被消费（seen 非空，且轮数与剧本一致）；
    ② 子代理第二轮输入里有 list_org_skills 的 ToolMessage，内容是本次运行
       config 里种的技能清单——工具真实执行在子代理上下文内，config 真实透传；
    ③ 子代理的最终答案归并回主线程（task 的 ToolMessage 里有它的结论），
       主模型据此收尾。缺任何一份都可能是「task 工具执行了但子代理是空转」。"""
    from langchain_core.messages import AIMessage
    from deepagents import create_deep_agent
    from deep_agent_service.harness import build_subagents

    monkeypatch.setenv("DEEP_AGENT_SUBAGENTS_ENABLED", "1")

    sub_model = _recording_model([
        AIMessage(content="", tool_calls=[{"id": "s1", "name": "list_org_skills", "args": {}}]),
        AIMessage(content="RESEARCH_DONE: 本次运行挂载 skill-a（做甲事）"),
    ])
    main_model = _recording_model([
        AIMessage(content="", tool_calls=[{
            "id": "m1",
            "name": "task",
            # 实测形状：description + subagent_type（= SubAgent["name"]）
            "args": {"description": "调研本组织技能库并汇总", "subagent_type": "org-skill-researcher"},
        }]),
        AIMessage(content="主线程收尾：已拿到研究员结论"),
    ])

    subagents = build_subagents(sub_model)
    graph = create_deep_agent(model=main_model, subagents=subagents)
    result = graph.invoke(
        {"messages": [{"role": "user", "content": "组织里有哪些技能可用？"}]},
        {"configurable": {"org_skills": [
            {"stable_name": "skill-a", "name": "甲技能", "content": "做甲事"},
        ]}},
    )

    # ① 子代理的脚本模型被真实消费：两轮（发工具调用 + 汇总收尾）
    assert len(type(sub_model).seen) == 2, (
        f"子代理模型应被调用 2 轮，实际 {len(type(sub_model).seen)}——委托没有真实发生"
    )
    # ② 第二轮输入包含 list_org_skills 的真实执行结果（config 里种的技能清单）
    second_round = " ".join(str(getattr(m, "content", "")) for m in type(sub_model).seen[1])
    assert "skill-a" in second_round and "甲技能" in second_round, (
        "子代理内 list_org_skills 必须真实执行且读到本次运行 config 的 org_skills"
    )
    # ③ 子代理结论归并回主线程：task 的 ToolMessage 带回 RESEARCH_DONE
    tool_msgs = [m for m in result["messages"] if type(m).__name__ == "ToolMessage"]
    task_results = [str(m.content) for m in tool_msgs if "RESEARCH_DONE" in str(m.content)]
    assert task_results, "子代理的最终答案必须归并回主线程的 task ToolMessage"
    final_texts = " ".join(str(getattr(m, "content", "")) for m in result["messages"])
    assert "主线程收尾" in final_texts, "主模型必须在拿到子代理结论后继续走到终稿"
