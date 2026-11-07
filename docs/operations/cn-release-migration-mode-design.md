# Explicit migration release mode (inactive implementation proposal)

Status: design and offline contract only. No production installation, new permission,
resource purchase, policy issuance or migration execution is authorized by this file.
The installed continuation CLI still accepts runtime-only scope. The PG fixture bridge
reuses its journal core but is not the production migration router.

## Existing interfaces to reuse

| Component | Actual interface | Required boundary |
|---|---|---|
| Held epoch backup | `.harness/scripts/vm/cn_backup_package.py:validate(plan, now, expected_identity=...)` and `dump_command` | Exact admitted identity, backup lease, database/object inventory; not a build archive |
| Isolated restore | `.harness/scripts/vm/isolated_rehearsal_restore.py:run(payload)` | Exact isolated target, backup artifacts and original fidelity; cannot restore over production by changing a path |
| Candidate plan | `.harness/scripts/vm/candidate_plan_producer.py:produce(inputs, transport, ..., expected_identity=...)` | Root reference closure, same epoch/host/hold generation, live sessions/hold/runtime seal; recomputes original epoch evidence |
| Migration action | `packages/cloud-deploy/src/cn-maintenance-host/migration_transport.ts:boundExactMigrationAction(inputs,binding,runWriter,lifecycle,authority)` | Real `OriginalPlanAuthority` capability, pinned writer plan/config/executables, actual TLS peer/role, persistent migration intent/ledger |
| Pre-DDL admission | `verifyBaselineMigrationAdmission(raw,validatedRaw,id,now)` | Exact source/base/plan and original full prebuild evidence; build readiness never grants DDL |
| Completion | `.harness/scripts/vm/candidate_completion_contract.py:verify_completion(value,bound,rows,now,expected_release=...)` | Approved release from root chain, original plan, current ledger and no drift/pending/unknown; its completion alone does not authorize mutation |
| Writer resume | Existing terminal + conditional/static A5 | New mode must bind the migration and current epoch facts. Existing runtime-only policy cannot be promoted to migration permission |

## Smallest new contract

Add a separate `cn-reviewed-additive-migration-v1` authority, not a new value in
caller-controlled runtime JSON. A trusted installer must separately pin the complete
raw authority SHA. It binds exact source/base/control, target, attempt, five image
digests, migration plan raw SHA, database epoch, hold generation, current authority
raw SHA, complete code closure, issued/expiry, and a maximum 30-minute release budget.
These are exact equality constraints, not independent revision allowlists.

`normal`, `no-schema`, and `hotfix` retain the current runtime-only route. Their
migration inventory must prove no pending DDL through the existing canonical path;
a mode name or caller boolean cannot suppress schema checks. Additive mode uses a
new fixed route and independently approved DDL capability. Destructive/non-additive,
unknown or checksum-drift plans reject before hold or SQL. A syntactic SQL keyword
filter is insufficient to establish additive semantics.

Offline contract inputs include raw approved authority plus its independent expected
SHA and a separately observed immutable identity binding. This module only checks
bytes and bindings; it does not create a root authority capability, classify SQL,
read live databases, acquire locks, sign approval, or produce execution receipts.

## Ordered production integration (not implemented by the fixture bridge)

1. Preflight installed closure, canonical original plan authority, source/base
   compatibility, exact database peer and migration inventory. No write on gaps.
2. Hold writers and drain; collect fresh epoch and original retained-session evidence.
3. Backup the same held epoch, verify encrypted artifact/readback and provider job.
4. Restore to an independently approved isolated target, preserve original fidelity,
   run canonical migration and six business acceptance with original receipts.
5. Under the existing release lock, re-read hold generation, epoch, session and plan
   hashes; create one durable intent before the production migration action.
6. Call the existing bound migration action. Unknown execution only reconciles the
   same original intent and diagnostic ledger; never reruns DDL automatically.
