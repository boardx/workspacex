# Step 6 — maintenance A-route host adapter

Scope: the frozen 9b maintenance release only. The root entry supplies its exact
source/baseline/migration/attempt binding. No production commands ran in this work.

## Input and output

`bindARouteHostOperations` takes the existing `HostBinding`, source-owned compiled
callbacks, hash-bound hold command runner, and protected input admission. It
returns the existing `ARouteOperations`; it does not add a release
platform or a plan-deserialized command registry. Admission snapshots callback
implementations and command binding before protected verification, validates all
required capabilities, and rejects missing candidate transport before lock/hold.
The existing `runARouteMaintenanceRelease` remains the coordinator.

The adapter implements actual hold command protocol (`create`, independent `read`,
CAS `clear`, independent cleared `read`) and precise identity/generation binding.
Other callbacks must collect their own live facts and implement their transport;
a receipt containing `true` cannot supply a missing callback.

## Ordering, retry and failure

Preparation and prehold recovery/isolated acceptance precede hold. Current-epoch
recovery and current-epoch isolated candidate acceptance precede exact migration.
Held readback and staged candidate runtime identity precede durable candidate
resume intent; candidate-only resume and independent resumed proof precede public
acceptance; public acceptance precedes CAS hold clearing.

Transport-owned commands supply durable idempotency under the exact attempt.
The adapter is scoped to one run; repeating an attempt requires freshly bound
operations and fresh live evidence, rather than reusing cached observations.
A lost create response can reconcile via an independent held read. Generation
change or failed clear readback is unproven, so the coordinator retains the lock
and records reconciliation. No auto retry of writes is added.

Pre-DDL cancellation requires a fresh no-commit proof, unchanged baseline resume
and independent baseline verification. After migration intent (including lost
migrate response), never resume baseline: block candidate writers if resume intent
exists, prove blocked writes, retain hold/lock and require reviewed database
recovery. This adapter does not claim image rollback can restore migrated data.

## Backlog and root integration

Completed: concrete hold CAS transport; complete A-route capability binding; callback
and command snapshot; all-op identity gate; local success/failure tests.

Root-owned integration: `HostPrimitives.aRoute?: ARouteOperations`; dispatch it
through `runMaintenanceRelease` after trusted startup admission, before legacy
hold callbacks; optional typed A-route input in `typed_operations`; the production
consumer may supply it only when compiled source-owned actual transports exist.
Keep the current activation hard rejection until the real path exists. Do not map
legacy `resumeWrites` onto `resumeExactCandidateWriters`.

Actual candidate and pre-DDL cancellation transport implementation is described
below. Remaining readiness blockers are aggregate current-held-epoch producer
wiring and production plan/profile inputs; a fixture cannot authorize production.
Actual production execution requires separate review.

## Local validation evidence

`node --import tsx --test packages/cloud-deploy/src/cn-maintenance-host/a_route_adapter_test.ts packages/cloud-deploy/src/cn-maintenance-host/a_route_test.ts`
passed 15/15 on 2026-10-04 (8 adapter + 7 coordinator). Covers complete success,
missing candidate transport before lock, identity mismatch on every operation,
generation drift, pre-DDL cancellation, post-resume failure, failed clear readback,
and callback replacement during admission.

`node node_modules/typescript/bin/tsc --noEmit -p packages/cloud-deploy/tsconfig.json`
passed. A first `pnpm --filter @repo/cloud-deploy typecheck` hit automatic package
manager bootstrap writing outside workspace; direct installed TypeScript avoids
that unrelated bootstrap. No real SQL, host runtime, public browser or recovery
was exercised. Tests prove protocol behavior only, not production readiness.

## Retained actual candidate host transport (follow-up)

`.harness/scripts/vm/candidate_host_transport.py` now supplies actual commands and
live proof consumers over the existing retained HostTransport and Journal:

