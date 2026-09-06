import base64
import json
import httpx
import pytest
from deepagents.backends.sandbox import BaseSandbox
from deep_agent_service.sandbox_backend import HttpSessionSandbox, SandboxTransportError

SESSION = "12345678-1234-4234-8234-123456789012"
TOKEN = "a" * 64

def sandbox(handler):
    return HttpSessionSandbox(SESSION, TOKEN, httpx.Client(base_url="http://sandbox", transport=httpx.MockTransport(handler)))

def result(request, **extra):
    return httpx.Response(200, json={"executionId": json.loads(request.content)["executionId"], "exitCode": 0,
        "output": "ok", "truncated": False, "timedOut": False, "cancelled": False, **extra})

def test_execute_units_identity_and_ids():
    seen = []
    def handle(request):
        assert request.headers["Authorization"] == f"Bearer {TOKEN}"
        assert request.url.path == f"/sessions/{SESSION}/executions"
        seen.append(json.loads(request.content))
        return result(request)
    backend = sandbox(handle)
    assert backend.id == SESSION and TOKEN not in repr(backend)
    assert backend.execute("first", timeout=2).exit_code == 0
    backend.execute("second")
    assert [x["timeoutMs"] for x in seen] == [2000, 120000]
    assert seen[0]["executionId"] != seen[1]["executionId"]

def test_timeout_cancels_same_id_without_retry_or_secret():
    seen = []
    def handle(request):
        seen.append(request)
        if request.url.path.endswith("/cancel"):
            return httpx.Response(200, json={"cancelled": True})
        raise httpx.ReadTimeout(TOKEN, request=request)
    with pytest.raises(SandboxTransportError) as error:
        sandbox(handle).execute("slow", timeout=1)
    assert TOKEN not in str(error.value) and len(seen) == 2
    assert seen[1].url.path.endswith(f"/{json.loads(seen[0].content)['executionId']}/cancel")

@pytest.mark.parametrize("status", [302, 400, 404, 409, 410, 503])
def test_http_failure(status):
    backend = sandbox(lambda _: httpx.Response(status, json={"error": TOKEN}, headers={"location": "http://other"}))
    with pytest.raises(SandboxTransportError) as error:
        backend.execute("x")
    assert TOKEN not in str(error.value)

@pytest.mark.parametrize("flag", ["timedOut", "cancelled"])
def test_terminal_flags_not_success(flag):
    assert sandbox(lambda r: result(r, **{flag: True})).execute("x").exit_code is None

def test_partial_binary_transfer():
    data = b"\x00\xff\x80binary"
    def handle(request):
        body = json.loads(request.content) if request.method == "POST" else dict(request.url.params)
        path = body["path"]
        if path == "/missing": return httpx.Response(404)
        if path == "/bad": return httpx.Response(200, json={"path": path, "sizeBytes": 5, "contentBase64": "!"})
        if request.method == "POST": assert base64.b64decode(body["contentBase64"]) == data
        return httpx.Response(200, json={"path": path, "sizeBytes": len(data), "contentBase64": base64.b64encode(data).decode()})
    backend = sandbox(handle)
    uploads = backend.upload_files([("/missing", data), ("/workspace/中文", data)])
    assert uploads[0].error and uploads[1].error is None
    downloads = backend.download_files(["/missing", "/workspace/中文", "/bad"])
    assert downloads[0].error and downloads[1].content == data and downloads[2].error

def test_official_helpers_use_transport():
    calls = []
    def handle(request):
        body = json.loads(request.content)
        calls.append((request.url.path, body))
        if request.url.path.endswith("/files"):
            return httpx.Response(200, json={"path": body["path"], "sizeBytes": len(base64.b64decode(body["contentBase64"]))})
        return result(request, output="")
    backend = sandbox(handle)
    for name in ("read", "write", "edit", "grep", "glob", "ls", "delete"):
        assert getattr(HttpSessionSandbox, name) is getattr(BaseSandbox, name)
    assert backend.write("/workspace/file", "hello").error is None
    assert calls[0][0].endswith("/executions") and calls[1][0].endswith("/files")
    backend.read("/workspace/file")
    backend.grep("hello", "/workspace")
    backend.glob("*.txt", "/workspace")
    assert all(path.endswith("/executions") for path, _ in calls[2:])
    assert len(calls[2:]) == 3
    assert all(body["command"] for _, body in calls[2:])

@pytest.mark.parametrize("timeout", [0, -1, 301, True, 1.5])
def test_invalid_timeout(timeout):
    with pytest.raises(ValueError):
        sandbox(lambda _: pytest.fail("must not send")).execute("x", timeout=timeout)


def test_malformed_result_does_not_succeed():
    backend = sandbox(lambda r: result(r, executionId="wrong"))
    with pytest.raises(SandboxTransportError):
        backend.execute("x")


def test_transport_disconnect_is_sanitized():
    def handle(request):
        raise httpx.ConnectError(TOKEN, request=request)
    with pytest.raises(SandboxTransportError) as error:
        sandbox(handle).execute("x")
    assert TOKEN not in str(error.value)


def test_uds_client_configuration_is_not_model_input():
    import inspect
    assert set(inspect.signature(HttpSessionSandbox.execute).parameters) == {"self", "command", "timeout"}
    client = httpx.Client(base_url="http://sandbox", transport=httpx.HTTPTransport(uds="/tmp/wsx-sandbox.sock"))
    backend = HttpSessionSandbox(SESSION, TOKEN, client)
    assert backend.id == SESSION
    client.close()


def test_limits_come_from_generated_contract(monkeypatch):
    import deep_agent_service.sandbox_backend as module
    monkeypatch.setitem(module.LIMITS, "maxCommandBytes", 4)
    monkeypatch.setitem(module.LIMITS, "maxFileBytes", 2)
    monkeypatch.setitem(module.LIMITS, "defaultTimeoutMs", 1234)
    monkeypatch.setitem(module.LIMITS, "maxTimeoutMs", 1500)
    sent = []
    def handle(request):
        sent.append(json.loads(request.content))
        return result(request)
    backend = sandbox(handle)
    with pytest.raises(ValueError): backend.execute("中文")
    with pytest.raises(ValueError): backend.execute("ok", timeout=2)
    assert backend.upload_files([("/workspace/a", b"123")])[0].error
    assert sent == []
    backend.execute("ok")
    assert sent[0]["timeoutMs"] == 1234


@pytest.mark.parametrize("encoded,size", [("YR==", 1), ("YQ==", True), ("YQ==", 1.0), ("YQ==", -1), ("YQ===", 1)])
def test_download_rejects_noncanonical_base64_and_noninteger_size(encoded, size):
    backend = sandbox(lambda _: httpx.Response(200, json={"path": "/workspace/a", "contentBase64": encoded, "sizeBytes": size}))
    assert backend.download_files(["/workspace/a"])[0].error
