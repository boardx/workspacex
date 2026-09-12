import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
import httpx
import pytest
from deep_agent_service.http_app import create_app
from deep_agent_service.self_hosted_runtime import Runtime
from test_self_hosted_runtime import MemoryLedger

class Session:
    def __init__(self, enter_error=False, execute_error=False, waiting=False):
        self.entered = self.exited = 0
        self.enter_error, self.execute_error, self.waiting = enter_error, execute_error, waiting
        self.started = asyncio.Event()
    @asynccontextmanager
    async def context(self):
        self.entered += 1
        if self.enter_error: raise ValueError("unavailable")
        try: yield self
        finally: self.exited += 1
    async def ainvoke(self, payload, config):
        assert self.entered == 1 and self.exited == 0
        self.started.set()
        if self.execute_error: raise RuntimeError("execution")
        if self.waiting: await asyncio.Event().wait()
        return {"messages": []}
    async def aget_state(self, config):
        assert self.exited == 0
        return SimpleNamespace(values={"messages": []}, next=(), tasks=())

@pytest.mark.parametrize("execute_error", [False, True])
def test_run_closes_after_execution(execute_error):
    async def exercise():
        session, ledger = Session(execute_error=execute_error), MemoryLedger()
        runtime = Runtime(ledger, lambda *_: session.context())
        run_id = await runtime.create_run("t", {})
        await runtime.tasks[run_id]
        assert session.entered == session.exited == 1
        assert ledger.runs[run_id]["status"] == ("error" if execute_error else "success")
        await runtime.stop()
        assert session.exited == 1
    asyncio.run(exercise())

@pytest.mark.parametrize("stage", ["enter", "persist"])
def test_acquisition_failure(stage):
    async def exercise():
        session, ledger = Session(enter_error=stage == "enter"), MemoryLedger()
        if stage == "persist":
            async def fail(*_): raise RuntimeError("persist")
            ledger.create_run = fail
        runtime = Runtime(ledger, lambda *_: session.context())
        with pytest.raises((ValueError, RuntimeError)): await runtime.create_run("t", {})
        assert ledger.runs == {} and runtime.tasks == {} and runtime._contexts == {}
        assert session.exited == (0 if stage == "enter" else 1)
    asyncio.run(exercise())

@pytest.mark.parametrize("started", [False, True])
@pytest.mark.parametrize("operation", ["cancel", "stop"])
def test_cancel_before_or_during_execution(started, operation):
    async def exercise():
        session, ledger = Session(waiting=True), MemoryLedger()
        runtime = Runtime(ledger, lambda *_: session.context())
        run_id = await runtime.create_run("t", {})
        if started: await session.started.wait()
        if operation == "cancel":
            assert await runtime.cancel("t", run_id)
            assert await runtime.cancel("t", run_id)
        else: await runtime.stop()
        assert session.exited == 1 and runtime._contexts == {} and runtime._closing == {}
        await runtime.stop()
        assert session.exited == 1
    asyncio.run(exercise())

def test_http_state_and_thread_enter_fresh_sessions():
    async def exercise():
        sessions = []
        def loader(*_):
            session = Session()
            sessions.append(session)
            return session.context()
        ledger = MemoryLedger()
        await ledger.create_thread("t", "reject")
        await ledger.create_run("t", "run", {})
        app = create_app(Runtime(ledger, loader))
        app.state.runtime = Runtime(ledger, loader)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local") as client:
            assert (await client.get("/threads/t/state")).status_code == 200
            assert (await client.get("/threads/t")).status_code == 200
        assert len(sessions) == 2
        assert all(s.entered == s.exited == 1 for s in sessions)
    asyncio.run(exercise())

def test_http_snapshot_exception_still_closes_context():
    async def exercise():
        session = Session()
        async def fail(_config): raise RuntimeError("state unavailable")
        session.aget_state = fail
        ledger = MemoryLedger()
        await ledger.create_thread("t", "reject")
        runtime = Runtime(ledger, lambda *_: session.context())
        app = create_app(runtime)
        app.state.runtime = runtime
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local") as client:
            assert (await client.get("/threads/t/state")).status_code == 404
        assert session.entered == session.exited == 1
    asyncio.run(exercise())

