"""Cancellation waits for a safe boundary and wins over pending pause/steering."""
from typing import TypedDict

import httpx
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import StateGraph, START, END
from deep_agent_service import run_control


def test_cancel_confirms_after_external_action_without_starting_another_model(monkeypatch):
    class State(TypedDict):
        completed: int

    actions = []
    monkeypatch.setattr(run_control.httpx, "post", lambda *a, **kw: httpx.Response(
        200, request=httpx.Request("POST", "http://api.invalid"),
        json={"interjections": [], "cancelRequested": True, "pauseRequested": True}))

    def action(state):
        actions.append("committed")
        return {"completed": 1}

    def final_boundary(state):
        run_control.poll_interjections(state, pause_at_boundary=True)
        actions.append("must not continue")
        return state

    builder = StateGraph(State)
    builder.add_node("action", action)
    builder.add_node("final_boundary", final_boundary)
    builder.add_edge(START, "action")
    builder.add_edge("action", "final_boundary")
    builder.add_edge("final_boundary", END)
    graph = builder.compile(checkpointer=InMemorySaver())
    result = graph.invoke({"completed": 0}, {"configurable": {"thread_id": "cancel", "run_control_callback": {
        "base_url": "http://api.invalid", "key": "test", "org_id": "org", "run_id": "run"}}})
    assert result["__interrupt__"][0].value == {"kind": "user_cancel"}
    assert actions == ["committed"]
