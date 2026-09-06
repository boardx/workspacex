"""Trusted session transport for the official BaseSandbox helpers.

The supplied client owns HTTP/UDS service configuration and its lifecycle. This
adapter neither creates sessions nor adds file tools or an isolation boundary.
"""
from __future__ import annotations

import asyncio
import hashlib
import inspect
import base64
import binascii
import json
from pathlib import Path
from uuid import UUID, uuid4

import httpx
from deepagents.backends.protocol import ExecuteResponse, FileDownloadResponse, FileUploadResponse, ReadResult
import deepagents.backends.sandbox as upstream
from deepagents.backends.sandbox import BaseSandbox

from .upstream_compat import ensure_sandbox_compat
from .native_skill_activity import observe_skill_read


LIMITS = json.loads((Path(__file__).parent / "generated" / "sandbox_session_schema.json").read_text())["limits"]


_READ_CAPTURE_BYTES = 1024 * 1024


class SandboxTransportError(RuntimeError):
    """Sanitized failure; response bodies and credentials never enter exceptions."""


class HttpSessionSandbox(BaseSandbox):
    def __init__(self, session_id: str, token: str, client: httpx.Client):
        ensure_sandbox_compat()
        self._session_id = str(UUID(session_id))
        if len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
            raise ValueError("Invalid sandbox credential")
        self._token = token
        self._client = client

    @property
    def id(self) -> str:
        return self._session_id

    def __repr__(self) -> str:
        return f"HttpSessionSandbox(session_id={self.id!r})"

    def _request(self, method: str, suffix: str, **kwargs) -> httpx.Response:
        # Do not follow redirects carrying a session credential to another host.
        return self._client.request(
            method, f"/sessions/{self.id}{suffix}",
            headers={"Authorization": f"Bearer {self._token}"},
            follow_redirects=False, **kwargs,
        )

    @staticmethod
    def _body(response: httpx.Response) -> dict:
        if not response.is_success:
            # Status alone is safe; server error text may include secrets or paths.
            raise SandboxTransportError(f"Sandbox request failed (HTTP {response.status_code})")
        try:
            body = response.json()
            if not isinstance(body, dict):
                raise ValueError()
            return body
        except ValueError:
            raise SandboxTransportError("Invalid sandbox response") from None

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        if not isinstance(command, str) or not command or len(command.encode("utf-8")) > LIMITS["maxCommandBytes"]:
            raise ValueError("Invalid sandbox command size")
        if timeout is not None and (type(timeout) is not int or timeout < 1 or timeout * 1000 > LIMITS["maxTimeoutMs"]):
            raise ValueError("Sandbox timeout exceeds contract limits")
        # Never retry an execution automatically: a transport failure may occur
        # after the command has run. Each ID is bound to exactly this request.
        execution_id = str(uuid4())
        timeout_ms = LIMITS["defaultTimeoutMs"] if timeout is None else timeout * 1000
        try:
            body = self._body(self._request("POST", "/executions", json={
                "executionId": execution_id, "command": command, "timeoutMs": timeout_ms,
            }, timeout=timeout_ms / 1000 + 5))
            if (body.get("executionId") != execution_id
                or type(body.get("output")) is not str
                or type(body.get("truncated")) is not bool
                or type(body.get("timedOut")) is not bool
                or type(body.get("cancelled")) is not bool
                or (body.get("exitCode") is not None and type(body["exitCode"]) is not int)
                or "exitCode" not in body):
                raise SandboxTransportError("Invalid sandbox execution response")
            output = body["output"].replace(self._token, "[redacted]")
            if body["timedOut"] or body["cancelled"]:
                reason = "timed out" if body["timedOut"] else "cancelled"
                return ExecuteResponse(output=f"Execution {reason}.\n{output}", exit_code=None,
                                       truncated=body["truncated"])
            return ExecuteResponse(output=output, exit_code=body["exitCode"], truncated=body["truncated"])
        except httpx.TimeoutException:
            try:
                self._request("POST", f"/executions/{execution_id}/cancel", timeout=5)
            except httpx.HTTPError:
                pass
            raise SandboxTransportError("Sandbox transport timed out; cancellation requested, outcome unknown") from None
        except httpx.HTTPError:
            raise SandboxTransportError("Sandbox transport unavailable; execution outcome unknown") from None

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        # Pin private upstream reader/capture helpers; dependency upgrades require review.
        if hashlib.sha256(inspect.getsource(upstream).encode()).hexdigest() != "13c228a22bfd1cf84e9cd1f2f8e4813e710a9fb405de19e189a2f42a3cfe60b6":
            raise SandboxTransportError("Upstream read helpers changed; review native image regressions before upgrading")
        capture = f"/workspace/.native-read-{uuid4().hex}.json"
        backend = _ReadCaptureSandbox(self._session_id, self._token, self._client)
        try:
            result = backend.execute_with_offload(upstream._build_read_cmd(file_path, offset, limit), capture,
                                                 max_inline_bytes=8192, max_capture_bytes=_READ_CAPTURE_BYTES)
            if result.response.exit_code != 0 or result.response.truncated:
                return ReadResult(error="Sandbox read capture failed or was truncated")
            output = result.response.output
            if result.offloaded:
                downloaded = self.download_files([capture])[0]
                if downloaded.error or downloaded.content is None or len(downloaded.content) > _READ_CAPTURE_BYTES:
                    return ReadResult(error="Sandbox read capture download failed or exceeded limit")
                try:
                    output = downloaded.content.decode("utf-8")
                except UnicodeDecodeError:
                    return ReadResult(error="Sandbox read capture was not UTF-8 JSON")
            parsed = upstream._parse_read_output(output, file_path)
        finally:
            # Generated hexadecimal path only, never interpolate a caller path into cleanup.
            cleaned = self.execute(f"rm -f -- {capture} {capture}.ec")
            if cleaned.exit_code != 0 or cleaned.truncated:
                raise SandboxTransportError("Sandbox read capture cleanup failed")

        observe_skill_read(file_path, parsed)
        return parsed

    async def aread(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        return await asyncio.to_thread(self.read, file_path, offset, limit)

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        results = []
        for path, content in files:
            try:
                if not isinstance(content, bytes) or len(content) > LIMITS["maxFileBytes"]:
                    raise SandboxTransportError("Invalid sandbox upload size")
                body = self._body(self._request("POST", "/files", json={
                    "path": path, "contentBase64": base64.b64encode(content).decode("ascii"),
                }))
                if body.get("path") != path or type(body.get("sizeBytes")) is not int or body["sizeBytes"] != len(content):
                    raise SandboxTransportError("Invalid sandbox upload response")
                results.append(FileUploadResponse(path=path))
            except (httpx.HTTPError, SandboxTransportError):
                results.append(FileUploadResponse(path=path, error="sandbox_upload_failed"))
        return results

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        results = []
        for path in paths:
            try:
                body = self._body(self._request("GET", "/files", params={"path": path}))
                encoded = body["contentBase64"]
                if (not isinstance(encoded, str)
                    or len(encoded) > 4 * ((LIMITS["maxFileBytes"] + 2) // 3)
                    or type(body.get("sizeBytes")) is not int
                    or not 0 <= body["sizeBytes"] <= LIMITS["maxFileBytes"]):
                    raise SandboxTransportError("Invalid sandbox download size")
                data = base64.b64decode(encoded, validate=True)
                if base64.b64encode(data).decode("ascii") != encoded:
                    raise SandboxTransportError("Noncanonical sandbox file encoding")
                if body.get("path") != path or type(body.get("sizeBytes")) is not int or body["sizeBytes"] != len(data):
                    raise SandboxTransportError("Invalid sandbox download response")
                results.append(FileDownloadResponse(path=path, content=data))
            except (httpx.HTTPError, SandboxTransportError, KeyError, ValueError, TypeError, binascii.Error):
                results.append(FileDownloadResponse(path=path, error="sandbox_download_failed"))
        return results


class _ReadCaptureSandbox(HttpSessionSandbox):
    """Enable official capture only for read transport, not model execute tools."""
    enable_capture_offload = True
