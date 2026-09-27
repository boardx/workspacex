"""issue #4344: `wx_remember` is the agent's only memory tool; the old `wx_memory_*` are retired.

* The tool is constructed, admitted by the server table and not interrupt-gated
  (opening a confirmation card IS the human confirmation; an approval dialog would
  ask twice).
* Identity comes from the trusted run callback only: the model schema carries just
  `statement`, and extra ids are refused before anything leaves the process.
* Every gateway outcome is a specific code (never one generic sentence), and a
  card result is relayed verbatim so the model can tell the user to confirm.
* `wx_memory_search / write / delete` are neither constructed nor admitted, and the
  system no longer depends on MEMORY_STORE_DATABASE_URL to offer memory.
"""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from deep_agent_service.native_factory import native_candidate_tools
from deep_agent_service.native_graph import _never_retry, _tool_outcome_errors
from deep_agent_service.standard_remember import StandardRememberError, remember_tool
from deep_agent_service.tools import build_tools
from test_native_graph import model

KEY = "internal-key-never-leaks"
SCHEMA = json.loads((Path(__file__).resolve().parents[1] / "src/deep_agent_service/generated/standard_remember_schema.json").read_text())
ADMISSION = json.loads((Path(__file__).resolve().parents[1] / "src/deep_agent_service/generated/native_profile_tools.json").read_text())


def runtime():
    return SimpleNamespace(tool_call_id="call-1", config={"configurable": {
        "run_control_callback": {"base_url": "http://gateway", "key": KEY, "org_id": "org", "run_id": "run/1",
                                 "attempt_id": "run/1:0", "lease_epoch": 3}}})


def ok(body, status=200):
    return httpx.Response(status, stream=httpx.ByteStream(json.dumps(body).encode()))


def call(monkeypatch, handler, **args):
    seen = []

    def record(request):
        seen.append(request)
        return handler(request)

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(record), **kw))
    return seen, asyncio.run(remember_tool().coroutine(runtime=runtime(), **args))


def test_tool_is_constructed_admitted_and_not_approval_gated():
    chat = model()
    names = {tool.name for tool in native_candidate_tools(chat, build_tools(chat, interactions_only=True))}
    assert "wx_remember" in names
    assert "wx_remember" in ADMISSION["tools"]
    assert ADMISSION["interruptOn"]["wx_remember"] is False


def test_old_memory_tools_are_retired_from_the_agent():
    chat = model()
    names = {tool.name for tool in native_candidate_tools(chat, build_tools(chat, interactions_only=True))}
    assert not {n for n in names if n.startswith("wx_memory_")}
    assert not {n for n in ADMISSION["tools"] if n.startswith("wx_memory_")}
    assert not {n for n in ADMISSION["interruptOn"] if n.startswith("wx_memory_")}


def test_offering_memory_needs_no_separate_memory_store(monkeypatch):
    """The retired tools failed on devapp when MEMORY_STORE_DATABASE_URL was unset; the new one never reads it."""
    monkeypatch.delenv("MEMORY_STORE_DATABASE_URL", raising=False)
    body = {"outcome": "card_opened", "cardId": "card_1", "statement": "用户的目标是今年跑完半马", "saved": False, "instruction": "请用户确认"}
    _, result = call(monkeypatch, lambda request: ok(body), statement="用户的目标是今年跑完半马")
    assert result == body


def test_model_schema_carries_only_the_statement():
    tool = remember_tool()
    assert tool.name == "wx_remember"
    assert set(tool.args_schema["properties"]) == {"statement"}
    assert tool.args_schema["additionalProperties"] is False


def test_request_identity_comes_from_the_run_callback(monkeypatch):
    body = {"outcome": "card_opened", "cardId": "card_1", "statement": "喜欢中文回答", "saved": False, "instruction": "请用户确认"}
    seen, result = call(monkeypatch, lambda request: ok(body), statement="喜欢中文回答")
    assert result == body
    assert len(seen) == 1
    assert seen[0].url.raw_path == b"/internal/agent-runs/run%2F1/remember/invoke"
    assert seen[0].headers["x-deep-agent-internal-key"] == KEY
    sent = json.loads(seen[0].content)
    assert sent == {"orgId": "org", "attemptId": "run/1:0", "leaseEpoch": 3, "toolCallId": "call-1",
                    "toolName": "wx_remember", "toolArgs": {"statement": "喜欢中文回答"}}


@pytest.mark.parametrize("forged", [{"sourceMessageId": "m-other"}, {"threadId": "t-other"}, {"userId": "u-other"}])
def test_model_supplied_ids_are_refused_before_dispatch(monkeypatch, forged):
    seen = []
    with pytest.raises(StandardRememberError) as caught:
        seen, _ = call(monkeypatch, lambda request: ok({}), statement="喜欢中文回答", **forged)
    assert caught.value.code == "remember_invalid_request"
    assert seen == []


@pytest.mark.parametrize(("status", "code"), [(400, "remember_invalid_request"), (401, "remember_not_authorized"),
                                              (403, "remember_not_authorized"), (503, "remember_unavailable"), (500, "remember_unavailable")])
def test_gateway_failures_are_specific_codes(monkeypatch, status, code):
    with pytest.raises(StandardRememberError) as caught:
        call(monkeypatch, lambda request: ok({"message": "x"}, status), statement="喜欢中文回答")
    assert caught.value.code == code
    assert code in str(caught.value) and "nothing was saved" in str(caught.value)
    assert KEY not in str(caught.value)
    assert set(SCHEMA["failureCodes"]) == {"remember_invalid_request", "remember_not_authorized", "remember_unavailable"}


def test_a_response_claiming_saved_is_rejected(monkeypatch):
    lie = {"outcome": "card_opened", "cardId": "card_1", "statement": "s", "saved": True, "instruction": "i"}
    with pytest.raises(StandardRememberError) as caught:
        call(monkeypatch, lambda request: ok(lie), statement="喜欢中文回答")
    assert caught.value.code == "remember_unavailable"


def test_refusal_reasons_are_relayed_to_the_model(monkeypatch):
    body = {"outcome": "refused", "code": "not_personal_thread", "saved": False, "instruction": "长期记忆只能在个人对话里记"}
    _, result = call(monkeypatch, lambda request: ok(body), statement="喜欢中文回答")
    assert result == body


def test_failures_are_reported_to_the_model_not_retried_and_not_run_fatal():
    assert StandardRememberError in _never_retry()
    assert StandardRememberError in _tool_outcome_errors()
