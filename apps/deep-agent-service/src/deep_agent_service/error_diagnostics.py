"""Bounded mechanical exception facts for private native logs; never exception text."""
from __future__ import annotations

import json
import re
import socket
import ssl
from collections import deque
from typing import Any
from uuid import UUID

import httpcore
import httpx
import openai


MAX_CAUSE_NODES = 6
_KNOWN_TYPES = (
    Exception, RuntimeError, ValueError, TypeError, OSError, ConnectionError, TimeoutError,
    socket.gaierror, ssl.SSLError, ssl.SSLCertVerificationError,
    httpx.RequestError, httpx.TransportError, httpx.ConnectError, httpx.ConnectTimeout,
    httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout, httpx.ProxyError,
    httpx.ReadError, httpx.WriteError, httpx.RemoteProtocolError, httpx.LocalProtocolError,
    httpx.HTTPStatusError,
    httpcore.ConnectError, httpcore.ConnectTimeout, httpcore.ReadTimeout,
    httpcore.WriteTimeout, httpcore.PoolTimeout, httpcore.ProxyError,
    httpcore.ReadError, httpcore.WriteError, httpcore.RemoteProtocolError,
    httpcore.LocalProtocolError,
    openai.APIError, openai.APIConnectionError, openai.APITimeoutError,
    openai.APIStatusError, openai.BadRequestError, openai.AuthenticationError,
    openai.PermissionDeniedError, openai.NotFoundError, openai.ConflictError,
    openai.UnprocessableEntityError, openai.RateLimitError, openai.InternalServerError,
)
_CLASS_LABELS = tuple((kind, kind.__name__) for kind in _KNOWN_TYPES)
_OS_TYPES = frozenset((OSError, ConnectionError, TimeoutError, socket.gaierror, ssl.SSLError, ssl.SSLCertVerificationError))
_OPENAI_STATUS_TYPES = frozenset((
    openai.APIStatusError, openai.BadRequestError, openai.AuthenticationError,
    openai.PermissionDeniedError, openai.NotFoundError, openai.ConflictError,
    openai.UnprocessableEntityError, openai.RateLimitError, openai.InternalServerError,
))
_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\Z")


def _integer(value: Any, minimum: int, maximum: int) -> int | None:
    # bool and integer subclasses are not observed mechanical codes.
    return value if type(value) is int and minimum <= value <= maximum else None


def _facts(error: BaseException) -> dict[str, str | int]:
    kind = type(error)
    label = next((label for trusted, label in _CLASS_LABELS if kind is trusted), "UnknownError")
    result: dict[str, str | int] = {"class": label}
    if label == "UnknownError":
        return result
    if kind in _OS_TYPES:
        code = _integer(object.__getattribute__(error, "errno"), -65535, 65535)
        if code is not None:
            result["errno"] = code
    if kind is ssl.SSLCertVerificationError:
        # A constructed SSL exception may lack verify_code; never read verify_message.
        try:
            code = _integer(object.__getattribute__(error, "verify_code"), 0, 65535)
        except AttributeError:
            code = None
        if code is not None:
            result["ssl_verify_code"] = code
    if kind is httpx.HTTPStatusError:
        response = object.__getattribute__(error, "response")
        code = _integer(response.status_code, 100, 599) if type(response) is httpx.Response else None
        if code is not None:
            result["http_status"] = code
    elif kind in _OPENAI_STATUS_TYPES:
        code = _integer(object.__getattribute__(error, "status_code"), 100, 599)
        if code is not None:
            result["http_status"] = code
    return result


def _linked_errors(error: BaseException) -> tuple[BaseException, ...]:
    # Read BaseException's actual slots, bypassing user overrides/properties entirely.
    cause = BaseException.__cause__.__get__(error)
    context = BaseException.__context__.__get__(error)
    # Private mechanical facts include both links, even when traceback display suppresses context.
    return tuple(link for link in (cause, context) if isinstance(link, BaseException))


def private_error_diagnostic(error: BaseException) -> dict[str, Any]:
    chain: list[dict[str, str | int]] = []
    seen: set[int] = set()
    pending = deque([(error, frozenset())])
    cycle = False
    while pending and len(chain) < MAX_CAUSE_NODES:
        current, ancestors = pending.popleft()
        if not isinstance(current, BaseException):
            continue
        if id(current) in seen:
            continue
        seen.add(id(current))
        chain.append(_facts(current))
        path = ancestors | {id(current)}
        for link in _linked_errors(current):
            if id(link) in path:
                cycle = True
            elif id(link) not in seen:
                pending.append((link, path))
    return {"causes": chain, "truncated": any(id(link) not in seen for link, _path in pending), "cycle_detected": cycle}


def log_private_run_failure(logger: Any, error: BaseException, run_id: str) -> bool:
    """Best effort only: log failure must not change durable error handling or retry execution."""
    try:
        payload = {"event": "native_run_failure_diagnostic", **private_error_diagnostic(error)}
        if type(run_id) is str and _UUID.fullmatch(run_id):
            payload["native_run_id"] = str(UUID(run_id))
        logger.warning(json.dumps(payload, sort_keys=True, separators=(",", ":")))
        return True
    except Exception:
        # Never serialize the logging/projection exception or replace the original failure.
        return False
