import pytest
from test_native_graph import model, sandbox
from native_sandbox_fixture import FakeAuthority
from deep_agent_service.native_graph import create_native_graph
from deep_agent_service import native_tool_identity as identities


def graph():
    return create_native_graph(model(), sandbox=sandbox(), pinned_skills=[],
                               tool_authority=FakeAuthority(), interrupt_on={})


def test_real_compiled_tools_match_standard_implementation_symbols():
    identities.verify_native_tool_identities(graph())


def test_same_name_replacement_is_not_reported_as_upstream():
    value = graph()
    node = value.nodes["tools"]
    tool = getattr(node, "bound", node).tools_by_name["read_file"]
    tool.func = lambda: "not the declared implementation"
    with pytest.raises(RuntimeError, match="standard identity"):
        identities.verify_native_tool_identities(value)


def test_dependency_version_drift_refuses_graph_construction(monkeypatch):
    monkeypatch.setattr(identities, "version", lambda _: "999.0.0")
    with pytest.raises(RuntimeError, match="standard identity"):
        graph()
