"""The fixture ledger must speak the same dialect as the real one.

`apps/api/tests/fixtures/self-hosted-agent-runtime.py` stands in for `PostgresLedger` in the
TS contract test. When the real ledger grew `append_events` (batched writes) and `events(after)`
(incremental SSE reads), the fixture kept the old signatures: the streaming endpoint raised
inside the response generator, the socket was torn down mid-body, and CI showed
`SocketError: other side closed` on the two tests that stream — nothing pointed at the fixture
(2026-09-22). A stand-in whose dialect drifts cannot exhibit the defect it is there to catch.

Read with `ast` rather than imported: the fixture is a script that binds a port at import.
"""
import ast
import inspect
from pathlib import Path

from deep_agent_service.self_hosted_runtime import Ledger

FIXTURE = Path(__file__).resolve().parents[2] / "api" / "tests" / "fixtures" / "self-hosted-agent-runtime.py"


def _fixture_methods() -> dict[str, list[str]]:
    tree = ast.parse(FIXTURE.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "MemoryLedger":
            out: dict[str, list[str]] = {}
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    out[item.name] = [a.arg for a in item.args.args]
            return out
    raise AssertionError("MemoryLedger not found in the fixture")


def test_fixture_implements_every_ledger_method_with_the_same_parameters():
    fixture = _fixture_methods()
    expected = [n for n in dir(Ledger) if not n.startswith("_")]
    assert expected, "the protocol must expose methods"
    missing = [n for n in expected if n not in fixture]
    assert not missing, f"fixture ledger is missing {missing}"
    for name in expected:
        real = list(inspect.signature(getattr(Ledger, name)).parameters)
        assert fixture[name] == real, (
            f"{name}(): fixture takes {fixture[name][1:]}, protocol takes {real[1:]}"
        )
