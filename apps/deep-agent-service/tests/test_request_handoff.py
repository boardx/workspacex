"""AG07 —— `request_handoff` 在真编译图里真的中断，且 resume 路径把网关的转交结果交回 Agent。

网关侧（`apps/api/.../handoff-gate.ts`）按 run 钉住的 delegationPolicy 判定目标与深度，登记待用户确认的
转交，然后以 `edit` 恢复（`edited_action.args` = 原参数 + `outcome`）。这里证明内核对这些 resume 的真实
行为——run 继续、模型收到的是 `outcome.message` 原句（不含原因码），没有 outcome 时如实说「未发起」。
"""
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from deepagents import create_deep_agent
from deep_agent_service.harness import build_interrupt_on
from deep_agent_service.tools import build_tools

PROPOSED = {
    "targetRole": "D003",
    "packet": {"originalQuestion": "帮我写 PRD", "confirmedScope": "", "evidenceRefs": ["ver-1"], "openItems": []},
}


def _graph():
    class Scripted(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self

    model = Scripted(messages=iter([
        AIMessage(content="", tool_calls=[{"id": "c1", "name": "request_handoff", "args": PROPOSED}]),
        AIMessage(content="done after handoff"),
    ]))
    tools = build_tools(model)
    assert "request_handoff" in {t.name for t in tools}
    assert "request_handoff" in {t.name for t in build_tools(model, interactions_only=True)}
    assert build_interrupt_on()["request_handoff"] is True
    return create_deep_agent(model=model, tools=tools, interrupt_on=build_interrupt_on(), checkpointer=MemorySaver())


def _resume(decision: dict, thread: str) -> list[str]:
    graph = _graph()
    config = {"configurable": {"thread_id": thread}}
    first = graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    assert "__interrupt__" in first and "request_handoff" in str(first["__interrupt__"])
    result = graph.invoke(Command(resume={"decisions": [decision]}), config)
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert texts[-1] == "done after handoff"
    return texts


def test_edit_requested_tells_agent_to_wait_for_confirmation():
    outcome = {"status": "requested", "handoffId": "h-1", "targetRole": "D003",
               "message": "已提交转交给「Product Manager」的请求，等待你在对话中确认；确认后会新开一个对话继续。"}
    texts = _resume({"type": "edit", "edited_action": {"name": "request_handoff", "args": {**PROPOSED, "outcome": outcome}}}, "h-req")
    hit = [t for t in texts if "已提交转交给「Product Manager」" in t]
    assert hit and "用户确认前" in hit[0]


def test_edit_refused_hands_chat_copy_without_code():
    outcome = {"status": "refused", "reason": "target_not_in_allowed_targets", "targetRole": "D005",
               "message": "该角色不能转交给 D005，未发起转交。当前对话会继续；如需要，可以直接联系对应负责人。"}
    texts = _resume({"type": "edit", "edited_action": {"name": "request_handoff", "args": {**PROPOSED, "outcome": outcome}}}, "h-ref")
    hit = [t for t in texts if "该角色不能转交给 D005" in t]
    assert hit and "target_not_in_allowed_targets" not in hit[0]


def test_approve_without_outcome_means_not_requested():
    texts = _resume({"type": "approve"}, "h-approve")
    assert any("转交未发起" in t for t in texts)


def test_outcome_is_not_model_visible():
    class M(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self
    tool = next(t for t in build_tools(M(messages=iter([]))) if t.name == "request_handoff")
    visible = tool.tool_call_schema.model_json_schema()["properties"]
    assert "outcome" not in visible and {"targetRole", "packet"} <= set(visible)
