import asyncio
from types import SimpleNamespace
import httpx
import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.prebuilt import ToolNode
from langgraph.graph import StateGraph, MessagesState, START, END
from deep_agent_service import standard_web_tools as web


def config():
    return {'configurable': {'run_control_callback': {'base_url': 'http://gateway', 'key': 'private-key', 'org_id': 'org', 'run_id': 'run', 'attempt_id': 'run:0', 'lease_epoch': 2}}}


def client(monkeypatch, status):
    requests = []
    original = httpx.AsyncClient
    def handle(request):
        requests.append(request)
        return httpx.Response(status, text='private-key upstream-sensitive-content')
    monkeypatch.setattr(web.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    return requests


def test_received_service_failure_is_real_error_tool_message(monkeypatch):
    requests = client(monkeypatch, 503)
    node = ToolNode(web.standard_web_tools(), handle_tool_errors=False)
    builder = StateGraph(MessagesState)
    builder.add_node('tools', node)
    builder.add_edge(START, 'tools')
    builder.add_edge('tools', END)
    result = asyncio.run(builder.compile().ainvoke({'messages': [AIMessage(content='', tool_calls=[{'name': 'fetch_url', 'args': {'url': 'https://example.com'}, 'id': 'call-web', 'type': 'tool_call'}])]}, config()))
    message = result['messages'][-1]
    assert isinstance(message, ToolMessage)
    assert message.status == 'error' and message.tool_call_id == 'call-web'
    assert 'unavailable' in message.content
    assert 'private-key' not in message.content and 'upstream-sensitive-content' not in message.content
    assert len(requests) == 1


@pytest.mark.parametrize('status', [400, 401, 403, 302, 500])
def test_non_service_failures_remain_fail_closed(monkeypatch, status):
    requests = client(monkeypatch, status)
    runtime = SimpleNamespace(config=config(), tool_call_id='call-web')
    with pytest.raises(web.StandardWebError):
        asyncio.run(web._invoke('fetch_url', {'url': 'https://example.com'}, runtime))
    assert len(requests) == 1


def test_unknown_transport_failure_is_not_projected_or_retried(monkeypatch):
    requests = []
    original = httpx.AsyncClient
    def handle(request):
        requests.append(request)
        raise httpx.ReadTimeout('private-key upstream-sensitive-content')
    monkeypatch.setattr(web.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    runtime = SimpleNamespace(config=config(), tool_call_id='call-web')
    with pytest.raises(web.StandardWebError) as error:
        asyncio.run(web._invoke('fetch_url', {'url': 'https://example.com'}, runtime))
    assert 'private-key' not in str(error.value)
    assert len(requests) == 1
