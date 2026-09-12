from __future__ import annotations

import asyncio

import pytest

from deep_agent_service import checkpoint_readiness


def test_readiness_reports_stage_without_exception_message(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    secret = "postgresql://owner:never-print-me@db/workspacex"

    async def fail_prepare(self: object) -> None:
        raise RuntimeError(f"connection rejected for {secret}")

    monkeypatch.setattr(checkpoint_readiness.PostgresLedger, "prepare", fail_prepare)

    with pytest.raises(SystemExit) as raised:
        asyncio.run(checkpoint_readiness.run_readiness(secret))

    assert raised.value.code == 1
    output = capsys.readouterr().out
    assert output == "checkpoint-readiness stage=ledger_prepare result=failed error=RuntimeError\n"
    assert secret not in output


def test_main_fails_closed_when_checkpoint_dsn_is_missing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("DEEP_AGENT_CHECKPOINT_DB", raising=False)

    with pytest.raises(SystemExit) as raised:
        checkpoint_readiness.main()

    assert raised.value.code == 1
    assert capsys.readouterr().out == (
        "checkpoint-readiness stage=config result=failed error=MissingCheckpointDsn\n"
    )


def test_readiness_runs_every_probe_in_order(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    calls: list[str] = []

    async def prepare(self: object) -> None:
        calls.append("ledger_prepare")

    def successful_probe(name: str):
        async def probe(dsn: str) -> None:
            assert dsn == "postgresql://checkpoint"
            calls.append(name)

        return probe

    monkeypatch.setattr(checkpoint_readiness.PostgresLedger, "prepare", prepare)
    monkeypatch.setattr(
        checkpoint_readiness, "probe_checkpoint", successful_probe("checkpoint_roundtrip")
    )
    monkeypatch.setattr(
        checkpoint_readiness,
        "probe_checkpoint_isolation",
        successful_probe("checkpoint_isolation"),
    )
    monkeypatch.setattr(
        checkpoint_readiness,
        "probe_restricted_runtime",
        successful_probe("restricted_runtime"),
    )

    asyncio.run(checkpoint_readiness.run_readiness("postgresql://checkpoint"))

    assert calls == [
        "ledger_prepare",
        "checkpoint_roundtrip",
        "checkpoint_isolation",
        "restricted_runtime",
    ]
    assert capsys.readouterr().out.count("result=passed") == 4
