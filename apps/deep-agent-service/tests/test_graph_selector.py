import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage

from deep_agent_service import graph_selector


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(graph_selector, "_execution_mode_key", lambda: "test-execution-mode")
    legacy = object()
    model = FakeMessagesListChatModel(responses=[AIMessage(content="text response")])
    monkeypatch.setitem(sys.modules, "deep_agent_service.graph", SimpleNamespace(graph=legacy, _model=model))
    return legacy


def test_default_returns_existing_graph(configured):
    assert graph_selector.select_graph({}) is configured
    assert graph_selector.select_graph({"configurable": {"unrelated": "x"}}) is configured


@pytest.mark.parametrize("mode", [None, "native", "unknown", "", [], {}])
def test_unknown_explicit_mode_fails_closed(configured, mode):
    with pytest.raises(ValueError, match="Unsupported"):
        graph_selector.select_graph({"configurable": {"test-execution-mode": mode}})


def test_text_only_has_no_tools_and_runs(configured):
    graph = graph_selector.select_graph({"configurable": {"test-execution-mode": "text-only"}})
    assert set(graph.nodes) == {"__start__", "model"}
    result = graph.invoke({"messages": [{"role": "user", "content": "answer"}]})
    assert result["messages"][-1].content == "text response"


def test_fabricated_tool_call_cannot_execute(configured, monkeypatch):
    model = FakeMessagesListChatModel(responses=[AIMessage(content="", tool_calls=[{
        "name": "execute", "args": {"command": "dangerous"}, "id": "fake-call",
    }])])
    monkeypatch.setattr(sys.modules["deep_agent_service.graph"], "_model", model)
    graph = graph_selector.select_graph({"configurable": {"test-execution-mode": "text-only"}})
    result = graph.invoke({"messages": [{"role": "user", "content": "execute"}]})
    assert not any(message.type == "tool" for message in result["messages"])
    assert "tools" not in graph.nodes


def test_deployment_uses_config_factory_without_changing_assistant_id():
    config = json.loads((Path(__file__).parents[1] / "langgraph.json").read_text())
    assert config["graphs"]["Deep Agent"] == "./src/deep_agent_service/graph_selector.py:select_graph"
    from langgraph_api._factory_utils import _classify_factory
    hook = _classify_factory(graph_selector.select_graph)
    assert hook is not None


def test_generated_execution_key_is_available():
    assert isinstance(graph_selector._execution_mode_key(), str)
    assert graph_selector._execution_mode_key()
