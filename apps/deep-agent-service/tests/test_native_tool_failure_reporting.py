"""不重试 ≠ 杀掉整条 run（2026-09-27 devapp 实测）。

## 量到的用户可见后果

"深入研究设计思维的历史……总结为一个 ppt"：模型已经在 thinking 里写下"全部 12 页
渲染正常，中文清晰无乱码……现在发布最终文件"，下一步 `wx_artifact_publish`
（界面标签「发布产物」）一次失败，整条 run 以 `tool_call_unresolved` 终止——
"有一次工具调用始终没有返回结果"。13 分钟的研究、生成、渲染验收全部作废，
模型连"发布失败"这件事都没看到，更谈不上用同一个幂等键再发一次。

## 根因（在锁定的 langchain 源码里核对过，不是猜的）

`_retry_policy` 把 `NativeArtifactPublishError` 等有副作用工具的错误判为"不重试"
——意图正确（丢失的执行响应不得变成第二次副作用）。但
`langchain.agents.middleware.tool_retry.ToolRetryMiddleware` 的语义是：
`retry_on` 不匹配的异常 **"propagate immediately and are not handled by
`on_failure`"**（`tool_retry.py` 的 docstring 与 `if not should_retry_exception(...):
raise`）。`on_failure="continue"`（把错误作为 ToolMessage 交还模型）只对"重试耗尽"
生效。于是"不重试"在这里实际等于"第一次失败就掀翻整张图"。

## 这份测试钉住的边界

- 工具**结果**类失败（发布、浏览器、画布、文档、MCP……）：不重试，但作为
  `status="error"` 的 ToolMessage 交还模型，run 继续走到收尾。
- 平台**不变量**类失败（`SandboxTransportError` / `ToolAuthorityError` /
  `SkillActivityError`）：照旧直接终止——本文件末尾用一条配对用例钉住，防止修法
  滑向"什么异常都吞"。`test_native_graph.py` 里 "outcome unknown" 那条既有用例
  也在守同一侧。

用的是**真实**的 `create_native_graph` + **真实**的 `wx_artifact_publish` 工具
（config 里没有 run_control_callback，真实代码路径抛真实的
`NativeArtifactPublishError`）+ `httpx.MockTransport` 沙箱——这条链不依赖集成容器，
不会被 skip。
"""
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import tool

import pytest

from native_sandbox_fixture import FakeAuthority
from test_native_graph import model, sandbox

from deep_agent_service.native_artifact_publish import artifact_publish_tool
from deep_agent_service.native_graph import create_native_graph
from deep_agent_service.native_tool_authority import ToolAuthorityError

PUBLISH_ARGS = {
    "workspacePath": "/workspace/design-thinking-history.pptx",
    "title": "design-thinking-history.pptx",
    "mediaType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "idempotencyKey": "publish-1",
}


def _publish_tool_name() -> str:
    return artifact_publish_tool().name


def test_publish_failure_reaches_the_model_instead_of_killing_the_run():
    name = _publish_tool_name()
    graph = create_native_graph(
        model(
            AIMessage(content="", tool_calls=[{"id": "pub-1", "name": name, "args": PUBLISH_ARGS}]),
            AIMessage(content="发布失败了，已如实告诉用户。"),
        ),
        sandbox=sandbox(), pinned_skills=[], tool_authority=FakeAuthority(), interrupt_on={},
        tools=[artifact_publish_tool()],
    )

    # 修复前这里直接抛 NativeArtifactPublishError——那就是 devapp 上的 tool_call_unresolved。
    result = graph.invoke({"messages": [{"role": "user", "content": "publish"}]})

    tool_messages = [m for m in result["messages"] if isinstance(m, ToolMessage) and m.tool_call_id == "pub-1"]
    assert len(tool_messages) == 1, "发布那次调用必须有且只有一条结果——没有结果就是 tool_call_unresolved"
    assert tool_messages[0].status == "error"
    assert "no ready artifact confirmed" in str(tool_messages[0].content), "模型要看到真实的失败原因，不是一句泛泛的报错"
    # run 走到了模型的收尾回复，而不是在工具那一步掀翻。
    assert isinstance(result["messages"][-1], AIMessage)
    assert result["messages"][-1].content == "发布失败了，已如实告诉用户。"


def test_publish_failure_is_still_not_retried():
    """"不重试"这一半必须原样保留：有副作用的工具，丢失的响应不得变成第二次调用。"""
    calls: list[dict] = []

    @tool("wx_publish_probe")
    def publish_probe(payload: str) -> str:
        """Side-effecting probe that always fails like a lost publish response."""
        from deep_agent_service.native_artifact_publish import NativeArtifactPublishError
        calls.append({"payload": payload})
        raise NativeArtifactPublishError("Artifact staging unavailable or refused; no ready artifact confirmed")

    graph = create_native_graph(
        model(
            AIMessage(content="", tool_calls=[{"id": "probe-1", "name": "wx_publish_probe", "args": {"payload": "x"}}]),
            AIMessage(content="done"),
        ),
        sandbox=sandbox(), pinned_skills=[], tool_authority=FakeAuthority(), interrupt_on={},
        tools=[publish_probe],
    )
    graph.invoke({"messages": [{"role": "user", "content": "publish"}]})
    assert len(calls) == 1, "有副作用的工具失败后被自动重试了——丢失的响应变成了第二次副作用"


