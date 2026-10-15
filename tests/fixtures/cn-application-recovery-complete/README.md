# Full control-schema recovery and transaction fixture

This is a new isolated lane, not a replacement of the frozen 26-suite runner.
It reuses the same exact-owned Docker registration protocol, 2 GiB memory cap,
1 GiB PGDATA tmpfs, no TCP publication, original `driver_bridge.py`, original
fixed driver/entry/journal, and existing AGE/vector image. The complete control
checkout migration set is applied once. It is not f0eb's exact 415-file schema,
and it does not execute the unavailable baseline 5285 application image.

The new launcher is `tests/cn_release_application_recovery_complete_linux.py`.
Its differences from the accepted application launcher are the payload,
passing its real Python executable to the private config, and requiring the new
full-schema/controller/hold-drift result fields. The custom PostgreSQL command
retains the image's `shared_preload_libraries=age`; before migrations, an actual
`current_setting` query must return `age`. Available extensions alone are not
accepted as preload evidence. Three offline Python contract tests cover this
command, readback, and missing/wrong preload rejection; real Linux remains pending.
It retains `-I -B`, bounded
process handling and Docker ownership/cleanup. Integration must assign a new
outer owner registry/token and export its receipts, then invoke the launcher;
this patch deliberately does not change the existing runner/workflow.

The new TypeScript payload uses all original migration bytes, one complete
baseline, and independent restored databases. `pg_dump -Fc` retains owners/ACLs;
`pg_restore --single-transaction --exit-on-error` consumes the exact saved bytes.
It compares the original 23-category catalog `collectFacts` algorithm, all
migration names/checksums, canary rows and actual `PgIdentityRepository` results.
This is same-cluster fixture transport: original provider/5432 capture authority
is not claimed. Full catalog equality is separate from the explicit row probes.

Original ARouteFactory/HoldStore run in one real retained-lock actor. Its capture
hook creates a new dump after the actual hold; its rehearsal restores that same
dump into an exclusive DB. The migrate hook calls the original application
migrator with two fixture-only additive files:

1. File A creates a table and inserts one row, committing normally.
2. File B creates another table, inserts a row, updates A, then divides by zero.
   Real readback requires B's DDL and row changes rolled back and its ledger entry
   absent, while A's committed row and checksum remain exactly once.
3. An explicit fixture repair removes B's deliberate failure. Re-running applies
   only B. A second run applies nothing; both data sets and ledger stay identical.

Actual repository readback follows migration before the original route clears
its real hold. A second route replaces the actual hold generation during capture;
restore/migration/readback callbacks must not run, and the new hold stays held.
The existing independent recovery phases additionally restore the original full
schema dump, and reject old-epoch restore after a real new canary write.

Provider completion, candidate writer transport and public/browser consumers
remain explicit fixtures. Original source-plan authority is the existing test
reader, not new production authorization. The controller proves orchestration
and real HoldStore behavior; `databaseHooksInvoked` alone is not PG evidence.
Only the Linux payload supplies real PG hooks. No field claims old-image,
exact-candidate, production, real-public-browser or provider acceptance.

Local protocol checks (no Docker/PG):

```
CN_POSTCLEAR_PYTHON=/absolute/python3.12 node --import tsx --test \
  tests/fixtures/cn-application-recovery-complete/*_test.ts
```

Three local cases pass: actual factory/HoldStore ordering, actual generation
replacement rejection, and actual migrator imports rejecting foreign DB bindings.
The real PG transaction/catalog/restore assertions have not yet run on Linux.
The same original 720-second work / 60-second cleanup ceilings remain; one full
migration plus a second bounded dump and one additional restore are added relative
to the historical-prefix lane. Ten-round/30-minute performance is not asserted.
