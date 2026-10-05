"""Opt-in per-HTTP-attempt receipts. Never persist prompts, responses, keys or URLs.

The API acknowledges a leased, owned start before dispatch. Terminal metadata is committed
with SQLite FULL synchronization before callback delivery. Replay repairs accounting only;
it never invokes a model. Deployment must supply a persistent spool directory explicitly.
"""
from __future__ import annotations
import asyncio
from contextlib import contextmanager
from contextvars import ContextVar
import json
import fcntl
import logging
import os
import sqlite3
import stat
import uuid
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from urllib.parse import quote, urlsplit
import httpx


_scoped_owner = ContextVar("model_request_accounting_owner", default=None)
_durability_fault = False
_logger = logging.getLogger(__name__)


def mark_durability_fault(journal):
    global _durability_fault
    _durability_fault = True
    try:
        journal.persist_fault()
    except Exception:
        _logger.error("usage_receipt_fault_marker_unconfirmed")
    _logger.error("usage_receipt_durability_fault")


class RuntimeUsageError(RuntimeError):
    pass


def enabled() -> bool:
    return os.environ.get("DEEP_AGENT_REQUEST_ACCOUNTING_ENABLED") == "1"


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ownership() -> dict:
    raw = _scoped_owner.get()
    try:
        from langgraph.config import get_config
        if raw is None:
            raw = (get_config().get("configurable") or {}).get("model_request_accounting")
    except Exception:
        pass
    if not isinstance(raw, dict):
        raise RuntimeUsageError("usage_ownership_unconfigured")
    value = {k: raw.get(k) for k in ("base_url", "org_id", "run_id", "attempt_id", "lease_epoch", "call_purpose", "subject_kind", "operation_id")}
    value["key"] = os.environ.get("DEEP_AGENT_SERVICE_INTERNAL_KEY", "").strip()
    try:
        parsed = urlsplit(value["base_url"])
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError()
        if not all(isinstance(value[k], str) and value[k] for k in ("key", "org_id")):
            raise ValueError()
        if value.get("subject_kind") == "artifact-index":
            uuid.UUID(value["operation_id"])
            if value.get("run_id") is not None or value.get("attempt_id") is not None or value.get("lease_epoch") is not None:
                raise ValueError()
        elif value.get("subject_kind") in (None, "agent-run"):
            if not all(isinstance(value[k], str) and value[k] for k in ("run_id", "attempt_id")) or type(value["lease_epoch"]) is not int or value["lease_epoch"] < 1:
                raise ValueError()
        else:
            raise ValueError()
    except Exception:
        raise RuntimeUsageError("usage_ownership_invalid") from None
    value["base_url"] = value["base_url"].rstrip("/")
    return value


def subject_id(owner):
    return owner["operation_id"] if owner.get("subject_kind") == "artifact-index" else owner["run_id"]


def callback_url(owner, resource_id, phase):
    route = "artifact-index" if owner.get("subject_kind") == "artifact-index" else "agent-runs"
    return f'{owner["base_url"]}/internal/{route}/{quote(resource_id, safe="")}/model-requests/{phase}'


@contextmanager
def retrieval_accounting_scope(reference, purpose):
    """Private service-key request reference, revalidated by the API before every vendor HTTP.

    No requester/project/provider/secret can be asserted here. Callback location/key are
    deployment-only. ContextVar isolation avoids cross-request or pooled-client ownership leaks.
    """
    requested = os.environ.get("DEEP_AGENT_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED") == "1"
    if not requested:
        if reference is not None or admission_enabled():
            raise RuntimeUsageError("retrieval_accounting_required")
        yield
        return
    if not enabled():
        raise RuntimeUsageError("admission_requires_accounting")
    if purpose not in ("retrieval-embedding", "retrieval-rerank"):
        raise RuntimeUsageError("usage_ownership_invalid")
    if reference is None:
        # Actual graph-scoped calls may reuse their existing immutable leased identity.
        raw = ownership()
    else:
        if isinstance(reference, dict) and reference.get("kind") == "artifact-index":
            if purpose != "retrieval-embedding" or set(reference) != {"kind", "orgId", "operationId"}:
                raise RuntimeUsageError("usage_ownership_invalid")
            raw = {"base_url":os.environ.get("DEEP_AGENT_USAGE_CALLBACK_BASE_URL", ""), "org_id":reference["orgId"], "operation_id":reference["operationId"], "subject_kind":"artifact-index"}
        else:
            if not isinstance(reference, dict) or set(reference) != {"orgId", "runId", "attemptId", "leaseEpoch"}:
                raise RuntimeUsageError("usage_ownership_invalid")
            raw = {"base_url":os.environ.get("DEEP_AGENT_USAGE_CALLBACK_BASE_URL", ""), "org_id":reference["orgId"], "run_id":reference["runId"], "attempt_id":reference["attemptId"], "lease_epoch":reference["leaseEpoch"]}
    raw = {k:raw.get(k) for k in ("base_url", "org_id", "run_id", "attempt_id", "lease_epoch", "subject_kind", "operation_id")} | {"call_purpose":purpose}
    token = _scoped_owner.set(raw)
    try:
        ownership()  # Validate before constructing any model/client.
        yield
    finally:
        _scoped_owner.reset(token)


