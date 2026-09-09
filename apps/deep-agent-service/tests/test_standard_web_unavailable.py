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


# ⚠ 必须在任何 monkeypatch 之前抓住真的 `httpx.AsyncClient`：同一个测试里连续打两次桩时
#   `httpx.AsyncClient` 已经是上一次的 lambda，再拿它当 `original` 会把 transport 传两遍
#   ——第一版就是这么红的，且红在"工具整体失败"上，看起来像被测代码坏了。
_REAL_ASYNC_CLIENT = httpx.AsyncClient


def json_client(monkeypatch, body):
    """网关的 503 现在带成因（issue #3204 ②）。"""
    requests = []
    def handle(request):
        requests.append(request)
        return httpx.Response(503, json=body)
    monkeypatch.setattr(web.httpx, 'AsyncClient', lambda **kwargs: _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handle), **kwargs))
    return requests


def text_client(monkeypatch):
    """旧网关形状：503 但正文不是可识别的 JSON。"""
    requests = []
    def handle(request):
        requests.append(request)
        return httpx.Response(503, text='private-key upstream-sensitive-content')
    monkeypatch.setattr(web.httpx, 'AsyncClient', lambda **kwargs: _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handle), **kwargs))
    return requests


async def _content(monkeypatch, body):
    json_client(monkeypatch, body)
    runtime = SimpleNamespace(config=config(), tool_call_id='call-web')
    message = await web._invoke('fetch_url', {'url': 'https://openai.com/index/navier-stokes-solution/'}, runtime)
    return message.content


def failure(reason, **extra):
    return {'error': 'standard_web_unavailable_or_refused', 'reason': reason, **extra}


def test_upstream_refusal_names_the_status_and_says_retrying_will_not_help(monkeypatch):
    """人类实测的那一条：openai.com 返回 HTTP/2 403 + cf-mitigated: challenge。

    修复前任意 503 都是同一句 'Web source unavailable or refused'，模型没法判断该不该换源。
    """
    content = asyncio.run(_content(monkeypatch, failure('upstream_refused', upstreamStatus=403)))
    assert '403' in content
    assert 'refused this request' in content
    assert 'Retrying will not help' in content


def test_the_four_causes_are_actually_distinguishable(monkeypatch):
    """这条才是"可分辨"本身——修复前这四句逐字相同。"""
    texts = [
        asyncio.run(_content(monkeypatch, failure('upstream_refused', upstreamStatus=403))),
        asyncio.run(_content(monkeypatch, failure('upstream_unreachable'))),
        asyncio.run(_content(monkeypatch, failure('timeout'))),
        asyncio.run(_content(monkeypatch, failure('blocked_by_policy'))),
    ]
    assert len(set(texts)) == 4
    # 被出站策略挡下 ≠ 网站拒绝了你：不许把我们自己的门说成上游行为。
    assert 'outbound access policy' in texts[3] and 'refused this request' not in texts[3]


def test_unrecognized_reason_falls_back_to_the_vague_sentence(monkeypatch):
    """认不出来就说得含糊——好过编一个具体的原因（反面用例）。"""
    content = asyncio.run(_content(monkeypatch, failure('not-a-real-reason')))
    assert 'Web source unavailable or refused' in content


def test_non_json_failure_body_keeps_the_old_sentence_and_leaks_nothing(monkeypatch):
    """旧网关形状（503 + 非 JSON 正文）不许把上游正文当成因读出来。"""
    requests = text_client(monkeypatch)
    runtime = SimpleNamespace(config=config(), tool_call_id='call-web')
    content = asyncio.run(web._invoke('fetch_url', {'url': 'https://example.com'}, runtime)).content
    assert 'Web source unavailable or refused' in content
    assert 'private-key' not in content and 'upstream-sensitive-content' not in content
    assert len(requests) == 1


def test_reason_never_carries_upstream_body_or_headers(monkeypatch):
    """可分辨不等于把上游内容透出去——网关塞进来的多余字段一律不进 ToolMessage。"""
    content = asyncio.run(_content(monkeypatch, failure('upstream_refused', upstreamStatus=403,
                                                        detail='private-key upstream-sensitive-content')))
    assert 'private-key' not in content and 'upstream-sensitive-content' not in content
