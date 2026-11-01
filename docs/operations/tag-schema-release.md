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
check found all three unapplied. US's failure code proves schema drift only; it
does not independently prove its ledger contents.

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
