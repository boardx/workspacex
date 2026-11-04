# Native streaming completion — #6232

## Dynamic trigger

DevApp API and agent OCI labels were independently read as `ddf28f7e91e5c65bb7f63d1a9bf2c3b82f2f11df` after release41829877288-1. One minimal chat returned “验收成功。” and persisted. Logical run `8fe8e284-cc3d-49bf-b6b5-a4b0998659aa` succeeded (2026-11-04 13:04:32.191501–13:04:36.484045 UTC), but physical Qwen request `9ef654bc-6258-4cb7-827f-15bfdec59437` recorded failed. Reported16523=16520input+3output tokens matched token_usage_events and exactly one16.53credit consume ledger; retrieval embedding request `dc020ed5-24fc-443f-8635-d695cb4a64c4` reported9input tokens and one0.01credit ledger. Both fixed payers were the initiating personal wallet. Read-only SQL ended ROLLBACK/EXIT0. No balances, permissions or config were changed.

## Reproduction and fix

Installed OpenAI SDK `_streaming.py` breaks on `[DONE]` then closes the HTTP response in finally. Accounting close previously always finalized failed, even though the protocol had completed. Actual model factory + installed SDK + sync/async accounting transport reproduce two stream failures while invoke/ainvoke succeed. Protocol counterexamples expose missing/truncated DONE and JSON errors incorrectly accepted on plain HTTP EOF: **8 failed,14 passed** before production correction (`red.txt`).

The parser now recognizes a complete independent SSE DONE event with sticky malformed/error evidence. Successful HTTP status and that evidence permit SDK close to settle succeeded; EOF without completion, early cancellation, read errors, error events and failed HTTP status remain failed. No unconditional finally-success, retries, payer/reservation/tariff changes, or invented zero usage.

Tests cover sync/async fragmented CRLF DONE, unknown usage remaining absent, missing/truncated/multiline/embedded DONE, oversized data, JSON/named errors, early close, cancellation, read exceptions, unchanged token subsets and a single terminal despite repeated close. Initial affected run105 passed (`green.txt`); further counterexamples are included in full-suite evidence.

Whole bare pytest initially found four explicit missing-Postgres-prerequisite failures (898passed/45skipped); `full-suite.txt` preserves them. The standard repository script supplies isolated real Postgres and cleanup: `GOLDEN_PYTEST_TARGET=tests DEEP_AGENT_GOLDEN_EVIDENCE_DIR=<this-directory>/golden bash apps/deep-agent-service/scripts/verify-golden-scenarios.sh -q`: **902passed,45skipped,2existing deprecation warnings** (`full-suite-pg.txt`). Exit0 and owned compose stack removed; skips are not passes.

## Boundaries

This fix has not yet been released or verified dynamically. Long text run `7808302c-78d5-4fbf-8b2e-86097c4bd6f8` failed after a partial response; reported523output tokens and maximumTokenBound72811 do not identify its cause. That logical run failure must not be called repaired merely because physical completion classification is corrected. Image tool/plan failure is separately tracked in #6233. Exact-SHA independent review, normal develop CI/queue and post-release long-text verification remain required.

## Independent review correction

Review of 7666a3117 found per-line DONE matching differed from the installed
SDK's full-event SSE framing. Added real SDK sync/async cases for reverse
multiline data, extra leading space/tab, and valid multiline JSON usage.
`review-red.txt`: 8 failed / 26 passed before correction.
Parser now joins all data lines per complete event, removes only one ASCII
space after the colon, and bounds cumulative event bytes at 262144.
`review-green.txt`: 121 passed. `review-full-suite-pg.txt`: 910 passed,
45 skipped, 2 existing deprecation warnings, with isolated real Postgres.
The owned test stack was released by the standard script. This does not
claim the distinct long-chat database deadlock (#6235) is fixed.

A second review found CR-only SSE line endings could hide an error event in
one HTTP byte chunk. Added actual SDK sync/async counterexamples:
`review-cr-red.txt` has 2 failed / 34 passed. CR, LF and fragmented CRLF now
share event boundaries; `review-cr-green.txt` has 123 passed and
`review-cr-full-suite-pg.txt` has 912 passed / 45 skipped / 2 existing warnings.
