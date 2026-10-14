# Deterministic platform-content release contract

This lane publishes an exact, independently tested catalog to `org-platform`.
The existing image release and this content release have separate receipts.
A healthy API, successful promotion jobs, a matching `main-cn`, and the existing
login/notifications smoke **do not establish content or business acceptance**.

## Ownership and required handoff

The content developer owns agent instructions, Skill packages, Workflow graphs,
runtime implementation and the authoritative complete v2 catalog. The release
owner owns this protocol, inventory, compatibility planning, backups, execution
and independent readback. Do not use the historical 60/60/200 counts as an
unverified assertion of completeness. Do not substitute the old f0eb catalog.

The developer must deliver:

1. Exact repair commit and offline source artifact SHA-256; exact control commit.
2. A complete generated `manifest.json` plus its raw SHA-256 and independently
   reviewed catalog closure SHA-256. Check generation against the exact commit.
3. Every entity's immutable version, content digest and relative artifact path
   with byte SHA-256; all exact dependency coordinates.
4. Historical official version/digest allowlists for legacy adoption. A match
   to an old name is insufficient provenance. Include current-state CAS hashes
   from the reviewed inventory before writing; do not manufacture old imports.
5. Source-bound test results per declared test ID, actual Skill gates and runtime
   registration evidence. Loopback/structural tests are labeled as such; they
   cannot establish model quality or be converted into fake gate successes.

## Noninteractive interface

`scripts/cn-content-sync/content_sync.py` initially provides offline admission
and planning. Final evidence verification and the database writer are **not
implemented yet**.
The eventual trusted executor consumes only an admitted plan, rather than
arbitrary SQL, URLs, shell fragments, credentials or moving branch names.

```
python3 scripts/cn-content-sync/content_sync.py validate \
  --manifest manifest.json --manifest-sha256 <raw-64-hex> \
  --source <exact-40-hex> --catalog-sha256 <reviewed-64-hex> \
  --bundle-root <verified-offline-artifact-root>

python3 scripts/cn-content-sync/content_sync.py plan \
  --manifest manifest.json --manifest-sha256 <raw-64-hex> \
  --source <exact-40-hex> --catalog-sha256 <reviewed-64-hex> \
  --bundle-root <verified-offline-artifact-root> \
  --inventory inventory.json --inventory-sha256 <raw-64-hex>
```

Stdout is one JSON object. Exit 0 means that **specific offline operation**
passed; exit 20 is rejected/not ready; exit 70 is a local execution failure.
No credential, environment dump, private entity text or raw exception is emitted.
Successful planning is neither authorization nor a completed production sync.
No model participates in admission, dependency order, conflict handling or
success classification. GitHub Actions may call these commands as ordinary
steps; wiring new triggers/credentials/permissions is outside this change.

### Manifest v1

Required root fields: `schemaVersion: 1`, `releaseId`, `sourceRevision`,
`controlRevision`, `sourceArtifactSha256`, `targetOrgId: "org-platform"`,
`acceptanceScope`, `catalogVersion`, `expectedCounts` (`agent`, `skill`, `workflow`),
`catalogClosureSha256`, `entities`, `requiredTests`.

Each entity has `kind`, `key`, `version` (string), `contentDigest`,
`artifactPath`, `artifactSha256`, and `dependencies` (entity coordinates
`kind/key/version`). Skill versions require `G0`, `G1`, `G2` test entries;
each agent and Workflow requires a `business` entry in `full-catalog` scope.
For the explicitly authorized `mvp-non-model` scope use
`catalogVersion: "implemented-mvp"`, `skippedTests: ["real-model",
"ai-output-quality"]`, `notApplicableContents: ["future-catalog-v2"]`, and
require a `content-readback` test for every entity. This relaxation does not
promote candidate Skills or claim model quality. Runtime/login/authorization
evidence remains a separate required release gate. A test entry has `id`,
`entity` (coordinate), and `gate` (`G0`/`G1`/`G2`/`business`).
Content digests use the entity domain's canonical algorithm; artifact SHA-256
binds actual bytes independently and need not equal the domain digest.

The catalog closure is SHA-256 of compact, UTF-8, key-sorted JSON of sorted
`{kind,key,version,contentDigest}` entries. Dependency coordinates must all
exist in the manifest; cycles fail before any executor is entered.

Optional `legacyAdoption` is `{fromVersion,fromDigest,expectedStateDigest}`.
It is only admitted against exact existing **official** state. Customized or
tenant records cannot be adopted. Same-version different-content conflicts
always fail, including legacy entries.

