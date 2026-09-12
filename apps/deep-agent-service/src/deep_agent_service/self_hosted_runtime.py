"""Small, open-source LangGraph HTTP runtime used by the production image.

The graph owns checkpoint state through ``DEEP_AGENT_CHECKPOINT_DB``.  This module
only persists control-plane facts (threads, runs and replayable SSE events), so a
process restart never turns an unknown run into a reported success.
"""
from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from functools import lru_cache
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Protocol
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row


TERMINAL = frozenset({"success", "error", "cancelled", "interrupted"})


class Ledger(Protocol):
    async def prepare(self) -> None: ...
    async def create_thread(self, thread_id: str, if_exists: str) -> bool: ...
    async def get_thread(self, thread_id: str) -> dict[str, Any] | None: ...
    async def create_run(self, thread_id: str, run_id: str, request: dict[str, Any]) -> None: ...
    async def update_run(self, run_id: str, status: str, error: str | None = None) -> None: ...
    async def get_run(self, thread_id: str, run_id: str) -> dict[str, Any] | None: ...
    async def latest_run(self, thread_id: str) -> dict[str, Any] | None: ...
    async def append_event(self, run_id: str, event: str, data: Any) -> None: ...
    async def events(self, run_id: str) -> list[dict[str, Any]]: ...
    async def mark_orphaned(self) -> None: ...


class PostgresLedger:
    def __init__(self, dsn: str):
        if not dsn.strip():
            raise RuntimeError("DEEP_AGENT_CHECKPOINT_DB_REQUIRED")
        self._dsn = dsn

    def _connect(self):
        return psycopg.connect(self._dsn, autocommit=True, row_factory=dict_row, connect_timeout=5)

    async def _call(self, operation: Callable[[], Any]) -> Any:
        return await asyncio.to_thread(operation)

    async def prepare(self) -> None:
        def operation():
            with self._connect() as connection:
                connection.execute("""CREATE TABLE IF NOT EXISTS wsx_agent_threads (
                    thread_id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())""")
                connection.execute("""CREATE TABLE IF NOT EXISTS wsx_agent_runs (
                    run_id text PRIMARY KEY, thread_id text NOT NULL REFERENCES wsx_agent_threads(thread_id),
                    status text NOT NULL, request jsonb NOT NULL, error text,
                    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())""")
                connection.execute("""CREATE TABLE IF NOT EXISTS wsx_agent_events (
                    run_id text NOT NULL REFERENCES wsx_agent_runs(run_id), sequence bigint GENERATED ALWAYS AS IDENTITY,
                    event text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (run_id, sequence))""")
        await self._call(operation)

    async def create_thread(self, thread_id: str, if_exists: str) -> bool:
        def operation():
            with self._connect() as connection:
                row = connection.execute("INSERT INTO wsx_agent_threads(thread_id) VALUES (%s) ON CONFLICT DO NOTHING RETURNING thread_id", (thread_id,)).fetchone()
                if row is None and if_exists != "do_nothing":
                    raise ValueError("THREAD_ALREADY_EXISTS")
                return row is not None
        return await self._call(operation)

    async def get_thread(self, thread_id: str) -> dict[str, Any] | None:
        def operation():
            with self._connect() as connection:
                thread = connection.execute("SELECT thread_id,created_at FROM wsx_agent_threads WHERE thread_id=%s", (thread_id,)).fetchone()
                if thread is None: return None
                run = connection.execute("SELECT status FROM wsx_agent_runs WHERE thread_id=%s ORDER BY created_at DESC LIMIT 1", (thread_id,)).fetchone()
                return {**thread, "status": "interrupted" if run and run["status"] == "interrupted" else "idle", "interrupts": {}}
        return await self._call(operation)

    async def create_run(self, thread_id: str, run_id: str, request: dict[str, Any]) -> None:
        def operation():
            with self._connect() as connection:
                connection.execute("INSERT INTO wsx_agent_runs(run_id,thread_id,status,request) VALUES (%s,%s,'pending',%s::jsonb)", (run_id, thread_id, json.dumps(request)))
        await self._call(operation)

    async def update_run(self, run_id: str, status: str, error: str | None = None) -> None:
        def operation():
            with self._connect() as connection:
                connection.execute("UPDATE wsx_agent_runs SET status=%s,error=%s,updated_at=now() WHERE run_id=%s", (status, error, run_id))
        await self._call(operation)

    async def get_run(self, thread_id: str, run_id: str) -> dict[str, Any] | None:
        def operation():
            with self._connect() as connection:
                return connection.execute("SELECT run_id,thread_id,status,error,created_at,updated_at FROM wsx_agent_runs WHERE thread_id=%s AND run_id=%s", (thread_id, run_id)).fetchone()
        return await self._call(operation)

    async def latest_run(self, thread_id: str) -> dict[str, Any] | None:
        def operation():
            with self._connect() as connection:
                return connection.execute("SELECT run_id,thread_id,status,error,created_at,updated_at FROM wsx_agent_runs WHERE thread_id=%s ORDER BY created_at DESC LIMIT 1", (thread_id,)).fetchone()
        return await self._call(operation)

    async def append_event(self, run_id: str, event: str, data: Any) -> None:
        def operation():
            with self._connect() as connection:
                connection.execute("INSERT INTO wsx_agent_events(run_id,event,data) VALUES (%s,%s,%s::jsonb)", (run_id, event, json.dumps(_jsonable(data))))
        await self._call(operation)

    async def events(self, run_id: str) -> list[dict[str, Any]]:
        def operation():
            with self._connect() as connection:
                return list(connection.execute("SELECT sequence,event,data FROM wsx_agent_events WHERE run_id=%s ORDER BY sequence", (run_id,)).fetchall())
        return await self._call(operation)

    async def mark_orphaned(self) -> None:
        def operation():
            with self._connect() as connection:
                connection.execute("UPDATE wsx_agent_runs SET status='error',error='runtime_restarted',updated_at=now() WHERE status IN ('pending','running')")
        await self._call(operation)


