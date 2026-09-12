"""Async graph compatibility for the synchronous, lock-protected PostgreSQL saver."""
from __future__ import annotations

import asyncio
from uuid import uuid4

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
