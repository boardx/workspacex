"""Durable user-input delivery at graph model boundaries, never inside a tool.

Only IDs already present in state are acknowledged. Returning a new message update
is not evidence that LangGraph has checkpointed it. A lost response is redelivered
and the middleware's stable message IDs make the update idempotent.
"""
import asyncio
import time
from urllib.parse import quote

import httpx
from langgraph.config import get_config


# Only callback connection establishment is recoverable. This window covers the
# observed 16s API deployment gap without replaying model/tool/publication work.
CONTROL_CONNECT_RECOVERY_SECONDS = 20.0
_CONTROL_CONNECT_BACKOFF_SECONDS = 0.5
_monotonic = time.monotonic
_sleep = time.sleep
_asleep = asyncio.sleep


def _request(state: dict) -> tuple[str, dict, dict] | None:
    try:
        callback = (get_config().get("configurable") or {}).get("run_control_callback")
    except RuntimeError:
        return None
    if callback is None:
        return None
    if not isinstance(callback, dict) or any(
        not isinstance(callback.get(k), str) or not callback[k].strip()
        for k in ("base_url", "key", "org_id", "run_id")
    ):
        raise ValueError("invalid run control callback configuration")
    ids = [
        message.id.removeprefix("interjection:")
        for message in state.get("messages", [])
        if isinstance(getattr(message, "id", None), str)
        and message.id.startswith("interjection:")
        and getattr(message, "type", None) == "human"
    ]
    url = (f"{callback['base_url'].rstrip('/')}/internal/agent-runs/"
           f"{quote(callback['run_id'], safe='')}/interjections/poll")
    return url, {"x-deep-agent-internal-key": callback["key"]}, {
        "orgId": callback["org_id"], "acknowledgedIds": ids[-100:],
    }


def _values(response: httpx.Response, pause_at_boundary: bool) -> list[dict]:
    response.raise_for_status()
    body = response.json()
    values = body.get("interjections")
    if not isinstance(values, list) or len(values) > 100:
        raise ValueError("invalid run control callback response")
    # Cancellation also interrupts after_model before pending tools start. Unlike
    # steering, interrupt preserves the AI tool calls without inserting a message.
    if body.get("cancelRequested") is True:
        from langgraph.types import interrupt
        interrupt({"kind": "user_cancel"})
    if pause_at_boundary and body.get("pauseRequested") is True:
        from langgraph.types import interrupt
        # Dynamic interrupt is checkpointed by LangGraph. The gateway marks paused
        # only after observing this exact value, and resumes with Command(resume=True).
        interrupt({"kind": "user_pause"})
    return values


def poll_interjections(state: dict, *, pause_at_boundary: bool = False) -> list[dict]:
    request = _request(state)
    if request is None:
        return []
    url, headers, body = request
    # Poll/ACK carries only checkpointed IDs and is idempotent. Never retry a
    # response/read/write error, denial, model call, tool dispatch or publication.
    deadline = _monotonic() + CONTROL_CONNECT_RECOVERY_SECONDS
    last_connection_error = None
    while True:
        remaining = deadline - _monotonic()
        if remaining <= 0:
            raise last_connection_error or httpx.ConnectTimeout("Control callback connection deadline exceeded")
        try:
            result = httpx.post(url, headers=headers, json=body, timeout=min(5.0, remaining))
        except (httpx.ConnectError, httpx.ConnectTimeout) as error:
            last_connection_error = error
            remaining = deadline - _monotonic()
            if remaining <= 0:
                raise
            _sleep(min(_CONTROL_CONNECT_BACKOFF_SECONDS, remaining))
            if _monotonic() >= deadline:
                raise
            continue
        if _monotonic() >= deadline:
            raise httpx.ReadTimeout("Control callback response arrived after recovery deadline")
        return _values(result, pause_at_boundary)


async def apoll_interjections(state: dict, *, pause_at_boundary: bool = False) -> list[dict]:
    request = _request(state)
    if request is None:
        return []
    url, headers, body = request
    deadline = _monotonic() + CONTROL_CONNECT_RECOVERY_SECONDS
    # The async production path additionally bounds slow response phases by the
    # same total deadline. External task cancellation always propagates.
    last_connection_error = None
    try:
        async with asyncio.timeout(CONTROL_CONNECT_RECOVERY_SECONDS):
            async with httpx.AsyncClient(timeout=5.0) as client:
                while True:
                    remaining = deadline - _monotonic()
                    if remaining <= 0:
                        raise last_connection_error or httpx.ConnectTimeout("Control callback connection deadline exceeded")
                    try:
                        result = await client.post(url, headers=headers, json=body, timeout=min(5.0, remaining))
                    except (httpx.ConnectError, httpx.ConnectTimeout) as error:
                        last_connection_error = error
                        remaining = deadline - _monotonic()
                        if remaining <= 0:
                            raise
                        await _asleep(min(_CONTROL_CONNECT_BACKOFF_SECONDS, remaining))
                        if _monotonic() >= deadline:
                            raise
                        continue
                    if _monotonic() >= deadline:
                        raise httpx.ReadTimeout("Control callback response arrived after recovery deadline")
                    return _values(result, pause_at_boundary)
    except TimeoutError:
        if last_connection_error is not None:
            raise last_connection_error from None
        raise
