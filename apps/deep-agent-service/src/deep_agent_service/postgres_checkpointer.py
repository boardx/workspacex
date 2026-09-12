"""Async graph compatibility for the synchronous, lock-protected PostgreSQL saver."""
from __future__ import annotations

import asyncio
from uuid import uuid4

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg import Connection
from psycopg.rows import dict_row


class AsyncCompatiblePostgresSaver(PostgresSaver):
    """Keep sync callers supported while moving blocking I/O off the event loop."""

    @classmethod
    def connect(cls, dsn: str):
        connection = Connection.connect(
            dsn, autocommit=True, prepare_threshold=0, row_factory=dict_row
        )
        saver = cls(connection)
        try:
            saver.setup()
        except BaseException:
            connection.close()
            raise
        return saver

    def close(self):
        with self.lock:
            self.conn.close()

    async def aget_tuple(self, config):
        return await asyncio.to_thread(self.get_tuple, config)

    async def alist(self, config, *, filter=None, before=None, limit=None):
        # Consume the cursor in one worker so no lock/cursor remains held across
        # an async yield (a consumer may write another checkpoint between rows).
        rows = await asyncio.to_thread(
            lambda: list(self.list(config, filter=filter, before=before, limit=limit))
        )
        for row in rows:
            yield row

    async def aput(self, config, checkpoint, metadata, new_versions):
        return await asyncio.to_thread(self.put, config, checkpoint, metadata, new_versions)

    async def aput_writes(self, config, writes, task_id, task_path=""):
        return await asyncio.to_thread(self.put_writes, config, writes, task_id, task_path)

    async def adelete_thread(self, thread_id):
        return await asyncio.to_thread(self.delete_thread, thread_id)

    async def aget_delta_channel_history(self, *, config, channels):
        return await asyncio.to_thread(self.get_delta_channel_history, config=config, channels=channels)


class FixedNamespaceCheckpointSaver(BaseCheckpointSaver):
    """Prefix storage namespaces without exposing the prefix to graph routing.

    Root stays empty and subgraph paths remain unchanged from LangGraph's view.
    The delegate must exclusively belong to this wrapper for lifecycle management.
    """

    def __init__(self, delegate: AsyncCompatiblePostgresSaver, namespace: str):
        super().__init__(serde=delegate.serde)
        if not namespace or "|" in namespace:
            raise ValueError("invalid checkpoint namespace")
        self.delegate = delegate
        self.prefix = namespace + "|"

    def _stored(self, config):
        configurable = dict((config or {}).get("configurable", {}))
        configurable["checkpoint_ns"] = self.prefix + configurable.get("checkpoint_ns", "")
        return {**(config or {}), "configurable": configurable}

    def _runtime(self, config):
        configurable = dict(config["configurable"])
        namespace = configurable.get("checkpoint_ns", "")
        if not namespace.startswith(self.prefix):
            raise ValueError("checkpoint outside graph namespace")
        configurable["checkpoint_ns"] = namespace[len(self.prefix):]
        return {**config, "configurable": configurable}

    def _tuple(self, value):
        if value is None:
            return None
        return value._replace(
            config=self._runtime(value.config),
            parent_config=self._runtime(value.parent_config) if value.parent_config else None,
        )

    def get_tuple(self, config):
        return self._tuple(self.delegate.get_tuple(self._stored(config)))

    def list(self, config, *, filter=None, before=None, limit=None):
        # An omitted config means all namespaces, including nested subgraphs.
        # Filter before applying limit so unrelated graphs cannot consume it.
        if config is None or "checkpoint_ns" not in config.get("configurable", {}):
            count = 0
            for value in self.delegate.list(config, filter=filter, before=self._stored(before) if before else None):
                if value.config["configurable"].get("checkpoint_ns", "").startswith(self.prefix):
                    if limit is not None and count >= limit:
                        break
                    yield self._tuple(value)
                    count += 1
        else:
            for value in self.delegate.list(self._stored(config), filter=filter, before=self._stored(before) if before else None, limit=limit):
                yield self._tuple(value)

    def put(self, config, checkpoint, metadata, new_versions):
        return self._runtime(self.delegate.put(self._stored(config), checkpoint, metadata, new_versions))

    def put_writes(self, config, writes, task_id, task_path=""):
        return self.delegate.put_writes(self._stored(config), writes, task_id, task_path)

    def get_next_version(self, current, channel):
        return self.delegate.get_next_version(current, channel)

    def get_delta_channel_history(self, *, config, channels):
        return self.delegate.get_delta_channel_history(config=self._stored(config), channels=channels)

    def delete_thread(self, thread_id):
        # Parameterized exact prefix comparison, not SQL LIKE (namespace may
        # contain underscores). Never delete the other assistant's root state.
        with self.delegate._cursor(pipeline=True) as cursor:
            for table in ("checkpoints", "checkpoint_blobs", "checkpoint_writes"):
                cursor.execute(
                    f"DELETE FROM {table} WHERE thread_id = %s AND left(checkpoint_ns, %s) = %s",
                    (str(thread_id), len(self.prefix), self.prefix),
                )

    def close(self):
        self.delegate.close()

    aget_tuple = AsyncCompatiblePostgresSaver.aget_tuple
    alist = AsyncCompatiblePostgresSaver.alist
    aput = AsyncCompatiblePostgresSaver.aput
    aput_writes = AsyncCompatiblePostgresSaver.aput_writes
    adelete_thread = AsyncCompatiblePostgresSaver.adelete_thread
    aget_delta_channel_history = AsyncCompatiblePostgresSaver.aget_delta_channel_history


