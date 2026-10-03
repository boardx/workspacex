# Explicit maintenance coordinator (#5221)

`packages/cloud-deploy/src/cn-maintenance-release.ts` exposes `runMaintenanceRelease` for trusted operational integration. It is separate from `deploy-cn-production.sh`; ordinary release admission remains unchanged. It does not silently install an operational patch into frozen 9b25.

Required opt-in is `stop-all-writes-and-require-database-recovery`. Preparation is offline and does not demand production's post-migration schema. Under an exclusive release lock the coordinator verifies actual three-database recovery, establishes a durable hold, blocks and drains all writers, applies the exact frozen plan, then requires real production dynamic and preactivate checks before activation. Acceptance precedes write resumption. All operations receive the same frozen source/baseline/plan/attempt identity.

Any failure or unknown outcome after hold persistence begins returns `MAINTENANCE_DATABASE_RECOVERY_REQUIRED_WRITES_HELD`. No image rollback callback exists. The persistent hold, not the transient lock, must block later release and writer operations until the reviewed database recovery path resolves it.

## Recovery integration is not ready

The existing isolated `isolated_rehearsal_restore.py` calls provider observe and `isolated_rehearsal_snapshot.run(operation='restore-fidelity')`, which returns hash-bound baseline proof refs for all three databases. It is target-bound isolation code and explicitly prohibits connecting to the production source. It must not be reclassified as a production recovery adapter.

No complete production three-database recovery receipt/adapter exists in this change. Consequently a production caller must omit `verifyThreeDatabaseRecovery`, and admission rejects `MAINTENANCE_CAPABILITY_MISSING:verifyThreeDatabaseRecovery` before even offline preparation. Supplying caller-controlled `accepted: true` is not an integration. A future trusted adapter must replay the existing hash-bound fidelity mechanism against the actual approved recovery target, bind source ledger/backup and all three database proofs, validate freshness and identity, and prove the production recovery executor exists. Full-writer blocking must cover API writes, running tasks, background workers and direct application-role sessions, not just AI run drain.

The tests use local injected operations only. They prove ordering and fail-closed behavior, not production restore, successful migration or release readiness. Production lane status remains NOT RUN / blocked on actual recovery and writer adapters. Do not execute this coordinator with fixture adapters.
