"""TC-3 连续故障注入 + 会循环的任务 + 退出前自检（检验 D7 三件套 + 退出自检）。

场景定义（rubric 原文）：「让一个工具连续失败 3 次 + 构造一个会循环的任务，
验证自愈/熔断/通告」。

## 与 `tests/test_harness.py` 里 D7 单测的分工（不是重复劳动）

那边是**逐件**的机制单测（重试一件、工具预算一件、模型预算一件，各自最小场景）。
本文件是 rubric 要求的**组合场景**：同一次 run 里先撞连续失败、再撞死循环，看三件
在一起是否还成立——组合起来才是「一个真会出事的任务」，也才有资格作为评分证据。
第二个测试补的是 DA-09 新接的 `RubricMiddleware`（退出前对照清单自检）。

## 自动化分级

| 检验点 | 本文件 | 说明 |
|---|---|---|
| D7① 失败逐条可见 + 重试 + 改道 | ✅ 全自动 | 失败次数是工具自己记的副作用计数，不是文本匹配 |
| D7② 死循环不会跑飞 | ✅ 全自动 | 剧本无限调同一个工具，run 仍在预算内终止 |
| D7③ 熔断带**明确通告** | ✅ 全自动 | 终稿消息里有 limit 通告，不是静默截断/裸异常 |
| D7 退出前自检 | ✅ 全自动 | grader 判 needs_revision → 真的跳回模型返工一轮 |
| 失败事件在**前端**逐条渲染 | ❌ 不在本文件 | 需要活体 SSE + 前端，见 rubric 物理证据闭环 |
| 「agent 不编造成功」的语义判断 | ❌ 不在本文件 | 假模型按剧本走，编不编造由真模型决定 |
"""
from __future__ import annotations

import pytest
from langchain_core.messages import ToolMessage, AIMessage, HumanMessage
from langchain_core.tools import tool

from _scripted import ScriptedChatModel, ai_tool_call, grader_always_satisfied_response, tool_call_names

# ToolRetryMiddleware(max_retries=2) = 1 次首发 + 2 次重试 = 同一个工具调用最多 3 次尝试。
# rubric 的「连续失败 3 次」就钉在这个数上：三次尝试全败，错误如实回给模型，模型改道。
EXPECTED_ATTEMPTS_BEFORE_GIVING_UP = 3


def _fault_tools(ledger: dict):  # noqa: ANN202
    @tool
    def flaky_probe(query: str) -> str:
        """一个不稳定的探针工具。"""
        ledger["flaky_attempts"] = ledger.get("flaky_attempts", 0) + 1
        msg = f"upstream unavailable (attempt {ledger['flaky_attempts']})"
        raise RuntimeError(msg)

    @tool
    def stable_probe(query: str) -> str:
        """一个稳定的备用探针工具。"""
        ledger["stable_calls"] = ledger.get("stable_calls", 0) + 1
        return f"stable result for {query}"

    return [flaky_probe, stable_probe]


def _router(messages, bound_tools):  # noqa: ANN001, ANN201
    """剧本：先打 flaky_probe（会连续失败），拿到错误后改道 stable_probe，
    然后**永远**接着调 stable_probe——这就是「会循环的任务」，靠引擎的预算熔断收场，
    不靠剧本自己停。

    Phase 14 F02（R6）起 `RubricMiddleware` 的默认清单播种无条件生效（见
    `grader_always_satisfied_response` 头注：本测试要看的是预算熔断本身的收尾
    形状，不是退出前自检——那件由 `test_tc3_precompletion_checklist_forces_a_revision`
    专门覆盖），所以对 grader 调用固定判"合格"放行，不让它跳回主链再吃一轮预算、
    把终稿形状搅浑。
    """
    if bound_tools == ["GraderResponse"]:
        return grader_always_satisfied_response()
    already = tool_call_names(messages)
    if "flaky_probe" not in already:
        return ai_tool_call("flaky_probe", {"query": "q"}, "tc3-flaky-1")
    n = already.count("stable_probe")
    return ai_tool_call("stable_probe", {"query": f"q{n}"}, f"tc3-stable-{n}")


