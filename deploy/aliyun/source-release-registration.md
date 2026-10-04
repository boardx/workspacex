# Source registration and phase-specific schema admission

This iteration changes source tooling only. It does not build images, create a database,
install host scripts, migrate production or deploy a release.

## Source identity

`node .harness/scripts/source-release.mjs dry-run input.json output.json` accepts a
strict machine plan: schemaVersion=1, kind=source-release-plan, status=source-planned,
release, sourceTag=`source/<release>`, exact sourceRevision/baselineRevision/frozenMainRevision,
environment (cn-production or devapp), scope (unique GitHub issue references), dataPolicy
(none, additive-migration or maintenance-required). The output is exclusive and never
follows moving main. Source must be contained in the frozen main SHA.

Source tags are distinct from `v*` tags, OCI release manifests/seals and CN prepared receipts.
The registration implementation never force-updates a tag or edits a differing Release;
it checks annotated tag identity/plan hash and creates only a draft prerelease. The CLI's
actual registration remains closed until external webhook/integration triggers are audited.
Repository Actions are audited on tagged source, frozen main and live main; unsupported
workflow syntax fails closed. A successful dry-run is not real tag or Release registration.

## Prebuild: baseline and exact migration plan

The collector requires these existing, root-protected inputs:

- `/etc/workspacex-cn/migration-plans/<source>/<attempt>/plan.json`: output of the existing
  `cn-migration-plan-cli.ts`, bound to complete independently identified read-only snapshot,
  exact source/baseline and migration inventory. Risk/drift blockers are not waived.
- `/etc/workspacex-cn/baseline-schemas/<baseline>.json`: schema-only baseline envelope.
  Replay the exact baseline's canonical migrations in a separately authorized isolated
  database, then call `capture` from `cn-baseline-schema-contract.cjs` using the exact SHA
  and ordered migration inventory hash. Save privately via the trusted operator.
  Do not capture production's current catalog and label it an independent expected baseline.

There is no trusted real baseline envelope yet. The pure capture/compare tests do not
establish provenance of a real artifact. Creating the isolated database or replaying its
migrations is outside this source-only execution.

Prebuild reads the running baseline image's own migration files, checks actual ledger,
columns/types/defaults/not-null/constraints and effective table/column/sequence/schema/function
privileges inside one explicit READ ONLY transaction. The result binds the baseline schema
hash and migration plan hash, authorizes build admission only and asserts no candidate schema.
Missing baseline members, unsafe roles, revoked privileges, drift, missing/expired plan fail.

## After isolated migrations, before prepared acceptance

`schema-probe.json` alongside the private plan selects an already-created and migrated
isolated database on the existing endpoint. Strict fields are schemaVersion=1,
scope=isolated-post-migration, sourceSha, baselineSha, migrationPlanSha256, imageDigest,
attemptId, database, issuedAt, expiresAt (at most one hour).
Database must equal `wsx_shadow_<source first 12>_<SHA256(attemptId) first 16>`.
Only PGDATABASE changes; endpoint, TLS and application credentials stay canonical.
The collector creates no database and executes no migration.

The immutable candidate API image's read-only compatibility probe must verify its complete
canonical migration inventory against the actual isolated ledger, then candidate schema,
permissions, administrator and seed closure. Static or baseline-only proof cannot become
preactivate/prepared proof. Existing manifest/seal, source, lock, identity and TTL gates remain.

## After production migration, before bootstrap/start

For production cloud provisioning, the same dynamic candidate proof is required between
canonical migrate and bootstrap. Missing target columns or migration checksum stops before
bootstrap writes and service start. This change must be part of the reviewed source/driver
identity; it is not a waiver that lets an older immutable driver claim the new check.

Actual 20-check CN prebuild, isolated migration acceptance, production deployment and public
browser acceptance remain separate operations requiring their real evidence and authorization.
