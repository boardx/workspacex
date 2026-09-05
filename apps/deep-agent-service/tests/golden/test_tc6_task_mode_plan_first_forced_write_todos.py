"""TC-6 任务模式：确定性强制 write_todos（issue #2220 方案 B，检验 D1；issue #2417
重做——第一版通过 PR #2410 合入又被 PR #2423 紧急回滚，见下方"同步/异步双路径"一节）。

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
——这是 `bind_tools` 的 provider 级契约（OpenAI 等模型收到具名 tool_choice 时**必须**
调用该工具），不是"提示词写得好不好"。

`_scripted.py` 的 `ScriptedChatModel` 如实模拟了这条 provider 契约（`_generate` 里
`bound_tool_choice` 命中时接管输出）——下面用的路由函数刻意"不合作"：无论看到什么
消息都只想吐纯文字步骤，完全复现 issue #2220 实测到的真实故障模式；如果最终 transcript
里仍然出现了 write_todos 调用，说明是中间件的强制生效了，不是路由函数"恰好配合"。

## 同步/异步双路径（issue #2417 的直接教训，本仓九次「全绿但空转」之一）

PR #2410 的第一版只用 `graph.invoke()`（同步）跑过这套断言，全绿；但 `deep-agent-
service` 生产走的是 `langgraph dev`（**异步** runtime，`ainvoke()`/`astream()`）。
`PlanFirstToolChoiceMiddleware` 当时只实现了同步 `wrap_model_call`，框架在异步上下文
里调用中间件链时，任何一个中间件没实现 `awrap_model_call` 就会在框架层直接
`raise NotImplementedError`——这个异常发生在中间件的业务判断**之前**，不区分任务
模式请求还是普通对话，每一次模型调用都会命中，导致生产 100% 请求失败（devapp 真实
容器日志实锤，见 PR #2423 描述）。同步桩测试"全绿"完全没有暴露这个 bug——这正是
"桩测试通过、真实运行时失败"的教训。

本文件因此在关键场景上**同时**跑同步 `graph.invoke()` 与异步
`asyncio.run(graph.ainvoke(...))` 两条路径：
`test_task_mode_marker_forces_write_todos_despite_uncooperative_model_sync`（同步）+
`test_task_mode_marker_forces_write_todos_despite_uncooperative_model_async`（异步，
issue #2417 的直接反证——如果 `PlanFirstToolChoiceMiddleware` 又只实现了 `wrap_
model_call`，这条测试会在 `NotImplementedError` 上失败，而不是像 PR #2410 那样
全程没人跑过异步路径）。不需要额外装 `pytest-asyncio`：`asyncio.run()` 在普通同步
测试函数体内直接跑一次事件循环，够用。

## 自动化分级

| 检验点 | 本文件 | 说明 |
|---|---|---|
| 任务模式标记 + write_todos 未调用过 → 强制 tool_choice="write_todos"（同步 + 异步） | ✅ 全自动 | 断言首次 `bind_tools` 调用捕获到的 `tool_choice` |
| 强制生效后 transcript 真的产出了 write_todos 工具调用（同步 + 异步） | ✅ 全自动 | 即使路由函数本身"不合作" |
| write_todos 已调用过 → 不再重复强制 | ✅ 全自动 | 断言第二次模型调用的 `tool_choice` 已回落为 `None` |
| 反证①：没有任务模式标记 → 不强制，原样复现 #2220 的真实故障 | ✅ 全自动 | 证明强制行为确实由标记触发 |
| 反证②：write_todos 工具本身未挂载 → 不强行指向不存在的工具 | ✅ 全自动 | 防止配置漂移时指向不存在的工具名 |
| 反证③（issue #2417）：provider 拒绝具名 tool_choice → 退回不强制重试一次，run 正常收尾 | ✅ 全自动 | 不让整轮判 `MODEL_CALL_FAILED` |
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

import asyncio

from langchain_core.messages import AIMessage

from _scripted import (
    ScriptedChatModel,
    ScriptedProviderRejectsToolChoice,
    grader_always_satisfied_response,
    tool_call_names,
)
from deep_agent_service.harness import TASK_MODE_MARKER, build_middleware

UNCOOPERATIVE_ANSWER = "第一步：整理素材。第二步：起草初稿。第三步：润色定稿。"


def _uncooperative_router(messages, bound_tools):  # noqa: ANN001, ANN201
    """无论收到什么消息都只想用纯文字回答——复现 issue #2220 实测到的真实故障模式：
    模型从不主动调用 write_todos，即使提示词已经要求"先给计划再执行"。

    Phase 14 F02（R6）起 `RubricMiddleware` 的默认清单播种无条件生效（见
    `grader_always_satisfied_response` 头注）：这个"不合作"假模型如果对
    `GraderResponse` 绑定也一样只吐纯文字，grader 解析不到判词会判"未通过"、
    反复跳回模型返工，与本文件要验证的"确定性强制"是两件不相关的事，所以固定
    判"合格"放行。
    """
    if bound_tools == ["GraderResponse"]:
        return grader_always_satisfied_response()
    return AIMessage(content=UNCOOPERATIVE_ANSWER)


def _build_graph(model: ScriptedChatModel):  # noqa: ANN201
    from deepagents import create_deep_agent

    from deep_agent_service.tools import build_tools

    return create_deep_agent(model=model, tools=build_tools(model), middleware=build_middleware(model))


def _assert_forced_then_produced(model: ScriptedChatModel, result: dict, *, thread_id: str) -> list[str]:  # noqa: ANN201
    """两条同步/异步测试共用的断言体（业务判断只写一份，避免同步/异步版本各自维护
    一份、日后漂移出不一致的验收标准）。"""
    assert model.calls[0]["bound_tool_choice"] == "write_todos", (
        f"[{thread_id}] 任务模式标记出现、write_todos 还没被调用过时，"
        "首次模型调用必须被强制指向 write_todos"
    )
    names = tool_call_names(result["messages"])
    assert "write_todos" in names, f"[{thread_id}] 强制生效后 transcript 必须包含 write_todos 调用，实际 {names}"
    assert model.calls[1]["bound_tool_choice"] is None, (
        f"[{thread_id}] write_todos 已调用过后不应继续强制 tool_choice，否则每一步都会被摁着重新摆待办"
    )
    final_texts = [str(getattr(m, "content", "")) for m in result["messages"]]
    assert any(UNCOOPERATIVE_ANSWER in t for t in final_texts)
    return names


def test_task_mode_marker_forces_write_todos_despite_uncooperative_model_sync(evidence):  # noqa: ANN001, ANN201
    """同步路径（`graph.invoke()`）——`PlanFirstToolChoiceMiddleware.wrap_model_call`。"""
    model = ScriptedChatModel(router=_uncooperative_router)
    graph = _build_graph(model)

    result = graph.invoke(
        {"messages": [{"role": "user", "content": f"{TASK_MODE_MARKER}：帮我把周报拆成三步"}]},
        {"configurable": {"thread_id": "tc6-forced-sync"}},
    )
    names = _assert_forced_then_produced(model, result, thread_id="sync")

    evidence.write(
        "tc6-task-mode-plan-first-forced-write-todos-sync",
        {
            "scenario": "任务模式标记 + 不合作假模型 → 确定性强制 write_todos（同步 graph.invoke()）",
            "dimensions": ["D1"],
            "not_covered_here": ["真实模型在方案 A 提示词下的实际服从率（需 devapp 多轮实测）"],
            "task_mode_marker": TASK_MODE_MARKER,
            "model_call_tool_choices": [c["bound_tool_choice"] for c in model.calls],
            "tool_call_names_in_transcript": names,
        },
    )


def test_task_mode_marker_forces_write_todos_despite_uncooperative_model_async(evidence):  # noqa: ANN001, ANN201
    """异步路径（`asyncio.run(graph.ainvoke(...))`）——issue #2417 的直接反证。

    `deep-agent-service` 生产走 `langgraph dev`，实际调用方式是异步的。这条测试跑的
    是 `PlanFirstToolChoiceMiddleware.awrap_model_call`，不是同步版本——如果中间件
    又只实现了 `wrap_model_call`（PR #2410 的原始 bug），这里会在框架抛出的
    `NotImplementedError` 上失败，而不是像上一版那样全程没人跑过这条路径。
    """
    model = ScriptedChatModel(router=_uncooperative_router)
    graph = _build_graph(model)

    result = asyncio.run(
        graph.ainvoke(
            {"messages": [{"role": "user", "content": f"{TASK_MODE_MARKER}：帮我把周报拆成三步"}]},
            {"configurable": {"thread_id": "tc6-forced-async"}},
        )
    )
    names = _assert_forced_then_produced(model, result, thread_id="async")

    evidence.write(
        "tc6-task-mode-plan-first-forced-write-todos-async",
        {
            "scenario": (
                "issue #2417 反证：任务模式标记 + 不合作假模型 → 确定性强制 write_todos"
                "（异步 asyncio.run(graph.ainvoke(...))，生产实际调用方式）"
            ),
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


def _assert_provider_reject_degrades_not_fails(model: ScriptedChatModel, result: dict) -> None:  # noqa: ANN201
    """同步/异步两条 provider-reject 反证共用的断言体——避免两份容易漂移的验收标准。

    Phase 14 F02（R6）起 `TaskClassifierMiddleware` 无条件挂载，这条用例的消息文本
    （含"再"这个连接词，触发它自己的启发式判类）同时命中手动 marker
    （`PlanFirstToolChoiceMiddleware`）与自动判类两条独立的强制路径——两者各自
    捕获 provider 拒绝、各自退回不强制重试，calls[1] 因此不再保证一定是不强制的
    那一次（可能是 TaskClassifier 的第二次强制尝试），真正不变的保证是"最终会
    收敛到不强制、且 run 正常收尾"，不是"恰好第二次调用就是不强制"。
    """
    # `RubricMiddleware` 收尾前会再发起一次绑 `GraderResponse` 的判词调用（Phase 14
    # F02 起无条件生效），那次调用与本条要验证的"主链强制→拒绝→退回不强制"是完全
    # 独立的另一件事，排除掉再看主链自己最终收敛到了哪个 tool_choice。
    main_chain_calls = [c for c in model.calls if c["bound_tools"] != ["GraderResponse"]]
    assert main_chain_calls[0]["bound_tool_choice"] == "write_todos"
    assert len(main_chain_calls) >= 2, "provider 拒绝具名 tool_choice 后中间件必须退回不强制重试一次"
    assert main_chain_calls[-1]["bound_tool_choice"] is None, (
        "降级重试最终必须收敛到不强制 tool_choice，否则会撞上同一个 provider 拒绝、无限失败"
    )
    final_texts = [str(getattr(m, "content", "")) for m in result["messages"]]
    assert any(UNCOOPERATIVE_ANSWER in t for t in final_texts), (
        "降级重试后 run 必须正常收尾并产出最终回复，不能让 provider 拒绝强制这件事本身变成整轮失败"
    )


def test_provider_rejecting_forced_tool_choice_degrades_to_unforced_retry_not_run_failure_sync(
    evidence,  # noqa: ANN001
):
    """反证③（issue #2417 排查过程中被提出、后被真实日志排除为直接根因，但仍是这个
    中间件该兜底的真实场景）——同步路径（`wrap_model_call`）：provider 拒绝这次具名
    `tool_choice` 强制调用时，中间件必须退回不强制重试一次，run 必须正常收尾——不能
    让这次强制调用的失败直接冒泡成整轮 `MODEL_CALL_FAILED`。

    `ScriptedChatModel(reject_forced_tool_choice=True)` 如实模拟"provider 拒绝
    具名 tool_choice"这个契约（见 `_scripted.py` 头注）——第一次模型调用被中间件
    钉成 `tool_choice="write_todos"`，假模型对此直接抛异常；中间件捕获后退回不
    强制、原样重试，最终一次调用的 `bound_tool_choice` 必须是 `None`（Phase 14
    F02 起 `TaskClassifierMiddleware` 也无条件参与，可能各自独立触发一轮"强制
    →拒绝→重试"，所以不钉死是第几次调用，只钉死最终收敛到不强制，见
    `_assert_provider_reject_degrades_not_fails` 头注），且 `graph.invoke`
    整体正常返回（不抛出、不是空 messages）。
    """
    model = ScriptedChatModel(router=_uncooperative_router, reject_forced_tool_choice=True)
    graph = _build_graph(model)

    result = graph.invoke(
        {"messages": [{"role": "user", "content": f"{TASK_MODE_MARKER}：帮我把周报拆成三步"}]},
        {"configurable": {"thread_id": "tc6-provider-rejects-forced-tool-choice-sync"}},
    )
    _assert_provider_reject_degrades_not_fails(model, result)

    evidence.write(
        "tc6-provider-rejects-forced-tool-choice-degrades-not-fails-sync",
        {
            "scenario": "provider 拒绝具名 tool_choice 强制调用时（同步 wrap_model_call），退回不强制重试一次，run 正常收尾",
            "dimensions": ["D1"],
            "not_covered_here": [
                "真实 DashScope/qwen-plus 端点是否真的拒绝具名 tool_choice"
                "（issue #2417 排查已确认这不是那次生产事故的直接根因，见 harness.py 头注）"
            ],
            "task_mode_marker": TASK_MODE_MARKER,
            "model_call_tool_choices": [c["bound_tool_choice"] for c in model.calls],
            "tool_call_names_in_transcript": tool_call_names(result["messages"]),
        },
    )


def test_provider_rejecting_forced_tool_choice_degrades_to_unforced_retry_not_run_failure_async(
    evidence,  # noqa: ANN001
):
    """同上一条的异步版本（`awrap_model_call`）——两条独立 review（exact-SHA review
    与 PR review comment 5472495179）都指出同一个缺口："两个方法的降级分支逐行
    对称"是靠读代码相似性下的结论，不是靠测试证明的：已有的强制生效异步测试用的
    是不拒绝的模型，只证明 `awrap_model_call` 会被调用、不会撞上
    `NotImplementedError`，从未证明它自己的 `except Exception` 降级重试分支是真的。
    这条测试用 `asyncio.run(graph.ainvoke(...))` 走同一套 provider-reject 场景，
    实际执行 `awrap_model_call` 的降级重试路径，不是靠读代码相似性放行。
    """
    model = ScriptedChatModel(router=_uncooperative_router, reject_forced_tool_choice=True)
    graph = _build_graph(model)

    result = asyncio.run(
        graph.ainvoke(
            {"messages": [{"role": "user", "content": f"{TASK_MODE_MARKER}：帮我把周报拆成三步"}]},
            {"configurable": {"thread_id": "tc6-provider-rejects-forced-tool-choice-async"}},
        )
    )
    _assert_provider_reject_degrades_not_fails(model, result)

    evidence.write(
        "tc6-provider-rejects-forced-tool-choice-degrades-not-fails-async",
        {
            "scenario": (
                "provider 拒绝具名 tool_choice 强制调用时（异步 awrap_model_call，"
                "asyncio.run(graph.ainvoke(...))），退回不强制重试一次，run 正常收尾"
            ),
            "dimensions": ["D1"],
            "not_covered_here": [
                "真实 DashScope/qwen-plus 端点是否真的拒绝具名 tool_choice"
                "（issue #2417 排查已确认这不是那次生产事故的直接根因，见 harness.py 头注）"
            ],
            "task_mode_marker": TASK_MODE_MARKER,
            "model_call_tool_choices": [c["bound_tool_choice"] for c in model.calls],
            "tool_call_names_in_transcript": tool_call_names(result["messages"]),
        },
    )


def test_scripted_provider_rejects_tool_choice_is_importable():
    """纯粹的接线看守：确保 `ScriptedProviderRejectsToolChoice` 真的从 `_scripted`
    导出，不是本文件顶部 import 到一个不存在的符号却因为其它测试先跑过而没暴露。"""
    assert issubclass(ScriptedProviderRejectsToolChoice, Exception)