- Reuses existing diagnostic connections with fixed `candidate-sessions`,
  `migration-ledger`, and `run-drain` query IDs. No new connection opens.
- Requires fsynced completion-intent/completion-durable journal references, rereads
  the exact private validated completion bytes, and hashes freshly queried sorted
  name/checksum ledger rows before reopening candidate writes.
- Verifies exact Docker ID/image/config, Compose service/file/hash and source
  artifact hash. Only candidate containers may start/unpause; baseline containers
  never receive a start command.
- Reuses `login_cas_sql` with live role state, peer identity and per-database
  existing control clients. Candidate admission and closed admission have separate
  independent readbacks; reblock continues trying all database/container actions
  after a lost reply, then requires live closed-session proof.
- Reuses exhaustive existing process/unit/container observations and
  CandidateBackendCollector's joint PG/socket/cgroup witness. Unknown processes
  and containers remain blockers; only exact bound candidate containers/cgroups
  are added to the known set.
- Uses real CLEARED hold observations through `collect_opened` after public open;
  never relabels a cleared hold as held. A failed public-open observation can bind
  a new live HELD generation only for reblock and verify-blocked. The original
  frozen plan remains unchanged and resume is permanently disabled before
  recording the old/new generation transition, including journal-failure cases.

`RetainedCandidateActor` is the source-owned fixed dispatcher. Its immutable
private input is
`/etc/workspacex-cn/maintenance-candidate/<source>/<attempt>/candidate-plan.json`
with envelope `{schemaVersion:1,toolRevision,plan,artifact:{path,sha256}}`.
It validates frozen APP/BASE, current actor identity/tool revision, source baseline
writer closure and raw input SHA on every operation. Only these operations exist:
`verify-staging`, `resume`, `verify-resumed`, `block`, `observe-opened`,
`rebind-held-epoch-for-reblock`, `verify-blocked`.

The response is `schemaVersion:1`, `kind:candidate-host-operation`, exact identity,
operation, raw reference `planSha256`, canonical `candidatePlanSha256`, optional
`observationSha256`, actual `holdState`, `ready:false`, and
`productionAvailabilityProven:false`. The parent integrates dispatcher calls into
its single retained actor; this module has no CLI or import-time host actions.

Additional local test evidence:
`PYTHONPATH=.harness/scripts/vm python3 -m unittest test_candidate_host_transport test_candidate_writer test_candidate_backend_collector`
passed 47/47 on 2026-10-04. Twenty-three new transport/dispatcher/cancellation cases cover actual
command selection, source closure, private input drift, live ledger drift, missing
durable completion, missing query capability, foreign sessions, unknown process
retention, failed container pause with continued SQL cleanup, new hold epoch only
for reblock, failed journal disabling resume, and cleared hold collector proof.

Root integration obligations (verify their final source state before readiness):
attach the fixed query ID to the existing Python/CJS diagnostic whitelist; bind
these modules into trusted tool/profile closure; cache one RetainedCandidateActor
in the existing host actor and wire TS lifecycle requests; provide fresh
source-owned authoritative RDS serverless-no-TLS evidence via
`HostTransport.read_candidate_transport_evidence(db)`. Source checks still reject
an absent authority. No real production transport, SQL, container or provider
calls were executed by these tests.


## Pre-DDL unchanged-baseline cancellation

`RetainedBaselineCancellation` reuses the same host, WriterFenceAdapter and
Journal. It is independent of acceptance-bound `resumeWrites`; no protected
acceptance check is relabeled or bypassed for a candidate deployment.

`verify-no-migration` requires the source-pinned migration authorization's exact
baseline ledger, freshly reads the retained diagnostic client's ledger, proves
writes blocked before and after that read, and rejects every durable migrate,
recovery or candidate-resume intent. Root must journal `migration-intent` before
calling any actual migration SQL, so an uncertain response can never restore the
old baseline simply because no completion receipt exists.

