# CN / US immutable-tag schema routing

Issue: #6079. Incident: #6078, CN run 41260346236 and US run 41260523328.

## Behavior

Production still consumes the same develop-built immutable tag and digests. It
never rebuilds images on CN or US. A canonical environment lock covers planning,
any admitted full release, verification and pointer commit.

The consumer resolves/pulls the API image first and compares actual migration
bytes from stopped baseline/target containers. A known API schema difference
rejects before downloading Agent, Web, Sandbox or Postgres unless a separately
installed full-release adapter exists. An early API result explicitly says
`schemaPlanComplete=false`: it does not assert that Agent is compatible, that SQL
is safe, or that the live database ledger matches. If API is unchanged, resolve
Agent, compare both inventories, then fetch the remaining images. Agent runtime
changes and historical migration deletion/rewrites require maintenance review.

The private attempt retains `schema-plan.json` and a public structured refusal
with added/removed/changed names and next action. Environment, tag, actual image
source SHA, old/new schema-image IDs and both inventories are hash-bound.
`schema-preparation` means preparation is required, not that added SQL is safe.
Empty, missing or malformed inventories cannot count as unchanged.

Image-only releases retain the original admission and engine's repeated schema,
source, live configuration and runtime checks. CN's fixed adapter errors are
forwarded only when the ENTIRE bounded stderr is an enumerated safe code; other
output is discarded. No raw SQL, backup material or credentials go into Actions.
Actions prints a bounded structured outcome in the job summary.

## Full schema release boundary

`schemaRelease` is OPTIONAL in the existing root-owned environment policy. It is
NOT populated by this change. There is no workflow input for a command, SQL file,
receipt, root configuration, or a schema-check bypass.

A host can separately install a reviewed writer and verifier and enable this
policy only after their real recovery/migration acceptance is complete:

```json
{
  "kind": "installed-schema-release-adapter-v1",
  "environment": "cn",
  "writer": {"path": "/absolute/root-owned/writer", "sha256": "<64 hex>"},
  "verifier": {"path": "/absolute/root-owned/verifier", "sha256": "<64 hex>"},
  "timeoutSeconds": 600
}
```

Both executable references must be root-owned, non-writable by other users and
hash-pinned; their paths must differ. Dependencies must be included in the
independently reviewed installed closure, not fetched from checkout at runtime.
The writer and verifier receive ONLY `--request <private-request.json> --receipt
<private-result.json>`, a minimal environment and the inherited canonical lock
FD (`WSX_RELEASE_LOCK_FD`). They must validate that FD against the request's
canonical path/device/inode and must not acquire a competing lock or close the
last lock while work is outstanding. One total deadline covers writer, verifier
and the consumer's runtime check; expiration never authorizes replay.

The complete request binds environment/tag/source, manifest checksum, schema plan
checksum, root-config checksum, exact images and baseline inventory, lock identity
and expiration. Its proof inputs are protected private files. The writer must
independently recheck baseline and live ledger at the last responsible moment,
not trust a historical schema inventory as live DB state.

Required writer responsibilities:

1. Independently bind the exact target images, running baseline, real database
   identity and full migration ledger; reject unknown/deleted/rewritten history.
2. Capture a current backup and ACTUALLY restore it into an isolated target. A
   successful `pg_restore --list` is not a restore test. Preserve original proof.
3. On that isolated state, execute the exact reviewed migration plan and prove
   baseline compatibility, candidate API/Agent bootstrap and business acceptance.
   Unknown or destructive SQL requires a maintenance path, never regex approval.
4. Establish/verify the write barrier and drain, recheck backup freshness and
   baseline/ledger, execute the exact migration once with durable original owner
   and transaction/commit evidence, and read back the actual post-migration ledger.
5. Activate only the requested digests, verify public business/browser behavior,
   and implement DB-aware recovery. Never claim recovery merely because old
   containers are running against an unknown/new database.

The writer's result is `schema-release-result-v1`, `status=SUCCEEDED`, with exact
`environment`, `tag`, `sourceRevision`, `planSha256`, `manifestSha256`, and `proofs`.
Proof keys are EXACTLY `backup-restore`, `baseline-compatibility`,
`migration-ledger`, `candidate-acceptance`. Each is a `{path, sha256}` reference to
a private actual proof file under the current attempt, not a `passed=true` flag.
The independently pinned read-only verifier must inspect those real artifacts and
live state, enforce original evidence/identity/expiry, and return nonzero for
fixtures, missing/stale evidence, unknown/partial outcomes or failed recovery.
It must not change the writer result; the consumer pins it across verification.

