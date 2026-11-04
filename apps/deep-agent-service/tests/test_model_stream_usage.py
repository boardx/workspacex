"""Installed SDK wire contract: reported stream usage must be requested explicitly."""
import asyncio
import json
import httpx
import pytest
from deep_agent_service import model as models
from deep_agent_service import model_request_accounting as accounting


@pytest.mark.parametrize("mode", ["invoke", "ainvoke", "stream", "astream"])
def test_model_requests_reported_usage_and_preserves_real_receipt(monkeypatch, tmp_path, mode):
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "fixture")
    monkeypatch.setenv("KERNEL_MODEL_MAX_OUTPUT_TOKENS", "4096")
    monkeypatch.setenv("DEEP_AGENT_USAGE_SPOOL_DIR", str(tmp_path))
    monkeypatch.setattr(accounting, "_durability_fault", False)
    owner = {"base_url":"http://api.example.test", "key":"fixture", "org_id":"org-A", "run_id":"run-A", "attempt_id":"run-A:1", "lease_epoch":1}
    monkeypatch.setattr(accounting, "ownership", lambda: dict(owner))
    callbacks, requests = [], []
    def callback(_owner, _subject, phase, payload):
        callbacks.append((phase, payload))
    async def callback_async(*args):
        callback(*args)
    monkeypatch.setattr(accounting, "post", callback)
    monkeypatch.setattr(accounting, "apost", callback_async)
    usage = {"total_tokens":9, "prompt_tokens":6, "completion_tokens":3}
    def vendor(request):
        body = json.loads(request.content)
        requests.append(body)
        common = {"id":"fixture", "created":1, "model":"qwen3.8-max"}
        if not body.get("stream"):
            payload = {**common, "object":"chat.completion", "choices":[{"index":0,"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}], "usage":usage}
            return httpx.Response(200, headers={"content-type":"application/json"}, stream=httpx.ByteStream(json.dumps(payload).encode()))
        chunks = [
            {**common, "object":"chat.completion.chunk", "choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":None}]},
            {**common, "object":"chat.completion.chunk", "choices":[{"index":0,"delta":{},"finish_reason":"stop"}]},
        ]
        # Qwen's documented protocol returns streamed totals only when requested.
        if body.get("stream_options", {}).get("include_usage") is True:
            chunks.append({**common,"object":"chat.completion.chunk","choices":[],"usage":usage})
        data = "".join("data: " + json.dumps(chunk) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n"
        # Unbuffered: the real accounting stream must observe every byte.
        return httpx.Response(200, headers={"content-type":"text/event-stream"}, stream=httpx.ByteStream(data.encode()))
    sync = httpx.Client(transport=accounting.AccountingTransport(httpx.MockTransport(vendor)))
    asynchronous = httpx.AsyncClient(transport=accounting.AsyncAccountingTransport(httpx.MockTransport(vendor)))
    monkeypatch.setattr(models, "model_http_clients", lambda: {"http_client":sync, "http_async_client":asynchronous})
    model = models.build_chat_model("qwen3.8-max")
    async def invoke_async():
        if mode == "ainvoke":
            return (await model.ainvoke("hello")).content
        return "".join([chunk.content async for chunk in model.astream("hello")])
    try:
        if mode == "invoke":
            content = model.invoke("hello").content
        elif mode == "stream":
            content = "".join(chunk.content for chunk in model.stream("hello"))
        else:
            content = asyncio.run(invoke_async())
        assert content == "hello"
        assert len(requests) == 1
        if mode in ("stream", "astream"):
            assert requests[0].get("stream_options", {}).get("include_usage") is True
        else:
            assert "stream_options" not in requests[0]
        assert [phase for phase, _ in callbacks] == ["admit", "terminal"]
        assert callbacks[-1][1]["usage"] == {"total":9, "prompt":6, "completion":3}
        assert callbacks[0][1]["requestId"] == callbacks[-1][1]["requestId"]
    finally:
        sync.close()
        asyncio.run(asynchronous.aclose())
