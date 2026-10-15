# T20 isolated startup side-effect extensions

`extended.ts` runs only with `CN_API_STARTUP_FIXTURE=1`, explicit loopback PGHOST,
and a fresh `cn_startup_<16 hex>` clone of the already migrated baseline. It
checks every original migration checksum and the pristine baseline canary first.
No production database, provider credential or cloud operation is accepted.

Two fixed scenarios are available to the existing Linux startup harness:

- `retention-extended`: original `sweepExpiredErrorLogs` and `sweepDebugEvents`
  run under a real app-role transaction with a shared PostgreSQL `now()` anchor.
  Synthetic rows exactly one microsecond before, on and after 30/7-day cutoffs
  establish the strict comparison. Then 500001 real rows exercise the unmodified
  default 500000-row cap, oldest-ID removal and repeat-sweep idempotence.
- `queued-worker-extended`: actual `PgAgentRunRepository` and `AgentRunExecutor`
  execute concurrent ticks against real migrated PostgreSQL. Only ModelCallPort
  is an explicit synthetic loopback HTTP adapter. Tests require one model call
  and one persisted message, a real INSERT-trigger failure followed by recovery
  through a fresh executor without repeating the model call, and a terminal
  provider failure that later ticks do not re-execute.

This extends the existing real Nest startup scenarios; it does not itself prove
Nest dependency-injection model wiring or real external model service behavior.
It is not production release acceptance. The existing outer harness must supply
its immutable local AGE/vector image, private owner registry and exact owned
container cleanup. No new image is pulled, and each scenario gets a separate
baseline clone. Each operation uses the minimum of its local cap and the remaining shared 1200-second budget. Work stops 90 seconds before that deadline to reserve cleanup time; scenario caps remain 420 seconds and do not extend the shared budget. The newly authorized container limit is 2 GiB memory/no extra swap and 1 GiB PGDATA tmpfs, verified by image/container inspect with no implicit volume. Limits never increase on failure. Heavy PG suites must be scheduled without exceeding standard-runner aggregate memory. The 500001-row disk/CPU cost and
actual Linux duration remain unmeasured until CI; do not report estimated size
as measured evidence. Outer cgroup/process supervision must also bound failures
and teardown. Missing capability fails rather than skips.

Current author validation: TypeScript syntax transpilation only. Real PostgreSQL
and worker scenario outcomes are pending Linux execution. Receipt `verified`
is produced only after every assertion succeeds; failure receipts retain the
fixed stage and existing sanitized startup diagnostic.

Version boundary: this fixture executes the current control checkout and its complete migration list, not the f0eb candidate application. Receipts record the control Git SHA and actual production-function file hashes. `candidateExactSourceTested:false` stays explicit; no additional control-checkout migration is thereby authorized for production.
