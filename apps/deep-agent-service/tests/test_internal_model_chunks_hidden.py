"""上下文摘要的英文整段不许流进聊天正文（2026-09-27 devapp 实测）。

长 PPT 任务触发上下文摘要，摘要调用输出的 "## SESSION INTENT / ARTIFACTS / NEXT STEPS"
被当成 agent 回答显示给用户。这里用**真实**的 langchain `SummarizationMiddleware` 摘要
调用、在真实 LangGraph 节点里、按运行时同样的 `astream(stream_mode=["messages"])` 取流，
再过运行时的过滤器。配对用例：普通模型调用的 token 必须照常通过——修法不许滑向"全藏"。
"""
import asyncio

from langchain.agents.middleware import SummarizationMiddleware
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.graph import START, StateGraph, MessagesState

from deep_agent_service.self_hosted_runtime import is_internal_model_chunk

SUMMARY = "## SESSION INTENT\nbuild ppt\n## NEXT STEPS\ninspect /workspace/preview"
ANSWER = "PPT 已生成。"


def _graph():
    summarizer = SummarizationMiddleware(
        model=GenericFakeChatModel(messages=iter([AIMessage(content=SUMMARY)])),
        trigger=("tokens", 10), keep=("messages", 1),
    )
    answer_model = GenericFakeChatModel(messages=iter([AIMessage(content=ANSWER)]))

    def node(state):
        summarizer._create_summary([HumanMessage(content="old turn " * 20)])
        return {"messages": [answer_model.invoke(state["messages"])]}

    return StateGraph(MessagesState).add_node("agent", node).add_edge(START, "agent").compile()


async def _stream(filtered: bool) -> str:
    text = []
    async for mode, data in _graph().astream({"messages": [HumanMessage(content="go")]}, stream_mode=["messages"]):
        if filtered and is_internal_model_chunk(mode, data):
            continue
        text.append(str(getattr(data[0], "content", "")))
    return "".join(text)


def test_raw_stream_really_leaks_the_summary():
    """前提反证：不过滤时摘要确实在流里——否则下面的"没泄露"是空转。"""
    assert "SESSION INTENT" in asyncio.run(_stream(filtered=False))


def test_summary_tokens_are_dropped():
    assert "SESSION INTENT" not in asyncio.run(_stream(filtered=True))


def test_normal_answer_tokens_still_pass():
    assert ANSWER in asyncio.run(_stream(filtered=True))


def test_spoofed_marker_does_not_hide_real_output():
    assert not is_internal_model_chunk("messages", (AIMessage(content="x"), {"lc_internal_call": "guess"}))
    assert not is_internal_model_chunk("values", {"messages": []})
