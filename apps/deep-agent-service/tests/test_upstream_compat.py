"""A two-comment dependency fix; upstream methods and user commands stay intact."""
import ast
import asyncio
import inspect

import deepagents.backends.sandbox as upstream
import pytest

from deep_agent_service import upstream_compat as compat
from deep_agent_service.sandbox_backend import HttpSessionSandbox
from native_sandbox_fixture import real_native_session


def original_template():
    # Read the installed source, independent of in-process initialization order.
    for node in ast.parse(inspect.getsource(upstream)).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_GREP_PATH_GLOB_TEMPLATE" for t in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError("Upstream template assignment missing")


def test_exactly_two_comment_lines_change_and_patch_is_idempotent():
    original = original_template()
    patched = compat._checked_template(original, "0.7.6")
    changed = [(a, b) for a, b in zip(original.splitlines(), patched.splitlines(), strict=True) if a != b]
    assert len(changed) == 2
    for before, after in changed:
        assert before.lstrip().startswith("#") and after == before.replace('"', '')
    assert compat._checked_template(patched, "0.7.6") == patched


def test_unknown_version_or_template_fails_closed():
    with pytest.raises(compat.UpstreamCompatibilityError, match="review the upstream"):
        compat._checked_template(original_template(), "0.7.13")
    with pytest.raises(compat.UpstreamCompatibilityError, match="hash changed"):
        compat._checked_template(original_template() + "\n", "0.7.6")


def test_only_template_changes_not_upstream_method_identity(monkeypatch):
    before = (upstream.BaseSandbox.grep, upstream.BaseSandbox.agrep, upstream._build_grep_cmd)
    monkeypatch.setattr(upstream, "_GREP_PATH_GLOB_TEMPLATE", original_template())
    compat.ensure_sandbox_compat()
    compat.ensure_sandbox_compat()
    assert before == (upstream.BaseSandbox.grep, upstream.BaseSandbox.agrep, upstream._build_grep_cmd)
    assert HttpSessionSandbox.grep is upstream.BaseSandbox.grep
    assert HttpSessionSandbox.agrep is upstream.BaseSandbox.agrep


def test_failed_validation_does_not_modify_template(monkeypatch):
    unknown = original_template() + "\n"
    monkeypatch.setattr(upstream, "_GREP_PATH_GLOB_TEMPLATE", unknown)
    with pytest.raises(compat.UpstreamCompatibilityError):
        compat.ensure_sandbox_compat()
    assert upstream._GREP_PATH_GLOB_TEMPLATE == unknown


@pytest.mark.parametrize("asynchronous", [False, True])
def test_real_upstream_path_glob_grep_and_cap(asynchronous):
    with real_native_session([]) as (adapter, _):
        assert adapter.write('/workspace/嵌套/notes.txt', 'needle.*\nneedle.*\nneedle.*\nother').error is None
        if asynchronous:
            result = asyncio.run(adapter.agrep('needle.*', '/workspace', glob='**/*.txt', max_count=2))
        else:
            result = adapter.grep('needle.*', '/workspace', glob='**/*.txt', max_count=2)
        assert result.error is None and result.truncated
        assert [match['line'] for match in result.matches] == [1, 2]
        # Caller command bytes pass through untouched; the adapter does not repair shell inputs.
        direct = adapter.execute("python3 -c 'print(\"USER_COMMAND_UNCHANGED\")'")
        assert direct.output.strip() == 'USER_COMMAND_UNCHANGED'


def test_caller_command_is_sent_byte_for_byte():
    import json
    from uuid import uuid4
    import httpx
    observed = []
    def handler(request):
        body = json.loads(request.content)
        observed.append(body["command"])
        return httpx.Response(200, json={"executionId": body["executionId"], "exitCode": 0, "output": "",
                                         "truncated": False, "timedOut": False, "cancelled": False})
    with httpx.Client(transport=httpx.MockTransport(handler), base_url="http://sandbox") as client:
        adapter = HttpSessionSandbox(str(uuid4()), "a" * 64, client)
        command = '''echo '"exactly at the cap" "capped early"' '''
        adapter.execute(command)
        assert observed == [command]


def test_shell_tokenization_keeps_complete_python_program(monkeypatch):
    import shlex
    monkeypatch.setattr(upstream, "_GREP_PATH_GLOB_TEMPLATE", original_template())
    broken = shlex.split(upstream._build_grep_cmd("needle", "/workspace", "**/*.txt", 2))
    with pytest.raises(SyntaxError):
        compile(broken[2], "upstream-original", "exec")
    compat.ensure_sandbox_compat()
    repaired = shlex.split(upstream._build_grep_cmd("needle", "/workspace", "**/*.txt", 2))
    assert repaired[:2] == ["python3", "-c"]
    assert len(repaired) == 4 and repaired[3] == "2>/dev/null"
    compile(repaired[2], "upstream-repaired", "exec")
