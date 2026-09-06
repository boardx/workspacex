"""Exact, temporary Deep Agents 0.7.6 sandbox-template compatibility fix.

Two quotes in Python comments break the upstream shell-quoted grep command.
Only this trusted template constant is changed. No method, parser or caller
command is wrapped. Remove after upgrading to a verified upstream fix and
re-running the real synchronous/asynchronous path-glob grep regressions.
"""
from __future__ import annotations

import hashlib
from importlib.metadata import version
from threading import Lock

import deepagents.backends.sandbox as upstream

_VERSION = "0.7.6"
_ORIGINAL_SHA256 = "4258343b027087e4f90aa3db83dd3218c063d7eb666c83b9a995d25a8aeb31d1"
_PATCHED_SHA256 = "8206dc7d3e708e4af074e7e917ae35174d938393f3cc76952f913c6d892d9bcb"
_COMMENT_QUOTES = ('"exactly at the cap"', '"capped early"')
_LOCK = Lock()


class UpstreamCompatibilityError(RuntimeError):
    """Dependency must be reviewed before allowing native sandbox use."""


def _checked_template(template: str, installed_version: str) -> str:
    if installed_version != _VERSION:
        raise UpstreamCompatibilityError(
            f"Native sandbox compatibility was reviewed for deepagents {_VERSION}, got {installed_version}; "
            "review the upstream grep template and run test_upstream_compat before updating the compatibility pin"
        )
    digest = hashlib.sha256(template.encode("utf-8")).hexdigest()
    if digest == _PATCHED_SHA256:
        return template
    if digest != _ORIGINAL_SHA256:
        raise UpstreamCompatibilityError(
            f"Deep Agents grep template hash changed ({digest}); review the dependency source and "
            "run test_upstream_compat before updating the compatibility hashes"
        )
    repaired = template
    for fragment in _COMMENT_QUOTES:
        if repaired.count(fragment) != 1:
            raise UpstreamCompatibilityError("Unexpected grep comment layout; inspect the pinned upstream template")
        repaired = repaired.replace(fragment, fragment[1:-1], 1)
    if hashlib.sha256(repaired.encode("utf-8")).hexdigest() != _PATCHED_SHA256:
        raise UpstreamCompatibilityError("Grep compatibility patch did not match its reviewed output hash")
    return repaired


def ensure_sandbox_compat() -> None:
    """Called only by the trusted HTTP adapter; idempotent and thread-safe."""
    with _LOCK:
        repaired = _checked_template(upstream._GREP_PATH_GLOB_TEMPLATE, version("deepagents"))
        upstream._GREP_PATH_GLOB_TEMPLATE = repaired