async def probe_checkpoint(dsn: str):
    """Exercise async persistence without a model; remove only this probe's thread."""
    from typing import TypedDict
    from langgraph.graph import END, START, StateGraph

    class ProbeState(TypedDict):
        value: int

    builder = StateGraph(ProbeState)
    builder.add_node("increment", lambda state: {"value": state["value"] + 1})
    builder.add_edge(START, "increment")
    builder.add_edge("increment", END)
    config = {"configurable": {"thread_id": "checkpoint-probe-" + uuid4().hex}}
    saver = await asyncio.to_thread(AsyncCompatiblePostgresSaver.connect, dsn)
    try:
        graph = builder.compile(checkpointer=saver)
        result = await graph.ainvoke({"value": 1}, config)
        if result["value"] != 2 or (await graph.aget_state(config)).values != {"value": 2}:
            raise RuntimeError("checkpoint async write/read verification failed")
        await asyncio.to_thread(saver.close)
        saver = await asyncio.to_thread(AsyncCompatiblePostgresSaver.connect, dsn)
        restored = builder.compile(checkpointer=saver)
        if (await restored.aget_state(config)).values != {"value": 2}:
            raise RuntimeError("checkpoint restart verification failed")
    finally:
        try:
            await saver.adelete_thread(config["configurable"]["thread_id"])
        finally:
            await asyncio.to_thread(saver.close)


async def probe_checkpoint_isolation(dsn: str):
    """Two no-model graphs share a thread, but never share persisted state."""
    from typing import TypedDict
    from langgraph.graph import END, START, StateGraph

    class State(TypedDict):
        value: int

    builder = StateGraph(State)
    builder.add_node("increment", lambda state: {"value": state["value"] + 1})
    builder.add_edge(START, "increment")
    builder.add_edge("increment", END)
    thread = "checkpoint-isolation-probe-" + uuid4().hex
    config = {"configurable": {"thread_id": thread}}
    raw = await asyncio.to_thread(AsyncCompatiblePostgresSaver.connect, dsn)
    scoped = FixedNamespaceCheckpointSaver(raw, "guided-research:v1")
    try:
        deep = builder.compile(checkpointer=raw)
        research = builder.compile(checkpointer=scoped)
        await deep.ainvoke({"value": 10}, config)
        await research.ainvoke({"value": 100}, config)
        if (await deep.aget_state(config)).values != {"value": 11}:
            raise RuntimeError("research overwrote Deep Agent state")
        if (await research.aget_state(config)).values != {"value": 101}:
            raise RuntimeError("research state missing")
        await asyncio.to_thread(raw.close)
        raw = await asyncio.to_thread(AsyncCompatiblePostgresSaver.connect, dsn)
        scoped = FixedNamespaceCheckpointSaver(raw, "guided-research:v1")
        deep = builder.compile(checkpointer=raw)
        research = builder.compile(checkpointer=scoped)
        if (await deep.aget_state(config)).values != {"value": 11} or (await research.aget_state(config)).values != {"value": 101}:
            raise RuntimeError("cross-graph restart state mismatch")
        history = [snapshot async for snapshot in research.aget_state_history(config)]
        if not history or any(item.config["configurable"]["checkpoint_ns"] != "" for item in history):
            raise RuntimeError("storage namespace leaked into graph history")
        await scoped.adelete_thread(thread)
        if await scoped.aget_tuple(config) is not None or (await deep.aget_state(config)).values != {"value": 11}:
            raise RuntimeError("scoped deletion crossed graph boundary")
    finally:
        try:
            await raw.adelete_thread(thread)
        finally:
            await asyncio.to_thread(raw.close)