7. Verify canonical completion and candidate conservation, then held startup/business.
8. A5 consumes an independently authorized mode-specific policy or static grant with
   current facts; clear-hold checks revocation again at the actual driver dispatch.
9. Public observation closes the same budget. Failure follows the branch below.

All output references remain original raw bytes + hash, not reconstructed summaries.
Each actual provider/SQL/entry result must retain unknown/partial outcomes and original
request identity. The release lock and one-use policy cannot be replaced by two
independent locks or a caller-provided observer callback.

## Failure and data protection

| Boundary | Required action | Forbidden action |
|---|---|---|
| Before DDL; clean backup exists | Remain held; canonical baseline recovery only after exact same epoch proof | Unverified dump or automatic repeated mutation |
| DDL or startup failed before writers resume | Reconcile actual terminal state; restore to separate target and prove original fidelity; separately authorized recovery activation | Treating transaction rollback as proof all prior migration files rolled back |
| DDL outcome unknown | Remain held; observe original plan/ledger/process; retain intent | Retry migration or infer failure means no writes |
| After writer resume/new writes | Re-hold/drain, create and preserve a new epoch, report recovery blocked pending explicit forward/data-preserving plan | Restoring old dump over new data, silently dropping post-clear rows |
| Expired budget | Stop admitting new actions; retain unknown and exact cleanup/recovery evidence | Refreshing release TTL or replaying an old one-use authority |

## Validation and remaining delivery

The current real-PG fixture exercises additive ledger/idempotency, partial migration
failure, failed startup and preserved post-clear rows. Its application SQL contracts
are synthetic, not all application migrations or the six UI journeys. Its separate
fixture scope and actual entry journal test the seam, not installed production route.
Normal/no-schema/hotfix scenario-specific evidence still needs explicit tests.

Required new tests: old runtime authority rejects additive mode; wrong target/pair/
epoch/hold generation/plan/closure/image digest; expired/current-authority mismatch;
unknown migration no retry; pre-clear recovery verifies original epoch; post-clear
write makes old-dump recovery impossible; canonical adapters and real driver execute
against one isolated PG lifecycle; missing dependency/skip cannot pass. Linux runtime
and the exact installed closure must then pass the ten-round candidate run. T18/T19/
S05 remain partial until the real new route and these tests exist; cloud execution
and permission approval are separate from code completion.

## Concrete integration findings (source read, not hypothetical)

The preferred production integration boundary is the existing source A-route factory,
not independent Python commands for each DDL step. `a_route_factory.ts` already holds
one inherited release lock over held epoch capture, isolated acceptance, migration,
held readback, candidate staging and writer resume. `entry.ts:main` admits only the
fixed root/Linux `--run-reviewed-maintenance` launcher, profile bundle and inherited
FD9. The entry transport journal lock remains an outer dispatch lock; it is not a
substitute for the canonical release lock.

`release_identity.ts` currently admits only the exact 9b/ba and 5285/a1cb pairs.
`readOriginalPlanAuthority` checks that registry and uses a WeakMap capability with
protected profile/raw-plan rereads. A new source/base cannot bypass this by matching
the new JSON contract. The approved exact pair and generated tool closure must be
resolved explicitly, with cross-pair/third-pair tests. No broad 40-hex fallback.

A fresh held epoch and generation do not exist before hold. Separate the preapproved
policy (exact source/base/plan/target/code/images/TTL and allowed transition conditions)
from its one-use held-facts authorization produced under the same canonical lock.
The current offline contract models the latter only. It cannot be installed as a
pre-hold authority with invented future epoch values, nor can it approve itself.
The fixed evaluator must consume real original backup/epoch/current-authority bytes.

The current controller returns `Promise<void>`; process exit zero is not a durable
migration completion receipt. A new observer must read exact original completion,
held epoch/conservation and public acceptance evidence, bind their raw hashes and
terminal state, and retain unknown outcomes. Reconciliation must never relaunch the
whole A-route after an ambiguous dispatch. This observer and a fixed new-scope router
remain required implementation work, not fulfilled by the offline byte-check module.

