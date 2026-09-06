# WX-T042 durable subtask queue — verification record

Implementation uses the existing SubtaskRunStore and executeQueuedSubtaskRuns entry,
with a PostgreSQL adapter, tenant RLS and a composite parent-run/org foreign key.
There is no second global scheduler. Enqueue/retry commits before tenant-scoped kick;
a later authorized tenant query triggers recovery after a process restart.
Lost running work becomes failed with reason
`subtask_execution_lost_after_restart_or_timeout`; no automatic execution replay occurs.
Terminal writes are idempotent and cannot overwrite an existing terminal result.
Explicit idempotencyKey replays reuse one row; changed description/context yields conflict.
Legacy callers without the key create a new row. Human retry uses server-derived
`retry:<failed-subtask-id>` so repeated clicks share one replacement task.

The executor reads the parent's fixed model provider/model and agent version instructions,
uses trusted text-only execution, and does not pass the parent's remote thread/checkpoint.
It claims one row immediately before executing it rather than reserving an entire batch.
Query/retry visibility reuses Chat resolveVisibility; retry additionally requires a writable,
unarchived parent and a failed subtask.

## Verification state

Before the authorization/idempotency review changes, two files passed 15 tests, including
production createApp dependency injection, HTTP enqueue, a real local HTTP model request,
and durable terminal state. This is **not** evidence for the later changes.

The expanded final regression command is:

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/subtask-run-store-real-db.test.ts tests/agent-runtime/subtask-run-queue.test.ts
```

Prior result before the final retry-key/deadline review delta: exit 0, **2 files / 17 tests passed**, Vitest duration 58.41 seconds.
See [tests.txt](./tests.txt) for raw output. The wrapper waited 7m21s at stack-admission,
then ran in database `wsx_8502d619f3179b662701` / Compose project
`wsx-8502d619f3179b662701`, peaked at 6 connections, and completed cleanup in 1 second.

The expanded tests include production dependency injection and HTTP enqueue through a
real local HTTP model, private-parent owner/intruder authorization, failed-only retry,
concurrent explicit-key replay, conflicting replay rejection, tenant isolation and parent
ownership, competing claims, persistence across adapter reconstruction, stale-running
failure and rejection of late terminal writes. Memory adapter parity is also checked.

An intermediate typecheck found a missing required logger err field, which was fixed.
A later typecheck was stopped to relieve host overload after its output descriptors were
verified to point to this task's log. That interrupted run is not a passing typecheck claim.
An earlier architecture lint passed (1220 files); final integrated gates remain the main
agent's responsibility. No second heavy verification was launched after the final result.

The subsequent deterministic retry-key and provider deadline refusal changes have added
regression assertions but are pending the main agent's unified rerun. Only generic HTTP
and the trusted deep-agent text-only provider are permitted, and their configured timeout
must leave at least one minute before the existing stale-running threshold. Unsupported
providers or longer timeouts fail before any model call; no heartbeat is claimed.

## Final delta verification (main agent)

The final retry-key and provider deadline changes passed the unified isolated command:

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/subtask-run-store-real-db.test.ts tests/agent-runtime/subtask-run-queue.test.ts tests/agent-runtime/deep-agent-resume-forwards-skills.test.ts
```

Exit 0, 3 files / 27 tests passed, 57.21 seconds; raw output is `final-tests.txt`.
Database `wsx_d11be3c11e7a3c148c88`, peak 8 connections, wrapper cleanup completed.
This includes trusted execution-mode forwarding, preserved background callback configuration
on fresh/resume, private parent authorization, deterministic human retry and deadline refusal.
Python graph/tools/harness/selector/package/backend regression separately passed 143 tests
in 13.78 seconds (fake models); later adapter-only limit validation has its own E003 evidence.
Independent reviews of authorization, claim order and injected call identity were resolved.

## Remaining capability boundaries after this increment

This covers text-only subtask results; artifact generation, parent cancellation propagation,
resource cleanup policy and richer permission/version snapshot requirements from the complete
WX-T042 catalog are not claimed complete by this adapter increment. Recovery requires a later
tenant kick/query, not an unattended global restart sweep. Existing model provider configuration
and the parent's pinned model are used; no fallback provider or additional tools are granted.

## Permission-path pre-push gate fix

The two exact infrastructure paths are registered in the existing permission-path exception
map, with `checkSubtaskPermissionBoundary` executed by that same lint gate. No dummy Guarded
import or fabricated user decision was added. Queue claims and fixed-version model inputs
are system operations; user reads and retries retain the actual parent Chat authorization.

The check limits SQL to the relevant tables, requires static statements inside
`withTenant(orgId)` and explicit org predicates, verifies the tenant-matched pinned version
join, preserves text-only/no-parent-thread execution, and checks that list/retry call the
existing parent authorization before reading rows. The gate also requires both the mutation
test file and the existing real DB/HTTP evidence test to remain present.

Executed from `apps/api`:

- `node --test scripts/tests/subtask-permission-boundary.test.mjs`: 7/7 passed, including
  mutations removing tenant predicates, tenant transaction, parent authorization, fixed
  version join and text-only boundary. [Raw output](./permission-boundary-tests.txt).
- `pnpm lint`: exit 0. [Full API lint output](./permission-lint.txt).
- `node scripts/lint-permission-paths.mjs`: exit 0 after the final evidence-presence check;
  1223 files and 195 tenant tables scanned. [Output](./permission-paths.txt).

The structural checks support the narrow exception; they do not replace the real private
owner/intruder and cross-organization tests described above. No new runtime permissions or
changes to the main-run protocol were introduced by this gate fix.

