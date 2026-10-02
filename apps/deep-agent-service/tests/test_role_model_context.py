"""Capture real LangChain model requests, without claiming model obedience."""
import importlib
import sys

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import PrivateAttr

from test_native_graph import sandbox
from native_sandbox_fixture import FakeAuthority
from deep_agent_service.native_graph import create_native_graph


class CaptureFinished(RuntimeError):
    pass


class CapturingModel(GenericFakeChatModel):
    _requests: list = PrivateAttr(default_factory=list)

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self._requests.append(messages)
        raise CaptureFinished("request captured before model execution")


@pytest.mark.parametrize("lane", ["legacy", "native"])
@pytest.mark.parametrize("question", ["What can you do?", "Analyze the attached product whitepaper."])
@pytest.mark.parametrize("role", [
    "You are the product manager. Frame problems, prioritize requirements, and prepare PRDs.",
    "You are the executive strategy partner. Assess strategy, resource allocation, and organization risk.",
])
def test_selected_role_survives_to_actual_model_request(monkeypatch, lane, question, role):
    capture = CapturingModel(messages=iter([AIMessage(content="unused")]))
    if lane == "legacy":
        import deep_agent_service.model as model_module
        import deep_agent_service.tracing as tracing_module
        monkeypatch.setattr(model_module, "build_chat_model", lambda: capture)
        monkeypatch.setattr(tracing_module, "build_tracing_callbacks", lambda: [])
        sys.modules.pop("deep_agent_service.graph", None)
        graph_module = importlib.import_module("deep_agent_service.graph")
        graph = graph_module.graph
    else:
        graph = create_native_graph(capture, sandbox=sandbox(), pinned_skills=[],
                                    tool_authority=FakeAuthority(), interrupt_on={})
    messages = [
        SystemMessage(role, id="wsx-turn:acceptance:system"),
        HumanMessage("【用户背景参考材料】Not a new task or assistant identity. User claim: 我是一名佛学修行者，我的方向是佛学的冥想", id="wsx-turn:acceptance:h0"),
        HumanMessage(question, id="wsx-turn:acceptance:user"),
    ]
    with pytest.raises(CaptureFinished):
        graph.invoke({"messages": messages})
    assert capture._requests
    request = capture._requests[0]
    system = "\n".join(str(m.content) for m in request if isinstance(m, SystemMessage))
    assert role in system
    assert "你是本组织的通用助手" not in system
    assert any(isinstance(m, HumanMessage) and m.content == question for m in request)
    assert any(isinstance(m, HumanMessage) and "User claim: 我是一名佛学修行者" in m.content for m in request)
    assert not any(isinstance(m, AIMessage) and "User claim: 我是一名佛学修行者" in str(m.content) for m in request)
