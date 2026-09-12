import asyncio
from dataclasses import dataclass

import httpx
import pytest

from deep_agent_service.http_app import create_app
from deep_agent_service.self_hosted_runtime import PostgresLedger, Runtime


@pytest.fixture
def anyio_backend(): return "asyncio"


class MemoryLedger:
    def __init__(self): self.threads, self.runs, self.recorded = {}, {}, {}
    async def prepare(self): pass
    async def mark_orphaned(self):
        for run in self.runs.values():
            if run["status"] in ("pending", "running"): run.update(status="error", error="runtime_restarted")
    async def create_thread(self, thread_id, if_exists):
        if thread_id in self.threads:
            if if_exists != "do_nothing": raise ValueError()
            return False
        self.threads[thread_id] = {"thread_id": thread_id, "status": "idle", "interrupts": {}}
        return True
    async def get_thread(self, thread_id): return self.threads.get(thread_id)
    async def create_run(self, thread_id, run_id, request): self.runs[run_id] = {"run_id": run_id, "thread_id": thread_id, "status": "pending", "error": None, "assistant_id": request.get("assistant_id", "Deep Agent"), "config": request.get("config")}
    async def update_run(self, run_id, status, error=None): self.runs[run_id].update(status=status, error=error)
    async def get_run(self, thread_id, run_id):
        row = self.runs.get(run_id)
        return row if row and row["thread_id"] == thread_id else None
    async def latest_run(self, thread_id):
        rows = [row for row in self.runs.values() if row["thread_id"] == thread_id]
        return rows[-1] if rows else None
    async def append_event(self, run_id, event, data):
        rows = self.recorded.setdefault(run_id, [])
        rows.append({"sequence": len(rows) + 1, "event": event, "data": data})
    async def events(self, run_id): return self.recorded.get(run_id, [])


@dataclass
class Snapshot:
    values: dict
    next: tuple = ()


class FakeGraph:
    def __init__(self): self.values = {"messages": [{"type": "ai", "content": "done"}]}
    async def ainvoke(self, payload, config):
        assert config["configurable"]["thread_id"]
        return self.values
    async def astream(self, payload, config, stream_mode):
        await self.ainvoke(payload, config)
        for event in ():
            yield event
    async def aget_state(self, config): return Snapshot(self.values)


class CustomStreamGraph(FakeGraph):
    async def astream(self, payload, config, stream_mode):
        assert stream_mode == ["messages", "updates", "custom"]
        yield "custom", {"type": "skill_activity", "version": 1, "fact": {
            "contractVersion": 1, "factId": "fact-1", "skillId": "skill-1",
            "skillStableName": "pdf-create", "skillVersion": "v1",
            "packageDigest": "a" * 64, "stage": "body_read",
            "readPath": "/skills/pdf-create/SKILL.md",
        }}
        self.values = {"messages": [{"type": "ai", "content": "streamed"}]}


@pytest.mark.anyio
async def test_runtime_replays_requested_custom_stream_events_before_terminal_values():
    graph, ledger = CustomStreamGraph(), MemoryLedger()
    runtime = Runtime(ledger, lambda _assistant, _config: graph)
    app = create_app(runtime)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://runtime") as client:
            await client.post("/threads", json={"thread_id": "skill-stream"})
            created = await client.post("/threads/skill-stream/runs", json={
                "assistant_id": "Deep Agent", "input": {"messages": []},
                "stream_mode": ["messages-tuple", "updates", "custom"],
            })
            run_id = created.json()["run_id"]
            await asyncio.gather(*list(runtime.tasks.values()))
            stream = await client.get(f"/threads/skill-stream/runs/{run_id}/stream")
            assert "event: custom" in stream.text
            assert '"type": "skill_activity"' in stream.text
            assert stream.text.index("event: custom") < stream.text.index("event: values")


@pytest.mark.anyio
async def test_open_runtime_contract_health_assistant_thread_run_state_and_stream():
    graph, ledger = FakeGraph(), MemoryLedger()
    runtime = Runtime(ledger, lambda _assistant, _config: graph)
    app = create_app(runtime)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://runtime") as client:
            assert (await client.get("/healthz")).json()["ok"] is True
            assistants = (await client.post("/assistants/search", json={"graph_id": "Deep Agent"})).json()
            assert assistants == [{"assistant_id": "Deep Agent", "graph_id": "Deep Agent"}]
            assert (await client.post("/threads", json={"thread_id": "t-1"})).json() == {"thread_id": "t-1"}
            duplicate = await client.post("/threads", json={"thread_id": "t-1"})
            assert duplicate.status_code == 409
            run_id = (await client.post("/threads/t-1/runs", json={"assistant_id": "Deep Agent", "input": {"messages": []}})).json()["run_id"]
            for _ in range(50):
                run = (await client.get(f"/threads/t-1/runs/{run_id}")).json()
                if run["status"] == "success": break
                await asyncio.sleep(0.01)
            assert run["status"] == "success"
            assert (await client.get("/threads/t-1/state")).json()["values"] == graph.values
            assert (await client.get("/threads/t-1/state")).json()["metadata"]["run_id"] == run_id
            stream = await client.get(f"/threads/t-1/runs/{run_id}/stream")
            assert "event: values" in stream.text and '"status": "success"' in stream.text


@pytest.mark.anyio
async def test_cancel_is_idempotent_and_restart_fails_unknown_inflight_run():
    ledger = MemoryLedger()
    await ledger.create_thread("t", "reject")
    await ledger.create_run("t", "orphan", {})
    await Runtime(ledger, lambda *_: FakeGraph()).start()
    assert (await ledger.get_run("t", "orphan"))["error"] == "runtime_restarted"

    class WaitingGraph(FakeGraph):
        async def ainvoke(self, payload, config): await asyncio.Event().wait()
    runtime = Runtime(ledger, lambda *_: WaitingGraph())
    run_id = await runtime.create_run("t", {"assistant_id": "Deep Agent", "input": {}})
    await asyncio.sleep(0)
    assert await runtime.cancel("t", run_id) is True
    assert await runtime.cancel("t", run_id) is True
    assert (await ledger.get_run("t", run_id))["status"] == "cancelled"


