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
