# CN MVP chain integration

`cn-release-mvp-chain.py` is an offline binding/acceptance component, not a cloud driver. It cannot dispatch workflows or produce cloud evidence.

1. An approved main workflow fixes `sourceRevision`, `controlRevision`, `releaseId`, and the content manifest SHA256. Retain existing main-ancestry/build/production gates.
2. After one build attempt succeeds, supply its GitHub run API record and **complete** artifact listing to `bind`. This selects seven exact artifact IDs, sizes and provider ZIP digests, without downloading images. Revalidation still reads the original candidate plan and verifies source/control.
3. `transfer_plan(binding, reviewed_destination_policy, candidate_plan_bytes, template_bytes, scripts_directory)` produces v3. The template must already bind exact run, verifier control, artifact IDs and original plan bytes. Destination policy, role and expiry come from the reviewed policy; no IAM scope is created or expanded. Existing nine-object OSS keys remain `runs/<run>/1/{plan,set,api,web,agent,sandbox,postgres}.zip`, `proof.json`, `policy.json`. A role restricted to an older prefix can reject a new run; report this restriction rather than change IAM.
4. Transfer workflow now accepts optional `transfer_plan` and `revalidation_template` JSON plus mandatory raw plan SHA256. Empty inputs retain checked-in v1/v2 behavior. Before federation, exact code pins, provider run identity, original plan ZIP bytes and proof template binding must pass. v3 allows a new explicit source SHA; v2 remains fixed to f0eb.
5. Production remains behind the existing immutable root-installed closure/approval. New binding is **not** a release approval. Backup/schema/content/deploy adapters must return exact bound JSON receipts, with original evidence hashes and previous receipt hashes.
6. `terminal` requires seven ordered success receipts and fixed checks for image identity, schema/content readback, tenant protection, login, permissions and fixed API behavior. Model quality is `SKIPPED`; future v2 content is `NOT_APPLICABLE`; terminal success is `SUCCEEDED_MVP`, never full business acceptance.

CLI `bind --identity identity.json --run run.json --artifacts artifacts.json --output binding.json`; `terminal --identity identity.json --receipts receipts.json --output terminal.json`. Success exits 0, rejection exits 2. Output creation is exclusive. Unknown mutation outcomes must be reconciled; no automatic dispatch retry is supplied.

Remaining integration: approved single trigger needs existing build/transfer dispatch adapters and immutable production approval bridge; stage receipts must be produced by actual components. No E2E production run is claimed by unit tests.

## Single trigger adapter

`cn-release-mvp.yml` calls `cn-release-mvp-master.py`; child dispatch uses the standard GitHub REST API with this workflow token's `actions: write`. It does not change repository settings, IAM or environments. The build, transfer and fixed-release workflows accept optional correlation `chain_id`, solely for exact run selection.

`cn-release-mvp-dispatch.py` persists intent before POST, dispatches only once, then searches the named workflow for exact correlation/main/control/attempt1 and creation time. A timeout/unknown POST is followed only by reads. Re-entering with the same intent never repeats POST. All stages share original requestedAt/deadlineAt, at most 30 minutes.

**Cold pipeline remains blocked:** transfer proof templates require actual post-build plan/set digests and artifact IDs; immutable production approval must be generated and installed after those evidence bindings exist. Current master accepts prebound request bundles and validates approval identity/hash, but refuses a mismatched new build run and reports missing final acceptance bridge rather than equating child workflow success with delivery. It is not a completed cold E2E driver. Integration needs a deterministic post-build template/approval generator plus the existing authorized root installation pathway and actual final evidence collection. Protected environments remain in force.

## Dynamic post-build inputs and root bridge

`cn-release-mvp-transfer-input.py:derive(identity, actual_run_id, reviewed_policy)` reads the precise successful build API record, full artifact list, and only the bounded plan/set ZIPs (at most 256 KiB each). It checks ZIP digests and exact member names, identical original plan bytes, source/control identity, and unchanged run readback. Producer workflow and verifier file hashes are fetched from the exact control commit. It generates the template and v3 plan for **that actual run**; no prebound old run or image download.

Master cold mode `kind: cn-mvp-cold-request-v1` takes `identity`, `buildRequest`, `reviewedTransferPolicy`, `rootBridgeStatus`. Bridge observations must report all of `fixedReleaseInstalled`, `advanceInstalled`, `controlInstalled`, `approvalStoreInstalled`, `sudoFixedEntryAllowed` true. Otherwise the master exits `ROOT_BRIDGE_NOT_READY` before dispatch. These observations do not authorize installation.

