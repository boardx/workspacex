# W13: one persistent scheduler, existing gateway execution

## Choice and provenance

The shipped deep-agent-service Dockerfile starts `langgraph dev`; no production LangSmith cron deployment or pg-boss package was present. Use the single newly pinned `pg-boss@12.30.0` (MIT, Node >=22.12; repository Node22.23 is compatible). Official sources: https://pgboss.io/api/scheduling, https://pgboss.io/api/jobs, https://github.com/timgit/pg-boss/tree/180a54b65ce492bf990e524cda2d38b19f0df3f4. Installed dist source is the exact lockfile artifact; no SDK patch is installed.

`cron-parser@5.10.0` is the identical version used by pg-boss. It computes nextRunAt for display and DST test fixtures only. It does not register a timer or write schedule state. The API restricts recurring expressions to five fields. pg-boss checks the most recent minute; missed offline cron occurrences are skipped, not replayed as a backlog. A persisted one-shot job runs after restart when overdue.

## Ownership and atomicity

The official pg-boss schema owns cron specs, timestamps, claims, job retries and worker coordination. `standard_schedules` owns requester/thread/agent binding, instruction, idempotency digest, cancellation revision and the last accepted run reference. It does not duplicate cron expressions or due-time authority.

The private PgBoss constructor database adapter is bound to an explicit TenantSession using AsyncLocalStorage. This is necessary: in 12.30.0, `schedule` and `unschedule` use the constructor adapter, not the `send` API's optional per-call database connection. Passing options.db to schedule would not provide the promised transaction.

Creation and cancellation use the same real database transaction for metadata and SDK writes. Delivery and cancellation serialize on the schedule row lock. ScheduledChatRunGateway calls the existing acceptHumanMessage path with the SDK job UUID as stable clientMessageId. Its repositories must share the scheduler's DATABASE_PORT instance; PgDatabase's nested transaction context then uses the same connection. The real PostgreSQL test proves identical backend PIDs and that an outer rollback removes both accepted message and run. The executor is kicked only after the outer commit. A lost acknowledgment retries the existing occurrence ID and cannot create another logical run.

The tested cancellation race either prevents a new run or waits for an occurrence that has already won the row lock and committed. It does not stop an accepted running/queued main run. Main run lifecycle remains peer owned.

Every model tool request checks its current run/attempt/epoch, actual tool call and current requester. Each due occurrence reuses Chat visibility, write-role/archive checks and current published-agent resolution. List output hides the instruction if the original thread is no longer visible. It never grants future runs a reusable old tool approval.

## Explicit deployment setup

Run `pnpm exec tsx apps/api/scripts/setup-standard-scheduler.ts` with the existing migration identity. It installs official SDK migrations and creates the queues, then grants only schema usage, table DML, sequence usage and function execution to app_rw. Runtime uses migrate:false/createSchema:false/reindex:false and does not acquire schema ownership or DDL privileges. Runtime and metadata must use the same database. The migration helper is never called by normal runtime DI.

The composition root owns enabling/start/stop and the required generic error reporter. This branch does not provision any external production database.

## Peer notification dependency (not delivered)

peer-boundaries.md assigns S7–S9 reminders and their UI to agent ux dev. A read-only inspection of its worktree found no generic persistent user-reminder publisher: existing inbox aggregation covers feedback, errors and design; transactional email is not the promised in-app channel. The attempted dependency message had Transport closed, so it must not be claimed delivered.

ScheduledRunNotifier.publish is therefore a required composition adapter for create, accepting only a stable fact ID, org/user/schedule IDs and a fixed failure code. No notification table or email fallback is added. The schedule metadata retains notification_pending until the peer reports durable acceptance; the official SDK job retries a failed acknowledgment using the same fact ID. Tests use an explicit peer adapter double and do not prove in-app UI delivery. Without that adapter, create fails explicitly; list/cancel do not silently drop notifications. This dependency remains open and W13 cannot be called fully user-complete merely because its provider tests pass.

### Production composition

`KERNEL_STANDARD_SCHEDULER=1` explicitly enables the Nest-managed official worker.
Run `apps/api/scripts/setup-standard-scheduler.ts` with the existing migration
configuration before enabling; runtime never installs the provider schema.
`STANDARD_SCHEDULE` uses the existing `DATABASE_PORT`, Chat repositories and
`AGENT_RUN_EXECUTOR`; dispatch goes through `acceptHumanMessage` and kicks only
after the scheduling transaction commits. Startup failure attempts provider
cleanup and fails application initialization. Nest close drains the worker;
the process entry enables SIGTERM/SIGINT shutdown hooks, while test `createApp`
does not register global signal listeners.

`SCHEDULED_RUN_NOTIFIER` remains an optional DI dependency for the peer's durable
in-app reminder adapter. An absent dependency rejects creation rather than
inventing delivery. Native factory registers all three actual Python tools;
all three remain L2 under the existing classifier. Schedule errors are excluded
from automatic tool retry because durable acceptance may precede lost responses.

The parent-lock boundary is supplied by existing implementations together:
`withAuthorizedStandardToolRun` opens the outer tenant transaction;
`PgParentRunControlReader.withSnapshot` locks the parent row `FOR UPDATE OF r`;
`PgDatabase.inTx` reuses the same instance's AsyncLocalStorage connection without
an inner commit. The lock therefore remains held before the schedule advisory/row
lock until metadata and SDK writes commit. This guarantee requires the production
composition's single DATABASE_PORT instance; the authority check alone is not a
portable claim about arbitrary injected readers/databases.
