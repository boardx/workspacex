# Source-safe localization storage/API — #6143

The synchronized storage implementation is `d4c427535b0c3985ebec9f7fdb93fa1d310e1c65`,
including the contracts parent `36c66f057` and actual merged foundation `30f0030`.
Independent read-only review confirmed that the explicit composition-root merge
keeps both the localization module and existing enterprise wiring.

`synced-api-tests.txt` records 41 passing API tests on the integrated UI consumer
head `cae29cfd7`, which contains this storage implementation plus the separately
reviewed visible-delegation-target projection. It includes 11 real PostgreSQL and
four real HTTP tests covering RLS, visibility, CAS/concurrent writes, source changes,
clear tombstones, translated search/pagination, strict fields, and unchanged original
execution-file bytes. The test isolation wrapper cleaned its own stack in zero
reported seconds. This is an integrated execution receipt, not a claim that the UI
projection was part of the storage-only commit.

During final synchronization, the architecture linter itself scanned 2218 files
successfully, but its counterproof test still enumerated the previous four reviewed
composition roots. `arch-red.txt` records that actual assertion failure (six passed,
one failed). The follow-up adds the reviewed localization module to that exact
expectation; no wildcard exemption or disabled assertion is introduced.
`arch-green.txt` records all seven architecture/error-leak counterproof tests passing.

The architecture test only runs filesystem linters against source and fixture trees.
It is now explicitly listed in the checked DB-free registry, preserving the guard
against database fixture imports. A prior bare invocation was refused by the normal
database-isolation guard before any tests or database access; it is not a test receipt.

The first synchronized push was deliberately interrupted after this missing
counterproof expectation was found. Only the verified owned Git-push process tree
was stopped. It does not count as a passing mandatory check; the corrected head
must pass the normal pre-push path and required CI.
