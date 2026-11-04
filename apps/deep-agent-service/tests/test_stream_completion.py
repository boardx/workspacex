"""Physical response completion must be evidenced, not inferred from SDK close."""
import asyncio
import httpx
import pytest
from deep_agent_service import model_request_accounting as a

USAGE = b'data: {"usage":{"total_tokens":9,"prompt_tokens":6,"completion_tokens":3}}\n\n'
OWNER = {"base_url":"http://api.example.test", "key":"fixture", "org_id":"org-A", "run_id":"run-A", "attempt_id":"run-A:1", "lease_epoch":1}

@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("case,chunks,status,want", [
    ("complete", [USAGE, b"data: [DO", b"NE]\r\n", b"\r\n"], 200, "succeeded"),
    ("unknown-usage", [b"data: [DONE]\n\n"], 200, "succeeded"),
    ("missing-done", [USAGE], 200, "failed"),
    ("truncated-event", [USAGE, b"data: [DONE]\n"], 200, "failed"),
    ("error-event", [USAGE, b'data: {"error":{"message":"fixture"}}\n\n', b"data: [DONE]\n\n"], 200, "failed"),
    ("named-error", [USAGE, b"event: error\ndata: {}\n\n", b"data: [DONE]\n\n"], 200, "failed"),
    ("done-in-content", [USAGE, b'data: {"choices":[{"delta":{"content":"[DONE]"}}]}\n\n'], 200, "failed"),
    ("multiline-not-done", [USAGE, b"data: [DONE]\ndata: {}\n\n"], 200, "failed"),
    ("overflow", [USAGE, b"data: " + b"x" * 262144 + b"\n\n", b"data: [DONE]\n\n"], 200, "failed"),
    ("http-failure", [USAGE, b"data: [DONE]\n\n"], 503, "failed"),
    ("early-close", [USAGE, b"data: [DONE]\n\n"], 200, "failed"),
    ("read-error", [USAGE], 200, "failed"),
    ("cancel", [USAGE], 200, "failed"),
])
def test_completion_protocol_preserves_failures_and_one_terminal(monkeypatch, tmp_path, asynchronous, case, chunks, status, want):
    monkeypatch.setenv("DEEP_AGENT_USAGE_SPOOL_DIR", str(tmp_path))
    monkeypatch.setattr(a, "_durability_fault", False)
    monkeypatch.setattr(a, "ownership", lambda: dict(OWNER))
    callbacks = []
    def post(_owner, _run, phase, payload):
        callbacks.append((phase, payload))
    async def apost(*args):
        post(*args)
    monkeypatch.setattr(a, "post", post)
    monkeypatch.setattr(a, "apost", apost)
    req = httpx.Request("POST", "http://vendor.test/chat/completions", json={"model":"fixture", "max_tokens":10, "messages":[{"role":"user","content":"hello"}]})
    class SyncChunks(httpx.SyncByteStream):
        def __iter__(self):
            yield from chunks
            if case == "read-error":
                raise httpx.ReadError("fixture")
            if case == "cancel":
                raise asyncio.CancelledError()
    class AsyncChunks(httpx.AsyncByteStream):
        async def __aiter__(self):
            for chunk in chunks:
                yield chunk
            if case == "read-error":
                raise httpx.ReadError("fixture")
            if case == "cancel":
                raise asyncio.CancelledError()
    def vendor(_request):
        return httpx.Response(status, headers={"content-type":"text/event-stream"}, stream=SyncChunks())
    async def avendor(_request):
        return httpx.Response(status, headers={"content-type":"text/event-stream"}, stream=AsyncChunks())
    def consume():
        transport = a.AccountingTransport(httpx.MockTransport(vendor))
        result = transport.handle_request(req)
        iterator = iter(result.stream)
        if case == "early-close":
            next(iterator)
        elif case in ("read-error", "cancel"):
            with pytest.raises(httpx.ReadError if case == "read-error" else asyncio.CancelledError):
                list(iterator)
        else:
            list(iterator)
        result.close()
        result.close()
        if case == "early-close":
            iterator.close()
        transport.close()
    async def aconsume():
        transport = a.AsyncAccountingTransport(httpx.MockTransport(avendor))
        result = await transport.handle_async_request(req)
        iterator = result.stream.__aiter__()
        if case == "early-close":
            await anext(iterator)
        elif case in ("read-error", "cancel"):
            with pytest.raises(httpx.ReadError if case == "read-error" else asyncio.CancelledError):
                _ = [value async for value in iterator]
        else:
            _ = [value async for value in iterator]
        await result.aclose()
        await result.aclose()
        if case == "early-close":
            await iterator.aclose()
        await transport.aclose()
    if asynchronous:
        asyncio.run(aconsume())
    else:
        consume()
    assert [phase for phase, _ in callbacks] == ["admit", "terminal"]
    admitted, terminal = [body for _, body in callbacks]
    assert terminal["requestId"] == admitted["requestId"]
    assert terminal["outcome"] == want
    assert terminal["usage"] == ({} if case == "unknown-usage" else {"total":9,"prompt":6,"completion":3})
    assert a.Journal(str(tmp_path)).pending(OWNER) == []
