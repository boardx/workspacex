"""联网失败的成因与重试策略（2026-09-24，人类报「联网时十次五次失败」）。

修改前的两个缺陷叠在一起，正好解释那个失败率：

  · **一次瞬时抖动 = 永久失败**：只读的 `web_search`/`fetch_url` 和「重试会造成第二次
    副作用」的工具一起被放进不重试名单。那条纪律对写操作成立，对幂等 GET 不成立。
  · **成因说反了**：网关的 403（权限 / 出网被拒）、我们自己的超时、响应过大，
    全被压成同一句 `Web source unavailable or request refused`，且 `from None` 丢掉链。
    模型据此只会不停换源重试——而真正该做的是报告「这个部署不能联网」或「换个更小的源」。

这份测试钉两件事：每一类失败说的是**它自己**的成因；只有真可能靠重试恢复的才重试。
"""
import asyncio
from types import SimpleNamespace

import httpx
import pytest
from langchain_core.messages import ToolMessage

from deep_agent_service import standard_web_tools as web
from deep_agent_service.native_graph import _never_retry, _retry_policy


def config():
    return {'configurable': {'run_control_callback': {
        'base_url': 'http://gateway', 'key': 'private-key', 'org_id': 'org',
        'run_id': 'run', 'attempt_id': 'run:0', 'lease_epoch': 2}}}


def _invoke(monkeypatch, handler):
    """与 `test_standard_web_unavailable.py` 同一套调用姿势：直接打 `_invoke`。"""
    original = httpx.AsyncClient
    monkeypatch.setattr(web.httpx, 'AsyncClient',
                        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    runtime = SimpleNamespace(config=config(), tool_call_id='call-web')
    return asyncio.run(web._invoke('fetch_url', {'url': 'https://example.com'}, runtime))


def _raises(monkeypatch, handler):
    with pytest.raises(web.StandardWebError) as excinfo:
        _invoke(monkeypatch, handler)
    return excinfo.value


@pytest.mark.parametrize('status', [401, 403])
def test_authority_or_egress_denied_says_so_and_never_retries(monkeypatch, status):
    """403 是**我们这边**拒绝。说成「网站不可用」会让模型换一百个网址、每个都被拒。"""
    error = _raises(monkeypatch, lambda request: httpx.Response(status, text='denied'))
    assert 'not allowed' in str(error)
    assert 'another URL will not help' in str(error)
    assert error.retryable is False


def test_gateway_5xx_is_retryable(monkeypatch):
    error = _raises(monkeypatch, lambda request: httpx.Response(502, text='bad gateway'))
    assert error.retryable is True


def test_invalid_request_is_not_retryable(monkeypatch):
    error = _raises(monkeypatch, lambda request: httpx.Response(400, text='bad'))
    assert 'rejected this request as invalid' in str(error)
    assert error.retryable is False


def test_transport_failure_is_retryable_and_says_it_is_our_side(monkeypatch):
    def boom(request):
        raise httpx.ConnectError('no route')
    error = _raises(monkeypatch, boom)
    assert 'not the source refusing' in str(error)
    assert error.retryable is True


class _Chunks(httpx.AsyncByteStream):
    """真正可流式读的响应体。

    ⚠ 不能用 `httpx.Response(200, content=...)`：那种响应在构造时就被读完，
    `aiter_raw()` 第一次迭代直接抛 `StreamConsumed`，**根本走不到大小判断**——
    夹具产不出这个缺陷的形状，测出来的会是另一条路径（2026-09-24 实测绕了半小时）。
    """

    def __init__(self, chunk, times):
        self._chunk, self._times = chunk, times

    async def __aiter__(self):
        for _ in range(self._times):
            yield self._chunk


def test_oversize_response_names_size_not_availability(monkeypatch):
    """说成「网站不可用」，模型只会原地重试同一个巨大页面。"""
    cap = web._SCHEMA['limits']['maxResponseBytes']
    error = _raises(monkeypatch, lambda request: httpx.Response(
        200, stream=_Chunks(b'x' * 65536, cap // 65536 + 2)))
    assert 'too large' in str(error)
    assert error.retryable is False


def test_upstream_declared_unavailable_still_degrades_to_a_tool_message(monkeypatch):
    """503 那条既有的优雅降级不能被这次改动碰坏——它返回 ToolMessage，不抛。"""
    result = _invoke(monkeypatch, lambda request: httpx.Response(
        503, json={'error': 'standard_web_unavailable_or_refused', 'reason': 'unknown'}))
    assert isinstance(result, ToolMessage)
    assert result.status == 'error'


class _SideEffectLike(RuntimeError):
    pass


def test_retry_policy_only_retries_web_errors_that_say_they_are_retryable():
    decide = _retry_policy(lambda error: True)  # 官方判据一律说「可重试」，用来放大差异
    assert decide(web.StandardWebError('x', retryable=True)) is True
    assert decide(web.StandardWebError('x', retryable=False)) is False


def test_retry_policy_still_never_retries_side_effecting_tools():
    decide = _retry_policy(lambda error: True)
    for cls in _never_retry():
        assert decide(cls('x')) is False, f'{cls.__name__} 不应重试：重试可能造成第二次副作用'


def test_retry_policy_falls_back_to_the_official_predicate_for_everything_else():
    assert _retry_policy(lambda error: True)(_SideEffectLike('x')) is True
    assert _retry_policy(lambda error: False)(_SideEffectLike('x')) is False
