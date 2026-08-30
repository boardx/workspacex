"""TC-6 任务模式：确定性强制 write_todos（issue #2220 方案 B，检验 D1）。

## 这条 TC 在证明什么、跟已有测试有什么不同

`test_harness.py::test_write_todos_present_with_harness_middleware` 证明的是「规划
工具存在于编译图里」；本仓已有的 vitest（`copilotkit-v2-plan-control.test.tsx`）证明
的是「账本里有数据时前端渲染正确」——issue #2220 的诊断原文说得很清楚，两者都不是
问题所在：真正的缺口是「真实模型这一轮会不会**主动**调用 write_todos」，实测命中率
0/1（同一句提示词换一轮对话，模型可能直接在回复正文里写"第一步/第二步"纯文字）。

方案 A（`graph.py` 的 `SYSTEM_PROMPT` 追加规则）已经在 main 上，但它的效果**依赖
LLM 对提示词的服从概率**，devapp 上多跑几轮才能知道收敛率，本仓的 loopback 桩/假
模型测试**都验证不了"真实模型愿不愿意听话"这件事**——这正是本文件要补的缺口，
但补的不是「验证模型质量」（假模型做不到，也不该冒充能做到），而是补一条不依赖
模型服从概率的**确定性**保证：`PlanFirstToolChoiceMiddleware`（`harness.py`）在任务
模式标记出现、write_todos 还没被调用过时，把 `tool_choice` 显式钉成 `"write_todos"`
——这是 `bind_tools` 的 provider 级契约（OpENAI 等模型收到具名 tool_choice 时**必须**
调用该工具），不是"提示词写得好不好"。

`_scripted.py` 的 `ScriptedChatModel` 如实模拟了这条 provider 契约（`_generate` 里
`bound_tool_choice` 命中时接管输出）——下面用的路由函数刻意"不合作"：无论看到什么
消息都只想吐纯文字步骤，完全复现 issue #2220 实测到的真实故障模式；如果最终 transcript
里仍然出现了 write_todos 调用，说明是中间件的强制生效了，不是路由函数"恰好配合"。

## 自动化分级

| 检验点 | 本文件 | 说明 |
|---|---|---|
| 任务模式标记 + write_todos 未调用过 → 强制 tool_choice="write_todos" | ✅ 全自动 | 断言首次 `bind_tools` 调用捕获到的 `tool_choice` |
| 强制生效后 transcript 真的产出了 write_todos 工具调用 | ✅ 全自动 | 即使路由函数本身"不合作" |
| write_todos 已调用过 → 不再重复强制（不会卡成每步都被摁着摆待办） | ✅ 全自动 | 断言第二次模型调用的 `tool_choice` 已回落为 `None` |
| 反证①：没有任务模式标记 → 不强制，原样复现 #2220 的真实故障（纯文字、零 write_todos） | ✅ 全自动 | 证明强制行为确实由标记触发，不是无条件生效 |
| 反证②：write_todos 工具本身未挂载（异常配置）→ 不强行指向不存在的工具 | ✅ 全自动 | 防止中间件在配置漂移时把请求指向一个不存在的工具名 |
| 真实模型在方案 A 提示词下的实际服从率 | ❌ 不在本文件 | 必须在 devapp 用真实模型多轮实测，见 issue #2220 |

PR #2410 review 指出的两条多轮对话反证（判据必须收窄到"最新一条人类消息所在的
这一轮"，不是"整份历史"）在 `test_harness.py` 用直接构造 `ModelRequest` 的方式
覆盖，不在本文件重复：
`test_new_task_mode_turn_is_forced_again_after_earlier_completed_plan_in_same_thread`
（更早一次任务用过 write_todos 不抑制新一轮任务模式请求）、
`test_ordinary_turn_not_falsely_forced_by_stale_marker_earlier_in_thread`
（历史里的旧标记不会误伤后续普通提问）。
"""
from __future__ import annotations

from langchain_core.messages import AIMessage

from _scripted import ScriptedChatModel, tool_call_names
from deep_agent_service.harness import TASK_MODE_MARKER, build_middleware

UNCOOPERATIVE_ANSWER = "第一步：整理素材。第二步：起草初稿。第三步：润色定稿。"


def _uncooperative_router(messages, bound_tools):  # noqa: ANN001, ANN201, ARG001
    """无论收到什么消息都只想用纯文字回答——复现 issue #2220 实测到的真实故障模式：
    模型从不主动调用 write_todos，即使提示词已经要求"先给计划再执行"。"""
    return AIMessage(content=UNCOOPERATIVE_ANSWER)


def _build_graph(model: ScriptedChatModel):  # noqa: ANN201
    from deepagents import create_deep_agent

    from deep_agent_service.tools import build_tools

    return create_deep_agent(model=model, tools=build_tools(model), middleware=build_middleware(model))


