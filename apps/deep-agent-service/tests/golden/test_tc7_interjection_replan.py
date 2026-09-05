"""TC-7 中途插话回灌内核：`InterjectionMiddleware`（Phase 14 后续 A，issue #2755）。

## 这条 TC 在证明什么

F11（PR #2742）把插话做到了网关侧，并如实记录：插话文本没有真正回到这张图，内核
不会据此重规划。本文件证明的是那道边界已经关掉——TS 网关投影到
`config.configurable["interjection"]` 的那条插话（契约 `KernelInterjection` 形状）：

1. 被 `InterjectionMiddleware.before_model` 以 `HumanMessage` 注入图状态（transcript
   里真的多出这条人类消息，带固定 id 前缀 `interjection:`）；
2. 注入后的下一次模型调用被钉成 `tool_choice="write_todos"`（确定性强制，不靠模型
   服从概率——与 TC-6 同一条纪律），transcript 里真的出现 `write_todos` 调用；
3. 强制只发生一次：`write_todos` 调过之后不再强制；
4. **生产实际路径**——HITL 中断之后的 resume 续跑：插话就是随这次 resume 的 config
   进来的（TS 侧 `deep-agent-model-provider.ts` 只在 resume 请求上才有机会带它，
   见 `interjection-handling.ts` 头注），注入落在刚执行完的 ToolMessage 之后；
5. 同一条插话（同一个 interjectionId）在同一线程上第二次出现时不重复注入；
6. 反证：没有这个 configurable 键 ⇒ 零注入、零强制，行为与本 feature 之前逐字节相同；
   形状不合契约 ⇒ 忽略（warning），不注入、不判死。

同步 `graph.invoke()` 与异步 `asyncio.run(graph.ainvoke(...))` 两条路径都跑
（issue #2417 教训：`langgraph dev` 走异步 runtime，只实现同步钩子的中间件会在业务
逻辑之前 `NotImplementedError`）。

## 自动化分级

| 检验点 | 本文件 | 说明 |
|---|---|---|
| configurable.interjection → HumanMessage 注入 + 强制 write_todos（同步 + 异步） | ✅ 全自动 | 断言 transcript 与 `bound_tool_choice` |
| HITL resume 路径：插话随 resume config 进来，注入落在 ToolMessage 之后 | ✅ 全自动 | `Command(resume=...)` + `MemorySaver` |
| 同一 interjectionId 不重复注入 | ✅ 全自动 | 同线程两次 invoke |
| 反证：无键不注入不强制 / 坏形状忽略 | ✅ 全自动 | |
| 真实模型收到插话后重规划的质量 | ❌ 不在本文件 | 假模型证明的是引擎行为，不是模型质量 |
"""
from __future__ import annotations

import asyncio

from langchain_core.messages import AIMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from _scripted import (
    ScriptedChatModel,
    grader_always_satisfied_response,
    tool_call_names,
)
from deep_agent_service.harness import (
    _INTERJECTION_CONFIG_KEY,
    _INTERJECTION_MESSAGE_ID_PREFIX,
    build_interrupt_on,
    build_middleware,
)

PLAIN_ANSWER = "好的，继续按当前计划推进。"
INTERJECTION_TEXT = "把第二页标题改成 X"


def _interjection(text: str = INTERJECTION_TEXT, *, interjection_id: str = "itj-1", classification: str = "adjustment") -> dict:
    """契约 `KernelInterjection` 形状——字段名逐字来自 `packages/contracts/src/artifacts-steering.ts`
    （`cross-lang-interjection-parity.test.ts` 机械比对 harness.py 常量与契约；这里
    只是构造一份合法输入）。"""
    return {
        "interjectionId": interjection_id,
        "text": text,
        "classification": classification,
        "receivedAt": "2026-09-05T00:00:00.000Z",
    }


def _config(thread_id: str, interjection: object = None) -> dict:
    """本文件所有 run 都关掉 `TaskClassifierMiddleware` 的自动判类
    （`disable_task_auto_classify`，issue #2667 的 per-run 开关）：它也会在判为多步任务
    时把 tool_choice 钉成 write_todos，不关掉就分不清"强制"是谁做的——这里要证明的是
    `InterjectionMiddleware` 单独就能触发重规划，正向与反证都必须在同一隔离条件下。"""
    configurable: dict = {"thread_id": thread_id, "disable_task_auto_classify": True}
    if interjection is not None:
        configurable[_INTERJECTION_CONFIG_KEY] = interjection
    return {"configurable": configurable}


