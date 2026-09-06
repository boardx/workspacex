"""Native wiring: official tools, pinned mounts, cache provenance and eviction."""
import asyncio
import base64
import copy
import hashlib
import json
from uuid import uuid4

import httpx
import pytest
from deepagents.backends import CompositeBackend, StateBackend
from deepagents.middleware.skills import SkillsMiddleware
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import MemorySaver

from native_sandbox_fixture import FakeAuthority
from native_sandbox_fixture import pinned_skill_package as package, real_native_session

from deep_agent_service import native_graph
from deep_agent_service.native_graph import _BoundSkillsMiddleware, create_native_graph
from deep_agent_service.sandbox_backend import HttpSessionSandbox, SandboxTransportError




class ScriptedModel(GenericFakeChatModel):
    def bind_tools(self, tools, **kwargs):
        names = [getattr(t, "name", None) or (t.get("function", {}).get("name") if isinstance(t, dict) else None) for t in tools]
        if "GraderResponse" in names:
            return ScriptedModel(messages=iter([AIMessage(content="", tool_calls=[{
                "id": "grade", "name": "GraderResponse", "args": {"result": "satisfied", "explanation": "Test grader", "criteria": []}
            }])]))
        return self


def model(*messages):
    return ScriptedModel(messages=iter(messages or (AIMessage(content="done"),)))


def sandbox(pins=(), *, session_id=None, corrupt=False):
    mounted = {f"/skills/{skill['stable_name']}/{f['path']}": f["contentBase64"] for skill in pins for f in skill["package"]["files"]}
    def handler(request):
        if request.method == "GET":
            path = request.url.params["path"]
            encoded = "YmFk" if corrupt else mounted[path]
            return httpx.Response(200, json={"path": path, "contentBase64": encoded, "sizeBytes": len(base64.b64decode(encoded))})
        body = json.loads(request.content)
        return httpx.Response(200, json={"executionId": body["executionId"], "exitCode": 0, "output": "",
                                         "truncated": False, "timedOut": False, "cancelled": False})
    return HttpSessionSandbox(session_id or str(uuid4()), "a" * 64, httpx.Client(transport=httpx.MockTransport(handler), base_url="http://sandbox"))


def test_native_tools_and_harness_share_one_backend(monkeypatch):
    seen = []
    original = native_graph.build_middleware
    def capture(m, *, backend=None):
        middleware = original(m, backend=backend)
        seen.append((backend, next(x for x in middleware if x.name == "FilesystemMiddleware")))
        return middleware
    monkeypatch.setattr(native_graph, "build_middleware", capture)
    adapter = sandbox()
    graph = create_native_graph(model(), sandbox=adapter, pinned_skills=[], tool_authority=FakeAuthority(), interrupt_on={})
    node = graph.nodes["tools"]
    names = set(getattr(getattr(node, "bound", node), "tools_by_name"))
    assert {"read_file", "write_file", "edit_file", "execute", "ls", "glob", "grep"} <= names
    assert "call_skill" not in names
    backend, filesystem = seen[0]
    assert isinstance(backend, CompositeBackend) and backend.default is adapter
    assert filesystem.backend is backend
    assert isinstance(backend.routes["/large_tool_results/"], StateBackend)


def test_pins_must_be_full_and_match_mounted_bytes():
    with pytest.raises(ValueError, match="complete package"):
        create_native_graph(model(), sandbox=sandbox(), pinned_skills=[{"stable_name": "old", "content": "legacy"}], tool_authority=FakeAuthority(), interrupt_on={})
    with pytest.raises(ValueError, match="does not match"):
        create_native_graph(model(), sandbox=sandbox(package(), corrupt=True), pinned_skills=package(), tool_authority=FakeAuthority(), interrupt_on={})
    create_native_graph(model(), sandbox=sandbox(package()), pinned_skills=package(), tool_authority=FakeAuthority(), interrupt_on={})


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("state", [{"skills_metadata": []}, {"skills_metadata": [{"name": "old"}]},
                                    {"native_skills_binding": "other"}, {"skills_metadata": [], "native_skills_binding": "other"}])
def test_cache_mismatch_rejected_before_official_loader(asynchronous, state):
    middleware = _BoundSkillsMiddleware(StateBackend(), "expected")
    with pytest.raises(ValueError, match="cache binding mismatch"):
        if asynchronous:
            asyncio.run(middleware.abefore_agent(state, None, {}))
        else:
            middleware.before_agent(state, None, {})


