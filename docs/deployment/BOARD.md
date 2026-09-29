# Board self-hosting and API integration

This guide supplements the existing [single-host deployment procedure](SELF-HOST-UPGRADE.md).
It records requirements and gaps; it does not claim a fresh-machine Board deployment has been
accepted. The older [QUICKSTART](QUICKSTART.md) explicitly describes a target state; do not
mistake its proposed `setup.sh` workflow for the current deployment procedure.

## Start from the existing host workflow

Use Node from `.nvmrc` and the repository's pinned pnpm version. Follow
[SELF-HOST-UPGRADE](SELF-HOST-UPGRADE.md) for the root `compose.yaml`, `selfhost.env.example`,
installation and migration commands. That compose starts dependencies; **API and Web remain
host processes**, which the operator must configure/start using the deployment's established
service units. Do not use the CI/dev PostgreSQL compose for durable boards: its data is tmpfs.

Load credentials from an owner-readable deployment file/secret manager, not command history.
Run the API with its normal restricted database role and use the privileged migration role only
for migrations. Apply the complete migrations of the chosen revision before starting its API.
The existing `/healthz` check is necessary but does not prove Board operations or blob recovery.

## Filesystem content and PostgreSQL metadata

For an ordinary filesystem-backed deployment, configure the API process:

```sh
export WORKSPACEX_OBJECT_STORE=fs
export WORKSPACEX_OBJECT_ROOT=/srv/workspacex/objects
```

The root must be persistent, writable by the API service account, and private to that service.
Without an explicit root, development falls back to a temporary directory. `WORKSPACEX_DEPLOY_PROFILE`
cloud profiles require OSS; do not combine those profiles with FS settings. The single source
for this validation is [storage-config.ts](../../packages/cloud-deploy/src/storage-config.ts).

**R8 version boundary:** setting those variables alone does not move Board Yjs snapshots or
updates out of PostgreSQL. Deploy a revision that includes the R8 ObjectStore collaboration,
comment, image, copy, backup and legacy-backfill adapters plus their migrations. R9 API/chrome
features alone do not prove that R8 is merged or deployed. Verify the exact release contents
and execute the R8 storage acceptance lane for that revision. During migration, existing
legacy bytea rows may remain until verified backfill; never claim all content is on disk based
on an environment variable or a nullable schema column.

The intended R8 division is:

- Files/ObjectStore: canonical document snapshots, incremental content and content-bearing
  assets/comment bodies, addressed by integrity-checked references.
- PostgreSQL: board names/tags/membership, revision/CAS, ObjectStore references/hashes/lengths,
  receipts, lifecycle/audit and recovery metadata.

PostgreSQL still grows with metadata/events/receipts; this is not a zero-growth database design.
Keep the ObjectStore and database as a coordinated backup set. A database-only dump cannot
restore files it references. Do not independently delete object keys or run generic filesystem
cleanup; use the version's reference/retention-aware maintenance flow. For multiple API replicas,
local disks must not diverge: use shared durable ObjectStore access with the same namespace,
or the supported cloud storage backend.

## Board API and open-source surface

[The executable API walkthrough](../../examples/board-api/README.md) covers Create/Read/Update/
Move/Arrange/Connect/Delete and whole-operation Undo with canonical schemas. Board editing does
not require a model provider. AI Organize additionally requires a real configured model and
published, authorized Agent/Skill; synthetic proposal fixtures cannot establish AI clustering.

Board core is `packages/whiteboard-core`, transport schemas are `packages/contracts`, Fabric
projection is in `apps/web`, and the authenticated persistence/operation adapters live in
`apps/api`. These are source modules, not a separately released drop-in whiteboard server.
Repository licensing is in [LICENSE](../../LICENSE); retain applicable third-party notices.
Do not advertise the current source layout as an independently validated npm/server release.

## Clean-instance acceptance still required

The main session must record the exact revision, runtime build and commands for:

1. Dependency startup, migrations and health; no existing development data or privileged API role.
2. User login, organization access and trusted service-actor provisioning.
3. API walkthrough, two-user browser convergence, reload and Undo with original IDs.
4. R8 backfill and fresh writes with document content absent from PG content columns; actual
   files present and hash-verified; copied images bound to the destination board's ACL.
5. Restart, coordinated backup/restore, revoked access and missing/corrupt file failures.
6. Dependency/licensing inventory and installation with the documented operator inputs only.

Outstanding packaging gap: the example needs an already provisioned actor; this guide does not
supply a public actor-management UI/API or automated clean-host installer. Historical isolated
API evidence and static schema checks do not close these deployment gates.
