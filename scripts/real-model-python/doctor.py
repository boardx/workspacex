"""Offline construction only. Never invoke a provider or accounting callback."""
import asyncio
import json
import os
import stat
import httpx
from pathlib import Path
from urllib.parse import urlsplit
from deep_agent_service.model import build_chat_model
from deep_agent_service.model_request_accounting import enabled, admission_enabled, Journal

spool = Path(os.environ.get("DEEP_AGENT_USAGE_SPOOL_DIR", ""))
journal = Journal(str(spool))
model = build_chat_model()
payload = model._get_request_payload([{"role": "user", "content": "Offline construction only; no request is sent."}])
caps = [payload[name] for name in ("max_tokens", "max_completion_tokens") if name in payload]
sync = model.http_client
async_client = model.http_async_client
callback = urlsplit(os.environ.get("DEEP_AGENT_USAGE_CALLBACK_BASE_URL", ""))
proxy_expected = bool(os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY"))
origin_isolation = True
if proxy_expected:
    import sitecustomize as dev_proxy
    origin_isolation = dev_proxy._matches(httpx.URL(os.environ["KERNEL_MODEL_BASE_URL"])) and not dev_proxy._matches(httpx.URL("http://127.0.0.1:3200/healthz")) and not dev_proxy._matches(httpx.URL("https://unrelated.invalid/v1"))
report = {
    "accountingEnabled": enabled(), "admissionEnabled": admission_enabled(),
    "spoolAbsolute": spool.is_absolute(),
    "spoolPrivateOwned": spool.stat().st_uid == os.getuid() and stat.S_IMODE(spool.stat().st_mode) == 0o700,
    "spoolInitialization": True,
    "callbackLoopback": callback.hostname in ("127.0.0.1", "localhost") and bool(callback.port),
    "callbackKeyPresent": bool(os.environ.get("DEEP_AGENT_SERVICE_INTERNAL_KEY")),
    "outputBoundExplicit": os.environ.get("KERNEL_MODEL_MAX_OUTPUT_TOKENS") == "2048",
    "modelConstructed": True,
    "sdkOutputTokenBoundVerified": bool(caps) and all(type(value) is int and value == 2048 for value in caps),
    "serializedBodyWithinAdmissionLimit": len(json.dumps(payload).encode("utf-8")) < 2_000_000,
    "accountingOuterTransportRetained": type(sync._transport).__name__ == "AccountingTransport" and type(async_client._transport).__name__ == "AsyncAccountingTransport",
    "proxyExpected": proxy_expected,
    "exactOriginProxyConfigured": not proxy_expected or type(sync._transport.inner).__name__ == "ModelOriginTransport" and type(async_client._transport.inner).__name__ == "ModelOriginAsyncTransport",
    "proxyOriginIsolationVerified": origin_isolation,
    "requestsSent": 0,
    "runtimeOwnership": "bound-and-revalidated-by-API-per-real-run-not-fabricated-by-doctor",
}
sync.close()
asyncio.run(async_client.aclose())
print(json.dumps(report))
if not all(report[key] for key in ("accountingEnabled", "admissionEnabled", "spoolAbsolute", "spoolPrivateOwned", "spoolInitialization", "callbackLoopback", "callbackKeyPresent", "outputBoundExplicit", "modelConstructed", "sdkOutputTokenBoundVerified", "serializedBodyWithinAdmissionLimit", "accountingOuterTransportRetained", "exactOriginProxyConfigured", "proxyOriginIsolationVerified")):
    raise SystemExit(1)
