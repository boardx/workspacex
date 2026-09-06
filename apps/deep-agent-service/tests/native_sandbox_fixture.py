"""Explicitly opted-in, owned-container integration fixture. No host model execution."""
import base64
import hashlib
import json
import os
import subprocess
from contextlib import contextmanager

import httpx
import pytest

from deep_agent_service.sandbox_backend import HttpSessionSandbox
from deep_agent_service.skill_packages import package_mount_files

def pinned_skill_package():
    files = {"SKILL.md": b"---\nname: example\ndescription: Run the pinned report script.\n---\nRun python3 /skills/example/scripts/report.py.\n",
             "scripts/report.py": b"from pathlib import Path\nPath('/workspace/report.txt').write_text('PINNED_SCRIPT_EXECUTED')\n"}
    return [{"stable_name": "example", "package": {"skillId": "s1", "versionId": "v1", "files": [
        {"path": path, "contentBase64": base64.b64encode(content).decode(), "mediaType": "text/plain",
         "digest": hashlib.sha256(content).hexdigest()} for path, content in files.items()]}}]


_UDS_RELAY = r"""
const http = require('node:http');
let input = ''; process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const p = JSON.parse(input);
  const req = http.request({socketPath: process.env.SKILL_SANDBOX_SOCKET, method:p.method,
    path:p.path, headers:p.headers}, res => {
    let body='';res.on('data', c => body+=c);
    res.on('end', () => process.stdout.write(JSON.stringify({status:res.statusCode,body})));
  });
  req.on('error', () => {process.stderr.write('UDS relay unavailable'); process.exitCode=1;});
  req.end(p.body);
});
"""


@contextmanager
def real_native_session(pins=None):
    """Yield (adapter, pins); create/delete only one session in the named test container."""
    container = os.environ.get("WX_NATIVE_SANDBOX_CONTAINER")
    if not container:
        pytest.skip("Requires an explicitly owned E003 integration container")
    class DockerUdsTransport(httpx.BaseTransport):
        def handle_request(self, request):
            payload = {"method": request.method, "path": request.url.raw_path.decode(),
                       "headers": dict(request.headers), "body": request.content.decode()}
            completed = subprocess.run(["docker", "exec", "-i", container, "node", "-e", _UDS_RELAY],
                                       input=json.dumps(payload), text=True, capture_output=True, timeout=30, check=True)
            response = json.loads(completed.stdout)
            return httpx.Response(response["status"], content=response["body"])
    pins = pinned_skill_package() if pins is None else pins
    with httpx.Client(transport=DockerUdsTransport(), base_url="http://sandbox") as client:
        created = client.post("/sessions", json={"skills": package_mount_files(pins)})
        assert created.status_code == 201
        session = created.json()
        adapter = HttpSessionSandbox(session["sessionId"], session["token"], client)
        try:
            yield adapter, pins
        finally:
            deleted = client.delete(f"/sessions/{session['sessionId']}", headers={"Authorization": f"Bearer {session['token']}"})
            assert deleted.status_code == 200


class FakeAuthority:
    """Explicit test-only authority, never selected by a production factory."""
    def check(self, tool_call):
        return None

    async def acheck(self, tool_call):
        return None
