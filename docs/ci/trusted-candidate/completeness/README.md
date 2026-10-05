# Observed history and completion protocols in shadow

Tracking: [#5405](https://github.com/boardx/workspacex/issues/5405), dependent on
[#5404](https://github.com/boardx/workspacex/pull/5404) and
[#5400](https://github.com/boardx/workspacex/pull/5400). This increment keeps every
existing workflow, required check, deployment entrypoint and permission unchanged.
Every real decision remains `skip=false`, `runFull=true`; metadata comparison and
an in-memory protocol model cannot authorize reuse.

## History observation

The shared history reader exhausts the unfiltered workflow API catalog, with a
default and hard maximum of 100 pages / 10,000 advertised runs. There is no
`created`, `status` or `head_sha` filter. Each eligible run must have exactly one
known PR association. Only an explicitly different PR **and** different immutable
API `head_sha` can omit expensive attempt reads. Same-PR old heads and same API
head across other PRs both remain relevant. Unknown, empty, multiple or foreign
associations fail closed.

Every relevant listed run, including attempt 1, is read through the direct latest
run endpoint and its exact latest attempt. Any list/latest/attempt difference
fails closed. A newer failed, queued, cancelled or otherwise unsuccessful attempt
vetoes old success; a newer same-PR success requires new evidence. The default
200-related-run budget is separate from the complete catalog budget.

Fresh source API/log/Git measurement remains between independent A and B catalog
snapshots. Complete page order, rows, boundaries, source/PR facts, jobs, steps and
artifact facts participate in the observation fingerprint. An observed error is
latched even if a diagnostic retry later looks green. The protected receipt reader
uses this common observation instead of its former second 200-global-run cap and
retains its outer source/pilot before/measurement/after comparisons.

This is an observed API view, not immutable event history, linearizable index
completeness or an atomic lease. Direct latest reads repair stale attempts of
known IDs; they cannot discover a new ID absent from the list. ABA and a new
attempt after B remain possible. `indexCompletenessVerified=false` and
`atomicLease=false` are explicit. A 9,659-row mocked catalog requires at least
194 list GETs per A/B bracket, plus related verification and measurement. The
receipt reader currently performs two such brackets (388 list GETs), retaining
its outer measurement protection. These counts are tested request costs, not
live completeness or elapsed-time savings.

The 388 list requests are sequential in the success path, followed/interleaved
with fresh source/PR, latest/exact-attempt, jobs, artifacts, logs and Git reads.
At the configured worst case, four catalog snapshots can cost 400 list GETs and
1,600 related latest/attempt GETs (200 relevant IDs × two routes × four reads),
before those other operations. This may exhaust the available token budget;
403/429, transport or pagination errors return full-run, never a partial green.
No live API latency benchmark or request-budget saving has been measured here.
For illustration only, list latency alone is `388 × observed per-request RTT`;
the real receipt must measure that RTT and every other request before a timing
claim. A protected complete catalog is an architectural alternative to repeated
global scans, with bootstrap, persistence and all-event coverage costs of its own.

## Fullstack definition and terminal metadata

One checked-in discovery observation records the existing `fullstack-smoke`
selection (149 tests, 53 spec files, seven-project dependency graph) and the
separate disclosure geometry selection (seven tests, five files, one project).
The expected fullstack statuses are 148 passed and the one existing inbox fixme.
The previous #5400 execution had 147 passed, one flaky retry and that fixme;
#5404 had 148 passed, zero retries and that fixme. Do not erase the old retry.

The observation is comparison data, not a product contract or attestation.
Normalized identities bind project, file, location, full parameterized title,
repeat index and the fixed project dependency graph. A supplied source/tree and
definition-input digest bind metadata only. The module never imports candidate
config/modules or invokes Playwright/services. A discovery report's list-only
skipped count is not execution.

The terminal ledger protocol requires each fixed test, worker, hook and project
to complete, one attempt per test, ordered begin/end events, exact terminal
counts, suite end, process exit and drained reporter completion. Missing,
duplicate or extra tests, `test.only`, unknown skips, retries/flaky/failed tests,
worker/hook errors, cancellation or an unfinished lifecycle reject comparison.
Global setup must finish before project/test work, and global teardown must
follow all project/test/worker completion. This checks the observed ledger's
declared hooks; it cannot prove that a supplied reporter did not omit a configured
hook. Configured-hook and reporter closure remain part of trusted execution work.
A legacy stdout comparison can compare IDs/counts but cannot prove this
lifecycle. Even a perfectly forged complete ledger keeps
`executionAuthorityVerified=false`, `apiVerified=false`, `protectedVerified=false`
and `skip=false`. The pure metadata module is not wired into execution gating.

The actual existing fullstack runtime closure is still open: immutable service,
browser/build/tool and dependency bytes, fresh migrations/data/roles, privileged
fixture/import boundaries and actual external GitHub import coverage must be
measured under a trusted controller. Network-none mocks are not equivalent to
that existing coverage. See the [runtime pilot backlog](../runtime-pilot/backlog.md)
and the remaining items below; a fixed Node-only pilot does not attest fullstack.

## Epoch/CAS protocol model

The deterministic in-memory model binds candidate base/head/checkout/tree,
definition, locks, runtime/toolchain/environment, every declared producer
run/attempt/job, and artifact digests/expiry. Start/rerun/cancel, candidate changes,
artifact invalidation, permission loss and crash/recovery invalidate generations.
Reservation/consume compare the full bundle, epoch and monotonic generation;
stale, expired or double consumption rejects. An unknown producer or start path
blocks the model rather than asserting complete coordinator coverage.

The model has no GitHub, persistence, coordinator, production skip function or
real atomic effect. Caller-supplied complete/authority flags are not accepted.
`modelConsumeSucceeded` describes only its simulated state. Every result keeps
`realAuthority=false`, `actualReuseAtomic=false`, `reuseAuthorized=false`,
`skip=false` and `runFull=true`. A crash between real CAS and later real action is
not solved by an in-memory transaction.

## Viable activation paths and approval boundaries

| Path | Cost / limitation | Next approval or implementation |
|---|---|---|
| Retain full verification | Measured saving is zero; existing deployment/runtime checks remain | Available now; default shadow |
| Complete unfiltered API observation | At least 194 list GETs at 9,659 rows per bracket; unknown association, >10k, stale index or errors fall back | Read-only development allowed; does not close atomic history |
| Protected history catalog | Complete bootstrap plus all lifecycle/start paths; cannot bootstrap from PR-provided JSON or current force-pushed commits | Design persistence/recovery; separately approve any new protected storage/write permission |
| Trusted fullstack execution | Actual browser/API/PG/Redis/MinIO/build/module/fixture/network bytes and terminal ledger; keep all existing coverage | Implement closure independently; protected main trial and any added network/secret permission need approval |
| Durable atomic consumer | Every UI/manual/start/rerun/cancel path must invalidate an epoch, with durable consume and real effect/recovery | Pure model is available; production all-path integration and any required permission need separate approval |

Protected main receipts require reviewed main integration and an explicitly
approved exact-controller/source-run manual pilot. Merging the existing two PRs
also invokes the current DevApp deployment and possible CN prepare chain. Those
actions, main-CN promotion, deployments, permission expansion and skip activation
have not been executed here. Main-specific full-regression/chat/profile and Board
native/meeting coverage, migrations, actual deployment identity, health and
login/core-flow checks remain required by the existing ownership matrix.

The sample run 37302506067 (24m35 total, 13m20 gates, 11m14 deployment) supports
only an estimated approximately 13-minute saving on a compatible verified gate
path after every missing trust boundary is closed. It does not support a claim
that all CI or an entire PR is halved.