def merge_late_terminal(previous: dict, incoming: dict):
    # Only unknown usage dimensions may gain facts; original physical identity and
    # lifecycle remain immutable, matching the API effective receipt projection.
    identity = lambda body: {k: v for k, v in body.items() if k not in ("usage", "endedAt", "outcome")}
    if identity(previous) != identity(incoming):
        raise RuntimeUsageError("usage_receipt_replay_mismatch")
    old, new = previous.get("usage", {}), incoming.get("usage", {})
    if not isinstance(old, dict) or not isinstance(new, dict):
        raise RuntimeUsageError("usage_receipt_replay_mismatch")
    merged = dict(old)
    for key, value in new.items():
        if key not in ("total", "prompt", "completion", "cacheInput", "reasoningOutput") or type(value) is not int or value < 0:
            raise RuntimeUsageError("usage_receipt_replay_mismatch")
        if merged.get(key) is not None and merged[key] != value:
            raise RuntimeUsageError("usage_receipt_replay_mismatch")
        merged[key] = value
    if all(merged.get(k) is not None for k in ("total", "prompt", "completion")) and merged["total"] != merged["prompt"] + merged["completion"]:
        raise RuntimeUsageError("usage_receipt_replay_mismatch")
    for subset, whole in (("cacheInput", "prompt"), ("reasoningOutput", "completion")):
        if merged.get(subset) is not None and merged.get(whole) is not None and merged[subset] > merged[whole]:
            raise RuntimeUsageError("usage_receipt_replay_mismatch")
    return previous | {"usage": merged}


