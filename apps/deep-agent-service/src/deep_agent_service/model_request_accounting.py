"""Opt-in per-HTTP-attempt receipts. Never persist prompts, responses, keys or URLs.

The API acknowledges a leased, owned start before dispatch. Terminal metadata is committed
with SQLite FULL synchronization before callback delivery. Replay repairs accounting only;
it never invokes a model. Deployment must supply a persistent spool directory explicitly.
"""
from __future__ import annotations
import asyncio
from contextlib import contextmanager
import json
import logging
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from urllib.parse import quote, urlsplit
import httpx


_durability_fault = False
_logger = logging.getLogger(__name__)


def mark_durability_fault():
    global _durability_fault
    _durability_fault = True
    _logger.error("usage_receipt_durability_fault")


class RuntimeUsageError(RuntimeError):
    pass


def enabled() -> bool:
    return os.environ.get("DEEP_AGENT_REQUEST_ACCOUNTING_ENABLED") == "1"


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ownership() -> dict:
    try:
        from langgraph.config import get_config
        raw = (get_config().get("configurable") or {}).get("model_request_accounting")
    except Exception:
        raw = None
    if not isinstance(raw, dict):
        raise RuntimeUsageError("usage_ownership_unconfigured")
    value = {k: raw.get(k) for k in ("base_url", "org_id", "run_id", "attempt_id", "lease_epoch", "call_purpose")}
    value["key"] = os.environ.get("DEEP_AGENT_SERVICE_INTERNAL_KEY", "").strip()
    try:
        parsed = urlsplit(value["base_url"])
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError()
        if not all(isinstance(value[k], str) and value[k] for k in ("key", "org_id", "run_id", "attempt_id")):
            raise ValueError()
        if type(value["lease_epoch"]) is not int or value["lease_epoch"] < 1:
            raise ValueError()
    except Exception:
        raise RuntimeUsageError("usage_ownership_invalid") from None
    value["base_url"] = value["base_url"].rstrip("/")
    return value


class Journal:
    def __init__(self, directory: str):
        root = Path(directory)
        if not directory or not root.is_absolute():
            raise RuntimeUsageError("usage_persistent_spool_unconfigured")
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = root / "model-usage.sqlite3"
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY, receiver TEXT NOT NULL, run_id TEXT NOT NULL, payload TEXT NOT NULL, last_attempt_order INTEGER NOT NULL DEFAULT 0)")
            if "last_attempt_order" not in {row[1] for row in db.execute("PRAGMA table_info(pending)")}:
                db.execute("ALTER TABLE pending ADD COLUMN last_attempt_order INTEGER NOT NULL DEFAULT 0")
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        try:
            db.execute("PRAGMA synchronous=FULL")
            with db:
                yield db
        finally:
            db.close()

    def save(self, owner: dict, body: dict):
        # Only non-secret ownership and usage metadata; receiver is a fingerprint.
        payload = json.dumps(body, separators=(",", ":"))
        with self.connect() as db:
            receiver = sha256(owner["base_url"].encode()).hexdigest()
            old = db.execute("SELECT receiver,run_id,payload FROM pending WHERE id=?", (body["requestId"],)).fetchone()
            if old and old != (receiver, owner["run_id"], payload):
                raise RuntimeUsageError("usage_receipt_replay_mismatch")
            db.execute("INSERT OR IGNORE INTO pending(id,receiver,run_id,payload) VALUES(?,?,?,?)", (body["requestId"], receiver, owner["run_id"], payload))

    def pending(self, owner: dict):
        with self.connect() as db:
            return db.execute("SELECT id,run_id,payload FROM pending WHERE receiver=? ORDER BY last_attempt_order,rowid LIMIT 20", (sha256(owner["base_url"].encode()).hexdigest(),)).fetchall()

    def defer(self, request_id: str):
        # Durable rotation prevents a permanently denied receipt starving later ones.
        # SQLite serializes this metadata-only queue update across worker processes.
        with self.connect() as db:
            db.execute("UPDATE pending SET last_attempt_order=(SELECT COALESCE(MAX(last_attempt_order),0)+1 FROM pending) WHERE id=?", (request_id,))

    def acknowledge(self, request_id: str):
        with self.connect() as db:
            db.execute("DELETE FROM pending WHERE id=?", (request_id,))