async def probe_restricted_runtime(dsn: str):
    """Isolated preflight process only: actual selector/runtime with a local model."""
    import sys
    from types import SimpleNamespace
    from unittest.mock import patch
    from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
    from langchain_core.messages import AIMessage
    from deep_agent_service.graph_selector import _execution_mode_key, select_graph
    from deep_agent_service.self_hosted_runtime import PostgresLedger, Runtime, production_graph_loader

    thread = "restricted-runtime-probe-" + uuid4().hex
    config = {"configurable": {"thread_id": thread, _execution_mode_key(): "text-only"}}
    saver = await asyncio.to_thread(AsyncCompatiblePostgresSaver.connect, dsn)
    ledger = PostgresLedger(dsn)
    runtime = Runtime(ledger, production_graph_loader)
    try:
        # Do not Runtime.start(): its orphan recovery must never touch live runs.
        await ledger.prepare()
        await ledger.create_thread(thread, "reject")
        model = FakeMessagesListChatModel(responses=[AIMessage(content="checkpoint probe response")])
        binding = SimpleNamespace(graph=SimpleNamespace(checkpointer=saver), _model=model)
        with patch.dict(sys.modules, {"deep_agent_service.graph": binding}):
            selected = select_graph(config)
            if selected.checkpointer is not saver or "tools" in selected.nodes:
                raise RuntimeError("restricted selector persistence/safety mismatch")
            run_id = await runtime.create_run(thread, {"assistant_id": "Deep Agent", "config": config, "input": {"messages": [{"role": "user", "content": "probe"}]}})
            await runtime.tasks[run_id]
            row = await ledger.get_run(thread, run_id)
            if not row or row["status"] != "success":
                raise RuntimeError("restricted runtime checkpoint execution failed")
            state = await select_graph(config).aget_state(config)
            if state.values["messages"][-1].content != "checkpoint probe response":
                raise RuntimeError("restricted runtime checkpoint read failed")
            # Exercise the same persisted-config routing used by HTTP clients.
            # ASGITransport makes local calls and does not run the app lifespan.
            import httpx
            from deep_agent_service.http_app import create_app
            app = create_app(runtime)
            app.state.runtime = runtime
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://checkpoint-probe") as client:
                response = await client.get(f"/threads/{thread}/state")
                if response.status_code != 200:
                    raise RuntimeError("restricted runtime HTTP state routing failed")
                payload = response.json()
                if payload.get("metadata", {}).get("run_id") != run_id or payload.get("values", {}).get("messages", [{}])[-1].get("content") != "checkpoint probe response":
                    raise RuntimeError("restricted runtime HTTP checkpoint mismatch")
                response = await client.get(f"/threads/{thread}")
                if response.status_code != 200 or response.json().get("thread_id") != thread or response.json().get("status") != "idle":
                    raise RuntimeError("restricted runtime HTTP thread read failed")
            # Persist/reload the native read projection using real JSONB events.
            # No native execution binding is created: this belongs only to our
            # disposable probe thread, and must restore without resolving one.
            from deep_agent_service.native_factory import native_config_key
            from deep_agent_service.self_hosted_runtime import NATIVE_SNAPSHOT_EVENT, snapshot_projection
            native_run = str(uuid4())
            native_config = {"configurable": {native_config_key(): {"bindingId": str(uuid4()), "profile": "native-v1", "policy": "native-v1"}}}
            await ledger.create_run(thread, native_run, {"assistant_id": "Deep Agent", "config": native_config})
            projection = snapshot_projection(state)
            await ledger.append_event(native_run, NATIVE_SNAPSHOT_EVENT, projection)
            await ledger.update_run(native_run, "success")
            reloaded = PostgresLedger(dsn)
            persisted_events = await reloaded.events(native_run)
            if len(persisted_events) != 1 or persisted_events[0]["data"] != projection:
                raise RuntimeError("native projection PostgreSQL roundtrip failed")
            restored = Runtime(reloaded, production_graph_loader)
            restored_app = create_app(restored)
            restored_app.state.runtime = restored
            with patch("deep_agent_service.native_factory._resolve", side_effect=AssertionError("native read must not resolve binding")):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=restored_app), base_url="http://checkpoint-probe") as client:
                    response = await client.get(f"/threads/{thread}/state")
                    if response.status_code != 200 or response.json().get("metadata", {}).get("run_id") != native_run or response.json().get("values") != projection["values"]:
                        raise RuntimeError("native projection HTTP restart recovery failed")
                    response = await client.get(f"/threads/{thread}")
                    if response.status_code != 200 or response.json().get("status") != "idle":
                        raise RuntimeError("native projection HTTP thread recovery failed")
                    stream = await client.get(f"/threads/{thread}/runs/{native_run}/stream")
                    if NATIVE_SNAPSHOT_EVENT in stream.text:
                        raise RuntimeError("native projection leaked into public events")

    finally:
        await runtime.stop()
        try:
            await saver.adelete_thread(thread)
            def cleanup():
                with ledger._connect() as connection:
                    connection.execute("DELETE FROM wsx_agent_events WHERE run_id IN (SELECT run_id FROM wsx_agent_runs WHERE thread_id=%s)", (thread,))
                    connection.execute("DELETE FROM wsx_agent_runs WHERE thread_id=%s", (thread,))
                    connection.execute("DELETE FROM wsx_agent_threads WHERE thread_id=%s", (thread,))
            await asyncio.to_thread(cleanup)
        finally:
            await asyncio.to_thread(saver.close)
