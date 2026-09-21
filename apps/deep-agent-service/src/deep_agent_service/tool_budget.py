"""Per-request tool budget: keep the model's prompt down to the tools it can actually use.

Measured on WorkspaceX Local (2026-09-22, recording proxy in front of Ollama): one canvas
request sent 25 519 characters, of which **17 347 were the JSON schemas of 15 tools** — 68 %
of a 4 098-token prompt, costing 14.6 s of prefill before the first character reached the
user. Those 15 include ten tools `create_deep_agent` injects through its own middleware
(filesystem, subagent dispatch, planning); a 4B model in a desktop chat calls almost none of
them, yet pays for every schema on every turn.

`FilesystemMiddleware` / `SubAgentMiddleware` are required scaffolding in deepagents and must
stay in the stack (they also enforce permissions), so the tools are removed from the *model
request* instead — the same shape as deepagents' own `_ToolExclusionMiddleware`, wired through
our middleware list so no packaging-level profile plugin is needed.

`DEEP_AGENT_EXCLUDED_TOOLS` unset ⇒ no middleware is appended and every deployment's request
is byte-for-byte what it was.
"""
from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

from langchain.agents.middleware.types import AgentMiddleware

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from langchain.agents.middleware.types import ModelRequest, ModelResponse


def excluded_tool_names(env: dict[str, str] | None = None) -> frozenset[str]:
    """Tool names to hide from the model, from `DEEP_AGENT_EXCLUDED_TOOLS` (comma separated)."""
    raw = (env if env is not None else os.environ).get("DEEP_AGENT_EXCLUDED_TOOLS", "")
    return frozenset(name.strip() for name in raw.split(",") if name.strip())


EXCLUDED_TOOLS_CONFIG_KEY = "excluded_tools"


def per_run_excluded_tools() -> frozenset[str]:
    """Exclusions the API computed for THIS turn (`configurable.excluded_tools`).

    A canvas request is answered by writing a ```canvas fence, never by a skill; with
    `call_skill` still mounted a 4B invented a skill name, spent two round trips discovering
    the real catalog, then delegated the canvas to `diagram-and-canvas`, which answered with a
    markdown table and no fence at all (recording proxy, 2026-09-22). Tools that cannot help
    with this turn are removed for this turn.
    """
    try:
        from langgraph.config import get_config

        configurable = (get_config() or {}).get("configurable") or {}
    except Exception:
        return frozenset()
    raw = configurable.get(EXCLUDED_TOOLS_CONFIG_KEY)
    if not isinstance(raw, (list, tuple)):
        return frozenset()
    return frozenset(str(name) for name in raw if isinstance(name, str) and name.strip())


def _tool_name(tool: Any) -> str | None:
    if isinstance(tool, dict):
        name = tool.get("name")
        if isinstance(name, str):
            return name
        function = tool.get("function")
        if isinstance(function, dict) and isinstance(function.get("name"), str):
            return str(function["name"])
        return None
    name = getattr(tool, "name", None)
    return name if isinstance(name, str) else None


ALL_TOOLS = "*"
"""Exclusion entry meaning "this turn needs no tools at all" (a canvas is written, not fetched)."""


def prune_tools(tools: list[Any], excluded: frozenset[str]) -> list[Any]:
    """Every tool whose name is not excluded, order preserved. Unnamed tools are kept:
    a tool we cannot identify is not a tool we may silently drop. `"*"` excludes all."""
    if not excluded:
        return tools
    if ALL_TOOLS in excluded:
        return []
    return [t for t in tools if (_tool_name(t) or "") not in excluded]


class ToolBudgetMiddleware(AgentMiddleware):
    """Removes `excluded` tools from the model request. Last in the stack: everything that
    injects tools has already run by then, including deepagents' own middleware."""

    name = "ToolBudgetMiddleware"

    def __init__(self, *, excluded: frozenset[str]) -> None:
        super().__init__()
        self._excluded = excluded

    def _pruned(self, request: "ModelRequest") -> "ModelRequest":
        tools = getattr(request, "tools", None)
        if not tools:
            return request
        excluded = self._excluded | per_run_excluded_tools()
        if not excluded:
            return request
        kept = prune_tools(list(tools), excluded)
        if len(kept) == len(tools):
            return request
        # `tool_choice` naming a tool we just removed would make the request unsatisfiable.
        choice = getattr(request, "tool_choice", None)
        overrides: dict[str, Any] = {"tools": kept}
        if isinstance(choice, str) and choice in excluded:
            overrides["tool_choice"] = None
        return request.override(**overrides)

    def wrap_model_call(
        self, request: "ModelRequest", handler: "Callable[[ModelRequest], ModelResponse]"
    ) -> "ModelResponse":
        return handler(self._pruned(request))

    async def awrap_model_call(
        self,
        request: "ModelRequest",
        handler: "Callable[[ModelRequest], Awaitable[ModelResponse]]",
    ) -> "ModelResponse":
        return await handler(self._pruned(request))
