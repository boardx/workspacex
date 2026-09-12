"""Fail-closed deployment probe with diagnostics that never include the checkpoint DSN."""

from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable, Callable

from deep_agent_service.postgres_checkpointer import (
    probe_checkpoint,
    probe_checkpoint_isolation,
    probe_restricted_runtime,
)
from deep_agent_service.self_hosted_runtime import PostgresLedger

Probe = Callable[[], Awaitable[object]]


async def run_readiness(dsn: str) -> None:
    stages: tuple[tuple[str, Probe], ...] = (
        ("ledger_prepare", lambda: PostgresLedger(dsn).prepare()),
        ("checkpoint_roundtrip", lambda: probe_checkpoint(dsn)),
        ("checkpoint_isolation", lambda: probe_checkpoint_isolation(dsn)),
        ("restricted_runtime", lambda: probe_restricted_runtime(dsn)),
    )
    for stage, probe in stages:
        try:
            await probe()
        except Exception as exc:
            # Database driver messages may echo credentials or full DSNs. Exception type and
            # stable stage are enough to route the failure without leaking either value.
            print(
                f"checkpoint-readiness stage={stage} result=failed error={type(exc).__name__}",
                flush=True,
            )
            raise SystemExit(1) from None
        print(f"checkpoint-readiness stage={stage} result=passed", flush=True)


def main() -> None:
    dsn = os.environ.get("DEEP_AGENT_CHECKPOINT_DB")
    if not dsn:
        print(
            "checkpoint-readiness stage=config result=failed error=MissingCheckpointDsn",
            flush=True,
        )
        raise SystemExit(1)
    asyncio.run(run_readiness(dsn))


if __name__ == "__main__":
    main()
