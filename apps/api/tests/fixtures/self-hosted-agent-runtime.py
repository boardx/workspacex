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
        await self.append_events(run_id, [(event, data)])

    # 2026-09-22：下面三个成员是 `Ledger` 协议（`self_hosted_runtime.py` 的 `class Ledger`）
    # 现有的形状，这个替身此前落后于它，于是那个协议的三处调用在替身上全部炸掉：
    #   · `events(run_id, after)` —— SSE 读取器会把「已发到第几条」传进来（#3716 增量读取），
    #     旧签名只收一个参数 ⇒ `TypeError: events() takes 2 positional arguments but 3 were
    #     given`，**在 SSE 处理器内部抛出** ⇒ 连接当场断掉。对客户端的症状是
    #     `SocketError: other side closed`，对走 skill 事实那条路的客户端则是
    #     `skill_activity_delivery_unavailable`——两条 CI 红都是它。
    #   · `append_events(run_id, items)` —— token 片段批量写入（#3716），替身完全没有。
    #   · `prune_events()` —— 事件账本裁剪（#3749 R4）。它的调用点包了 try/except，
    #     所以只在启动时打一行 warning，不致命；但它和上面两个是同一个原因：**替身没跟上协议**。
    #
    # ⚠ 教训写在这里而不是提交信息里：一个落后于协议的替身不会报「我过期了」，它会
    # 在一个完全不相关的地方以「连接断了」的形状出现。本仓已多次栽在
    # 「替身的方言 ≠ 上游的方言」这件事上。
    async def append_events(self, run_id: str, items: list[tuple[str, Any]]):
        rows = self.run_events[run_id]
        for event, data in items:
            rows.append({"sequence": len(rows) + 1, "event": event, "data": data})

    async def events(self, run_id: str, after: int = 0):
        return [row for row in self.run_events.get(run_id, []) if row["sequence"] > after]

    async def prune_events(self) -> int:
        return 0


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

    async def astream(self, payload: Any, config: dict[str, Any], stream_mode):
        await self.ainvoke(payload, config)
        text = str(payload.get("messages", [{}])[-1].get("content", "")) if isinstance(payload, dict) else ""
        if text == "skill activity":
            yield "custom", {"type": "skill_activity", "version": 1, "fact": {
                "contractVersion": 1, "factId": "fact-1", "skillId": "skill-1",
                "skillStableName": "pdf-create", "skillVersion": "v1",
                "packageDigest": "a" * 64, "stage": "body_read",
                "readPath": "/skills/pdf-create/SKILL.md",
            }}

    async def aget_state(self, config: dict[str, Any]):
        return self.states.get(self._thread(config), Snapshot({"messages": []}))


def main():
    port = int(sys.argv[1])
    states: dict[str, Snapshot] = {}
    runtime = Runtime(MemoryLedger(), lambda _graph_id, config: FakeGraph(states, config))
    uvicorn.run(create_app(runtime), host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__": main()