@pytest.mark.parametrize("asynchronous", [False, True])
def test_first_and_matching_empty_cache_use_official_hooks(monkeypatch, asynchronous):
    calls = []
    def load(self, state, runtime, config):
        calls.append(state)
        return {"skills_metadata": []} if "skills_metadata" not in state else None
    async def aload(self, state, runtime, config):
        return load(self, state, runtime, config)
    monkeypatch.setattr(SkillsMiddleware, "before_agent", load)
    monkeypatch.setattr(SkillsMiddleware, "abefore_agent", aload)
    middleware = _BoundSkillsMiddleware(StateBackend(), "expected")
    for state in ({}, {"skills_metadata": [], "native_skills_binding": "expected"}):
        result = asyncio.run(middleware.abefore_agent(state, None, {})) if asynchronous else middleware.before_agent(state, None, {})
        assert result["native_skills_binding"] == "expected"
    assert len(calls) == 2


def test_large_result_uses_official_state_route(monkeypatch):
    monkeypatch.setenv("KERNEL_DEEP_AGENT_TOOL_EVICT_TOKENS", "1000")
    @tool
    def large_result() -> str:
        """Emit a large research result."""
        return "X" * 8000
    graph = create_native_graph(model(AIMessage(content="", tool_calls=[{"id": "large", "name": "large_result", "args": {}}]),
                                      AIMessage(content="done")), sandbox=sandbox(), pinned_skills=[], tool_authority=FakeAuthority(), interrupt_on={}, tools=[large_result])
    result = graph.invoke({"messages": [{"role": "user", "content": "hello"}]})
    assert "/large" in result.get("files", {}), str({"files": list(result.get("files", {})), "messages": [str(m.content)[:180] for m in result["messages"]]})
    assert "".join(result["files"]["/large"]["content"]) == "X" * 8000
    assert any("/large_tool_results/large" in str(m.content) for m in result["messages"])


@pytest.mark.parametrize("change", ["session", "package"])
def test_checkpoint_cache_rejects_other_session_or_package(change):
    pins = package()
    session_id = str(uuid4())
    checkpointer = MemorySaver()
    config = {"configurable": {"thread_id": "native-cache"}}
    first = create_native_graph(model(), sandbox=sandbox(pins, session_id=session_id), pinned_skills=pins, tool_authority=FakeAuthority(), interrupt_on={}, checkpointer=checkpointer)
    first.invoke({"messages": [{"role": "user", "content": "hello"}]}, config)
    next_pins = copy.deepcopy(pins)
    if change == "package":
        next_pins[0]["package"]["versionId"] = "v2"
    other = create_native_graph(model(), sandbox=sandbox(next_pins, session_id=str(uuid4()) if change == "session" else session_id),
                                pinned_skills=next_pins, tool_authority=FakeAuthority(), interrupt_on={}, checkpointer=checkpointer)
    with pytest.raises(ValueError, match="cache binding mismatch"):
        other.invoke({"messages": [{"role": "user", "content": "hello again"}]}, config)

def test_real_pinned_skill_executes_in_isolated_session():
    with real_native_session() as (adapter, pins):
        graph = create_native_graph(model(
            AIMessage(content="", tool_calls=[{"id": "read-skill", "name": "read_file", "args": {"file_path": "/skills/example/SKILL.md"}}]),
            AIMessage(content="", tool_calls=[{"id": "execute-skill", "name": "execute", "args": {"command": "python3 /skills/example/scripts/report.py", "timeout": 10}}]),
            AIMessage(content="Created the report.")), sandbox=adapter, pinned_skills=pins, tool_authority=FakeAuthority(), interrupt_on={}, checkpointer=MemorySaver())
        config = {"configurable": {"thread_id": "native-integration"}}
        result = graph.invoke({"messages": [{"role": "user", "content": "Create the report using the example skill."}]}, config)
        assert any(skill["name"] == "example" for skill in graph.get_state(config).values["skills_metadata"])
        executed = [m for m in result["messages"] if getattr(m, "tool_call_id", None) == "execute-skill"]
        assert len(executed) == 1 and getattr(executed[0], "status", None) == "success"
        downloaded = adapter.download_files(["/workspace/report.txt"])
        assert downloaded[0].content == b"PINNED_SCRIPT_EXECUTED"
        assert not downloaded[0].error