@pytest.mark.parametrize("interrupted", [False, True])
def test_native_http_projection_survives_expired_binding_and_runtime_restart(monkeypatch, interrupted):
    from typing import TypedDict
    from unittest.mock import Mock
    from langgraph.graph import StateGraph, START, END
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.types import interrupt
    from deep_agent_service import native_factory as factory
    from deep_agent_service.graph_selector import select_graph
    from deep_agent_service.self_hosted_runtime import NATIVE_SNAPSHOT_EVENT, production_graph_loader
    from test_native_factory import config as native_config, resolved

    class State(TypedDict):
        messages: list[str]
    def answer(_state):
        if interrupted: interrupt("approve")
        return {"messages": ["persisted native answer"]}
    builder = StateGraph(State)
    builder.add_node("answer", answer)
    builder.add_edge(START, "answer")
    builder.add_edge("answer", END)
    graph = builder.compile(checkpointer=InMemorySaver())
    config = native_config()
    payload = resolved()
    payload["packageDigest"] = factory._package_set_digest(config["configurable"]["org_skills"])
    resolves = []
    async def resolve(*_):
        resolves.append(1)
        if len(resolves) > 1: raise factory.NativeFactoryError("binding expired")
        return payload
    monkeypatch.setenv("NATIVE_SESSION_SOCKET", "/unused/native.sock")
    monkeypatch.setattr(factory, "_resolve", resolve)
    monkeypatch.setattr(factory, "_shared_runtime", lambda: (None, None, []))
    monkeypatch.setattr(factory, "build_tools", lambda *_a, **_k: [])
    monkeypatch.setattr(factory, "native_candidate_tools", lambda *_a, **_k: [])
    monkeypatch.setattr(factory, "create_native_graph", lambda *_a, **_k: graph)
    client = Mock()
    from contextlib import nullcontext
    monkeypatch.setattr(factory, "_sandbox_client", lambda *_: nullcontext(client))

    async def exercise():
        ledger = MemoryLedger()
        await ledger.create_thread("native", "reject")
        runtime = Runtime(ledger, production_graph_loader)
        run_id = await runtime.create_run("native", {"assistant_id": "Deep Agent", "config": config, "input": {"messages": ["question"]}})
        await runtime.tasks[run_id]
        expected_status = "interrupted" if interrupted else "success"
        assert ledger.runs[run_id]["status"] == expected_status
        assert any(event["event"] == NATIVE_SNAPSHOT_EVENT for event in await ledger.events(run_id))
        # Prove the actual selector's native context can no longer be rebuilt.
        with pytest.raises(factory.NativeFactoryError, match="expired"):
            async with select_graph(config): pass
        assert len(resolves) == 2
        restarted = Runtime(ledger, production_graph_loader)
        app = create_app(restarted)
        app.state.runtime = restarted
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local") as http:
            state = await http.get("/threads/native/state")
            assert state.status_code == 200
            assert state.json()["metadata"]["run_id"] == run_id
            assert state.json()["values"]["messages"] == (["question"] if interrupted else ["persisted native answer"])
            assert bool(state.json()["next"]) is interrupted
            if interrupted:
                stored_interrupt = state.json()["tasks"][0]["interrupts"][0]
                assert isinstance(stored_interrupt, dict)
                assert stored_interrupt["value"] == "approve"
                assert isinstance(stored_interrupt["id"], str) and stored_interrupt["id"]
            thread = (await http.get("/threads/native")).json()
            assert bool(thread["interrupts"]) is interrupted
            if interrupted:
                assert next(iter(thread["interrupts"].values()))[0] == stored_interrupt
            stream = await http.get(f"/threads/native/runs/{run_id}/stream")
            assert NATIVE_SNAPSHOT_EVENT not in stream.text
        assert len(resolves) == 2
    asyncio.run(exercise())

def test_native_snapshot_persistence_failure_never_reports_success():
    from deep_agent_service.native_factory import native_config_key
    from deep_agent_service.self_hosted_runtime import NATIVE_SNAPSHOT_EVENT
    async def exercise():
        session, ledger = Session(), MemoryLedger()
        append = ledger.append_event
        async def fail_projection(run_id, event, data):
            if event == NATIVE_SNAPSHOT_EVENT: raise RuntimeError("write failed")
            await append(run_id, event, data)
        ledger.append_event = fail_projection
        runtime = Runtime(ledger, lambda *_: session.context())
        run_id = await runtime.create_run("t", {"config": {"configurable": {native_config_key(): {}}}})
        await runtime.tasks[run_id]
        assert ledger.runs[run_id]["status"] == "error"
        assert session.exited == 1
        assert not any(event["data"] == {"status": "success"} for event in await ledger.events(run_id))
    asyncio.run(exercise())