Inventory v1 has `schemaVersion`, `targetOrgId`, `observedAt`, `entities`.
Rows have `kind`, `key`, `version`, `contentDigest`, `orgId`, `origin`
(`official`/`custom`), `status` (`published`/`retired`), `stateDigest`.
Inventories contain normalized metadata only, never private bodies or secrets.
The future collector must use a consistent read-only transaction and emit a
complete provider-bound receipt; a locally supplied inventory is not live DB
evidence. Future write admission also requires fresh inventory, baseline CAS,
backup proof, approval binding and a source-bound verified execution adapter.

## Execution and recovery requirements (not installed)

1. Acquire one content-release lock; recheck source/manifest/database identity
   and exact before-state hashes. Read all rows consistently before writes.
2. Take a new RDS snapshot and a private before-state backup of affected platform
   rows, versions, catalog entries and pointers. Record both scopes explicitly.
   The previous application-release snapshot is not a current content backup.
3. Import only desired Skill versions; preserve old immutable versions. Run real
   required gates, then promote only the validated versions. A file hash match
   alone must not set `verified` or insert fabricated gate records.
4. Append official agent versions and bind exact validated Skill versions.
   Existing official legacy rows need explicit compatibility checks and CAS.
   Retain user edits, old frozen references and genuine import history.
5. Publish Workflow versions through the normal graph/Skill/admin validation.
   Unavailable graph or unresolved Skill is a failure, not partial success.
6. Read every expected entity/version/digest and binding independently; verify
   source-bound per-entity business results before full acceptance.

Every stage records a durable operation ID and outcome. Unknown write outcomes
are reconciled by readback, never blindly retried. Per-stage transactions do not
make the whole release atomic. A conflict stops before dependent publication.

Rollback is compensating and bounded: CAS-revert agent publication pointers
only while unchanged; retire newly published Workflow versions without deleting
instances/history. Do not promise deletion or unpublication of immutable Skill
versions: an approved compensating version may be needed. Whole-RDS restoration
would overwrite subsequent business data and is never the default rollback.
No API restart, migration-password injection, privilege grant, credential
creation, tenant overwrite or irreversible deletion is part of this protocol.

## Current status

Offline admission/planning has 20 focused tests passing. The root-controlled
`apps/api/scripts/platform-content-release.ts` executor is implemented with
`preflight`, `apply`, and `readback` modes, using the existing one-shot migration
connection; it has not been installed or executed in production. Its independent
Linux database tests must pass before installation. The MVP source handoff identifies
`08947ec2a1ae2e962d4c38fe2a33d83bfcb20172`; the full repaired v2 catalog remains
future scope and does not block MVP implementation. No production content write
has been performed. Original f0eb image deployment remains completed; full
content and business acceptance remain pending under A6.

### Root-controlled execution request

The executor's `ReleaseRequest` type in `platform-content-release-core.ts` is
the execution-request authority; the Python normalized inventory planner is
an offline audit helper and is not a production writer admission token.
The execution request pins pack bytes/digests, the generated official role pack
digest, registered built-in Workflow content, exact source and current platform
before-state hash. It requires existing platform admin `svc-platform-templates`.

```
node --import tsx apps/api/scripts/platform-content-release.ts \
  preflight /root/private/request.json <request-raw-sha> <source-sha>
node --import tsx apps/api/scripts/platform-content-release.ts \
  apply /root/private/request.json <request-raw-sha> <source-sha> \
  /root/private/backup-observation.json <backup-raw-sha>
node --import tsx apps/api/scripts/platform-content-release.ts \
  readback /root/private/request.json <request-raw-sha> <source-sha>
```

Inputs must be root-owned private ordinary files and the production database is
fixed. The backup observation must be independently produced by the trusted
RDS observer, bind request/source/before-state/database, and describe a successful
fresh snapshot. Caller-authored success booleans are not backup evidence; the
protected release integration must verify the original provider receipts and
install the observation before calling this entry. That bridge is not implemented
by the content executor itself.

One outer `PgDatabase.withTenant` transaction serializes platform imports and
official role changes. Nested existing repositories reuse the same transaction.
Any later import/publish/readback rejection rolls the batch back. No automatic
retirement or gate promotion is called. An explicit current compatibility
upgrade records genuine new provenance; past legacy import history is not
invented. Replay of a committed operation independently reads content again.
This transaction protects content writes only; it does not make RDS backup,
image publication or container activation part of one database transaction.