@pytest.fixture
def tc3():  # noqa: ANN201
    from deepagents import create_deep_agent

    from deep_agent_service.harness import build_middleware

    # Phase 14 F02（R6）起退出前自检无条件生效，不能再靠环境变量关掉——`_router`
    # 自己对 GraderResponse 调用固定判"合格"放行（见 `_router` 头注），达到同样的
    # 效果："本测试要看预算熔断的收尾形状，不让 grader 把终稿形状搅浑"。
    ledger: dict = {}
    model = ScriptedChatModel(router=_router)
    graph = create_deep_agent(
        model=model,
        tools=_fault_tools(ledger),
        middleware=build_middleware(model),
    )
    return graph, ledger


def test_tc3_fault_injection_then_loop_hits_budget_with_notice(tc3, evidence):  # noqa: ANN001, ANN201
    from deep_agent_service.harness import RUN_MODEL_CALL_LIMIT

    graph, ledger = tc3
    # recursion_limit 给得远高于预算——如果引擎的熔断没生效，这条会以
    # GraphRecursionError 炸出来（「跑飞了」），而不是悄悄地绿。
    #
    # Phase 14 F02（R6）：`TaskClassifierMiddleware` 无条件挂载后，`build_middleware()`
    # 每一轮循环多走一个 `before_model` 节点（见 harness.py `build_middleware()` 挂载
    # 那一行上方的注释），图形状变了、不是熔断逻辑变了——同一份 25 次模型调用预算现在
    # 要吃掉更多 recursion 步数，200 已经不够远高于预算（实测卡在 23 轮左右撞
    # GraphRecursionError，达不到 RUN_MODEL_CALL_LIMIT=25 就先撞了外层步数上限）。
    # 抬到 1000，继续保持"远高于预算"的安全边际。
    result = graph.invoke(
        {"messages": [{"role": "user", "content": "反复探测直到拿到完整答案"}]},
        {"recursion_limit": 1000},
    )

    # D7①：同一个工具调用真的被重试了 3 次（副作用计数，不是文本匹配）。
    assert ledger.get("flaky_attempts") == EXPECTED_ATTEMPTS_BEFORE_GIVING_UP, (
        f"ToolRetryMiddleware(max_retries=2) 应产生 3 次尝试，实际 {ledger.get('flaky_attempts')}"
    )
    # 失败如实进对话（不是被吞掉后伪装成成功）。
    texts = [str(getattr(m, "content", "")) for m in result["messages"]]
    assert any("upstream unavailable" in t for t in texts), "工具失败必须如实回到对话里"
    # 改道：模型拿到错误后换了另一条工具路径，并真的拿到了成功结果。
    assert ledger.get("stable_calls", 0) >= 1, "重试仍败后必须改道到别的工具"

    # D7②③：会循环的任务在预算内被熔断，且**明确通告**。
    assert "__interrupt__" not in result
    notice = [t for t in texts if "limit" in t.lower()]
    assert notice, f"预算耗尽必须有明确通告，不是静默截断。终稿消息：{texts[-3:]}"
    ai_turns = [m for m in result["messages"] if isinstance(m, AIMessage)]
    assert len(ai_turns) <= RUN_MODEL_CALL_LIMIT + 2, (
        f"模型调用必须被 {RUN_MODEL_CALL_LIMIT} 的预算钉住，实际 {len(ai_turns)} 轮"
    )

    evidence.write(
        "tc3-fault-injection-and-budget",
        {
            "scenario": "连续故障注入 + 会循环的任务",
            "dimensions": ["D7①", "D7②", "D7③"],
            "not_covered_here": ["失败事件的前端逐条渲染", "「不编造成功」的语义判断（需真模型）"],
            "flaky_attempts": ledger.get("flaky_attempts"),
            "stable_calls": ledger.get("stable_calls"),
            "model_call_budget": RUN_MODEL_CALL_LIMIT,
            "ai_turns": len(ai_turns),
            "budget_notice": notice[-1][:500],
            "recursion_limit_used": 1000,
        },
    )


# ── DA-09 新增：退出前对照清单自检（RubricMiddleware，官方等价件）──


