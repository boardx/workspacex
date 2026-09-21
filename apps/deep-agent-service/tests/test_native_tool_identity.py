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


# #3014: WX-T009 / WX-T010 carry the same catalog clause as T001-T008 -- "never a
# same-name in-house function" -- but were absent from the manifest, so the verifier
# never looked at them and both mutations below went through unreported. They are
# also the two tools upstream does NOT shape like a FilesystemMiddleware factory:
# `write_todos` is a pair of module level langchain functions, `task` a closure of a
# module level deepagents factory. Mutating each implementation separately keeps the
# sync and async halves of both shapes falsifiable.
@pytest.mark.parametrize("name", ["write_todos", "task"])
@pytest.mark.parametrize("implementation", ["func", "coroutine"])
def test_planning_and_delegation_same_name_replacement_is_not_reported_as_upstream(name, implementation):
    value = graph()
    node = value.nodes["tools"]
    tool = getattr(node, "bound", node).tools_by_name[name]
    setattr(tool, implementation, lambda: "not the declared implementation")
    with pytest.raises(RuntimeError, match="standard identity"):
        identities.verify_native_tool_identities(value)


def test_planning_and_delegation_tools_carry_a_standard_identity():
    manifest = {identity["canonicalName"]: identity["id"] for identity in identities.IDENTITIES}
    assert manifest.get("write_todos") == "WX-T009"
    assert manifest.get("task") == "WX-T010"


def test_locator_naming_no_installed_symbol_refuses_attribution(monkeypatch):
    """The manifest may not attribute a tool to a symbol upstream does not publish."""
    value = graph()
    stale = [{**identity, "source": {**identity["source"], "locator": identity["source"]["locator"] + "_renamed_upstream"}}
             if identity["canonicalName"] == "write_todos" else identity for identity in identities.IDENTITIES]
    monkeypatch.setattr(identities, "IDENTITIES", stale)
    with pytest.raises(RuntimeError, match="standard identity"):
        identities.verify_native_tool_identities(value)
