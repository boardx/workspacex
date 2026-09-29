"""AG06 —— `escalate_matter` 在真编译图里真的中断，且三条 resume 路径都把结果交回 Agent。

网关侧（`apps/api/.../tool-permission-gate.ts`）决定：命中 escalationPolicy ⇒ 挂起，目标人
裁决以 `edit` 恢复（`edited_action.args` = EscalateDecision 原文）；未命中 ⇒ `approve`
原样放行。这里证明内核对这三种 resume 的真实行为——run 继续、模型收到裁决文本。
"""
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from deepagents import create_deep_agent
from deep_agent_service.harness import build_interrupt_on
from deep_agent_service.tools import build_tools

PROPOSED = {"matter": "budget_overrun", "reason": "超预算 20%", "contextRefs": ["art-1"]}


def _graph():
    class Scripted(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self

    model = Scripted(messages=iter([
        AIMessage(content="", tool_calls=[{"id": "c1", "name": "escalate_matter", "args": PROPOSED}]),
        AIMessage(content="done after decision"),
    ]))
    tools = build_tools(model)
    assert "escalate_matter" in {t.name for t in tools}
    assert "escalate_matter" in {t.name for t in build_tools(model, interactions_only=True)}
    return create_deep_agent(model=model, tools=tools, interrupt_on=build_interrupt_on(), checkpointer=MemorySaver())


def _resume(decision: dict, thread: str) -> list[str]:
    graph = _graph()
    config = {"configurable": {"thread_id": thread}}
    first = graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    assert "__interrupt__" in first and "escalate_matter" in str(first["__interrupt__"])
    result = graph.invoke(Command(resume={"decisions": [decision]}), config)
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert texts[-1] == "done after decision", "resume 之后 run 必须继续跑到模型下一轮"
    return texts


def test_edit_resolve_hands_decision_text_to_agent():
    texts = _resume({"type": "edit", "edited_action": {"name": "escalate_matter",
                     "args": {"decision": "resolve", "decisionText": "同意追加预算"}}}, "esc-resolve")
    assert any("负责人已裁决同意：同意追加预算" in t for t in texts)


def test_edit_reject_hands_reason_to_agent():
    texts = _resume({"type": "edit", "edited_action": {"name": "escalate_matter",
                     "args": {"decision": "reject", "reason": "不批"}}}, "esc-reject")
    assert any("负责人不同意：不批" in t for t in texts)


def test_approve_means_not_escalated_never_approved():
    texts = _resume({"type": "approve"}, "esc-approve")
    hit = [t for t in texts if "budget_overrun" in t and "未升级" in t]
    assert hit and "没有人批准" in hit[0]