The real bridge is NOT installed as of the 2026-10-14 02:48:29Z probe. Required reviewed installation closure includes `scripts/cn-release-fixed-driver.py`, `scripts/cn-release-stage-router.py`, `.harness/scripts/vm/cn-release-advance.py`, and the complete router dependency closure, fixed command entry `/usr/local/bin/workspacex-cn-fixed-release`, root-only `/etc/workspacex-cn/release-approvals`, and narrowly reviewed runner sudo access to the fixed entry only. Do not approve arbitrary shell, caller-selected paths, or new database credentials.

After real transfer terminal evidence, root approval generation must consume exact identity/publication attempt, original requestedAt/deadlineAt, pinned codeFiles and actual proof/backup bindings using existing canonical generators. Return `NOT_READY` with a reason until root package/limited sudo is separately approved and installed. Current cold master explicitly stops at `POST_TRANSFER_ROOT_APPROVAL_BRIDGE_REQUIRED`; it cannot fabricate or install the missing bridge. Final receipt collection remains required even after a fixed-driver `CHAIN_COMPLETED` result, which explicitly does not claim production acceptance.

## Bridge increment status (2026-10-14)

The master now invokes the protected evidence bridge after transfer and after production. The read-only root portal consumes retained, content-addressed original approval and stage bytes; it never installs or grants authority. Cold preflight also requires evidencePortalInstalled and trustedEvidenceMaterializerInstalled. These caller observations are preparation checks, not proof of authorization.

The canonical approval generator accepts optional MVP metadata binding the content manifest, build run and transfer run. The portal reuses canonical fixed-driver/acquire validation before returning an installed approval. Existing approvals without MVP metadata remain valid for their original driver, but are not MVP bridge approvals.

`cn-release-mvp-evidence-materializer.py` creates an unprivileged, exclusive, private **offline proposal** from bounded original bytes. It does not verify live provider provenance, install files, or grant permission. Approval packaging requires identical retained approval-store bytes. Terminal packaging verifies seven receipts and original evidence digests structurally only. The live portal deliberately rejects terminal acceptance with `TRUSTED_STAGE_PROVENANCE_VALIDATOR_NOT_READY` until a trusted stage-specific producer/validator binds actual run IDs and independently observed outcomes. Fixture success is not production acceptance.

Remaining work: trusted post-transfer approval retention, trusted stage-specific original evidence validation, approved exact root portal/closure and limited sudo installation, then protected cloud end-to-end execution. Previous installation proposal hashes must be re-frozen for this changed closure; no previous approval is inherited. The production fixed driver still requires actual content/nonmodel stage compatibility verification. No production run is claimed by this increment.

## Original evidence and isolated stage adapters

`cn-release-mvp-stage-evidence.py` validates seven content-addressed original byte closures: canonical build artifact binding, v3 transfer proof/policy, current epoch RDS provider dispatch/task/full pagination, historical durable execution receipt/admission/manifest linkage, exact content request and readback, SQL ledger digest and nonmodel contract. Root/provider provenance is separate and always remains required; matching offline bytes cannot grant production acceptance or derive actual runtime image identity.

`cn-release-mvp-content-stage.py` invokes the fixed actual TypeScript executor in preflight/apply/readback order. An exclusive fsynced intent precedes apply, raw receipts persist, and unknown outcomes never retry. Six local process/filesystem tests cover orchestration; actual PostgreSQL tests cover executor semantics. No root-installed caller or production runtime wiring is claimed.

`platform-schema-readback.ts` is a root-controlled read-only observer of `_kernel_migrations`, comparing every name/checksum against the actual source files. It does not invoke migrations, API startup or write business data. Its new isolated PostgreSQL test rejects checksum and database drift and verifies an unchanged ledger.

`cn-release-mvp-nonmodel.py` uses fixed HTTP routes for existing scoped fixtures: login, owned project read, cross-org denial, same-org restricted project denial, unauthenticated denial, kernel health and public deployment marker. It requires three distinct **existing single-org accounts**, distinct owned resources, and a pinned trusted runtime/writer admission callback before each login and after observation. It has no CLI, caller command, credential output, model call or resource creation. Local HTTP server tests exercise real sockets; they do not prove production behavior.

Concrete现场边界: actual root historical receipts and authenticated provider readbacks; pinned installed control closure and existing migration runtime; source/image containing the actual content/schema executor; separately approved public writer boundary and existing scoped fixture accounts/resources. Library code does not bypass these boundaries. Until these are wired and verified, live terminal remains NOT_READY. Previous installation proposal hashes remain obsolete for this increment.