## Local implementation checkpoint

`migration_scope_adapter.ts` now supplies a WeakMap-backed guard created only after
asserting the existing `OriginalPlanAuthority`. The original protected plan must
explicitly contain `releaseContinuation` with the new scope and an exact private
policy file reference. Policy checks include source/base/plan, control, ECS and RDS,
the five candidate image digests, original manifest and consumer-input hashes,
profile code hashes and a 30-minute maximum. Policy bytes and original authority are
reread before DDL and before resume. The held epoch is captured by the existing A-route
and latched for subsequent checks; the policy does not invent its future value.

`source_production_consumers.ts` constructs this guard from its actual authority and
protected inputs. `a_route_factory.ts` snapshots it, rejects fabricated guard objects
before lock/hold, and invokes it under its existing release lock. No optional field
preserves the historical route; this does **not** let a future new-scope launcher omit
its mandatory guard. That launcher and its complete terminal observer are still not
implemented. The guard does not itself execute DDL or issue a durable launch claim.

Local checkpoint: 48 TypeScript tests pass, including actual authority issuance,
serialized-capability rejection, policy revocation before resume and input guard
removal. SQL/cloud/provider interfaces remain local fixtures in these tests. The PG
bridge Linux execution and full new-scope route must be evaluated separately; this
checkpoint cannot close T18/T19/S05.

### Launcher lifetime conflict to resolve before route activation

`controller.ts:runHostMaintenanceRetainingFd9` deliberately keeps the process and
inherited FD9 alive indefinitely for unknown writer state or required DB recovery.
The current continuation entry's `run_command` kills its complete cgroup at its
bounded timeout. Wrapping the canonical launcher directly in that action would close
the retained lock when the timeout fires. A JSON `unknown` receipt does not preserve
that lock. No code in this checkpoint backgrounds a controller or escapes a cgroup.

The next integration must explicitly select one durable lock owner, with a single
startup intent, independent job identity/terminal observation, and readonly unknown
reconciliation. A bounded dispatcher may observe that owner; it must not silently
kill it or replay startup. Alternatively the original lock lifetime contract must
be refactored and independently reviewed end to end. This is a concrete orchestration
gap; the PG phase fixture's finite terminal processes do not exercise it.

Independent review found and fixed a fresh-facts defect: the initial pre-DDL guard
compared only the frozen epoch generation. It now reads the held generation again
and compares it to that epoch immediately before DDL admission. A real A-route test
changes both current hold and writer observation after isolated acceptance and
asserts zero migration calls. This is local fixture evidence, not a live DB run.

### Fixed owner protocol, isolated checkpoint

The proposed installed unit is `workspacex-cn-migration@<releaseSHA>.service`, with
`Restart=no` and a fixed root loader. That loader must reuse the original
`cn-maintenance-host-launcher.py` and its pinned controller, recovery preflight and
FD9 lock admission. Neither package JSON nor a caller callback can select an
executable. Installing this unit or a policy is outside this code checkpoint.

`scripts/cn-release-migration-owner.py` currently implements only the private
fixture journal protocol. A durable, fsynced, exclusive claim binds the exact
release/plan/launcher/unit hashes before the manager's single start call. A lost
acknowledgement or crash after claim never permits another start. Readonly
reconciliation requires the original claim and a matching owner-start receipt
(invocation ID, PID/start ticks, boot ID); missing or mismatched evidence is unknown
or rejected. Observing an owner is explicitly **not terminal verification**.
The public entry always rejects with `MIGRATION_OWNER_NOT_INSTALLED`.

Nine local tests include actual competing processes, crash after durable claim,
lost acknowledgement, invocation replacement, duplicate JSON, and an owner that
continues holding a real flock after a finite sibling exits. The test's outer
finally kills exactly its owned process and observes the lock becoming available.
This is a process primitive demonstration on macOS, **not** a Linux cgroup test or
live systemd verification. A Linux CI test still must put both siblings inside one
owned outer containment and prove final domain cleanup. It must not launch an
uncontained system service from a CI job.

