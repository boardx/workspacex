"""AG05 —— `start_workflow` 在真编译图里真的中断，且 resume 路径把网关的发起结果交回 Agent。

网关侧（`apps/api/.../workflow-start-gate.ts`）在服务端按 run 钉住的 workflowAllowlist 判定并经 WF03
start 执行，然后以 `edit` 恢复（`edited_action.args` = 原参数 + `outcome`）。这里证明内核对这些 resume
的真实行为——run 继续、模型收到的是 `outcome.message` 原句（不含错误码），没有 outcome 时如实说「未发起」。
"""
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from deepagents import create_deep_agent
from deep_agent_service.harness import build_interrupt_on
from deep_agent_service.tools import build_tools

PROPOSED = {"workflowId": "W027", "input": {"topic": "新用户流失"}}


def _graph():
    class Scripted(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self

    model = Scripted(messages=iter([
        AIMessage(content="", tool_calls=[{"id": "c1", "name": "start_workflow", "args": PROPOSED}]),
        AIMessage(content="done after start"),
    ]))
    tools = build_tools(model)
    assert "start_workflow" in {t.name for t in tools}
    assert "start_workflow" in {t.name for t in build_tools(model, interactions_only=True)}
    assert build_interrupt_on()["start_workflow"] is True
    return create_deep_agent(model=model, tools=tools, interrupt_on=build_interrupt_on(), checkpointer=MemorySaver())


def _resume(decision: dict, thread: str) -> list[str]:
    graph = _graph()
    config = {"configurable": {"thread_id": thread}}
    first = graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    assert "__interrupt__" in first and "start_workflow" in str(first["__interrupt__"])
    result = graph.invoke(Command(resume={"decisions": [decision]}), config)
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert texts[-1] == "done after start", "resume 之后 run 必须继续跑到模型下一轮"
    return texts


def test_edit_started_hands_instance_to_agent():
    outcome = {"status": "started", "workflowId": "W027", "instanceId": "inst-1", "message": "已发起流程 W027（实例 inst-1），流程正在后台运行。"}
    texts = _resume({"type": "edit", "edited_action": {"name": "start_workflow", "args": {**PROPOSED, "outcome": outcome}}}, "wf-started")
    hit = [t for t in texts if "已发起流程 W027（实例 inst-1）" in t]
    assert hit and "不要重复发起" in hit[0]


def test_edit_refused_hands_chat_copy_without_code():
    outcome = {"status": "refused", "code": "workflow_not_allowed", "workflowId": "W027", "handoffCandidates": ["D003"],
               "message": "该角色不能发起此流程（W027），未创建实例。可转交给角色：D003。"}
    texts = _resume({"type": "edit", "edited_action": {"name": "start_workflow", "args": {**PROPOSED, "outcome": outcome}}}, "wf-refused")
    hit = [t for t in texts if "该角色不能发起此流程（W027）" in t]
    assert hit and "不要改走其它流程" in hit[0]
    assert "workflow_not_allowed" not in hit[0]


def test_approve_without_outcome_means_not_started():
    texts = _resume({"type": "approve"}, "wf-approve")
    assert any("流程未发起" in t and "未创建任何实例" in t for t in texts)


def test_outcome_is_not_model_visible():
    class M(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self
    tool = next(t for t in build_tools(M(messages=iter([]))) if t.name == "start_workflow")
    visible = tool.tool_call_schema.model_json_schema()["properties"]
    assert "outcome" not in visible and {"workflowId", "input"} <= set(visible)