`resume-baseline` validates the exact captured prior image/config/host/admission
and unit closure, durably journals its own resume intent, then uses existing
`HostTransport.apply` for only the prior baseline containers, prior automation
state and prior role admission. `verify-baseline` independently observes the
unchanged exact prior runtime and admission before the controller may clear hold.
Any lost reply retains hold/lock and prohibits automatic retry. This route cannot
restore an old runtime after migration intent or recover migrated databases.

Its response is `kind:baseline-cancellation-operation`, exact identity/operation,
canonical baseline `planSha256`, optional `observationSha256`, `holdState:held`,
`writesHeld:true` only for the no-migration proof, `ready:false` and
`productionAvailabilityProven:false`. Six new local tests cover success without
acceptance receipt, migration intent despite unchanged ledger, live ledger drift,
prior image drift, failed durable resume journal, and partial resume response loss.
All 47 Python tests across transport/writer/collector and all 17 current TS
adapter/A-route tests passed, followed by the package TypeScript check (exit 0).

## Typed A-route factory composition

`a_route_factory.ts` adds `createARouteFactory(ARouteFactoryInputs)`, an explicit
source-code composition seam. It does **not** connect the real production entry or
supply missing producers. Every named consumer group needs exact identity/tool
revision, a profile-bound source executable, nonempty hash-bound private input
refs and an actual `assertCapability` implementation. Missing producer, candidate
binder, public observation or retained lifecycle method rejects before lock/hold.
Consumer implementations and bindings are snapshotted before admission I/O.

Root integration inputs are:

- `binding`: the original hash-bound HostBinding, `toolRevision`, and the current
  trusted profile's `installedFilesSha256` (including the hold helper).
- `run`: protected fixed command runner; `assertInstalledSource`: protected
  executable closure verification; `readEvidence`: protectedPrivateJson using
  **both** reference path and expected raw SHA.
- `acquireReleaseLock`: inherited lock validator/release only. The factory owns
  `lifecycle.closeAfterAccepted`; do not wrap a second lifecycle close around it.
- compiled groups `offline`, `prehold`, `epoch`, `migration`, `heldReadback`,
  `candidate`, `writer`, `public`, `disposition`. These are source-created functions,
  not private JSON methods, command registries or readiness booleans.

The `epoch.captureAndVerify` result points to a persisted epoch manifest. Its
manifest contains all result fields except the self-referential `epoch` ref and
uses kind `held-current-epoch-manifest`; independent reread/hash must match it.
Three database refs plus object recovery are mandatory. A newly changed hold
forces reconciliation rather than accepting a prior epoch. Epoch acceptance must
complete before migration. Completion and sealed candidate plan are independently
reread/hash bound; candidate input must contain the same epoch, hold generation,
identity and completed migration hash. Candidate reference binds only after
staging/sealing, exactly once, through the same lifecycle's
`bindCandidateReference`. Resume requires the same retained actor's fixed
`prepare-resume-intent` operation; no opaque candidate bind/persist callback is
accepted. Host opened observations run before **and after** public samples.

The factory uses legacy held writer proof only before candidate binding; after
binding it uses candidate `verify-blocked`, retaining exact candidate/session
closure. Recovery disposition is attempted before retaining the driver, and
retention occurs even if the disposition journal itself fails.

Still required in root's actual source assembly: epoch capture/isolated replay
producer, held diagnostic readback, exact paused/stopped candidate stage/seal,
actual stage/seal consumer using the implemented one-time late candidate binding
and durable resume-intent lifecycle operations, real public identity/canonical/browser/observation transport, and safe
close-only reblock/reconciliation channel after retained proof rejection. Every
such source consumer must prove actual capability at admission; a callable
placeholder that throws only after holding writes is not a completed integration.
The existing schema1 production hard rejection remains intact until the strict
schema2 factory route and all these actual consumers are present.