def _jsonable(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, dict): return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)): return [_jsonable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None: return value
    if isinstance(value, datetime): return value.astimezone(timezone.utc).isoformat()
    return repr(value)


@dataclass
class Runtime:
    ledger: Ledger
    graph_loader: Callable[[str, dict[str, Any]], Any]

    def __post_init__(self):
        self.tasks: dict[str, asyncio.Task[None]] = {}

    async def start(self) -> None:
        await self.ledger.prepare()
        await self.ledger.mark_orphaned()

    async def stop(self) -> None:
        tasks = list(self.tasks.values())
        for task in tasks: task.cancel()
        if tasks: await asyncio.gather(*tasks, return_exceptions=True)

    async def create_run(self, thread_id: str, request: dict[str, Any]) -> str:
        run_id = str(uuid4())
        await self.ledger.create_run(thread_id, run_id, request)
        self.tasks[run_id] = asyncio.create_task(self._execute(thread_id, run_id, request))
        self.tasks[run_id].add_done_callback(lambda _task: self.tasks.pop(run_id, None))
        return run_id

    async def cancel(self, thread_id: str, run_id: str) -> bool:
        row = await self.ledger.get_run(thread_id, run_id)
        if row is None: return False
        task = self.tasks.get(run_id)
        if task: task.cancel()
        if row["status"] not in TERMINAL:
            await self.ledger.update_run(run_id, "cancelled")
            await self.ledger.append_event(run_id, "metadata", {"status": "cancelled"})
        return True

    async def _execute(self, thread_id: str, run_id: str, request: dict[str, Any]) -> None:
        try:
            await self.ledger.update_run(run_id, "running")
            config = dict(request.get("config") or {})
            configurable = dict(config.get("configurable") or {})
            configurable["thread_id"] = thread_id
            config["configurable"] = configurable
            graph = self.graph_loader(str(request.get("assistant_id", "Deep Agent")), config)
            payload = request.get("command") if "command" in request else request.get("input", {})
            if "command" in request:
                from langgraph.types import Command
                payload = Command(**payload)
            result = await graph.ainvoke(payload, config=config)
            snapshot = await graph.aget_state(config)
            next_nodes = list(getattr(snapshot, "next", ()) or ())
            status = "interrupted" if next_nodes else "success"
            await self.ledger.append_event(run_id, "values", getattr(snapshot, "values", result))
            await self.ledger.update_run(run_id, status)
            await self.ledger.append_event(run_id, "metadata", {"status": status})
        except asyncio.CancelledError:
            return
        except Exception as error:
            await self.ledger.update_run(run_id, "error", type(error).__name__)
            await self.ledger.append_event(run_id, "metadata", {"status": "error"})


@lru_cache(maxsize=1)
def _self_hosted_research_graph():
    from deep_agent_service.guided_research_graph import create_guided_research_graph
    from deep_agent_service.harness import build_checkpointer
    return create_guided_research_graph(checkpointer=build_checkpointer())


def production_graph_loader(graph_id: str, config: dict[str, Any]):
    if graph_id == "Deep Agent":
        from deep_agent_service.graph_selector import select_graph
        return select_graph(config)
    if graph_id == "Guided Research":
        return _self_hosted_research_graph()
    raise ValueError("ASSISTANT_NOT_FOUND")


def production_runtime() -> Runtime:
    dsn = os.environ.get("DEEP_AGENT_CHECKPOINT_DB") or os.environ.get("DATABASE_URI", "")
    return Runtime(PostgresLedger(dsn), production_graph_loader)