class Journal:
    def __init__(self, directory: str):
        root = Path(directory)
        if not directory or not root.is_absolute():
            raise RuntimeUsageError("usage_persistent_spool_unconfigured")
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        root_info = root.lstat()
        if not stat.S_ISDIR(root_info.st_mode) or root_info.st_uid != os.getuid() or root_info.st_mode & 0o077:
            raise RuntimeUsageError("usage_persistent_spool_permissions_invalid")
        self.path = root / "model-usage.sqlite3"
        spool_fd = os.open(self.path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0) | os.O_NONBLOCK, 0o600)
        try:
            spool_info = os.fstat(spool_fd)
            if not stat.S_ISREG(spool_info.st_mode) or spool_info.st_uid != os.getuid() or spool_info.st_mode & 0o077:
                raise RuntimeUsageError("usage_persistent_spool_permissions_invalid")
        finally:
            os.close(spool_fd)
        self.fault_path = root / "receipt-durability-fault"
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY, receiver TEXT NOT NULL, run_id TEXT NOT NULL, payload TEXT NOT NULL, last_attempt_order INTEGER NOT NULL DEFAULT 0)")
            if "last_attempt_order" not in {row[1] for row in db.execute("PRAGMA table_info(pending)")}:
                db.execute("ALTER TABLE pending ADD COLUMN last_attempt_order INTEGER NOT NULL DEFAULT 0")
            if "subject_kind" not in {row[1] for row in db.execute("PRAGMA table_info(pending)")}:
                db.execute("ALTER TABLE pending ADD COLUMN subject_kind TEXT NOT NULL DEFAULT 'agent-run'")
            db.execute("CREATE TABLE IF NOT EXISTS inflight(id TEXT PRIMARY KEY, receiver TEXT NOT NULL, subject_id TEXT NOT NULL, subject_kind TEXT NOT NULL, start TEXT NOT NULL, last_attempt_order INTEGER NOT NULL DEFAULT 0)")
            if "last_attempt_order" not in {row[1] for row in db.execute("PRAGMA table_info(inflight)")}:
                db.execute("ALTER TABLE inflight ADD COLUMN last_attempt_order INTEGER NOT NULL DEFAULT 0")
            db.execute("CREATE TABLE IF NOT EXISTS lock_candidates(id TEXT PRIMARY KEY, last_attempt_order INTEGER NOT NULL DEFAULT 0)")
        self.path.chmod(0o600)

    def persist_fault(self):
        # Independent constant-only file; never persist content, identity or secrets.
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        try:
            fd = os.open(self.fault_path, flags, 0o600)
        except FileExistsError:
            fd = os.open(self.fault_path, os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0))
            created = False
        else:
            created = True
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise RuntimeUsageError("usage_receipt_fault_marker_invalid")
            if created:
                os.write(fd, b"usage_receipt_durability_fault\n")
            # Existence, even an empty file, is the closed-state signal. Sync an
            # existing marker too; a creator race does not confirm persistence.
            os.fsync(fd)
        finally:
            os.close(fd)
        directory_fd = os.open(self.path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    def assert_dispatch_allowed(self):
        # No auto-clear. Callback-only repair remains available.
        if os.path.lexists(self.fault_path):
            raise RuntimeUsageError("usage_receipt_durability_fault")

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
        # Only non-secret ownership/usage metadata; serialize writers before read.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            receiver = sha256(owner["base_url"].encode()).hexdigest()
            subject, kind = subject_id(owner), owner.get("subject_kind") or "agent-run"
            old = db.execute("SELECT receiver,run_id,payload,subject_kind FROM pending WHERE id=?", (body["requestId"],)).fetchone()
            if old:
                if (old[0], old[1], old[3]) != (receiver, subject, kind):
                    raise RuntimeUsageError("usage_receipt_replay_mismatch")
                merged = merge_late_terminal(json.loads(old[2]), body)
                payload = old[2] if merged == json.loads(old[2]) else json.dumps(merged, separators=(",", ":"))
                db.execute("UPDATE pending SET payload=? WHERE id=?", (payload, body["requestId"]))
            else:
                payload = json.dumps(body, separators=(",", ":"))
                db.execute("INSERT INTO pending(id,receiver,run_id,payload,subject_kind) VALUES(?,?,?,?,?)", (body["requestId"], receiver, subject, payload, kind))
            db.execute("DELETE FROM inflight WHERE id=? AND receiver=?", (body["requestId"], receiver))
            return payload

    def request_lock(self, request_id):
        # Every opener checks the locked inode against the current path, so a
        # concurrent GC unlink before flock cannot authorize a detached inode.
        # Candidates permit bounded metadata-only reclamation, never a TTL decision.
        if str(uuid.UUID(request_id)) != request_id:
            raise RuntimeUsageError("usage_request_identity_invalid")
        path = self.path.parent / ("inflight-" + request_id + ".lock")
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO lock_candidates(id) VALUES(?)", (request_id,))
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise RuntimeUsageError("usage_inflight_lock_invalid")
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            current = path.lstat()
            if not stat.S_ISREG(current.st_mode) or (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
                raise RuntimeUsageError("usage_inflight_lock_inode_changed")
            # GC may have removed the candidate before this open. Re-register while
            # holding the verified current inode so its next scan cannot unlink it.
            with self.connect() as db:
                db.execute("INSERT OR IGNORE INTO lock_candidates(id) VALUES(?)", (request_id,))
            os.fsync(fd)
            directory = os.open(self.path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            return fd
        except BaseException:
            os.close(fd)
            raise

    def begin(self, owner, start):
        fd = self.request_lock(start["requestId"])
        try:
            # Explicit projection: no request body, callback address/key or model content.
            metadata = {k:start[k] for k in ("orgId", "requestId", "attemptId", "leaseEpoch", "startedAt") if k in start}
            with self.connect() as db:
                db.execute("INSERT INTO inflight(id,receiver,subject_id,subject_kind,start) VALUES(?,?,?,?,?)",
                           (start["requestId"], sha256(owner["base_url"].encode()).hexdigest(), subject_id(owner), owner.get("subject_kind") or "agent-run", json.dumps(metadata, separators=(",", ":"))))
            return fd
        except BaseException:
            os.close(fd)
            raise

    def recover_inflight(self, owner):
        receiver = sha256(owner["base_url"].encode()).hexdigest()
        with self.connect() as db:
            rows = db.execute("SELECT id FROM inflight WHERE receiver=? ORDER BY last_attempt_order,rowid LIMIT 20", (receiver,)).fetchall()
        for (request_id,) in rows:
            with self.connect() as db:
                db.execute("UPDATE inflight SET last_attempt_order=(SELECT COALESCE(MAX(last_attempt_order),0)+1 FROM inflight) WHERE id=?", (request_id,))
            try:
                fd = self.request_lock(request_id)
            except BlockingIOError:
                continue  # Live stream owns the inode; no age/TTL inference.
            try:
                with self.connect() as db:
                    row = db.execute("SELECT subject_id,subject_kind,start FROM inflight WHERE id=? AND receiver=?", (request_id, receiver)).fetchone()
                    if not row:
                        continue
                    start = json.loads(row[2])
                    body = {k:start[k] for k in ("orgId", "requestId", "attemptId", "leaseEpoch") if k in start}
                    body.update(endedAt=now(), outcome="failed", usage={})
                    # An actual durable terminal always wins, even after a crash.
                    db.execute("INSERT OR IGNORE INTO pending(id,receiver,run_id,payload,subject_kind) VALUES(?,?,?,?,?)", (request_id, receiver, row[0], json.dumps(body, separators=(",", ":")), row[1]))
                    db.execute("DELETE FROM inflight WHERE id=? AND receiver=?", (request_id, receiver))
            finally:
                os.close(fd)

    def collect_locks(self):
        # Bounded durable rotation: active locks cannot starve later completed ones.
        with self.connect() as db:
            candidates = db.execute("SELECT id FROM lock_candidates ORDER BY last_attempt_order,rowid LIMIT 20").fetchall()
        removed = 0
        for (request_id,) in candidates:
            with self.connect() as db:
                db.execute("UPDATE lock_candidates SET last_attempt_order=(SELECT COALESCE(MAX(last_attempt_order),0)+1 FROM lock_candidates) WHERE id=?", (request_id,))
            try:
                fd = self.request_lock(request_id)
            except (BlockingIOError, FileNotFoundError):
                continue
            try:
                with self.connect() as db:
                    # Take SQLite's writer lock before both rechecks and unlink.
                    db.execute("UPDATE lock_candidates SET last_attempt_order=last_attempt_order WHERE id=?", (request_id,))
                    if db.execute("SELECT 1 FROM inflight WHERE id=? UNION ALL SELECT 1 FROM pending WHERE id=?", (request_id, request_id)).fetchone():
                        continue
                    path = self.path.parent / ("inflight-" + request_id + ".lock")
                    current, locked = path.lstat(), os.fstat(fd)
                    if not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino) != (locked.st_dev, locked.st_ino):
                        raise RuntimeUsageError("usage_inflight_lock_inode_changed")
                    path.unlink()
                    directory = os.open(self.path.parent, os.O_RDONLY)
                    try:
                        os.fsync(directory)
                    finally:
                        os.close(directory)
                    db.execute("DELETE FROM lock_candidates WHERE id=?", (request_id,))
                    removed += 1
            finally:
                os.close(fd)
        return removed

    def pending(self, owner: dict):
        with self.connect() as db:
            return db.execute("SELECT id,run_id,payload,subject_kind FROM pending WHERE receiver=? ORDER BY last_attempt_order,rowid LIMIT 20", (sha256(owner["base_url"].encode()).hexdigest(),)).fetchall()

    def defer(self, request_id: str):
        # Durable rotation prevents a permanently denied receipt starving later ones.
        # SQLite serializes this metadata-only queue update across worker processes.
        with self.connect() as db:
            db.execute("UPDATE pending SET last_attempt_order=(SELECT COALESCE(MAX(last_attempt_order),0)+1 FROM pending) WHERE id=?", (request_id,))

    def acknowledge(self, request_id: str, payload: str):
        with self.connect() as db:
            # A stale delivery ACK must not erase a newer pending enrichment.
            db.execute("DELETE FROM pending WHERE id=? AND payload=?", (request_id, payload))


def post(owner: dict, run_id: str, phase: str, body: dict):
    url = callback_url(owner,run_id,phase)
    # Separate callback client: must never recurse through provider transport.
    for _ in range(3):
        try:
            with httpx.Client(timeout=5, follow_redirects=False) as client:
                response = client.post(url, headers={"x-deep-agent-internal-key": owner["key"],**({"x-deep-agent-admission-protocol":"same-connection-v1"} if phase=="admit" else {})}, json=body)
                if response.status_code == 200 and response.json().get("accepted") is True:
                    return response.json()
                if response.status_code < 500:
                    break
        except Exception:
            pass
    raise RuntimeUsageError("usage_receipt_delivery_unconfirmed")


async def apost(owner: dict, run_id: str, phase: str, body: dict):
    url = callback_url(owner,run_id,phase)
    for _ in range(3):
        try:
            async with httpx.AsyncClient(timeout=5, follow_redirects=False) as client:
                response = await client.post(url, headers={"x-deep-agent-internal-key": owner["key"],**({"x-deep-agent-admission-protocol":"same-connection-v1"} if phase=="admit" else {})}, json=body)
                if response.status_code == 200 and response.json().get("accepted") is True:
                    return response.json()
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
    journal.assert_dispatch_allowed()
    try:
        model = json.loads(request.content).get("model")
        if not isinstance(model, str) or not model or len(model) > 200:
            raise ValueError()
    except Exception:
        raise RuntimeUsageError("usage_model_identity_invalid") from None
    body = {"orgId": owner["org_id"], "attemptId": owner.get("attempt_id"), "leaseEpoch": owner.get("lease_epoch"), "requestId": str(uuid.uuid4()), "startedAt": now(), "modelId": model, "callPurpose": owner.get("call_purpose") or "primary"}
    if owner.get("subject_kind") == "artifact-index":
        body = {k:body[k] for k in ("orgId", "requestId", "startedAt", "modelId")}
    return owner, journal, body


def admission_enabled():
    return os.environ.get("DEEP_AGENT_MODEL_ADMISSION_ENABLED") == "1"


def admission_payload(request, owner, start):
    if owner.get("call_purpose") == "retrieval-embedding":
        try:
            body = json.loads(request.content)
            if not isinstance(body, dict) or not request.url.path.endswith("/embeddings") or not body.get("input"):
                raise ValueError()
            if any(name in body for name in ("max_tokens", "max_completion_tokens", "messages", "tools")):
                raise ValueError()
            serialized = request.content.decode("utf-8")
        except Exception:
            raise RuntimeUsageError("admission_input_only_binding_unverified") from None
        digest = sha256(request.content).hexdigest()
        logical = json.dumps([subject_id(owner), "retrieval-embedding", start["requestId"], digest, request.url.path], separators=(",", ":"))
        return start | {"billingMode":"input-only", "requestPath":request.url.path, "logicalCallId":logical, "serializedBody":serialized}
    if owner.get("subject_kind") == "artifact-index":
        raise RuntimeUsageError("artifact_embedding_admission_unimplemented")
    try:
        body = json.loads(request.content)
        caps = [body[name] for name in ("max_tokens", "max_completion_tokens") if name in body]
        if not caps or any(type(value) is not int or value <= 0 or value != caps[0] for value in caps):
            raise ValueError()
        serialized = request.content.decode("utf-8")
    except Exception:
        raise RuntimeUsageError("admission_output_cap_unverified") from None
    # A physical request owns its admission identity. Separate equal-body calls are
    # separate paid work; replaying this request keeps the same identity. SDK retries
    # remain disabled here; a future retry coordinator must retain its own logical ID.
    # Hash only; no prompt or response is placed in durable identity metadata.
    digest = sha256(request.content).hexdigest()
    logical = json.dumps([owner["run_id"],start["callPurpose"],start["requestId"],digest],separators=(",",":"))
    return start | {"logicalCallId":logical,"serializedBody":serialized,"outputTokenLimit":caps[0]}

def apply_admitted_dispatch(request, start, acknowledgement):
    """Accept only the API's same-provider model/cap substitution, never new content or URL.

    The API has already remeasured/reserved this exact body and persisted its selected start.
    A malformed replacement fails before vendor dispatch; the hold is retained for recovery.
    """
    if acknowledgement is None or "dispatch" not in acknowledgement:
        return request
    try:
        dispatch = acknowledgement["dispatch"]
        if not isinstance(dispatch, dict) or set(dispatch) != {"modelId", "serializedBody", "outputTokenLimit"}:
            raise ValueError()
        cap = dispatch["outputTokenLimit"]
        if type(cap) is not int or not 0 < cap <= 2147483647 or not isinstance(dispatch["modelId"], str) or not 0 < len(dispatch["modelId"]) <= 200:
            raise ValueError()
        encoded = dispatch["serializedBody"].encode("utf-8")
        if len(encoded) > 2_000_000:
            raise ValueError()
        original, selected = json.loads(request.content), json.loads(encoded)
        if not isinstance(selected, dict) or set(original) != set(selected) or selected.get("model") != dispatch["modelId"]:
            raise ValueError()
        caps = [name for name in ("max_tokens", "max_completion_tokens") if name in original]
        if not caps or any(type(original[name]) is not int or type(selected[name]) is not int or selected[name] != cap or cap > original[name] for name in caps):
            raise ValueError()
        if json.dumps({name:original[name] for name in original if name not in {"model", *caps}},sort_keys=True,separators=(",", ":")) != json.dumps({name:selected[name] for name in selected if name not in {"model", *caps}},sort_keys=True,separators=(",", ":")):
            raise ValueError()
        headers = [(key, value) for key, value in request.headers.multi_items() if key.lower() != "content-length"]
        selected_request = httpx.Request(request.method, request.url, headers=headers, content=encoded, extensions=request.extensions)
        start["modelId"] = dispatch["modelId"]
        return selected_request
    except Exception:
        raise RuntimeUsageError("admission_dispatch_binding_invalid") from None


def terminal(start: dict, parser: UsageParser, success: bool):
    parser.finish()
    return {k: start[k] for k in ("orgId", "attemptId", "leaseEpoch", "requestId") if k in start} | {"endedAt": now(), "outcome": "succeeded" if success else "failed", "usage": parser.usage}


class AccountedSyncStream(httpx.SyncByteStream):
    def __init__(self, stream, owner, journal, start, content_type, success, intent_lock=None):
        self.stream,self.owner,self.journal,self.start = stream,owner,journal,start
        self.parser = UsageParser(content_type); self.success = success; self.done = False
        self.intent_lock = intent_lock

    def finish(self, success):
        if self.done:
            return
        body = terminal(self.start,self.parser,success)
        self.done = True
        persisted = False
        try:
            payload = self.journal.save(self.owner,body)
            if payload is not None:
                body = json.loads(payload)
            persisted = True
        except Exception:
            mark_durability_fault(self.journal)  # stop future dispatch, preserve this provider result
        try:
            post(self.owner,subject_id(self.owner),"terminal",body)
            if persisted:
                self.journal.acknowledge(body["requestId"], payload)
        except RuntimeUsageError:
            pass  # persisted when possible; original start remains visible otherwise
        except Exception:
            mark_durability_fault(self.journal)
        finally:
            if self.intent_lock is not None:
                os.close(self.intent_lock); self.intent_lock = None
            try:
                self.journal.collect_locks()
            except Exception:
                _logger.warning("usage_receipt_lock_cleanup_unavailable")

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
    def __init__(self, stream, owner, journal, start, content_type, success, intent_lock=None):
        self.stream,self.owner,self.journal,self.start = stream,owner,journal,start
        self.parser = UsageParser(content_type); self.success = success; self.done = False
        self.intent_lock = intent_lock

    async def finish(self, success):
        if self.done:
            return
        body = terminal(self.start,self.parser,success)
        self.done = True
        persisted = False
        try:
            payload = self.journal.save(self.owner,body)
            if payload is not None:
                body = json.loads(payload)
            persisted = True
        except Exception:
            mark_durability_fault(self.journal)
        try:
            await apost(self.owner,subject_id(self.owner),"terminal",body)
            if persisted:
                self.journal.acknowledge(body["requestId"], payload)
        except RuntimeUsageError:
            pass
        except Exception:
            mark_durability_fault(self.journal)
        finally:
            if self.intent_lock is not None:
                os.close(self.intent_lock); self.intent_lock = None
            try:
                self.journal.collect_locks()
            except Exception:
                _logger.warning("usage_receipt_lock_cleanup_unavailable")

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
    if _scoped_owner.get() is not None:
        return True
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
        for request_id,run_id,payload,kind in journal.pending(owner):
            try:
                post(owner | {"subject_kind":kind},run_id,"terminal",json.loads(payload)); journal.acknowledge(request_id,payload)
            except RuntimeUsageError:
                break
        if admission_enabled():
            acknowledgement = post(owner,subject_id(owner),"admit",admission_payload(request,owner,start))
            request = apply_admitted_dispatch(request,start,acknowledgement)
        else:
            post(owner,subject_id(owner),"start",start)
        intent_lock = journal.begin(owner,start)
        try:
            response = self.inner.handle_request(request)
        except BaseException:
            stream = AccountedSyncStream(httpx.ByteStream(b""),owner,journal,start,"application/json",False,intent_lock)
            stream.finish(False); raise
        response.stream = AccountedSyncStream(response.stream,owner,journal,start,response.headers.get("content-type", ""),response.is_success,intent_lock)
        return response

    def close(self):
        self.inner.close()


class AsyncAccountingTransport(httpx.AsyncBaseTransport):
    def __init__(self, inner=None, *, scoped_only=False):
        self.inner = inner or httpx.AsyncHTTPTransport()
        self.scoped_only = scoped_only

    async def handle_async_request(self, request):
        if self.scoped_only and _scoped_owner.get() is None:
            return await self.inner.handle_async_request(request)
        if admission_enabled() and not enabled():
            raise RuntimeUsageError("admission_requires_accounting")
        if not enabled():
            if receipt_requested():
                raise RuntimeUsageError("usage_runtime_capability_disabled")
            return await self.inner.handle_async_request(request)
        if _durability_fault:
            raise RuntimeUsageError("usage_receipt_durability_fault")
        owner,journal,start = prepare(request)
        for request_id,run_id,payload,kind in journal.pending(owner):
            try:
                await apost(owner | {"subject_kind":kind},run_id,"terminal",json.loads(payload)); journal.acknowledge(request_id,payload)
            except RuntimeUsageError:
                break
        if admission_enabled():
            acknowledgement = await apost(owner,subject_id(owner),"admit",admission_payload(request,owner,start))
            request = apply_admitted_dispatch(request,start,acknowledgement)
        else:
            await apost(owner,subject_id(owner),"start",start)
        intent_lock = journal.begin(owner,start)
        try:
            response = await self.inner.handle_async_request(request)
        except BaseException:
            stream = AccountedAsyncStream(response_stream_empty(),owner,journal,start,"application/json",False,intent_lock)
            await stream.finish(False); raise
        response.stream = AccountedAsyncStream(response.stream,owner,journal,start,response.headers.get("content-type", ""),response.is_success,intent_lock)
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
    await asyncio.to_thread(journal.recover_inflight, owner)
    for request_id, run_id, payload, kind in await asyncio.to_thread(journal.pending, owner):
        try:
            await asyncio.to_thread(journal.defer, request_id)
            body = json.loads(payload)
            await apost(owner | {"subject_kind":kind}, run_id, "terminal", body)
            await asyncio.to_thread(journal.acknowledge, request_id, payload)
            delivered += 1
        except Exception:
            # Keep the original identity and receipt for a future bounded batch.
            # No raw exception, key, endpoint or receipt body reaches logs.
            _logger.warning("usage_idle_receipt_delivery_unconfirmed")
            continue
    await asyncio.to_thread(journal.collect_locks)
    return delivered


async def replay_pending_receipts(owner, journal):
    """Service-owned idle repair. Cancellation ends the worker without dropping pending rows."""
    while True:
        try:
            await replay_pending_batch(owner, journal)
        except Exception:
            _logger.warning("usage_idle_receipt_spool_unavailable")
        await asyncio.sleep(60)
