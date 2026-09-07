"""Bounded graph-instance admission for a single trusted sandbox consumer slot.

This is conservative tool scheduling, not a distributed lock or remote stop. The
existing session provider still rejects competing calls from other graphs/processes.
"""
from __future__ import annotations

import asyncio
from collections import deque
import math
import threading
import time
from uuid import UUID

from langchain.agents.middleware import AgentMiddleware

from .native_tool_authority import ToolAuthorityError
from .sandbox_backend import LIMITS


class SandboxDispatchError(ToolAuthorityError):
    """No dispatch occurred; inherits the existing native no-retry boundary."""


class NativeSandboxDispatch(AgentMiddleware):
    """Place immediately outside NativeToolAuthority: acquire, recheck, dispatch.

There is no shared resource declaration for all current native/HTTP tools. Until
one exists, serialize all tools conservatively except cancellation/status. This
includes the complete parent `task` handler; its child read-only graph must not
be wrapped with this gate again. The instance belongs to one trusted session and
must not be used to coordinate separate graphs or processes.
"""
    _CONTROL = frozenset({'wx_run_cancel', 'wx_run_status'})

    def __init__(self, session_id: str, *, queue_timeout: float | None = None,
                 max_pending: int | None = None, binding_guard=None):
        self._session_id = str(UUID(session_id))
        self._timeout = LIMITS['maxTimeoutMs'] / 1000 if queue_timeout is None else queue_timeout
        self._capacity = LIMITS['maxSessions'] if max_pending is None else max_pending
        if not isinstance(self._timeout, (int, float)) or not math.isfinite(self._timeout) or not 0 < self._timeout <= LIMITS['maxTimeoutMs'] / 1000:
            raise ValueError('Invalid sandbox dispatch queue timeout')
        if type(self._capacity) is not int or not 1 <= self._capacity <= LIMITS['maxSessions']:
            raise ValueError('Invalid sandbox dispatch queue capacity')
        if binding_guard is not None and any(not callable(getattr(binding_guard,name,None)) for name in ('check','acheck')):
            raise TypeError('A trusted binding guard requires sync and async checks')
        self._binding_guard = binding_guard
        self._condition = threading.Condition()
        self._waiting: deque[object] = deque()
        self._active = False

    def _reserve(self):
        with self._condition:
            if len(self._waiting) >= self._capacity:
                raise SandboxDispatchError('Sandbox dispatch queue capacity reached; not submitted')
            ticket = object()
            self._waiting.append(ticket)
            return ticket

    def _take(self, ticket):
        with self._condition:
            if not self._active and self._waiting and self._waiting[0] is ticket:
                self._waiting.popleft()
                self._active = True
                return True
            return False

    def _remove(self, ticket):
        with self._condition:
            try:
                self._waiting.remove(ticket)
            except ValueError:
                pass
            self._condition.notify_all()

    def _release(self):
        with self._condition:
            self._active = False
            self._condition.notify_all()

    def wrap_tool_call(self, request, handler):
        if request.tool_call['name'] in self._CONTROL:
            return handler(request)
        ticket = self._reserve()
        deadline = time.monotonic() + self._timeout
        try:
            with self._condition:
                while not self._take(ticket):
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise SandboxDispatchError('Sandbox dispatch queue timed out; not submitted')
                    self._condition.wait(remaining)
        except BaseException:
            self._remove(ticket)
            raise
        try:
            if self._binding_guard is not None:
                self._binding_guard.check()
            result = handler(request)
            if self._binding_guard is not None:
                self._binding_guard.check()
            return result
        finally:
            self._release()

    async def awrap_tool_call(self, request, handler):
        if request.tool_call['name'] in self._CONTROL:
            return await handler(request)
        ticket = self._reserve()
        deadline = time.monotonic() + self._timeout
        try:
            while not self._take(ticket):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise SandboxDispatchError('Sandbox dispatch queue timed out; not submitted')
                # No executor thread survives queue cancellation. Small polling
                # also permits sync and async dispatches to share the same slot.
                await asyncio.sleep(min(.01, remaining))
        except BaseException:
            self._remove(ticket)
            raise
        try:
            async def dispatch():
                if self._binding_guard is not None:
                    await self._binding_guard.acheck()
                result = await handler(request)
                if self._binding_guard is not None:
                    await self._binding_guard.acheck()
                return result
            task = asyncio.create_task(dispatch())
            try:
                return await asyncio.shield(task)
            except asyncio.CancelledError:
                # An already-dispatched consumer may have a to_thread call or
                # remote HTTP operation. Do not open the slot while it settles.
                # This delays local cancellation; it does not claim remote stop.
                while not task.done():
                    try:
                        await asyncio.shield(task)
                    except asyncio.CancelledError:
                        continue
                    except BaseException:
                        break
                if task.done():
                    try:
                        task.result()
                    except BaseException:
                        pass
                raise
        finally:
            self._release()
