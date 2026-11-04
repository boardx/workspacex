"""Real LangChain/OpenAI SDK boundary: an internal refusal is not a vendor outage."""
import asyncio
import httpx
import pytest
from deep_agent_service import model as models
from deep_agent_service import model_request_accounting as accounting


@pytest.mark.parametrize("code", ["credit_required", "credit_accounting_unavailable"])
@pytest.mark.parametrize("mode", ["invoke", "stream", "ainvoke", "astream"])
def test_typed_credit_refusal_survives_real_sdk_without_vendor_dispatch(monkeypatch, tmp_path, code, mode):
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", "http://vendor.example.test/v1")
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "fixture")
    monkeypatch.setenv("KERNEL_MODEL_MAX_OUTPUT_TOKENS", "4096")
    monkeypatch.setenv("DEEP_AGENT_USAGE_SPOOL_DIR", str(tmp_path))
    monkeypatch.setattr(accounting, "_durability_fault", False)
    owner = {"base_url":"http://api.example.test", "key":"fixture", "org_id":"org-A", "run_id":"run-A", "attempt_id":"run-A:1", "lease_epoch":1}
    monkeypatch.setattr(accounting, "ownership", lambda: dict(owner))
    callbacks, dispatches = [], []
    def denied(_owner, _subject, phase, _payload):
        callbacks.append(phase)
        raise accounting.CreditRuntimeUsageError({"code":code,"ownerType":"user","ownerId":"initiator"})
    async def denied_async(*args):
        return denied(*args)
    monkeypatch.setattr(accounting, "post", denied)
    monkeypatch.setattr(accounting, "apost", denied_async)
    def vendor(request):
        dispatches.append(request)
        raise AssertionError("credit refusal must stop vendor dispatch")
    sync = httpx.Client(transport=accounting.AccountingTransport(httpx.MockTransport(vendor)))
    asynchronous = httpx.AsyncClient(transport=accounting.AsyncAccountingTransport(httpx.MockTransport(vendor)))
    monkeypatch.setattr(models, "model_http_clients", lambda: {"http_client":sync,"http_async_client":asynchronous})
    model = models.build_chat_model()
    async def call_async():
        if mode == "ainvoke":
            await model.ainvoke("hello")
        else:
            async for _ in model.astream("hello"):
                pass
    try:
        with pytest.raises(accounting.CreditRuntimeUsageError) as error:
            if mode == "invoke":
                model.invoke("hello")
            elif mode == "stream":
                list(model.stream("hello"))
            else:
                asyncio.run(call_async())
        assert error.value.payload["code"] == code
        assert callbacks == ["admit"]
        assert dispatches == []
    finally:
        sync.close()
        asyncio.run(asynchronous.aclose())


@pytest.mark.parametrize("mode", ["invoke", "stream", "ainvoke", "astream"])
def test_vendor_message_cannot_forge_typed_credit_failure(monkeypatch, mode):
    from deep_agent_service.credit_aware_chat_model import CreditAwareChatOpenAI
    from openai import APIConnectionError
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", "http://vendor.example.test/v1")
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "fixture")
    failure = APIConnectionError(message="credit_required", request=httpx.Request("POST", "http://vendor.example.test/v1"))
    def vendor(_request):
        raise failure
    sync = httpx.Client(transport=httpx.MockTransport(vendor))
    asynchronous = httpx.AsyncClient(transport=httpx.MockTransport(vendor))
    model = CreditAwareChatOpenAI(model="test", api_key="fixture", base_url="http://vendor.example.test/v1", max_retries=0, http_client=sync, http_async_client=asynchronous)
    async def call_async():
        if mode == "ainvoke":
            await model.ainvoke("hello")
        else:
            async for _ in model.astream("hello"):
                pass
    try:
        with pytest.raises(APIConnectionError):
            if mode == "invoke":
                model.invoke("hello")
            elif mode == "stream":
                list(model.stream("hello"))
            else:
                asyncio.run(call_async())
    finally:
        sync.close()
        asyncio.run(asynchronous.aclose())