def _plain_router(messages, bound_tools):  # noqa: ANN001, ANN201
    """不合作假模型：永远只想用纯文字回答，从不主动调用 write_todos——如果 transcript 里
    出现了 write_todos，只能是中间件强制生效了。"""
    if bound_tools == ["GraderResponse"]:
        return grader_always_satisfied_response()
    return AIMessage(content=PLAIN_ANSWER)


def _build_graph(model: ScriptedChatModel, *, tools=None, hitl: bool = False):  # noqa: ANN001, ANN201
    from deepagents import create_deep_agent

    kwargs = {"checkpointer": MemorySaver()}
    if hitl:
        kwargs["interrupt_on"] = build_interrupt_on()
    return create_deep_agent(model=model, tools=tools or [], middleware=build_middleware(model), **kwargs)


def _invoke(graph, payload, config):  # noqa: ANN001, ANN201
    """本文件所有**同步** `graph.invoke()` 都走这里：`durability="sync"`。

    2026-09-05 事故（PR #2762 合入时 CI `pytest` job 挂死到 20 分钟超时，issue #2755）：
    根因不在 `InterjectionMiddleware`，在 langgraph 1.2.11 同步执行器的一个死锁——
    `durability="async"`（默认）时每一步的 checkpoint `put` 都丢进同一个
    `ThreadPoolExecutor`（CPU+4 = CI 4 核上 8 个 worker）后台链式执行：第 N 次 put 先
    `wait` 它开跑那一刻已提交的所有 delta-write future，再 `wait` 第 N-1 次 put。假模型
    零延迟，主线程出步子比 worker 写 checkpoint 快，队列里就堆成
    `[put N, writes N+1, put N+1, writes N+2, …]`：put N 开跑时把 writes N+7 也纳入等待，
    而 writes N+7 排在 put N+1…N+7 之后——那 7 个各占一个 worker 等 put N，8 个 worker
    全部在等，writes N+7 永远拿不到线程。faulthandler 实测栈：7 个线程停在
    `_loop.py::_checkpointer_put_after_previous` 的 `prev.result()`，1 个停在
    `concurrent.futures.wait(futs)`，主线程在 `BackgroundExecutor.__exit__` 等全部 future。

    为什么只有本文件撞上：这是时序竞争，CPython 3.12（CI）比 3.11 更容易触发；
    本地 3.12 单跑本文件 3 次中 1 次挂死（随机落在不同测试上），TC-2/TC-4 各 3 次 0 挂。
    本文件每条测试都用 `MemorySaver` + 同步 invoke，暴露面最大。

    `durability="sync"` 让主线程每一步都等当次 put 落地后再出下一步——任何时刻最多
    一次 put 在飞，线程池不可能被 put 占满，死锁在结构上不可能发生。它只改
    checkpoint 何时落盘，不改中间件的任何行为，本文件的断言一条不动。
    异步路径（`asyncio.run(graph.ainvoke(...))`）用的是 asyncio task，不经过这个有界线程池，
    保持生产（`langgraph dev`）的默认口径不变。
    """
    return graph.invoke(payload, config, durability="sync")


def _main_agent_tool_choices(model: ScriptedChatModel) -> list:
    """主 agent 链上每次模型调用的 tool_choice——排除 `RubricMiddleware` 的 grader 调用
    （它绑 `GraderResponse` 结构化输出、自带 tool_choice="any"，与本文件要观测的
    write_todos 强制无关）。"""
    return [c["bound_tool_choice"] for c in model.calls if c["bound_tools"] != ["GraderResponse"]]


def _interjection_messages(messages) -> list:  # noqa: ANN001
    return [
        m for m in messages
        if getattr(m, "type", None) == "human" and str(getattr(m, "id", "") or "").startswith(_INTERJECTION_MESSAGE_ID_PREFIX)
    ]