Validation: `node --import tsx --test packages/cloud-deploy/src/cn-maintenance-host/a_route_factory_test.ts`
passed 21/21; package TypeScript check exit 0. Tests include capability omission,
boolean substitution, identity/profile mismatch, old epoch, hold drift, missing
objects, unpersisted epoch receipt, different completion epoch, foreign candidate
plan, illegal stage/resume order, composed opened observation failure with
rehold/reblock, and implementation replacement during admission. Tests are local
injected source consumers only; they cannot demonstrate production readiness.


### Step-four collection versus qualified factory manifest

The new step-four collector returns kind
`current-held-epoch-evidence-collection`, a semantic `epoch` hash, flattened
component `evidenceRefs`, and explicit `qualified:false` with
`remainingTransport:retained-scoped-backup-transport-required`. It does not return
the factory's `held-current-epoch-manifest` aggregate refs, nor prove the missing
actual capture transport. Direct kind renaming or setting qualified is forbidden.

A future source-owned manifest consumer must first use the real scoped-backup
qualification transport, binding collection raw SHA, semantic epoch, exact held
actor/host/generation and primary proof refs. It can then persist three database
aggregate manifests, the object recovery manifest, and a qualified epoch manifest
with actual independent before/after held observation hashes. The factory uses
that qualified manifest's **raw SHA** to bind migration completion and candidate
plan. The original collector's semantic epoch remains an explicit provenance link
in the qualified producer inputs, rather than being confused with a file hash.
Until that actual transport/consumer exists, the factory epoch consumer's
`assertCapability` must reject before lock. Existing collection files remain
unqualified; no actual replay or capture is resumed by this composition work.


Factory candidate reread now requires exactly four envelope keys:
`schemaVersion`, `toolRevision`, `plan`, `artifact`. The artifact has exactly
`path` and `sha256`, a protected private path, and its SHA must equal the plan's
required `artifactSha256`. Full native candidate-plan validation remains in the
retained actor. Five additional negatives cover missing artifact, extra wrapper
field, artifact hash mismatch, extra artifact field, and missing plan artifact
hash; each prevents bind/resume and retains the post-migration recovery state.
The factory suite now passes 21/21 with package TypeScript exit 0.

`current_epoch_manifest_consumer.ts` now provides the source-bound qualification
admission gate. It independently reads raw-hash protected collection/recovery/
canonical/journey/object references, binds frozen APP/BASE, host, semantic epoch,
held generation and isolated target, and invokes the exact hash-pinned existing
`cn-maintenance-recovery-evidence-verifier.py --maintenance-evidence-replay`
consumer. Collection remains `qualified:false` with its original kind. The
verifier independently checks actual backup metadata and ciphertext, restore
execution, catalogs, complete roles/ACLs, sequences, versions and row streams.
Its source-owned `admission_result()` currently rejects unconditionally; the
prehold path also unconditionally rejects artifact provenance qualification.
The new gate therefore rejects even a mocked successful command returning
`qualified:true`. It never publishes a qualified manifest or returns READY.
The canonical/journey/object references are required inputs, **not** accepted
boolean certificates and not substitutes for missing formal qualification
consumers. Ten local tests exercise fixed invocation and fail-closed boundaries.

Remaining implementation: source-owned common-held-epoch provenance, complete
object recovery and formal six-journey qualification consumers must validate
actual artifacts before a qualified publisher becomes reachable. Only then may
it write database/object aggregate refs and the factory's
`held-current-epoch-manifest` through an O_EXCL 0600, file-and-parent-fsync writer.
That publisher is deliberately absent from this gate: an unreachable writer is
not evidence that current sources can qualify an epoch. No production evidence
was captured or replay restarted.

Schema2 now has a separate real qualification validator:
`.harness/scripts/vm/current_epoch_qualification.py`. This supersedes the
schema1 gate's publisher limitation only for the new schema2 contract; the old
recovery admission guards and old TS gate continue to reject. The validator:

- Recomputes the original unqualified collection from its protected actual input
  and source bytes; requires an externally approved source-policy reference.
- Hashes the loaded verifier/module closure and all root-policy-approved
  invocation source/executable/input/output bytes. Invocation records bind the
  producer identity, PID/start, namespace IDs, start/end times, provider binding,
  owned-child join and successful exit. Every nested proof/body/content reference
  must be declared as a protected invocation input.
- Executes the existing recovery `replay`, backup `permission_gaps`, conservation
  `produce`, `verify_outer` and `verify_result` consumers. Permissions must match
  the actual backup catalog. Three pinned pg_dump backend attestations use the
  existing implementation-attestation contract with **sqlObserved:false**;
  precheck PID and a claimed foreign-session read-only value cannot replace it.
- Requires the same logical held epoch across the three backups, actual
  ciphertext/metadata/fidelity equivalence, before/after drained observations and
  a monotonic durable held interval journal with no reopening. Capture invocations
  must fit entirely inside that held interval.
- Compares source before/after and restored versioned object inventories, exact
  scope and source-facts hashes, and actual restored content bytes. Verifies all
  eight isolated stages and six formal journey request/response/body artifacts.
- Writes three database aggregates, an object aggregate and the exact factory
  epoch manifest only after all validation, using existing O_EXCL 0600 publication
  with file and parent fsync. It returns `CurrentEpochEvidence`; the epoch SHA is
  the actual manifest byte hash. The semantic epoch remains in aggregate binding.

The new TS `consumeQualifiedCurrentEpochManifest` invokes only the fixed
`--qualify-current-epoch` source command and independently rereads the manifest,
three aggregates and object aggregate by raw hash. It does not accept READY or
qualified booleans as substitute outputs. Sourcepolicy belongs to root authority,
not the input plan. The standalone root profile entry is exactly
`currentEpochQualification: {schemaVersion:2,sourcePath,sha256,input,sourcePolicy}`;
refs in Python evidence carry `path,sha256,bytes`. Input and output locations are
fixed under `/etc/workspacex-cn/maintenance-evidence/APP/attempt/`, with
`qualification-input.json` and `qualified-current-epoch/` respectively.

Source-only validation: 19 new Python qualifier tests, 70 combined underlying
Python tests and 60 combined TypeScript factory/adapter/A-route/consumer tests
pass. The complete positive uses disposable actual local files and approved
mock invocation records, not production evidence. Actual retained backup capture,
source-owned provenance recording, formal journey transport and installed
hash-bound Python dependency bundle integration still must be supplied by root;
missing actual records hard-reject. This does not restart the paused baseline
replay or establish production qualification/readiness.

The qualifier now imports `epoch_recovery` through root's fixed FD module finder;
there is no production sibling-path fallback. `CURRENT_EPOCH_PYTHON_MODULES`
strictly binds all 12 dependency names, installed paths and source-profile hashes,
including the canonical-plan/input dependencies. The Python consumer verifies
actual loaded FD bytes for that complete closure plus its own source. Four
additional TS negatives reject missing/extra modules, changed hash and changed
path before invocation.

The qualifier source-policy closure now distinguishes required verifier imports
from approved artifact producers. All 13 verifier sources remain mandatory and
are checked against the actually loaded FD bytes. Additional producer sources
are admitted only by a fixed reviewed filename allowlist: retained capture,
backup host/backend observer, invocation receipt recorder, opened health and
acceptance receipt producers, existing isolated capture/conservation/recovery
engines and object inventory/restore sources. Extra files are read by protected
raw SHA, never imported or executed by policy JSON; the CLI also requires every
extra SHA to match the root source profile. An invocation must reference the
exact source/executable of its approved producer and an actual source-policy pin.
This permits true producer attribution rather than falsely naming the verifier.
Five additional tests cover admitted actual producer bytes and rejection of an
unlisted file, extra-source hash drift, missing producer pin and false attribution.