def post(owner: dict, run_id: str, phase: str, body: dict):
    url = f'{owner["base_url"]}/internal/agent-runs/{quote(run_id, safe="")}/model-requests/{phase}'
    # Separate callback client: must never recurse through provider transport.
    for _ in range(3):
        try:
            with httpx.Client(timeout=5, follow_redirects=False) as client:
                response = client.post(url, headers={"x-deep-agent-internal-key": owner["key"]}, json=body)
                if response.status_code == 200 and response.json().get("accepted") is True:
                    return
                if response.status_code < 500:
                    break
        except Exception:
            pass
    raise RuntimeUsageError("usage_receipt_delivery_unconfirmed")


async def apost(owner: dict, run_id: str, phase: str, body: dict):
    url = f'{owner["base_url"]}/internal/agent-runs/{quote(run_id, safe="")}/model-requests/{phase}'
    for _ in range(3):
        try:
            async with httpx.AsyncClient(timeout=5, follow_redirects=False) as client:
                response = await client.post(url, headers={"x-deep-agent-internal-key": owner["key"]}, json=body)
                if response.status_code == 200 and response.json().get("accepted") is True:
                    return
                if response.status_code < 500:
                    break
        except Exception:
            pass
    raise RuntimeUsageError("usage_receipt_delivery_unconfirmed")


class UsageParser:
    def __init__(self, content_type: str):
        self.sse = "text/event-stream" in content_type
        self.buffer = b""
        self.overflow = False
        self.usage = {}

    def read(self, value):
        if not isinstance(value, dict) or not isinstance(value.get("usage"), dict):
            return
        raw = value["usage"]
        input_details = raw.get("prompt_tokens_details")
        output_details = raw.get("completion_tokens_details")
        input_details = input_details if isinstance(input_details, dict) else {}
        output_details = output_details if isinstance(output_details, dict) else {}
        details = (("total", raw.get("total_tokens")), ("prompt", raw.get("prompt_tokens")),
                   ("completion", raw.get("completion_tokens")), ("cacheInput", input_details.get("cached_tokens")),
                   ("reasoningOutput", output_details.get("reasoning_tokens")))
        for name, count in details:
            if type(count) is int and 0 <= count <= 9_007_199_254_740_991:
                self.usage[name] = count
        for detail, parent in (("cacheInput", "prompt"), ("reasoningOutput", "completion")):
            if detail in self.usage and parent in self.usage and self.usage[detail] > self.usage[parent]:
                del self.usage[detail]

    def feed(self, chunk: bytes):
        if not self.sse:
            if not self.overflow and len(self.buffer) + len(chunk) <= 1_048_576:
                self.buffer += chunk
            else:
                self.buffer = b""; self.overflow = True
            return
        for piece in chunk.splitlines(keepends=True):
            if not self.overflow and len(self.buffer) + len(piece) <= 262_144:
                self.buffer += piece
            else:
                self.buffer = b""; self.overflow = True
            if piece.endswith(b"\n"):
                if not self.overflow and self.buffer.startswith(b"data:"):
                    try:
                        self.read(json.loads(self.buffer[5:].strip()))
                    except (ValueError, TypeError, AttributeError):
                        pass
                self.buffer = b""; self.overflow = False

    def finish(self):
        if not self.sse and not self.overflow:
            try:
                self.read(json.loads(self.buffer))
            except (ValueError, TypeError, AttributeError):
                pass
        self.buffer = b""


def prepare(request):
    owner = ownership()
    journal = Journal(os.environ.get("DEEP_AGENT_USAGE_SPOOL_DIR", ""))
    try:
        model = json.loads(request.content).get("model")
        if not isinstance(model, str) or not model or len(model) > 200:
            raise ValueError()
    except Exception:
        raise RuntimeUsageError("usage_model_identity_invalid") from None
    body = {"orgId": owner["org_id"], "attemptId": owner["attempt_id"], "leaseEpoch": owner["lease_epoch"], "requestId": str(uuid.uuid4()), "startedAt": now(), "modelId": model, "callPurpose": owner.get("call_purpose") or "primary"}
    return owner, journal, body


def admission_enabled():
    return os.environ.get("DEEP_AGENT_MODEL_ADMISSION_ENABLED") == "1"


