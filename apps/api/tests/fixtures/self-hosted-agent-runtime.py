"""Deterministic graph/ledger fixture for the TypeScript provider compatibility test."""
from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "apps/deep-agent-service/src"))

import uvicorn

from deep_agent_service.http_app import create_app
from deep_agent_service.self_hosted_runtime import Runtime


class MemoryLedger:
    def __init__(self):
        self.threads: dict[str, dict[str, Any]] = {}
        self.runs: dict[str, dict[str, Any]] = {}
        self.run_events: dict[str, list[dict[str, Any]]] = {}

    async def prepare(self): pass
    async def mark_orphaned(self): pass

    async def create_thread(self, thread_id: str, if_exists: str):
        if thread_id in self.threads:
            if if_exists != "do_nothing": raise ValueError("THREAD_ALREADY_EXISTS")
            return False
        self.threads[thread_id] = {"thread_id": thread_id}
        return True

    async def get_thread(self, thread_id: str):
        thread = self.threads.get(thread_id)
        if thread is None: return None
        latest = next((run for run in reversed(list(self.runs.values())) if run["thread_id"] == thread_id), None)
        status = "interrupted" if latest and latest["status"] == "interrupted" else "idle"
        return {**thread, "status": status, "interrupts": {"pending": True} if status == "interrupted" else {}}

    async def create_run(self, thread_id: str, run_id: str, request: dict[str, Any]):
        self.runs[run_id] = {"run_id": run_id, "thread_id": thread_id, "status": "pending", "error": None}
        self.run_events[run_id] = []

    async def update_run(self, run_id: str, status: str, error: str | None = None):
        self.runs[run_id].update(status=status, error=error)

    async def get_run(self, thread_id: str, run_id: str):
        run = self.runs.get(run_id)
        return run if run and run["thread_id"] == thread_id else None

    async def latest_run(self, thread_id: str):
        return next((run for run in reversed(list(self.runs.values())) if run["thread_id"] == thread_id), None)

    async def append_event(self, run_id: str, event: str, data: Any):
        rows = self.run_events[run_id]
        rows.append({"sequence": len(rows) + 1, "event": event, "data": data})

    async def events(self, run_id: str): return list(self.run_events.get(run_id, []))


@dataclass
class Snapshot:
    values: dict[str, Any]
    next: tuple[str, ...] = ()


class FakeGraph:
    def __init__(self, states: dict[str, Snapshot], config: dict[str, Any]):
        self.states = states
        self.config = config

    def _thread(self, config: dict[str, Any] | None = None):
        actual = config or self.config
        return actual["configurable"]["thread_id"]

    async def ainvoke(self, payload: Any, config: dict[str, Any]):
        thread_id = self._thread(config)
        if getattr(payload, "resume", None) is not None:
            state = Snapshot({"messages": [{"type": "ai", "content": "resumed answer", "tool_calls": []}]})
        else:
            messages = payload.get("messages", [])
            text = str(messages[-1].get("content", "")) if messages else ""
            if text == "slow":
                await asyncio.sleep(30)
            if text == "interrupt":
                state = Snapshot({"messages": [{"type": "ai", "content": "", "tool_calls": [
                    {"id": "approval-1", "name": "call_skill", "args": {"skill_stable_name": "diagram-maker"}}
                ]}]}, ("HumanInTheLoopMiddleware.after_model",))
            else:
                state = Snapshot({"messages": [{"type": "ai", "content": "runtime answer", "tool_calls": []}]})
        self.states[thread_id] = state
        return state.values

    async def aget_state(self, config: dict[str, Any]):
        return self.states.get(self._thread(config), Snapshot({"messages": []}))


def main():
    port = int(sys.argv[1])
    states: dict[str, Snapshot] = {}
    runtime = Runtime(MemoryLedger(), lambda _graph_id, config: FakeGraph(states, config))
    uvicorn.run(create_app(runtime), host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__": main()
