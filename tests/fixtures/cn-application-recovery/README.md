# Isolated original application migration / recovery chain

`tests/cn_release_application_recovery_linux.py` calls the unchanged
`cn-postgres-lifecycle/driver_bridge.py`: actual fixed driver `coordinate`, original
entry/journal/observer and its isolated PostgreSQL transport execute eight phases.
The new TypeScript payload uses the original application `migrate`, copied original
SQL bytes, `PgDatabase` and `PgIdentityRepository.findOrganization`.

This is control-checkout fixture coverage, **not exact DevApp candidate validation**.
Current fixture takes 415 of this checkout's 416 sorted migrations, then commits
its original final `organization_creation_requests` migration before a deliberately
failing fixture-only SQL file. This historical prefix is not the production schema
or the f0eb candidate's migration delta. Checkout HEAD and the full original file
manifest SHA are reported; production/candidate acceptance are always false.

1. Migrate a fresh prefix database; seed an isolated organization and canary; read
   through the actual application repository. Revoke app-role writes and prove the
   fixture canary update is denied and no application sessions remain.
2. Save one bounded original-epoch `pg_dump` (64 MiB maximum), retain its raw SHA.
3. Restore those exact bytes into a separate new DB, comparing the original ledger,
   canary and actual repository readback. No source database is overwritten.
4. Apply the remaining original migration successfully to the restored DB and read
   the actual application repository again.
5. On the original isolated DB run the actual migrator with the original files
   plus `SELECT 1/0`: prove original last migration committed and fault did not.
   Preserve before/after ledgers, reassert hold, restore the same original dump into
   another exclusive DB, and compare actual application readback.
6. Inject a caught failure after a real repository read; hold and restore the same
   dump into a third isolated DB. This is **not** actual `startApi` coverage; T20's
   separate real-startApi suite owns that claim.
7. Enable one fixture canary write, observe its new value, hold again, and refuse an
   old-epoch restore through an actual called guard before CREATE DATABASE/restore;
   rejection, new rows and target absence are asserted. This is a fixture decision assertion, not production recovery
   approval or a production writer-hold implementation.
8. Confirm immutable backup bytes and restored application reads. The unchanged
   controller then performs read-only status replay and verifies all eight raw
   receipts and the phase hash chain.

Linux setup must provide the already-built exact-checkout immutable amd64 PG image
with AGE/vector, Node 22 and full API dependencies. No image pulls occur here.
The launcher requires outer `CN_API_STARTUP_OWNER_TOKEN` / `OWNER_DIR` cleanup
registration; use the same exact-owned Docker cleanup hook as T20. Unknown create
without its receipt must remain unknown even if daemon readback is empty. A new
runner suite must wire that hook; this change does not edit the runner/workflow.
Each invocation has a new container, a fixed 2 GiB memory/swap ceiling and 1 GiB
PGDATA tmpfs. Declared image volumes and live mounts are checked; persistent or
unexpected mounts are rejected. There is no published TCP port, only a private Unix
socket. Init's transient server is excluded by checking PID 1 is the final postgres.
Budget: 720 s total work, original bridge 600 s / phase 120 s, separate 60 s cleanup;
Docker pg_dump/restore also has in-container 85 s timeout. Actual Linux timing is
pending, not a 30-minute release guarantee. Local subprocesses remain within the
outer simulation domain; the Docker daemon is covered by its separate owner hook.

Local checks:

```
python3 -m unittest discover -s tests -p test_cn_release_application_recovery_fixture.py -v
```

Seven local tests cover storage/image/mount rejection, platform denial, no signal after reap, timeout/output bounds,
and actual application imports rejecting a nonisolated connection before DB use.
They do not run Docker, PG, cloud or production. A real Linux pass remains required.
