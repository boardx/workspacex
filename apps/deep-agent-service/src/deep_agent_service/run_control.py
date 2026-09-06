"""Durable user-input delivery at graph model boundaries, never inside a tool.

Only IDs already present in state are acknowledged. Returning a new message update
is not evidence that LangGraph has checkpointed it. A lost response is redelivered
and the middleware's stable message IDs make the update idempotent.
"""
from urllib.parse import quote

import httpx
from langgraph.config import get_config


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
    if pause_at_boundary and body.get("cancelRequested") is True:
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
    # Fail closed on transport/auth failures: continuing could execute stale user intent.
    return _values(httpx.post(url, headers=headers, json=body, timeout=5.0), pause_at_boundary)


async def apoll_interjections(state: dict, *, pause_at_boundary: bool = False) -> list[dict]:
    request = _request(state)
    if request is None:
        return []
    url, headers, body = request
    async with httpx.AsyncClient(timeout=5.0) as client:
        return _values(await client.post(url, headers=headers, json=body), pause_at_boundary)