def test_task_mode_marker_forces_write_todos_despite_uncooperative_model(evidence):  # noqa: ANN001, ANN201
    model = ScriptedChatModel(router=_uncooperative_router)
    graph = _build_graph(model)

    result = graph.invoke(
        {"messages": [{"role": "user", "content": f"{TASK_MODE_MARKER}：帮我把周报拆成三步"}]},
        {"configurable": {"thread_id": "tc6-forced"}},
    )

    # 硬证据①：第一次模型调用被钉成了 write_todos——这是中间件做的，不是路由函数
    # "恰好"决定这么答（路由函数从头到尾只会返回 UNCOOPERATIVE_ANSWER）。
    assert model.calls[0]["bound_tool_choice"] == "write_todos", (
        "任务模式标记出现、write_todos 还没被调用过时，首次模型调用必须被强制指向 write_todos"
    )

    # 硬证据②：即使路由函数"不合作"，transcript 里仍然真实出现了 write_todos 调用
    # ——这是强制生效的最终效果，plan-control 六态面板正是靠这个事件才有数据可同步。
    names = tool_call_names(result["messages"])
    assert "write_todos" in names, f"强制生效后 transcript 必须包含 write_todos 调用，实际 {names}"

    # 硬证据③：write_todos 已经出现过之后，第二次模型调用不再被强制——不会把"确认后
    # 再执行"这个阶段也卡成必须再摆一次待办；模型在这之后按自己的判断（这里是路由
    # 函数固定返回的纯文字）收尾。
    assert model.calls[1]["bound_tool_choice"] is None, (
        "write_todos 已调用过后不应继续强制 tool_choice，否则每一步都会被摁着重新摆待办"
    )
    final_texts = [str(getattr(m, "content", "")) for m in result["messages"]]
    assert any(UNCOOPERATIVE_ANSWER in t for t in final_texts)

    evidence.write(
        "tc6-task-mode-plan-first-forced-write-todos",
        {
            "scenario": "任务模式标记 + 不合作假模型 → 确定性强制 write_todos（issue #2220 方案 B）",
            "dimensions": ["D1"],
            "not_covered_here": ["真实模型在方案 A 提示词下的实际服从率（需 devapp 多轮实测）"],
            "task_mode_marker": TASK_MODE_MARKER,
            "model_call_tool_choices": [c["bound_tool_choice"] for c in model.calls],
            "tool_call_names_in_transcript": names,
        },
    )


def test_counterproof_without_task_mode_marker_reproduces_original_bug(evidence):  # noqa: ANN001, ANN201
    """反证①（本仓九次「全绿但空转」的纪律）：没有任务模式标记时，同一个"不合作"假
    模型必须原样复现 issue #2220 实测到的真实故障——不强制、零 write_todos、纯文字
    步骤——证明上一条测试的绿灯确实是任务模式标记触发的强制生效，不是中间件对所有
    对话都无条件生效（那样就不是"任务模式"专属的修复了，而是悄悄改变了问答模式的
    行为）。"""
    model = ScriptedChatModel(router=_uncooperative_router)
    graph = _build_graph(model)

    result = graph.invoke(
        {"messages": [{"role": "user", "content": "帮我把周报拆成三步"}]},
        {"configurable": {"thread_id": "tc6-counterproof-no-marker"}},
    )

    assert model.calls[0]["bound_tool_choice"] is None, "没有任务模式标记时不应强制 tool_choice"
    names = tool_call_names(result["messages"])
    assert "write_todos" not in names, (
        f"没有任务模式标记时必须原样复现 #2220 的真实故障（零 write_todos），实际 {names}"
    )
    final_texts = [str(getattr(m, "content", "")) for m in result["messages"]]
    assert any(UNCOOPERATIVE_ANSWER in t for t in final_texts)

    evidence.write(
        "tc6-counterproof-no-marker",
        {
            "scenario": "反证①：无任务模式标记 → 不强制，原样复现 #2220 的真实故障",
            "dimensions": ["D1"],
            "model_call_tool_choices": [c["bound_tool_choice"] for c in model.calls],
            "tool_call_names_in_transcript": names,
        },
    )


def test_counterproof_without_write_todos_tool_mounted_never_forces_missing_tool():  # noqa: ANN001, ANN201
    """反证②：write_todos 工具本身未挂载时（配置漂移/裸调用），中间件绝不能强行把
    tool_choice 指向一个不存在的工具——那会让每一次模型调用直接报错，比"没有强制"
    更糟。"""
    from deepagents import create_deep_agent

    from deep_agent_service.harness import PlanFirstToolChoiceMiddleware

    model = ScriptedChatModel(router=_uncooperative_router)
    # 故意只挂本中间件本身，不挂 TodoListMiddleware——模拟 write_todos 未挂载的配置漂移。
    graph = create_deep_agent(model=model, middleware=[PlanFirstToolChoiceMiddleware()])

    result = graph.invoke(
        {"messages": [{"role": "user", "content": f"{TASK_MODE_MARKER}：帮我把周报拆成三步"}]},
        {"configurable": {"thread_id": "tc6-counterproof-no-tool"}},
    )

    assert model.calls[0]["bound_tool_choice"] is None, (
        "write_todos 未挂载时绝不能强行指向一个不存在的工具"
    )
    final_texts = [str(getattr(m, "content", "")) for m in result["messages"]]
    assert any(UNCOOPERATIVE_ANSWER in t for t in final_texts)
