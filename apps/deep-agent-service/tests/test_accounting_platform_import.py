"""A missing POSIX backend must not break the opt-out native HTTP application."""
import os
from pathlib import Path
import subprocess
import sys


def test_native_app_import_without_fcntl_and_opt_in_rejects_before_dispatch(tmp_path):
    source = Path(__file__).resolve().parents[1] / "src"
    script = r'''
import builtins, os, sys
original = builtins.__import__
def without_fcntl(name, *args, **kwargs):
    if name == "fcntl":
        raise ModuleNotFoundError("POSIX backend unavailable", name="fcntl")
    return original(name, *args, **kwargs)
sys.modules.pop("fcntl", None)
builtins.__import__ = without_fcntl
for key in ("DEEP_AGENT_REQUEST_ACCOUNTING_ENABLED", "DEEP_AGENT_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED", "DEEP_AGENT_MODEL_ADMISSION_ENABLED"):
    os.environ.pop(key, None)
from deep_agent_service.http_app import app
from deep_agent_service import model_request_accounting as accounting
import httpx
assert app is not None and not accounting.enabled()
dispatched = []
inner = httpx.MockTransport(lambda request: dispatched.append(request) or httpx.Response(200, json={"ok": True}))
transport = accounting.AccountingTransport(inner)
request = httpx.Request("POST", "http://vendor.example.test/completions")
assert transport.handle_request(request).status_code == 200
assert len(dispatched) == 1
os.environ["DEEP_AGENT_REQUEST_ACCOUNTING_ENABLED"] = "1"
accounting.ownership = lambda: {"base_url":"http://api.example.test", "org_id":"fixture", "run_id":"run", "attempt_id":"attempt", "lease_epoch":1}
os.environ["DEEP_AGENT_USAGE_SPOOL_DIR"] = sys.argv[1]
try:
    transport.handle_request(request)
except accounting.RuntimeUsageError as error:
    assert str(error) == "usage_accounting_platform_unsupported", str(error)
else:
    raise AssertionError("unsupported accounting dispatched")
assert len(dispatched) == 1
assert not os.path.exists(sys.argv[1])
'''
    environment = {**os.environ, "PYTHONPATH": str(source)}
    result = subprocess.run([sys.executable, "-c", script, str(tmp_path / "uncreated-spool")],
                            env=environment, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