The consumer persists `pending.json` BEFORE invoking the writer. Lost ACK, timeout,
nonzero exit, missing/tampered receipt, verifier failure or runtime failure keeps
that intent and returns `SCHEMA_RELEASE_RECONCILIATION_REQUIRED`; subsequent tag
requests reject before pulling or dispatching. There is deliberately no automatic
retry or generic image rollback after a possible DB write. Only independently
verified reconciliation can establish what happened and release that block.

On verified success the consumer additionally checks actual application image
IDs, running/healthy state and the fixed business probe, then atomically commits
its own exact-image override and pointer. It never passes a schema waiver into
`minimal-docker-release.py`.

## Current production limit and rollout

As checked during this incident, CN's existing adapter provides read-only ledger
checks and encrypted backup/TOC inspection; its restore result is explicitly
`NOT_PERFORMED`. No reusable complete writer was confirmed. US has not been
qualified for a full schema release either. Therefore keep `schemaRelease`
ABSENT on both hosts. This code does not make tag 41248889927-1 deployable yet and
must not be described as completed database migration automation.

The concrete tag adds three files (no historical removals/rewrites in the CN
comparison): `20261031090000_billing_stripe_topups.sql`,
`20261031091000_billing_wechat_monthly.sql`,
`20261031150000_billing_subscription_amount_snapshot.sql`. CN's read-only ledger
check found all three unapplied. US's subsequent read-only source query also found all three unapplied
and 435 baseline ledger entries.

Rollout: merge reviewed code; stage the entire content-addressed consumer closure
with `install-image-release.sh` while preserving existing protected environment
policies and adapters; verify permissions, installed file hashes, root wrapper,
canonical lock and schema rejection/no runtime change. Never install an incomplete
Python closure. `build-cn-release-artifacts.yml` includes the new modules.
Enable the full route only in a separate reviewed environment-specific change
with writer/verifier code, actual restore/compatibility/migration/recovery proof,
exact installed closure and tested root policy. Rerun the SAME tag afterwards;
never replace the requested artifact to hide the migration requirement.

## Validation limits

Python tests cover diff classifications, exact binding, actual child-process
probe commands and cleanup, no unrelated image pulls on early refusal, no compose
switch on rejection, fixed adapter protocol, verifier/binding failures and durable
unknown-state blocking. Docker behavior is simulated in the early-probe test;
writer proofs in protocol tests are explicitly fixture-only. These do not prove
production recovery, real SQL migration, host installation or public acceptance.

## Isolated restore component

`schema-restore-rehearsal.py` now supplies the restore-and-reviewed-SQL part of
preparation. It is not a runner-facing command, source backup authority, full
writer or activation adapter. The caller must independently bind the source DB,
original encrypted backup, actual ledger, target SQL and immutable clone image.
Only the three exact SQL checksums are accepted. It restores through a kernel pipe
into a newly owned network-none/no-ports/tmpfs PostgreSQL container, checks the
restored ledger, replays the SQL in one clone transaction, verifies the expanded
ledger and removes the exact owned clone. Unknown cleanup cannot succeed. Backup
files must be private regular bounded files; raw data and keys are not uploaded.

Three real PostgreSQL 16 Docker fixture cases cover success, ledger mismatch and
corrupt encrypted archive, and verify the source fixture remains unchanged. This
is real restore/SQL execution on synthetic data, not production recovery proof.
The result explicitly says `activationAllowed=false`, old API and migration-role
acceptance `NOT_PERFORMED`: no owners/ACLs are restored in this component. A later
full verifier must not promote it into application compatibility or readiness.
It is bundled with the tools; enabling a production schema route still requires
the separate qualified source/profile/writer/verifier and actual host acceptance.


## Incident qualification progress (2026-11-01)

US production is the same instance `i-rj9117enz64hpoifa3cq`, now at
`47.254.69.39`; the operator confirmed that address in ECS and Workbench.
Operational connection examples are maintained in `deploy/us/README.md`.
No production DDL or target-image activation has been executed in this incident.