`verify_existing_qualification(p, reader, externalSourcePolicyRef)` now repeats
all qualification checks through the same private source path as `qualify`.
Its fixed internal publication mode constructs the exact canonical expected
bytes for the three database aggregates, object aggregate and epoch manifest;
protected reads must match their expected path, byte length and raw SHA. It
never invokes a caller writer, creates a missing output, overwrites a file or
renames the output root. Final input/output stat-and-hash rechecks are retained.
Ordinary `qualify` still exclusively publishes and rejects existing paths through
O_EXCL. Seven new tests cover read-only success with unchanged bytes/inodes/mtime,
input/policy/aggregate/epoch drift and absent output without reconstruction.
The dedicated qualifier suite now has 31 passing tests.

Actual installed code now has its own `QualificationCodeAuthority`, constructed
from independently pinned root profile data. `qualify` and
`verify_existing_qualification` accept the keyword `code_authority`; source-policy
JSON cannot construct that authority. Only fixed approved installed source paths
under `/usr/local/lib/workspacex-cn/` may be read at root-owned mode 0700, and the
independently pinned resolved `/usr/bin/python3` runtime at mode 0755. Evidence
still uses the unchanged attempt-scoped 0600 `ProtectedArtifacts`. Source refs in
invocation inputs may use this code branch only when their exact path/hash is
approved. Every code read checks parents, owner, mode, single link, O_NOFOLLOW,
opened/named stat stability, actual byte hash and final recheck. Production rejects
private-copy source/runtime self-authorization. Non-root disposable code fixtures
have an explicit API-only owner/root override; root cannot request that override.

Root profile capabilities now have exactly six fields:
`schemaVersion, sourcePath, sha256, input, sourcePolicy, executablePins`, where
`executablePins` independently maps the resolved Python runtime path to its SHA.
The separate `preholdEpochQualification` entry admits only
`--verify-prehold-epoch`, running full read-only `verify_existing_qualification`
against an existing qualified archive. It may refer to an earlier attempt, with
fixed APP/BASE and bound tool/source profile. Missing archive evidence rejects;
this command never captures, republishes or falls back to current qualification.
`currentEpochQualification` continues to admit only the exclusive publication
command `--qualify-current-epoch` after a fresh held capture. The TS source
consumer `consumePreholdEpochManifest` calls the fixed read-only command and
independently rereads all persisted outputs. Earlier archive qualification cannot
replace the current held epoch capture.

Actual local FD-bundle testing now runs Python with `-I`, loads all 12 dependencies
from open descriptors, verifies the separate 0700 code / 0755 runtime branch,
publishes five qualified outputs and revalidates them without a path-import
fallback. Additional tests cover symlinks, hardlinks, races, changed code, missing
runtime pin, forbidden root fixture override, independent capability selection
and missing prehold evidence. No production data acquisition or paused replay was
executed.

The fixed code-producer allowlist also admits
`parent_source_invocation_receipt.py`. It is protected code input only; policy
JSON never selects it for execution. The real retained parent recorder may attest
its 12 actual production capture outputs; the qualifier still requires the exact
full 32-invocation closure, including all 20 external actual producer outputs.
Missing external records cannot be replaced by parent capture receipts. A new
local test verifies the pinned recorder bytes are read without importing that
producer from policy JSON.

The runtime code-reader allowlist now includes the existing resolved
`/usr/bin/node` path alongside the required resolved `/usr/bin/python3` path.
Node requires its own independent `executablePins` SHA and the same root-owned
0755, single-link, stable-FD/hash/final-recheck metadata rules. This authorizes
runtime byte verification only, never JSON-selected execution. Unknown runtimes
and private Node copies remain rejected. Five new tests read the actual system
Node bytes through a disposable explicit code fixture, check its independent
pin and metadata failures, and revalidate a mock Node invocation. They do not
execute or claim completion of any external stage or journey producer.