## PR2869 migration replay correction

CI exposed non-replayable CREATE statements in the new subtask migration. Added
IF NOT EXISTS to its table/index creation and drop-then-create for its exact tenant
policy. The companion MCP schema migration now uses ADD COLUMN IF NOT EXISTS.
No unrelated migration or permission grant changed; ENABLE/FORCE RLS remains explicit.

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api migrate:check
```

Exit 0: this worktree's 202 migrations applied from empty, then every file force-replayed;
schema digest identical and all files recorded. The existing digest explicitly includes
pg_policies definitions and pg_class relrowsecurity/relforcerowsecurity, so replay
preserved tenant policy and enabled/forced RLS state. Raw log: `migrations-replay.txt`.
Wrapper cleaned its own stack; total 10 seconds. git diff --check also passed.
The CI report mentioned 204 files; this evidence is deliberately limited to the actual
202-file local worktree and does not claim the merged CI checkout was tested locally.

## PR2869 merged-CI deadline drift and regression repair

The old CI head was 749969d770d8b1beefed04a57e460ca90606fd6c, but actions/checkout
actually tested merge a39716c7 against base a6c7c4b6f35b20eabbdb9fb3a442d03cd3582f5d.
The merged ports.ts changed the peer main-run stale deadline to two minutes (head/local
had twenty). Both failed subtask success tests rejected execution with
`subtask_provider_timeout_or_execution_mode_unsupported`. This was a production coupling
bug, not a reason to accept failed results. Derived tasks now own one twenty-minute
SUBTASK_STALE_RUNNING_THRESHOLD_MS in subtask-run-queue.ts, shared by PG recovery and
executor timeout validation; peer main-run configuration is untouched.

The real DB test now substitutes the observed two-minute main-run deadline and still
requires the 180-second configured child to complete. Seven tests pass, including real
HTTP model invocation, tenant/private authorization, stale recovery and long-timeout
rejection. No completed expectation was relaxed.

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/deep-agent-produces-files.test.ts tests/mcp/new-tool-defaults-closed.test.ts tests/agent-runtime/subtask-run-store-real-db.test.ts tests/agent-run/deep-agent-flags-removed.test.ts tests/kernel/permission-propagation-six-paths.test.ts
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/subtask-run-store-real-db.test.ts
```

Initial targeted set: 73/73 pass after correcting stale scope-key/schema-fingerprint/
backend-signature/permission-exception expectations. After the actual deadline fix,
seven real DB tests pass again; final counterexample run with the two-minute peer
constant also passes 7/7 (`ci-main-deadline-counterexample.txt`). All wrappers cleaned
their own stacks. Permission-path lint passes (`ci-permission-lint.txt`), diff check passes.
The exception regression names the two reviewed T042 files and requires their structural
boundary helper in addition to the revised limit of 91. The flag regression continues
to require unconditional TaskClassifierMiddleware and rejects conditional spread.

## Peer v1 parent cancellation adapter

PgChildRunCanceller is bound to CHILD_RUN_CANCELLER and delegates to the same tenant
subtask store. cancelChildren validates the durable parent's cancel_requested_at-derived
requestId under a parent row lock, changes only pending children to cancelled and reports
running IDs as pending. readCancellation only selects; even remaining pending children
prevent confirmed. Missing parent, foreign org or forged request returns unavailable.
No peer main-run cancellation/lease state is changed by this adapter.

Enqueue now locks the same parent before insertion and refuses cancelled parents. Claim
locks candidate parents in stable ID order with SKIP LOCKED before claiming their child
rows; cancelled parents' pending work is cancelled instead of dispatched. No parent
lookup is performed after a pending-child row lock, avoiding opposite parent/child lock
order with propagation. Existing running work is not advertised as remotely aborted.

Test-first missing-adapter failure is recorded in parent-cancel-red.txt. Final command:

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/subtask-run-store-real-db.test.ts tests/agent-runtime/subtask-run-queue.test.ts
node --test apps/api/scripts/tests/subtask-permission-boundary.test.mjs
```

20/20 API tests and 8/8 boundary tests pass. DB tests hold an uncommitted parent cancel
update while starting a late enqueue and attempting claim: claim returns no children,
commit makes enqueue reject, and a later claim cancels pending work. Tests also check
request identity, cross-org denial, read leaving pending unchanged, pending-to-cancelled,
running-to-pending confirmation and actual completion-to-confirmed. Wrapper cleaned its
stack. No running cancellation/remote-stop confirmation is claimed.

Permission exception count stays 91: the new adapter contains no SQL. Existing store
exception permits only narrowly scoped agent_runs cancellation identity reads, with
mutation counterproof against reading parent content or scanning unrestricted parents.
Full repository permission lint currently reports unrelated newly merged peer paths;
this component's precise boundary tests pass. No broad allowance was added.

Final follow-up: authenticated late callbacks and human retries now map only the typed
SubtaskParentCancelledError to HTTP 409. The shared EnqueueSubtaskRunFailure enum supplies
the sole allowed sanitized reason SUBTASK_PARENT_CANCELLED. Other errors are not broadly
mapped. A real HTTP callback holding the internal shared key after durable cancellation
receives 409 with that reason and produces no additional model request. Production Nest
DI is asserted to resolve PgChildRunCanceller. Final same two-file command passes 20/20;
raw log parent-cancel-final.txt. The wrapper cleaned its stack. Boundary tests also
explicitly reject writing parent lifecycle columns from the child store.
