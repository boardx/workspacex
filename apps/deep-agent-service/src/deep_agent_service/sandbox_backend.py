"""Trusted session transport for the official BaseSandbox helpers.

The supplied client owns HTTP/UDS service configuration and its lifecycle. This
adapter neither creates sessions nor adds file tools or an isolation boundary.
"""
from __future__ import annotations

import base64
import binascii
import json
from pathlib import Path
from uuid import UUID, uuid4

import httpx
from deepagents.backends.protocol import ExecuteResponse, FileDownloadResponse, FileUploadResponse
from deepagents.backends.sandbox import BaseSandbox

from .upstream_compat import ensure_sandbox_compat


LIMITS = json.loads((Path(__file__).parent / "generated" / "sandbox_session_schema.json").read_text())["limits"]


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