@pytest.mark.anyio
async def test_postgres_ledger_prepares_durable_tables_and_fails_orphaned_runs(monkeypatch):
    statements = []

    class Connection:
        def __enter__(self): return self
        def __exit__(self, *_args): pass
        def execute(self, statement, _parameters=()):
            statements.append(" ".join(statement.split()))
            return self

    ledger = PostgresLedger("postgresql://runtime@example.invalid/agent")
    monkeypatch.setattr(ledger, "_connect", lambda: Connection())
    await ledger.prepare()
    await ledger.mark_orphaned()
    assert any("CREATE TABLE IF NOT EXISTS wsx_agent_threads" in sql for sql in statements)
    assert any("CREATE TABLE IF NOT EXISTS wsx_agent_runs" in sql for sql in statements)
    assert any("CREATE TABLE IF NOT EXISTS wsx_agent_events" in sql for sql in statements)
    assert any("runtime_restarted" in sql and "pending" in sql and "running" in sql for sql in statements)


def test_postgres_ledger_and_image_do_not_accept_missing_runtime_database():
    with pytest.raises(RuntimeError, match="DEEP_AGENT_CHECKPOINT_DB_REQUIRED"):
        PostgresLedger("")


@pytest.mark.anyio
@pytest.mark.parametrize("interrupted", [False, True])
async def test_research_http_state_and_interrupts_follow_persisted_assistant_after_restart(interrupted):
    from types import SimpleNamespace

    deep, research, ledger = FakeGraph(), FakeGraph(), MemoryLedger()
    research.values = {"topic": "synthetic research"}
    async def research_state(_config):
        return SimpleNamespace(values=research.values, next=("confirm",) if interrupted else (),
            tasks=(SimpleNamespace(id="research-confirm", interrupts=({"value": "confirm research"},)),) if interrupted else ())
    research.aget_state = research_state
    loaded = []
    def load(assistant, _config):
        loaded.append(assistant)
        return {"Deep Agent": deep, "Guided Research": research}[assistant]
    runtime = Runtime(ledger, load)
    app = create_app(runtime)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://runtime") as client:
            await client.post("/threads", json={"thread_id": "shared"})
            for assistant in ("Deep Agent", "Guided Research"):
                response = await client.post("/threads/shared/runs", json={"assistant_id": assistant, "input": {}})
                run_id = response.json()["run_id"]
                await asyncio.gather(*list(runtime.tasks.values()))
            assert (await ledger.get_run("shared", run_id))["status"] == ("interrupted" if interrupted else "success")
    # New runtime instance must use the durable run identity, not an in-memory map.
    restarted = create_app(Runtime(ledger, load))
    async with restarted.router.lifespan_context(restarted):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=restarted), base_url="http://runtime") as client:
            loaded.clear()
            state = (await client.get("/threads/shared/state")).json()
            assert state["values"] == research.values
            assert state["metadata"]["run_id"] == run_id
            thread = (await client.get("/threads/shared")).json()
            assert bool(thread["interrupts"]) is interrupted
            assert loaded == ["Guided Research", "Guided Research"]


@pytest.mark.anyio
@pytest.mark.parametrize("invalid", ["unknown", "", None, 42, [], {}])
async def test_invalid_assistant_cannot_replace_a_valid_threads_latest_run(invalid):
    ledger, graph = MemoryLedger(), FakeGraph()
    runtime = Runtime(ledger, lambda *_: graph)
    app = create_app(runtime)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://runtime") as client:
            await client.post("/threads", json={"thread_id": "valid"})
            valid = await client.post("/threads/valid/runs", json={"assistant_id": "Guided Research", "input": {}})
            await asyncio.gather(*list(runtime.tasks.values()))
            response = await client.post("/threads/valid/runs", json={"assistant_id": invalid, "input": {}})
            assert response.status_code == 404
            assert len(ledger.runs) == 1
            state = (await client.get("/threads/valid/state")).json()
            assert state["metadata"]["run_id"] == valid.json()["run_id"]
            assert state["values"] == graph.values


@pytest.mark.anyio
async def test_execution_route_is_validated_before_persist_and_restored_for_state_reads():
    ledger, graph = MemoryLedger(), FakeGraph()
    seen = []
    def load(assistant, config):
        mode = config["configurable"].get("execution-mode")
        if mode != "text-only": raise ValueError("invalid execution route")
        seen.append((assistant, mode))
        return graph
    runtime = Runtime(ledger, load)
    app = create_app(runtime)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://runtime") as client:
            await client.post("/threads", json={"thread_id": "restricted"})
            config = {"configurable": {"execution-mode": "text-only"}}
            response = await client.post("/threads/restricted/runs", json={"assistant_id": "Deep Agent", "config": config, "input": {}})
            await asyncio.gather(*list(runtime.tasks.values()))
            run_id = response.json()["run_id"]
            assert seen == [("Deep Agent", "text-only")]
            assert (await client.get("/threads/restricted/state")).json()["values"] == graph.values
            invalid = await client.post("/threads/restricted/runs", json={"assistant_id": "Deep Agent", "config": {"configurable": {"execution-mode": "unknown"}}})
            assert invalid.status_code == 404
            assert len(ledger.runs) == 1
            assert (await client.get("/threads/restricted/state")).json()["metadata"]["run_id"] == run_id
