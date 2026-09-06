"""No service/DB: real checkpoint scheduling, fake callback HTTP transport."""
from typing import TypedDict

import httpx
import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

from deep_agent_service import run_control
from deep_agent_service.harness import InterjectionMiddleware


CALLBACK = {"base_url": "http://gateway", "key": "test-key", "org_id": "org-a", "run_id": "run-a"}


def response(values=None, pause=False, status=200):
    return httpx.Response(status, json={"interjections": values or [], "pauseRequested": pause},
                          request=httpx.Request("POST", "http://gateway/poll"))


def value(identifier):
    return {"interjectionId": identifier, "text": identifier, "classification": "adjustment",
            "receivedAt": "2026-09-07T00:00:00Z"}


def test_fifo_and_replayed_delivery_are_injected_once(monkeypatch):
    monkeypatch.setattr(run_control, "get_config", lambda: {"configurable": {"run_control_callback": CALLBACK}})
    bodies = []

    def post(url, **kwargs):
        bodies.append(kwargs["json"])
        return response([value("first"), value("second")])

    monkeypatch.setattr(run_control.httpx, "post", post)
    middleware = InterjectionMiddleware()
    first = middleware.before_model({"messages": []}, None)
    assert [m.id for m in first["messages"]] == ["interjection:first", "interjection:second"]
    assert bodies[0]["acknowledgedIds"] == []  # returned update is not an ACK
    assert middleware.before_model(first, None) is None
    assert bodies[1]["acknowledgedIds"] == ["first", "second"]


def test_callback_failure_does_not_silently_execute_stale_intent(monkeypatch):
    monkeypatch.setattr(run_control, "get_config", lambda: {"configurable": {"run_control_callback": CALLBACK}})
    monkeypatch.setattr(run_control.httpx, "post", lambda *a, **kw: response(status=503))
    with pytest.raises(httpx.HTTPStatusError):
        run_control.poll_interjections({"messages": []})


def test_only_checkpoint_human_interjection_ids_acknowledged(monkeypatch):
    monkeypatch.setattr(run_control, "get_config", lambda: {"configurable": {"run_control_callback": CALLBACK}})
    _, headers, body = run_control._request({"messages": [HumanMessage("normal", id="normal"),
                                                         HumanMessage("steer", id="interjection:one")]})
    assert body == {"orgId": "org-a", "acknowledgedIds": ["one"]}
    assert headers == {"x-deep-agent-internal-key": "test-key"}


def test_pause_at_next_boundary_and_checkpoint_resume_never_replays_completed_tool(monkeypatch):
    class State(TypedDict):
        completed: int

    external_actions = []
    pause_requested = True

    def post(*args, **kwargs):
        return response(pause=pause_requested)

    monkeypatch.setattr(run_control.httpx, "post", post)

    def tool(state):
        external_actions.append("external action committed")
        return {"completed": state["completed"] + 1}

    def boundary(state):
        run_control.poll_interjections(state, pause_at_boundary=True)
        return state

    builder = StateGraph(State)
    builder.add_node("tool", tool)
    builder.add_node("model_boundary", boundary)
    builder.add_edge(START, "tool")
    builder.add_edge("tool", "model_boundary")
    builder.add_edge("model_boundary", END)
    graph = builder.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "pause-test", "run_control_callback": CALLBACK}}
    paused = graph.invoke({"completed": 0}, config)
    assert paused["__interrupt__"][0].value == {"kind": "user_pause"}
    assert external_actions == ["external action committed"]
    pause_requested = False  # gateway atomically clears request when requeuing
    resumed = graph.invoke(Command(resume=True), config)
    assert resumed["completed"] == 1
    assert "__interrupt__" not in resumed
    assert external_actions == ["external action committed"]


def test_late_input_reopens_final_model_but_never_splits_tool_pair(monkeypatch):
    monkeypatch.setattr(run_control, "poll_interjections", lambda *a, **kw: [value("late")])
    middleware = InterjectionMiddleware()
    final = {"messages": [AIMessage("done")]}
    update = middleware.after_model(final, None)
    assert update["jump_to"] == "model"
    assert update["messages"][0].id == "interjection:late"
    tools = {"messages": [AIMessage("", tool_calls=[{"name": "write_file", "args": {}, "id": "tool-1"}])]}
    assert middleware.after_model(tools, None) is None


def test_async_late_input_matches_sync_path(monkeypatch):
    import asyncio

    async def poll(*args, **kwargs):
        return [value("late-async")]

    monkeypatch.setattr(run_control, "apoll_interjections", poll)
    update = asyncio.run(InterjectionMiddleware().aafter_model({"messages": [AIMessage("done")]}, None))
    assert update["jump_to"] == "model"
    assert update["messages"][0].id == "interjection:late-async"
