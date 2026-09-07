import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from deep_agent_service import standard_browser_tools as browser


PAGE = 'page:' + 'a' * 64
ELEMENT = 'element:' + 'b' * 64


def runtime():
    return SimpleNamespace(tool_call_id='actual-call', config={'configurable': {
        'native_runtime': {'bindingId': '00000000-0000-4000-8000-000000000001'},
        'run_control_callback': {'base_url': 'http://gateway', 'key': 'service-secret', 'org_id': 'org', 'run_id': 'run', 'attempt_id': 'run:0', 'lease_epoch': 1},
    }})


def test_exposes_only_catalog_browser_tools():
    tools = browser.standard_browser_tools()
    assert [tool.name for tool in tools] == ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_fill_form', 'browser_take_screenshot']
    assert 'browser_evaluate' not in {tool.name for tool in tools}
    assert set(tools[0].args) == {'url'}
    assert set(tools[2].args) == {'pageRef', 'elementRef'}


def test_model_cannot_forge_identity_or_upstream_refs(monkeypatch):
    monkeypatch.setattr(browser.httpx, 'AsyncClient', lambda **_: pytest.fail('must not dispatch'))
    with pytest.raises(browser.StandardBrowserError):
        asyncio.run(browser._invoke('browser_click', {'pageRef': PAGE, 'elementRef': 'e1', 'orgId': 'other'}, runtime()))


def test_forwards_trusted_identity_once_and_validates_output(monkeypatch):
    seen = []
    output = {'pageRef': PAGE, 'url': 'https://example.com/', 'title': 'Example', 'generation': 1}

    def handle(request):
        seen.append(request)
        return httpx.Response(200, stream=httpx.ByteStream(json.dumps(output).encode()))

    original = httpx.AsyncClient
    monkeypatch.setattr(browser.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    result = asyncio.run(browser._invoke('browser_navigate', {'url': 'https://example.com'}, runtime()))
    assert result == output
    assert len(seen) == 1
    body = json.loads(seen[0].content)
    assert body['orgId'] == 'org'
    assert body['bindingId'] == '00000000-0000-4000-8000-000000000001'
    assert body['toolCallId'] == 'actual-call'


@pytest.mark.parametrize(
    'status, body',
    [(503, b'{}'), (302, b'{}'), (200, b'x' * (2 * 1024 * 1024 + 1)), (200, b'{}')],
    ids=['upstream-error', 'redirect', 'oversize', 'invalid-json'],
)
def test_failure_is_sanitized_and_not_retried(monkeypatch, status, body):
    seen = []

    def handle(request):
        seen.append(request)
        return httpx.Response(status, stream=httpx.ByteStream(body))

    original = httpx.AsyncClient
    monkeypatch.setattr(browser.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    with pytest.raises(browser.StandardBrowserError) as error:
        asyncio.run(browser._invoke('browser_snapshot', {'pageRef': PAGE}, runtime()))
    assert 'service-secret' not in str(error.value)
    assert len(seen) == 1