A real US encrypted source backup was actually restored into an owned isolated
PostgreSQL 16.15 container. The exact three SQL files succeeded there and the
clone was removed. Independent readback retained the original 435-entry source
ledger and baseline API image. Its evidence remains private on the host at
`/var/lib/workspacex-image-release/us/prepare-rehearsal-_cemr920/isolated-diagnostic`.
This diagnostic execution is not the failed preceding outer preparation result,
and neither receipt proves owners/ACLs, application compatibility or activation.

The operator closure now includes fixed CN/US read-only source adapters,
maintenance policy builders, stopped-writer backup/restore qualification and
transaction adapters, and separate old-application probes. Each policy is derived
from original fresh restore files and live baseline checks, not a caller-provided
success flag. Maintenance stops the five exact application containers, drains
other database connections, repeats backup/restore with writers stopped, and
applies only the reviewed SQL set in one transaction. Unknown execution retains
`pending.json` and cannot be automatically replayed. Interrupted child adapters
receive TERM and a bounded cleanup grace period before escalation.

CN's actual source rehearsal exposed two transcription errors in fixed host
bindings: the RDS hostname contains lowercase `l`, and the PostgreSQL tool image
ID must contain all 64 hex characters. Both bindings were corrected against
actual host readback, with regression tests; no identity check was weakened.
CN's complete actual source restore still needs a successful original receipt.

CN's old-application probe uses the already installed hash-pinned browser runtime
with the real HTTPS hostname resolved to loopback during maintenance. US uses
the baseline image's actual login/file/Agent/model/sandbox business probe with
the same TLS hostname routed to loopback. The US probe does not claim browser
acceptance. Both must run successfully on their actual hosts before production
DDL; unit tests alone do not establish that qualification.

These operator components do not install a general `schemaRelease` policy or
bypass the image-only schema guard. Actual migration, candidate activation,
public browser acceptance and database-aware recovery qualification remain
required before this incident can be closed.

CN source capacity qualification (2026-11-01): the actual read-only query measured
150,494,231 bytes, 435 ledger entries and the `app_rw` role. The CN source adapter
therefore accepts at most 192 MiB of database size; US keeps its separate existing
limit. This bounded adjustment uses the observed CN host capacity (16 GiB RAM,
74 GiB free disk). It does not raise the encrypted archive's 128 MiB limit, the
clone's 512 MiB PGDATA tmpfs, or its 1 GiB memory limit. Database size is not a
promise of restore fit: dump or restore exceeding those independent limits must
fail, clean up the owned clone, and leave production unchanged. Capacity readback
alone is not a successful original-source restore receipt or migration approval.


The US full outer source preparation also succeeded after the readiness fix
(using the reviewed `707f813da` source closure), with
`sourceLedgerCountBefore=435`, `sourceLedgerCountAfter=435`,
`sourceReadOnlyTransactions=true`, `sourceDatabaseWriteAttempted=false`,
`writersStopped=false` and `activationAllowed=false`. This result includes the
outer source/baseline recheck rather than only the earlier diagnostic clone.
It still explicitly reports migration-role and old-API acceptance as
`NOT_PERFORMED`; no general schema-release production policy is enabled.

### Follow-up qualification (issue #6081)

PR #6080 merged as `48ac496d59e2eb8d4026c56d0f6c20964ec5b1cc`. The CN host subsequently completed the actual encrypted source backup, isolated restore, and exact three-SQL rehearsal for tag `41248889927-1` using the reviewed 192 MiB source bound. This remains `restore-and-reviewed-sql-only`: no production SQL, stopped writers, activation, migration-role or API acceptance is implied. US had already completed the same limited qualification.

The follow-up retains owner/ACL and password-free role/catalog metadata in a separate read-only capture, and tests actual clone logins, including exact source-versus-clone PostgreSQL builtin role attributes and membership comparison. Provider authority and role-GUC/API qualifications are not inferred from a successful clone SQL transaction.

Maintenance health uses the fixed HTTPS production hostname resolved to loopback, with default curl configuration, proxy and redirects disabled; system TLS and expected health body remain mandatory. Outer public verification remains independent. CN browser fingerprints were re-read from actual bytes and cross-checked against the unchanged root-owned `cn.json` verificationFiles; two transcribed 63-character pins are corrected and all embedded fingerprints now require 64 lowercase hexadecimal characters before filesystem access. Original browser source and private env contents were not changed.

Focused verification on the final follow-up snapshot: 15 ACL unit/real-PostgreSQL tests passed in 144.378 seconds; activation and CN browser regressions passed 15/15. These timings are local fixture measurements, not measured production activation budgets.
