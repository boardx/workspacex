# Long chat event / token receipt deadlock — #6235

## Actual DevApp failure

On deployed OCI revision ddf28f7e91e5c65bb7f63d1a9bf2c3b82f2f11df, local
run `7808302c-78d5-4fbf-8b2e-86097c4bd6f8` failed MODEL_CALL_FAILED at
2026-11-04T13:18:08.944501Z while remote agent run
`09c96b14-e65d-4744-9899-127ff9e34f7a` completed success with error null.
Read-only GET used the agent's actual port 8000; an earlier incorrect-port
2024 refusal was corrected and is not evidence of runtime failure.
The main physical request reported 16846 tokens (16323 input / 523 output).

The API's sole model-call-failure log in 13:17:50–13:18:12 UTC records
`unexpected model call failure: error: deadlock detected`. Its logger
retains traceId/detail but drops runId, so this correlation is by the narrow
window, not a fabricated exact runId log field.

Postgres independently records at 13:18:07.413 UTC: PID 916622 waits for
ShareLock transaction 1761417, blocked by PID 916672; PID 916672 waits for
transaction 1761418, blocked by PID 916622. Statements insert into
`agent_execution_events` and `token_usage_events`; context is locking tuple
(0,22) in `organizations`. All remote actions were read-only, with exit 0;
SQL used READ ONLY / ROLLBACK. No model request was replayed or funds changed.

## Root cause and narrow repair

Execution-event append locks the existing run to serialize event sequence
allocation, then its organization foreign key requires a key-share lock.
Token settlement holds the organization financial lock, then its token event
foreign key requires a run key-share lock. FOR UPDATE on that run creates
the inverse dependency cycle. Appending an event does not change the run key.
FOR NO KEY UPDATE retains writer serialization while permitting the receipt's
foreign-key KEY SHARE check. No foreign key or accounting lock is removed.

These are short database transactions, not locks held throughout AI inference.
This repair does not alter model execution, request replay, payer selection,
credit tariff, permissions, SSE delivery or error handling.

## Verification

The real PgTokenUsageRepository.record and PgAgentRunRepository event append
run concurrently against isolated Postgres. A barrier holds the receipt's
organization lock; pg_stat_activity confirms that the event insert is waiting
before releasing the receipt. Query errors are captured before repository
retries. With the original production lock the regression fails with real
40P01 (`red.txt`); after the one-lock-mode repair all 20 journal / billing /
concurrency regressions pass (`green.txt`), peak seven DB connections. They
also cover concurrent sequence allocation, skill fact deduplication and the
previous personal-payer lock-order regression. The standard isolation wrapper
releases its owned infrastructure.

API typecheck, complete API lint and init.sh fast bootstrap pass. Fast init
is not represented as full-repository verification. Independent exact-SHA
review, actual PR checks and normal develop integration remain required.

## Acceptance still outstanding

This evidence does not claim deployment or full user-flow restoration.
After the normal release, verify a complete persisted long reply; same-user
concurrent sessions; refresh during a live request and journal recovery;
reported usage, immutable personal payer and no replay or duplicate debit.
The separate physical SSE completion outcome fix is PR #6236 / issue #6232.

## Production lease-context correction

Follow-up tracing found `PgDatabase.inTx` also implicitly locks the leased run
before invoking any repository callback. Initial 5f2e7e966 acceptance covered
the explicit repository SQL and omitted this production context; it is not
full-path acceptance. Adding actual `withRunLease` to the real PG regression
reproduces another 40P01 (1 failed / 1 passed, `lease-red.txt`). The implicit
run guard now also uses NO KEY UPDATE, preserving every org/epoch/expiry
predicate and transaction boundary.

`lease-green.txt`: **36 passed**, including lease and non-lease concurrent
receipt/event writes, journal sequence/deduplication, prior personal payer
lock order, stale run recovery and lease units. A new real PG fencing test
observes takeover's UPDATE blocked in pg_stat_activity until the live worker
commits, then proves old epoch and expired leases refuse the transaction
body. This establishes exclusion through commit without blocking token FKs.

Knowledge feedback records the implicit-guard tracing requirement in
mod-org-identity; the initial review omission and lease-red regression are
the observed baseline failure. The final review must inspect that full path.
