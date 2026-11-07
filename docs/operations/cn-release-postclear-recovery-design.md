# T24: post-clear data-preserving recovery

Status: design, not an installed or executable production recovery policy. No cloud
or database operation was performed to write this report. The existing baseline
recovery authorization does not authorize this new recovery action.

## Actual current call chain

`a_route.ts` catches a post-open failure after migration/resume. It persists a new
hold, verifies it, calls `blockCandidateWriters` and `verifyWritesBlocked`, records
recovery-required, and retains the release lock. It does not perform data recovery.
`a_route_factory.ts` implements blocking via the existing persistent lifecycle's
`rebind-held-epoch-for-reblock`, `block`, and `verify-blocked` operations.
`candidate_host_transport.RetainedCandidateActor.dispatch` derives a close-only
plan using the new hold generation, permanently disables its resume path, and
checks stopped/paused candidate and baseline writers plus exact retained sessions.
The original host plan remains bound to its original generation.

`sealed_runtime.recoverRetainedBaseline` is a separate existing path. Python
`host_transport.recover_retained_databases` and CJS
`retained_session_recovery.recoverExistingSession` check the original source plan,
its recovery authorization, a pinned recovery plan, all three database identities,
existing sessions, and baseline backup hashes. Their explicit action is
`replace-three-production-databases-with-exact-baseline`. Their transaction and
fidelity checks are useful machinery, but that action cannot preserve writes made
after opening the candidate. Relabelling those backups as a new epoch would be
incorrect. Nor can the close-only candidate plan become new DDL authority.

## Minimum isolated scenario

1. Execute the real `runARoute` and `createARouteOperations` paths with a real
   `OriginalPlanAuthority` obtained through the existing protected-plan admission.
   External instance/Docker observations may use fixture ports. Do not replace the
   A-route state machine, generation comparisons or original authority checks.
2. An isolated PostgreSQL writer commits a unique post-clear row after the real
   clear operation. Inject failure at opened observation. Record exact committed
   row/transaction evidence, not only a flag saying a write occurred.
3. Let the real catch path create generation G2, run the original candidate
   close-only rebind/block/readback sequence, and retain FD9. Demonstrate an
   attempted subsequent write cannot commit. A generation mismatch or ambiguous
   stop result prevents all backup/restore work.
4. Under G2 and the same original authority/lock, capture three fresh databases
   plus roles, catalog and data conservation evidence. Bind old epoch G1, new
   epoch G2, original source/control/plan, candidate completion, peers and original
   post-clear failure receipt. The original G1 archive remains unchanged.
5. Restore only those new exact bytes into three separate, empty isolated recovery
   databases. Use the existing backup/restore and catalog/fidelity algorithms;
   do not change their production identity constants or approve an old baseline
   archive as the new epoch. The isolated adapter must be an explicit source-owned
   test entry, unavailable from the production CLI or untrusted plan fields.
6. Fully compare schemas/catalogs, rows and relevant sequence/role facts for all
   three targets, including the post-clear row, and repeat source/hold/peer/hash
   checks. Persist raw evidence and one-shot intents/receipts. Remain held with
   `ready:false`; a separate action would be needed to resume any writer.

This proves preservation plus a usable recovered isolated database, not permission
to replace the production databases or run the baseline application against a new
schema. A repair-forward or backwards-compatible application choice is outside
this test; restoring an old dump and discarding the new row is always a failure.

## Necessary small implementation seams

* For this task the admission is fixture-only and descends from the real
  `OriginalPlanAuthority`, under the same release lock. An explicit isolated test
  binding pins the three loopback source/target peers, fresh empty target names,
  G1-to-G2 relationship, exact source/control/plan, byte/time limits and one attempt.
  It grants no production data action. The library must reject production paths,
  non-loopback targets, original source-target aliases and untrusted JSON selecting
  a test mode. Production entry points cannot select this adapter. Any future
  production post-clear recovery policy is out of scope and remains unavailable.
* A recovery coordinator should consume the actual stopped/reheld evidence and
  capture the new epoch before any destructive operation. It needs an explicit
  same-authority close-only view of G2; simply rewriting `host.plan.holdGeneration`
  would invalidate the original seal and is not acceptable.
* Keep the existing baseline recovery default untouched. Share lower-level
  transaction/restore/fidelity functions through explicit internal interfaces if
  needed; never patch source strings, change a production RDS constant in tests,
  or fake canonical success fields from an aggregate fixture result.
* The source disposition currently exposes only `recordRecoveryRequired`; there
  is no continuation capability or result schema for the data-preserving action.
  For the isolated scenario use a separate fixture-only continuation, not an unconditional recovery callback
  inside `recordRecoveryRequired`. Unknown state keeps the owner alive and cannot
  automatically repeat capture/restore/commit.

Proposed isolated ownership: new `postclear_recovery` module and its tests, plus a
new independent PostgreSQL harness/fixture directory. Existing T22, runner and
`cn-postgres-lifecycle` author files stay untouched. Any shared original-core
refactor must first identify exact files and receive ownership coordination; the
currently frozen native/terminal checkpoint must remain unchanged.

## Required counterexamples and evidence boundary

Tests must cover an old-epoch archive, wrong G2, foreign original authority or
peer, writer-stop ambiguity, changing source during capture, missing one database,
partial restore, commit reply loss, incorrect complete readback and expired policy.
Each must keep the hold/lock, forbid baseline resume, preserve the source/new data,
and refuse automatic replay. A successful isolated recovery must demonstrate the
new row in the recovered target, not merely demonstrate rejection of rollback.

The initial design review ran no new PostgreSQL scenario. Existing A-route tests
cover rehold/reblock and retained recovery disposition with fixture operations;
existing lifecycle tests do not establish this complete data-preserving chain.
T24 therefore remains open until original control code and real isolated SQL are
connected and independently verified on Linux.