def test_unknown_execution_outcome_is_not_retried():
    calls = []
    def handler(request):
        body = json.loads(request.content)
        if body["command"] == "side-effect":
            calls.append(body["executionId"])
            raise httpx.ReadError("response lost", request=request)
        return httpx.Response(200, json={"executionId": body["executionId"], "exitCode": 0, "output": "",
                                         "truncated": False, "timedOut": False, "cancelled": False})
    adapter = HttpSessionSandbox(str(uuid4()), "a" * 64, httpx.Client(transport=httpx.MockTransport(handler), base_url="http://sandbox"))
    graph = create_native_graph(model(AIMessage(content="", tool_calls=[{"id": "unknown", "name": "execute", "args": {"command": "side-effect"}}]),
                                      AIMessage(content="Execution outcome is unknown.")), sandbox=adapter, pinned_skills=[], tool_authority=FakeAuthority(), interrupt_on={})
    with pytest.raises(SandboxTransportError, match="outcome unknown"):
        graph.invoke({"messages": [{"role": "user", "content": "hello"}]})
    assert len(calls) == 1, "Retrying with new execution IDs can replay the side effect"


def test_interrupt_policy_must_be_explicit():
    with pytest.raises(TypeError, match="interrupt_on"):
        create_native_graph(model(), sandbox=sandbox(), pinned_skills=[])
    with pytest.raises(ValueError, match="explicit trusted interrupt policy"):
        create_native_graph(model(), sandbox=sandbox(), pinned_skills=[], tool_authority=FakeAuthority(), interrupt_on=None)
    create_native_graph(model(), sandbox=sandbox(), pinned_skills=[], tool_authority=FakeAuthority(), interrupt_on={})


def test_only_explicit_text_delegate_cannot_call_parent_tool(monkeypatch):
    children = []
    original = native_graph.create_agent
    def capture(*args, **kwargs):
        child = original(*args, **kwargs)
        children.append(child)
        return child
    monkeypatch.setattr(native_graph, "create_agent", capture)
    calls = []
    @tool
    def parent_secret() -> str:
        """A parent capability not granted to the text delegate."""
        calls.append("called")
        return "must not happen"
    graph = create_native_graph(model(
        AIMessage(content="", tool_calls=[{"id": "delegate", "name": "task", "args": {"description": "Draft text only", "subagent_type": "general-purpose"}}]),
        AIMessage(content="TEXT_ONLY_CHILD", tool_calls=[{"id": "denied", "name": "parent_secret", "args": {}}]),
        AIMessage(content="done")), sandbox=sandbox(), pinned_skills=[], tool_authority=FakeAuthority(), interrupt_on={}, tools=[parent_secret])
    assert len(children) == 1
    assert "tools" not in children[0].nodes
    assert not any("SkillsMiddleware" in name or "FilesystemMiddleware" in name for name in children[0].nodes)
    result = graph.invoke({"messages": [{"role": "user", "content": "hello"}]})
    assert calls == []
    assert any(getattr(m, "tool_call_id", None) == "delegate" and "TEXT_ONLY_CHILD" in str(m.content) for m in result["messages"])


def test_real_execute_waits_for_official_approval():
    from langgraph.types import Command
    with real_native_session() as (adapter, pins):
        graph = create_native_graph(model(
            AIMessage(content="", tool_calls=[{"id": "gated", "name": "execute", "args": {"command": "python3 /skills/example/scripts/report.py", "timeout": 10}}]),
            AIMessage(content="Approved report created.")), sandbox=adapter, pinned_skills=pins,
            tool_authority=FakeAuthority(), interrupt_on={"execute": True}, checkpointer=MemorySaver())
        config = {"configurable": {"thread_id": "native-hitl"}}
        paused = graph.invoke({"messages": [{"role": "user", "content": "Create a report."}]}, config)
        assert paused.get("__interrupt__")
        assert adapter.download_files(["/workspace/report.txt"])[0].error
        graph.invoke(Command(resume={"decisions": [{"type": "approve"}]}), config)
        assert adapter.download_files(["/workspace/report.txt"])[0].content == b"PINNED_SCRIPT_EXECUTED"