def _assert_injected_and_replanned(model: ScriptedChatModel, result: dict, *, label: str) -> list[str]:
    injected = _interjection_messages(result["messages"])
    assert len(injected) == 1, f"[{label}] 插话必须以 HumanMessage 注入且只注入一次，实际 {len(injected)} 条"
    assert INTERJECTION_TEXT in str(injected[0].content), f"[{label}] 注入的人类消息必须带插话原文"
    assert "write_todos" in str(injected[0].content), f"[{label}] 注入文本要明说先用 write_todos 更新计划"

    assert model.calls[0]["bound_tool_choice"] == "write_todos", (
        f"[{label}] 注入插话后的第一次模型调用必须被钉成 write_todos，实际 {model.calls[0]['bound_tool_choice']!r}"
    )
    names = tool_call_names(result["messages"])
    assert "write_todos" in names, f"[{label}] 强制生效后 transcript 必须包含 write_todos 调用，实际 {names}"
    assert model.calls[1]["bound_tool_choice"] is None, (
        f"[{label}] write_todos 调过之后不应继续强制，实际 {model.calls[1]['bound_tool_choice']!r}"
    )
    # 顺序：插话消息在 write_todos 调用之前——重规划是"据此"发生的，不是先规划再看到插话。
    idx_injected = result["messages"].index(injected[0])
    idx_write_todos = next(
        i for i, m in enumerate(result["messages"])
        if any(c.get("name") == "write_todos" for c in (getattr(m, "tool_calls", None) or []))
    )
    assert idx_injected < idx_write_todos, f"[{label}] write_todos 必须在插话注入之后被调用"
    return names


def test_interjection_in_configurable_is_injected_and_forces_write_todos_sync(evidence):  # noqa: ANN001
    model = ScriptedChatModel(router=_plain_router)
    graph = _build_graph(model)

    result = _invoke(
        graph,
        {"messages": [{"role": "user", "content": "帮我做一份季度回顾"}]},
        _config("tc7-sync", _interjection()),
    )
    names = _assert_injected_and_replanned(model, result, label="sync")
    evidence.write(
        "tc7-interjection-replan-sync",
        {
            "scenario": "configurable.interjection → HumanMessage 注入 + 确定性强制 write_todos（同步 graph.invoke()）",
            "issue": "#2755",
            "model_call_tool_choices": [c["bound_tool_choice"] for c in model.calls],
            "tool_call_names_in_transcript": names,
            "injected_message_ids": [m.id for m in _interjection_messages(result["messages"])],
        },
    )


def test_interjection_in_configurable_is_injected_and_forces_write_todos_async(evidence):  # noqa: ANN001
    """异步路径——issue #2417 的直接反证：`abefore_model`/`awrap_model_call` 缺任何一个，
    这里会在框架抛出的 `NotImplementedError` 上失败。"""
    model = ScriptedChatModel(router=_plain_router)
    graph = _build_graph(model)

    result = asyncio.run(
        graph.ainvoke(
            {"messages": [{"role": "user", "content": "帮我做一份季度回顾"}]},
            _config("tc7-async", _interjection()),
        )
    )
    names = _assert_injected_and_replanned(model, result, label="async")
    evidence.write(
        "tc7-interjection-replan-async",
        {
            "scenario": "同上，异步 asyncio.run(graph.ainvoke(...))——生产 langgraph dev 的实际调用方式",
            "issue": "#2755",
            "model_call_tool_choices": [c["bound_tool_choice"] for c in model.calls],
            "tool_call_names_in_transcript": names,
        },
    )