def admission_payload(request, owner, start):
    try:
        body = json.loads(request.content)
        caps = [body[name] for name in ("max_tokens", "max_completion_tokens") if name in body]
        if not caps or any(type(value) is not int or value <= 0 or value != caps[0] for value in caps):
            raise ValueError()
        serialized = request.content.decode("utf-8")
    except Exception:
        raise RuntimeUsageError("admission_output_cap_unverified") from None
    # Stable across API/SDK worker retries and lease changes; identical intent is conservative replay.
    # Hash only; no prompt or response is placed in durable identity metadata.
    digest = sha256(request.content).hexdigest()
    logical = json.dumps([owner["run_id"],start["callPurpose"],digest],separators=(",",":"))
    return start | {"logicalCallId":logical,"serializedBody":serialized,"outputTokenLimit":caps[0]}

def terminal(start: dict, parser: UsageParser, success: bool):
    parser.finish()
    return {k: start[k] for k in ("orgId", "attemptId", "leaseEpoch", "requestId")} | {"endedAt": now(), "outcome": "succeeded" if success else "failed", "usage": parser.usage}


class AccountedSyncStream(httpx.SyncByteStream):
    def __init__(self, stream, owner, journal, start, content_type, success):
        self.stream,self.owner,self.journal,self.start = stream,owner,journal,start
        self.parser = UsageParser(content_type); self.success = success; self.done = False

    def finish(self, success):
        if self.done:
            return
        body = terminal(self.start,self.parser,success)
        self.done = True
        persisted = False
        try:
            self.journal.save(self.owner,body)
            persisted = True
        except Exception:
            mark_durability_fault()  # stop future dispatch, preserve this provider result
        try:
            post(self.owner,self.owner["run_id"],"terminal",body)
            if persisted:
                self.journal.acknowledge(body["requestId"])
        except RuntimeUsageError:
            pass  # persisted when possible; original start remains visible otherwise
        except Exception:
            mark_durability_fault()

    def __iter__(self):
        try:
            for chunk in self.stream:
                self.parser.feed(chunk); yield chunk
            self.finish(self.success)
        finally:
            self.finish(False)

    def close(self):
        try:
            self.stream.close()
        finally:
            self.finish(False)


class AccountedAsyncStream(httpx.AsyncByteStream):
    def __init__(self, stream, owner, journal, start, content_type, success):
        self.stream,self.owner,self.journal,self.start = stream,owner,journal,start
        self.parser = UsageParser(content_type); self.success = success; self.done = False

    async def finish(self, success):
        if self.done:
            return
        body = terminal(self.start,self.parser,success)
        self.done = True
        persisted = False
        try:
            self.journal.save(self.owner,body)
            persisted = True
        except Exception:
            mark_durability_fault()
        try:
            await apost(self.owner,self.owner["run_id"],"terminal",body)
            if persisted:
                self.journal.acknowledge(body["requestId"])
        except RuntimeUsageError:
            pass
        except Exception:
            mark_durability_fault()

    async def __aiter__(self):
        try:
            async for chunk in self.stream:
                self.parser.feed(chunk); yield chunk
            await self.finish(self.success)
        finally:
            await self.finish(False)

    async def aclose(self):
        try:
            await self.stream.aclose()
        finally:
            await self.finish(False)


def receipt_requested():
    try:
        from langgraph.config import get_config
        return "model_request_accounting" in (get_config().get("configurable") or {})
    except Exception:
        return False


class AccountingTransport(httpx.BaseTransport):
    def __init__(self, inner=None):
        self.inner = inner or httpx.HTTPTransport()

    def handle_request(self, request):
        if admission_enabled() and not enabled():
            raise RuntimeUsageError("admission_requires_accounting")
        if not enabled():
            if receipt_requested():
                raise RuntimeUsageError("usage_runtime_capability_disabled")
            return self.inner.handle_request(request)
        if _durability_fault:
            raise RuntimeUsageError("usage_receipt_durability_fault")
        owner,journal,start = prepare(request)
        for request_id,run_id,payload in journal.pending(owner):
            try:
                post(owner,run_id,"terminal",json.loads(payload)); journal.acknowledge(request_id)
            except RuntimeUsageError:
                break
        if admission_enabled():
            post(owner,owner["run_id"],"admit",admission_payload(request,owner,start))
        else:
            post(owner,owner["run_id"],"start",start)
        try:
            response = self.inner.handle_request(request)
        except BaseException:
            stream = AccountedSyncStream(httpx.ByteStream(b""),owner,journal,start,"application/json",False)
            stream.finish(False); raise
        response.stream = AccountedSyncStream(response.stream,owner,journal,start,response.headers.get("content-type", ""),response.is_success)
        return response

    def close(self):
        self.inner.close()


