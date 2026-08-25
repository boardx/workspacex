"""TC-4 30 轮超长上下文：第 30 轮追问第 2 轮的细节（检验 D8 D4）。

场景定义（rubric 原文）：「30 轮超长上下文：第 30 轮追问第 2 轮的细节，验证摘要质量
与条件召回」。

## 这条测试**能**证明什么、**不能**证明什么（先说清楚，避免被当成 D8 满分凭据）

能证明的是**引擎侧的上下文工程真的发生了**：
- 对话涨到钉死的 60000 token 触发线时，`SummarizationMiddleware` 真的被触发；
- 触发的是**语义摘要**（老消息被一段摘要替换、最近 20 条保留），不是粗暴截断；
- 第 2 轮说过的事实经过摘要仍然在第 30 轮的模型可见上下文里 —— 条件召回成立。

不能证明的是「**摘要质量**」。这里的摘要器是假模型：它按一条机械规则（把
transcript 里所有 `事实：` 开头的句子原样抄进 `## SUMMARY`）产出摘要。因此
「事实活下来了」是**引擎把对的消息交给了摘要器、又把摘要接回了上下文**的证据，
不是「真模型摘得好」的证据。后者必须用真模型跑一遍活体对话来判，本文件不冒充。

| 检验点 | 本文件 | 说明 |
|---|---|---|
| D8① 到阈值触发滚动语义摘要（非截断） | ✅ 全自动 | 阈值用生产钉死的 60000，不 monkeypatch |
| D8 条件召回：第 30 轮拿得到第 2 轮的事实 | ✅ 全自动 | 断言落在模型第 30 轮**实际收到的消息**上 |
| D4 跨轮次状态由 checkpointer 承载 | ✅ 全自动 | 30 轮共用一个 thread_id，历史从 checkpointer 取 |
| 摘要**质量** | ❌ 不在本文件 | 需真模型活体对话人工判读 |
| D4 跨**进程**恢复 / 时间旅行 | ❌ 不在本文件 | 见 TC-5（真 Postgres + 真 kill） |
"""
from __future__ import annotations

import re

import pytest
from langchain_core.messages import AIMessage

from _scripted import ScriptedChatModel

ROUNDS = 30
SECRET_FACT = "事实：阿尔法项目的季度预算是 730 万元。"
FACT_NEEDLE = "730 万元"
# 每轮塞进去的填充文本。`SummarizationMiddleware` 的触发线是生产钉死的 60000 token，
# 这里靠真实把对话撑过那条线来触发，而不是把阈值改小——改小了就测不到生产配置。
FILLER = "背景补充：" + ("这是一段与主题相关但不含关键事实的会议记录内容。" * 400)


def _summary_prompt(messages) -> bool:  # noqa: ANN001
    return any(
        "Context Extraction Assistant" in str(getattr(m, "content", "")) for m in messages
    )


def _make_router(seen: dict):  # noqa: ANN202
    def router(messages, bound_tools):  # noqa: ANN001, ANN202
        # ① 摘要器链：机械摘要——把所有「事实：」句子原样抄进摘要（理由见模块注释）。
        if _summary_prompt(messages):
            seen["summaries"] = seen.get("summaries", 0) + 1
            # 摘要器收到的是把整段历史渲染进**一条** HumanMessage 的文本
            # （库的 prompt 原话：「The user will message you with the full message
            # history」），所以按行首匹配抓不到——用正则在全文里捞「事实：」句子。
            # 这条注释就是第一版红的存档：按 splitlines().startswith 抓到 0 条。
            blob = "\n".join(str(getattr(m, "content", "")) for m in messages)
            facts = re.findall(r"事实：[^\n。]*。", blob)
            return AIMessage(
                content="## SESSION INTENT\n多轮问答\n\n## SUMMARY\n" + "\n".join(facts or ["None"])
                + "\n\n## ARTIFACTS\nNone\n\n## NEXT STEPS\n继续回答用户问题"
            )

        # ② 主链：记录本轮模型**实际收到**的上下文，并在被追问时只依据它作答。
        visible = "\n".join(str(getattr(m, "content", "")) for m in messages)
        seen["last_visible_context"] = visible
        seen["last_visible_message_count"] = len(messages)
        if "第 2 轮" in visible.split("\n")[-1] or "季度预算是多少" in visible.split("\n")[-1]:
            if FACT_NEEDLE in visible:
                return AIMessage(content=f"你在第 2 轮说过：阿尔法项目的季度预算是 {FACT_NEEDLE}。")
            return AIMessage(content="抱歉，这条细节已经不在我的上下文里了。")
        return AIMessage(content="收到。")

    return router