def test_interjection_arrives_on_hitl_resume_and_lands_after_the_tool_result(evidence):  # noqa: ANN001
    """生产实际路径：run 停在 L2 工具的 HITL interrupt；网关在那个检查点消费插话，随
    resume 请求的 config 把它投递进来（`deep-agent-model-provider.ts` resume 分支）。
    期望：被批准的工具先真实执行（I-5：插话不打断当次调用），插话消息落在它的
    ToolMessage 之后，紧接着的模型调用被钉成 write_todos。"""
    executed: list[str] = []

    @tool
    def call_skill(payload: str) -> str:
        """A tool that must not run without approval."""
        executed.append(payload)
        return f"EXECUTED:{payload}"

    def router(messages, bound_tools):  # noqa: ANN001, ANN201
        if bound_tools == ["GraderResponse"]:
            return grader_always_satisfied_response()
        already_ran = any("EXECUTED" in str(getattr(m, "content", "")) for m in messages)
        if not already_ran:
            return AIMessage(content="", tool_calls=[{"id": "c1", "name": "call_skill", "args": {"payload": "x"}}])
        return AIMessage(content=PLAIN_ANSWER)

    model = ScriptedChatModel(router=router)
    graph = _build_graph(model, tools=[call_skill], hitl=True)
    first = _invoke(graph, {"messages": [{"role": "user", "content": "go"}]}, _config("tc7-hitl-resume"))
    assert "__interrupt__" in first, "前置条件：run 先停在 HITL interrupt"
    assert executed == [], "批准前工具绝不能执行"
    assert _interjection_messages(first["messages"]) == [], "第一次 run 的 config 没带插话，不该有注入"

    resumed = _invoke(
        graph,
        Command(resume={"decisions": [{"type": "approve"}]}),
        _config("tc7-hitl-resume", _interjection(classification="direction_change")),
    )
    assert executed == ["x"], "批准后工具必须真实执行且只执行一次"
    msgs = resumed["messages"]
    injected = _interjection_messages(msgs)
    assert len(injected) == 1
    assert "方向性改变" in str(injected[0].content), "分类标签要透传给模型"
    idx_tool_result = next(i for i, m in enumerate(msgs) if "EXECUTED:x" in str(getattr(m, "content", "")))
    idx_injected = msgs.index(injected[0])
    assert idx_tool_result < idx_injected, "插话必须落在刚执行完的 ToolMessage 之后（不打断当次调用）"

    # 第一次模型调用（发起 call_skill）未被强制；resume 后紧接着的那次被钉成 write_todos。
    choices = [c["bound_tool_choice"] for c in model.calls]
    assert choices[0] is None
    assert "write_todos" in choices[1:], f"resume 后的模型调用里必须有一次被钉成 write_todos，实际 {choices}"
    names = tool_call_names(msgs)
    assert names.index("call_skill") < names.index("write_todos")
    assert "__interrupt__" not in resumed
    evidence.write(
        "tc7-interjection-on-hitl-resume",
        {
            "scenario": "HITL 中断 → resume 携带 configurable.interjection → 工具先执行、插话落在其后、随后强制 write_todos",
            "issue": "#2755",
            "model_call_tool_choices": choices,
            "tool_call_names_in_transcript": names,
            "executed_tool_payloads": executed,
        },
    )


def test_same_interjection_id_is_not_injected_twice_on_the_same_thread():
    """去重：TS 侧只投递一次，但内核侧也按 message id 去重（双保险）——同一
    interjectionId 在同一线程第二次出现在 config 里，不再注入、不再强制。"""
    model = ScriptedChatModel(router=_plain_router)
    graph = _build_graph(model)
    config = _config("tc7-dedupe", _interjection())

    _invoke(graph, {"messages": [{"role": "user", "content": "第一轮"}]}, config)
    second = _invoke(graph, {"messages": [{"role": "user", "content": "第二轮，普通追问"}]}, config)

    assert len(_interjection_messages(second["messages"])) == 1, "同一 interjectionId 只能注入一次"
    choices = [c["bound_tool_choice"] for c in model.calls]
    assert choices.count("write_todos") == 1, f"同一条插话只强制一次重规划，实际 {choices}"


def test_counterproof_without_interjection_key_nothing_changes():
    """反证：没有 configurable.interjection ⇒ 零注入、零强制——证明上面的绿灯是插话
    触发的，不是中间件对所有对话无条件生效。"""
    model = ScriptedChatModel(router=_plain_router)
    graph = _build_graph(model)

    result = _invoke(
        graph,
        {"messages": [{"role": "user", "content": "帮我做一份季度回顾"}]},
        _config("tc7-no-key"),
    )
    assert _interjection_messages(result["messages"]) == []
    assert all(choice is None for choice in _main_agent_tool_choices(model)), _main_agent_tool_choices(model)
    assert "write_todos" not in tool_call_names(result["messages"])


def test_counterproof_malformed_interjection_is_ignored_not_fatal():
    """形状不合契约（少字段 / 分类不在枚举内 / 空白文本）⇒ 忽略，run 正常收尾。"""
    for bad in (
        {"interjectionId": "x", "text": "缺 classification 与 receivedAt"},
        _interjection(classification="not_in_enum"),
        _interjection(text="   "),
        "not-a-dict",
    ):
        model = ScriptedChatModel(router=_plain_router)
        graph = _build_graph(model)
        result = _invoke(
            graph,
            {"messages": [{"role": "user", "content": "hi"}]},
            _config(f"tc7-bad-{abs(hash(str(bad)))}", bad),
        )
        assert _interjection_messages(result["messages"]) == [], f"坏形状 {bad!r} 不该被注入"
        assert all(choice is None for choice in _main_agent_tool_choices(model)), _main_agent_tool_choices(model)
        assert any(PLAIN_ANSWER in str(getattr(m, "content", "")) for m in result["messages"]), "run 必须正常收尾"
