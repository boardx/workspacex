# Shared-database project migration compatibility (Refs #5097)

The running ba6343199f3c834d6a198f83d0c771614292c82b source uses research_projects, user_insights and their member tables. W1 migration 20260929050000_pw_w1_general_project_kind.sql renames/deletes these names and replaces kind values with general. Code rollback alone is not schema rollback.

The assessed diff must include an explicit pending migration count. A `none` classification requires exactly zero; missing counts and nonempty inventories cannot bypass compatibility proof. The trusted assessment producer must derive this count from the actual bound ledger comparison, rather than a caller assertion.

A prepared release declaring compatible migrations now needs an exact baseline source revision, baseline fingerprint, target revision, plan hash and pending inventory hash. The migration-assessed check must hash the same plan. Its compatibility evidence must have restored-baseline-runtime scope, SQL execution and cleanup confirmation, and separate passed old-read, old-write, candidate-read and candidate-write evidence hashes. Missing, synthetic, failed, skipped or differently bound evidence is rejected by both receipt preparation and activation. These references are admission requirements for the trusted producer; arbitrary user-created JSON is not independent evidence or an authorization to mutate production.

The local PGlite regression executes unchanged 0018 and W1 SQL in a partial private PostgreSQL fixture. It proves old reads and writes succeed before W1, both fail afterward, and candidate general writes and reads succeed. The fixture stubs the unrelated freeze installation functions; it does not prove RDS privileges, complete 138-pending execution, tenant/freeze behavior, full old binaries or production restore fidelity. Its isolated-sql-contract scope cannot be used as restored-baseline-runtime acceptance. The synthetic Docker rehearsal similarly reports oldVersionCompatible=false and binds its old SQL expressions to actual baseline Git source; its success means the incompatibility was detected, not that a live upgrade is safe.

Reproduce focused checks:

```
pnpm --filter @repo/cloud-deploy exec vitest run test/cn-project-compatibility-probe.test.ts test/cn-fast-safe-release.test.ts --maxWorkers=1 --minWorkers=1
pnpm --filter @repo/cloud-deploy typecheck
```

No historical migration bytes are changed, no SQL is skipped, and no stable secret is regenerated. A correct expand-contract release needs a bridge runtime compatible with old and new schema before destructive conversion, then a separately admitted contract phase after old writers drain. Adding views after destructive W1 leaves a live failure window and does not repair old kind parsers. Shadow database switching also needs live-write catch-up and a rollback data policy; keeping an unchanged source database is insufficient once the shadow receives new writes.

This change closes the false-compatible admission gap. It does not make the current 138-migration candidate compatible or ready to activate.
