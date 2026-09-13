"""Public task timing/tool facts, isolated per invocation; no model content."""
from contextvars import ContextVar
from dataclasses import dataclass, field
from collections import Counter
from threading import Lock
import time

from langchain.agents.middleware import AgentMiddleware
from langchain_core.callbacks import BaseCallbackHandler
from .tool_progress import ToolProgressThrottle, resolve_writer


@dataclass
class _Observation:
    root_run: object = None
    tools: dict = field(default_factory=dict)
    failures: set = field(default_factory=set)
    lock: Lock = field(default_factory=Lock)


_current = ContextVar('native_task_observation', default=None)


class NativeTaskToolObserver(BaseCallbackHandler):
    # Keep the invocation's ContextVar, including sync callbacks inside async graphs.
    run_inline = True

    def on_tool_start(self, serialized, input_str, *, run_id, **kwargs):
        observation = _current.get()
        if observation is not None:
            with observation.lock:
                name = str((serialized or {}).get('name', 'unknown'))
                if observation.root_run is None and name == 'task':
                    observation.root_run = run_id
                    return
                observation.tools[run_id] = name

    def on_tool_error(self, error, *, run_id, **kwargs):
        observation = _current.get()
        if observation is not None:
            with observation.lock:
                if run_id in observation.tools:
                    observation.failures.add(run_id)

    def on_tool_end(self, output, *, run_id, **kwargs):
        if getattr(output, 'status', None) == 'error':
            self.on_tool_error(None, run_id=run_id)


def _finish(observation, progress, started):
    elapsed = max(0, time.monotonic() - started)
    if observation.root_run is None:
        progress.emit(f'子任务耗时 {elapsed:.2f} 秒；工具统计不可用', force=True)
        return
    with observation.lock:
        counts = Counter(observation.tools.values())
        total, failures = len(observation.tools), len(observation.failures)
    # Counts are complete even when the bounded public name summary is shortened.
    names = '、'.join(f'{name[:24]}×{count}' for name, count in sorted(counts.items())[:4])
    if len(counts) > 4:
        names += f'等 {len(counts)} 种工具'
    progress.emit(f'子任务耗时 {elapsed:.2f} 秒；工具调用 {total} 次，失败 {failures} 次'
                  + (f'：{names}' if names else '（未调用工具）'), force=True)


class NativeTaskObservation(AgentMiddleware):
    def wrap_tool_call(self, request, handler):
        if request.tool_call['name'] != 'task':
            return handler(request)
        observation = _Observation()
        progress = ToolProgressThrottle(resolve_writer(), 'task', request.tool_call['id'])
        token = _current.set(observation)
        started = time.monotonic()
        try:
            return handler(request)
        finally:
            _current.reset(token)
            _finish(observation, progress, started)

    async def awrap_tool_call(self, request, handler):
        if request.tool_call['name'] != 'task':
            return await handler(request)
        observation = _Observation()
        progress = ToolProgressThrottle(resolve_writer(), 'task', request.tool_call['id'])
        token = _current.set(observation)
        started = time.monotonic()
        try:
            return await handler(request)
        finally:
            _current.reset(token)
            _finish(observation, progress, started)