class _DenyingAuthority(FakeAuthority):
    def check(self, tool_call):
        raise ToolAuthorityError("denied")

    async def acheck(self, tool_call):
        raise ToolAuthorityError("denied")


def test_platform_invariant_failures_still_stop_the_run():
    """配对用例：修法不许滑向"什么异常都吞"。授权失败是平台不变量，照旧终止。"""
    @tool("harmless")
    def harmless(payload: str) -> str:
        """Would be fine to run — but authority says no."""
        return "ran"

    graph = create_native_graph(
        model(
            AIMessage(content="", tool_calls=[{"id": "h-1", "name": "harmless", "args": {"payload": "x"}}]),
            AIMessage(content="should not get here"),
        ),
        sandbox=sandbox(), pinned_skills=[], tool_authority=_DenyingAuthority(), interrupt_on={},
        tools=[harmless],
    )
    with pytest.raises(ToolAuthorityError):
        graph.invoke({"messages": [{"role": "user", "content": "go"}]})


@pytest.mark.parametrize("code", ["credit_required", "credit_accounting_unavailable"])
@pytest.mark.parametrize("asynchronous", [False, True])
def test_credit_refusal_crosses_real_native_retry_stack_once(code, asynchronous):
    import asyncio
    from deep_agent_service.model_request_accounting import CreditRuntimeUsageError
    from deep_agent_service.self_hosted_runtime import credit_failure_projection

    calls = []
    refusal = CreditRuntimeUsageError({"code": code, "ownerType": "user", "ownerId": "requester"})

    @tool("wx_credit_probe")
    def credit_probe(payload: str) -> str:
        """Probe an authoritative billing refusal without provider dispatch."""
        calls.append(payload)
        raise refusal

    adapter = sandbox()
    try:
        graph = create_native_graph(
            model(
                AIMessage(content="", tool_calls=[{"id": "credit-1", "name": "wx_credit_probe", "args": {"payload": "x"}}]),
                AIMessage(content="must not resume after billing refusal"),
            ),
            sandbox=adapter, pinned_skills=[], tool_authority=FakeAuthority(), interrupt_on={},
            tools=[credit_probe],
        )
        with pytest.raises(CreditRuntimeUsageError) as failure:
            inputs = {"messages": [{"role": "user", "content": "transcribe"}]}
            if asynchronous:
                asyncio.run(graph.ainvoke(inputs))
            else:
                graph.invoke(inputs)
        assert failure.value is refusal
        assert calls == ["x"], "authoritative Credit refusals must never retry the physical tool call"
        assert credit_failure_projection(failure.value)["message"] == code
    finally:
        adapter._client.close()


@pytest.mark.parametrize("code", ["credit_required", "credit_accounting_unavailable", None])
def test_audio_callback_through_native_graph_preserves_credit_boundary(monkeypatch, code):
    import asyncio
    import json
    import httpx
    from deep_agent_service import standard_audio_tools as audio
    from deep_agent_service.model_request_accounting import CreditRuntimeUsageError
    from test_standard_audio_tools import runtime

    requests = []
    def respond(request):
        if request.url.path.endswith("/interjections/poll"):
            return httpx.Response(200, json={"interjections": []})
        requests.append(request)
        body = {"code": code, "ownerType": "user", "ownerId": "requester"} if code else {}
        return httpx.Response(402 if code == "credit_required" else 503,
                             stream=httpx.ByteStream(json.dumps(body).encode()))

    original = httpx.AsyncClient
    monkeypatch.setattr(audio.httpx, "AsyncClient", lambda **kwargs:
                        original(transport=httpx.MockTransport(respond), **kwargs))
    adapter = sandbox()
    audio_tool = audio.audio_transcribe_tool()
    graph = create_native_graph(
        model(AIMessage(content="", tool_calls=[{"id": "audio-credit", "name": audio_tool.name,
                                                "args": {"attachmentId": "original"}}]),
              AIMessage(content="unknown outcome reported")),
        sandbox=adapter, pinned_skills=[], tool_authority=FakeAuthority(), interrupt_on={}, tools=[audio_tool],
    )
    try:
        invoke = graph.ainvoke({"messages": [{"role": "user", "content": "transcribe"}]}, runtime().config)
        if code:
            with pytest.raises(CreditRuntimeUsageError) as failure:
                asyncio.run(invoke)
            assert failure.value.payload["code"] == code
        else:
            result = asyncio.run(invoke)
            failed = [m for m in result["messages"] if isinstance(m, ToolMessage) and m.tool_call_id == "audio-credit"]
            assert len(failed) == 1 and failed[0].status == "error"
            assert "Do not resubmit automatically" in str(failed[0].content)
            assert result["messages"][-1].content == "unknown outcome reported"
        assert len(requests) == 1
        assert requests[0].url.path.endswith("/audio-transcribe")
    finally:
        adapter._client.close()