@pytest.fixture
def tc4(monkeypatch):  # noqa: ANN001, ANN201
    from langgraph.checkpoint.memory import MemorySaver

    from deepagents import create_deep_agent
    from deep_agent_service.harness import build_middleware

    # 退出前自检与本条无关，关掉——省掉每轮一次 grader 调用带来的噪音。
    monkeypatch.delenv("DEEP_AGENT_PRECOMPLETION_CHECKLIST", raising=False)
    seen: dict = {}
    model = ScriptedChatModel(router=_make_router(seen))
    graph = create_deep_agent(model=model, middleware=build_middleware(model), checkpointer=MemorySaver())
    return graph, seen


def test_tc4_round30_recalls_round2_detail_through_summary(tc4, evidence):  # noqa: ANN001, ANN201
    graph, seen = tc4
    config = {"configurable": {"thread_id": "tc4-long-context"}}

    for turn in range(1, ROUNDS + 1):
        if turn == 2:
            text = f"{SECRET_FACT}\n{FILLER}"
        elif turn == ROUNDS:
            text = "回到第 2 轮：阿尔法项目的季度预算是多少？"
        else:
            text = f"第 {turn} 轮。{FILLER}"
        result = graph.invoke({"messages": [{"role": "user", "content": text}]}, config)

    # D8①：到了钉死的触发线，摘要真的发生了（不是一路裸增长，也不是截断）。
    assert seen.get("summaries", 0) >= 1, "对话撑过 60000 token 触发线后必须发生滚动摘要"
    visible = seen["last_visible_context"]
    assert "## SUMMARY" in visible, "上下文里必须有语义摘要段，而不只是被砍短的原始消息"

    # D8 条件召回：第 2 轮的事实经过摘要仍在第 30 轮模型**实际收到**的上下文里。
    assert FACT_NEEDLE in visible, "第 2 轮的事实必须经摘要活到第 30 轮的可见上下文里"

    # 压缩确实发生：第 30 轮模型看到的消息数远少于 30 轮原始消息总数。
    assert seen["last_visible_message_count"] < ROUNDS * 2, (
        f"摘要后可见消息数应显著少于原始轮次，实际 {seen['last_visible_message_count']}"
    )

    final_text = str(getattr(result["messages"][-1], "content", ""))
    assert FACT_NEEDLE in final_text, f"第 30 轮必须答出第 2 轮的细节，实际：{final_text}"

    evidence.write(
        "tc4-long-context-recall",
        {
            "scenario": "30 轮超长上下文，第 30 轮追问第 2 轮细节",
            "dimensions": ["D8①", "D8 条件召回", "D4 跨轮次状态"],
            "not_covered_here": ["摘要质量（需真模型）", "D4 跨进程恢复与时间旅行（见 TC-5）"],
            "rounds": ROUNDS,
            "summarizations_triggered": seen.get("summaries"),
            "summarization_trigger_pinned": "tokens=60000（harness.build_middleware，未 monkeypatch）",
            "visible_messages_at_round_30": seen["last_visible_message_count"],
            "fact_planted_at_round": 2,
            "fact_recalled": FACT_NEEDLE in final_text,
            "final_answer": final_text,
        },
    )


def test_tc4_counterproof_fact_is_not_in_the_recent_window(tc4):  # noqa: ANN001, ANN201
    """反证：第 2 轮的事实**不在**「最近 20 条」保留窗口里——所以上面那条召回成功
    只可能来自摘要通路，不是「消息本来就还在」。没有这条，TC-4 的绿灯说明不了任何事。
    """
    graph, seen = tc4
    config = {"configurable": {"thread_id": "tc4-counterproof"}}
    for turn in range(1, ROUNDS + 1):
        text = f"{SECRET_FACT}\n{FILLER}" if turn == 2 else f"第 {turn} 轮。{FILLER}"
        graph.invoke({"messages": [{"role": "user", "content": text}]}, config)

    visible = seen["last_visible_context"]
    summary_start = visible.index("## SESSION INTENT")
    after_summary = visible[summary_start:]
    body_after_summary = after_summary.split("## NEXT STEPS", 1)[-1]
    assert FACT_NEEDLE not in body_after_summary, (
        "第 2 轮的原始消息不该还留在保留窗口里——否则召回与摘要无关"
    )