class AsyncAccountingTransport(httpx.AsyncBaseTransport):
    def __init__(self, inner=None):
        self.inner = inner or httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request):
        if admission_enabled() and not enabled():
            raise RuntimeUsageError("admission_requires_accounting")
        if not enabled():
            if receipt_requested():
                raise RuntimeUsageError("usage_runtime_capability_disabled")
            return await self.inner.handle_async_request(request)
        if _durability_fault:
            raise RuntimeUsageError("usage_receipt_durability_fault")
        owner,journal,start = prepare(request)
        for request_id,run_id,payload in journal.pending(owner):
            try:
                await apost(owner,run_id,"terminal",json.loads(payload)); journal.acknowledge(request_id)
            except RuntimeUsageError:
                break
        if admission_enabled():
            await apost(owner,owner["run_id"],"admit",admission_payload(request,owner,start))
        else:
            await apost(owner,owner["run_id"],"start",start)
        try:
            response = await self.inner.handle_async_request(request)
        except BaseException:
            stream = AccountedAsyncStream(response_stream_empty(),owner,journal,start,"application/json",False)
            await stream.finish(False); raise
        response.stream = AccountedAsyncStream(response.stream,owner,journal,start,response.headers.get("content-type", ""),response.is_success)
        return response

    async def aclose(self):
        await self.inner.aclose()


def response_stream_empty():
    class Empty(httpx.AsyncByteStream):
        async def __aiter__(self):
            if False:
                yield b""
    return Empty()


def model_http_clients():
    # Validate durable storage during construction; there is no temporary/default spool.
    if admission_enabled() and not enabled():
        raise RuntimeUsageError("admission_requires_accounting")
    if enabled():
        Journal(os.environ.get("DEEP_AGENT_USAGE_SPOOL_DIR", ""))
    return {"http_client":httpx.Client(transport=AccountingTransport(),follow_redirects=False),
            "http_async_client":httpx.AsyncClient(transport=AsyncAccountingTransport(),follow_redirects=False)}


def idle_replay_configuration():
    """Explicit opt-in owner; no endpoint/key is recovered from persisted receipts."""
    if os.environ.get("DEEP_AGENT_USAGE_IDLE_REPLAY_ENABLED") != "1":
        return None
    if not enabled():
        raise RuntimeUsageError("usage_idle_replay_accounting_disabled")
    base = os.environ.get("DEEP_AGENT_USAGE_CALLBACK_BASE_URL", "").strip().rstrip("/")
    key = os.environ.get("DEEP_AGENT_SERVICE_INTERNAL_KEY", "").strip()
    try:
        parsed = urlsplit(base)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not key:
            raise ValueError()
    except Exception:
        raise RuntimeUsageError("usage_idle_replay_receiver_unconfigured") from None
    return {"base_url": base, "key": key}, Journal(os.environ.get("DEEP_AGENT_USAGE_SPOOL_DIR", ""))


async def replay_pending_batch(owner, journal):
    """At most 20 metadata callbacks; never constructs/calls a model transport."""
    delivered = 0
    for request_id, run_id, payload in await asyncio.to_thread(journal.pending, owner):
        try:
            await asyncio.to_thread(journal.defer, request_id)
            body = json.loads(payload)
            await apost(owner, run_id, "terminal", body)
            await asyncio.to_thread(journal.acknowledge, request_id)
            delivered += 1
        except Exception:
            # Keep the original identity and receipt for a future bounded batch.
            # No raw exception, key, endpoint or receipt body reaches logs.
            _logger.warning("usage_idle_receipt_delivery_unconfirmed")
            continue
    return delivered


async def replay_pending_receipts(owner, journal):
    """Service-owned idle repair. Cancellation ends the worker without dropping pending rows."""
    while True:
        try:
            await replay_pending_batch(owner, journal)
        except Exception:
            _logger.warning("usage_idle_receipt_spool_unavailable")
        await asyncio.sleep(60)
