"""Select the legacy or restricted graph from gateway-owned run configuration.

The gateway must not forward user-controlled configurable fields. Text-only
background runs must use separate threads, never a legacy thread checkpoint.
"""
from __future__ import annotations

import json
from pathlib import Path

from langchain.agents import create_agent
from langchain_core.runnables import RunnableConfig


def _execution_mode_key() -> str:
    schema = json.loads((Path(__file__).parent / "generated" / "standard_capabilities_schema.json").read_text())
    return schema["configurableKeys"]["executionMode"]


def select_graph(config: RunnableConfig):
    """Official LangGraph config factory; absence preserves existing assistant behavior."""
    configurable = config.get("configurable", {})
    if not isinstance(configurable, dict):
        raise ValueError("Invalid execution configuration")
    key = _execution_mode_key()
    from deep_agent_service.native_factory import native_config_key, native_graph_context
    if native_config_key() in configurable:
        if key in configurable:
            raise ValueError("Native and restricted execution modes cannot be combined")
        return native_graph_context(config)
    if key not in configurable:
        from deep_agent_service.graph import graph
        return graph
    if configurable[key] != "text-only":
        raise ValueError("Unsupported execution mode")
    from deep_agent_service.graph import _model
    # No middleware, file backend, tool node, HITL or subagent machinery. Even
    # a model returning a fabricated tool call has no execution node to reach.
    return create_agent(model=_model, tools=[])
