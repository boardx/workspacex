# #4828 migration snapshot integrity validation

Scope: synthetic fixtures and local subprocesses only. No production query, migration, ledger update, resource creation, upload of production metadata or activation was performed.

- `./init.sh`: passed after retry with network access; initial sandbox-only install failed DNS, not a code failure.
- `pnpm --filter @repo/cloud-deploy exec vitest run test/cn-migration-snapshot.test.ts test/cn-migration-snapshot-cli.test.ts test/cn-migration-plan.test.ts test/cn-migration-rehearsal.test.ts --maxWorkers=1 --minWorkers=1`: 4 files / 63 tests passed.
- `pnpm --filter @repo/cloud-deploy typecheck`: passed.
- `git diff --check`: passed.

Failure coverage: legacy/missing/extra fields, provider Dropped, valid JSON subset versus independent SQL count, duplicate ledger names, mispaired name/checksum versus independent digest, all source identity fields, SQL connection identity, invoke/command/ECS identity, provider failure/partial pagination, malformed base64/UTF8/gzip, bounded decompression, private file/symlink refusal. Real CLI test accepts a synthetic complete snapshot into a frozen Git migration plan and rejects resealed partial row evidence with exit 2, zero stdout and a stable code before source import/DB/Docker.

Existing drift/out-of-order/risk tests remain green. Snapshot proof hashes/count are included in the canonical plan body. Synthetic rehearsal retains production-profile/remote-daemon refusal and ownership cleanup checks.

Limit: evidence format and private trusted caller remain required. No provider signature is claimed; external protected source binding and a fresh independent SQL count/digest cannot be self-filled from a transformed old artifact. Production readiness and successful real-data rehearsal are not claimed.

Self-review hardening: complete plan is written create-once EXCL/NOFOLLOW/0600/fsync to privatePlanPath. Public stdout contains only scope/ready/planSha256/productionMigrationAuthorized; the real CLI test checks no ledger or source values leak, preserves an existing plan on refusal, and checks mode0600. Source/legacy evidence errors return stable codes, not raw input or provider diagnostics. The 63-test suite was rerun after this change.