def _checklist_router(grader_verdicts: list[str]):  # noqa: ANN202
    """两条链共用一个假模型：

    · grader 链——`create_agent(..., response_format=GraderResponse)` 把结构化输出
      当成一个名为 `GraderResponse` 的工具绑上去（实测：`bind_tools` 收到的名字就是
      `GraderResponse`，`tool_choice='any'`）。按 `grader_verdicts` 依次给判词。
    · 主链——第一轮给一个**明显不合格**的答复（只说打算做什么），被打回后才给结论。
    """

    def router(messages, bound_tools):  # noqa: ANN001, ANN202
        if bound_tools == ["GraderResponse"]:
            verdict = grader_verdicts[min(len(_grader_calls), len(grader_verdicts) - 1)]
            _grader_calls.append(verdict)
            if verdict == "satisfied":
                args = {
                    "result": "satisfied",
                    "explanation": "清单五条全部满足",
                    "criteria": [{"name": "结论可直接使用", "passed": True}],
                }
            else:
                args = {
                    "result": "needs_revision",
                    "explanation": "第 5 条不满足：只有过程陈述，没有结论",
                    "criteria": [
                        {
                            "name": "最终回复是可直接使用的结论",
                            "passed": False,
                            "gap": "回复只写了『我接下来打算……』，没有给出结论",
                        }
                    ],
                }
            return AIMessage(content="", tool_calls=[{"id": f"grade-{len(_grader_calls)}", "name": "GraderResponse", "args": args}])

        # 主链：先真的调一次 write_todos（issue #2836 选项 A 起，本轮没有任何工具调用的
        # 纯文本回复不评分——D7 钉的是"有工具的轮次"被拦下返工），然后给一个明显
        # 不合格的过程陈述；被打回过（transcript 里出现了 grader 的返工指示）就给结论。
        if not any(isinstance(m, ToolMessage) for m in messages):
            return AIMessage(
                content="",
                tool_calls=[{"id": "todo-1", "name": "write_todos", "args": {"todos": [{"content": "查资料", "status": "in_progress"}]}}],
            )
        revised = any(
            isinstance(m, HumanMessage) and "打算" in str(getattr(m, "content", ""))
            for m in messages
        )
        if revised:
            return AIMessage(content="结论：建议先做市场扫描再做风险复核，理由如下……")
        return AIMessage(content="我接下来打算查一下资料。")

    _grader_calls: list[str] = []
    router.grader_calls = _grader_calls  # type: ignore[attr-defined]
    return router


def _checklist_graph():  # noqa: ANN202
    from deepagents import create_deep_agent

    from deep_agent_service.harness import build_middleware

    router = _checklist_router(["needs_revision", "satisfied"])
    model = ScriptedChatModel(router=router)
    graph = create_deep_agent(model=model, middleware=build_middleware(model))
    return graph, router


def test_tc3_precompletion_checklist_forces_a_revision(evidence):  # noqa: ANN201
    """D7 退出前自检：本来要收尾的那一刻被拦下，带着差距说明跳回模型返工一轮。
    Phase 14 F02（R6）起默认清单的播种无条件生效，不再是灰度开关。"""
    graph, router = _checklist_graph()
    result = graph.invoke(
        {"messages": [{"role": "user", "content": "给我一个可执行的建议"}]},
        {"recursion_limit": 40},
    )

    # grader 真的跑了两轮：第一轮打回、第二轮放行。
    assert router.grader_calls == ["needs_revision", "satisfied"], (
        f"退出前自检必须真实发生并在合格后放行，实际 {router.grader_calls}"
    )
    # 差距说明真的作为 HumanMessage 注入回主链（这是「返工」而不是「重说一遍」的凭据）。
    injected = [
        str(m.content) for m in result["messages"] if isinstance(m, HumanMessage) and "打算" in str(m.content)
    ]
    assert injected, "grader 的 gap 必须注入回主链，否则模型不知道要改什么"
    # 终稿是返工后的那一版，不是那句被判不合格的过程陈述。
    final_text = str(getattr(result["messages"][-1], "content", ""))
    assert final_text.startswith("结论："), f"终稿必须是返工后的结论，实际：{final_text}"

    evidence.write(
        "tc3b-precompletion-checklist",
        {
            "scenario": "退出前对照清单自检（RubricMiddleware，官方等价件）",
            "dimensions": ["D7 退出前自检"],
            "upstream_component": "deepagents.RubricMiddleware（0.7.6，beta 标记）",
            "grader_verdicts_in_order": router.grader_calls,
            "injected_revision_feedback": injected,
            "final_answer": final_text,
        },
    )