Remaining fixed-adapter work is explicit: root installation descriptor and complete
launcher/unit/systemctl closure admission; independently validated owner-start
receipt publication; manager response identity binding; original terminal receipt
and phase-evidence validation; and per-phase deadline admission without destroying
an ambiguous lock owner. An `active` unit, an exit code or this fixture manager
cannot substitute for any of those checks. Unknown owner state never starts a
second controller, and post-clear recovery must preserve the new data epoch.

### Next checkpoint: installed adapter and canonical observer (review pending)

The next local delta implements `cn-release-migration-owner-native.py`: fixed
root-only configuration and profile pins, the exact reviewed unit fragment with no
drop-ins or pending reload, one durable claim before `systemctl start`, and readonly
observation after an uncertain response. `--own` verifies its actual systemd
invocation/PID, records start ticks and boot ID, then execs the original pinned
maintenance launcher. It does not install a unit, restart an owner, stop a retained
owner, create policy or contact a cloud API. The required independent profile
extension/configuration is not installed.

For the new scope, the canonical factory now requires a fixed terminal sink after
both opened observations and before unlocking. The source sink requires its actual
owner PID/start/boot/claim and inherited FD9, writes terminal bytes exclusively,
fsyncs them and their parent, reads them back, then publishes an exclusive seal.
Failure takes the original post-clear re-hold/recovery path and retains the lock;
there is no fallback to restoring an old dump. Old scopes keep their prior behavior.

A fixed `--verify-reviewed-owner-terminal` controller mode reconstructs the real
`OriginalPlanAuthority` and active migration policy. It reuses the existing epoch
and candidate envelope schemas, native migration completion validator, public
acceptance validators and hold CAS validator, rereads the original pinned files,
and returns evidence digests. It has no operation port, FD9 release or StartUnit
path. Systemd exit zero is never its validation input.

Author checks at this checkpoint: 113 TypeScript tests and package typecheck pass;
17 Python tests pass (9 durable/process primitives and 8 offline native protocol
checks). The Linux containment test is authored but not run on this Mac. No live
systemd installation, installed root closure or full migration release has been
validated. Independent review is pending and these files remain uncommitted WIP.

The self-identified canonical/browser receipt gap is now fixed in local code.
The source records each original fixed attempt/lane path and SHA only after reading
and validating its raw bytes. The terminal document requires both references. The
readonly verifier loads those original bytes, reuses the shared source envelope
check, binds their checks exactly to the recorded actual transport returns, and
rereads both files at the end. Their individual raw hashes are returned with the
other original evidence hashes; the native adapter accepts only that complete
output shape. Missing refs, another attempt/lane, raw substitution, foreign identity,
changed checks with a recomputed hash, and final-read drift all have rejecting tests.

The updated local regression has 119 TypeScript tests passing, no skips; package
typecheck and 17 Python tests also pass. These demonstrate local protocol behavior,
not real canonical/provider/browser success. Independent review and actual isolated
Linux/systemd validation remain pending. No production unit or policy is installed,
and this checkpoint alone does not close the full migration requirement.

The native launch gate now repeats the constructor's direct critical-file checks
immediately before a start command: approved profile/config bytes, adapter source,
entry plan, the writer plan at its pinned entry-derived path, launcher, exact unit
and systemctl. The owner-side write gates repeat them too; the original launcher
still validates its downstream controller/runtime/recovery closure. Eight individual
post-construction file mutations produce zero systemctl calls in offline tests.
The unchanged closure and exact-expiry rejection are also covered. The local Python
regression is now 19 passing tests; this is not a real systemd launch test.

Policy expiry remains conservative: readonly inspection does not extend the policy
window, and the terminal verifier cannot newly accept historical success after the
policy expires. No automatic renewal or replacement authorization is provided.
