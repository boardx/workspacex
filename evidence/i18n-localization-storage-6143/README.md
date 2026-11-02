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

CI integration repair at `694a7ecb9`: the two historical upgrade fixtures now
exclude the new source-view migration from their intentionally incomplete legacy
phase and assert its application after prerequisite columns exist. Existing backfill
and rejection assertions remain. The recovery fixture explicitly appends this one
reviewed migration to its allowlist; unknown/missing/reordered migration rejection
remains. `legacy-upgrade-tests.txt` records both real PostgreSQL upgrades passing
under the normal isolation wrapper (owned stack cleaned in zero seconds);
`recovery-scope-tests.txt` records both scope tests passing after a failing reproduction.
These receipts do not claim the separate full simulation suite has passed.

PR review follow-up: `published-avatar-red.txt` isolates the real published-null
avatar counterexample (one failing test; the other 12 deliberately filtered out).
The view now chooses published avatar data whenever a published version is selected,
including NULL; a newer draft cannot leak through COALESCE.
`published-avatar-summary-green.txt` records all 13 PostgreSQL cases passing after
the fix, including the original 11 and a 5,000-character source-description read
through both administration and batched display. Original descriptions remain
verbatim under the unbounded source contract from `36c66f057`; translated copy
retains its separate authoring budget. Initial long-description fixture attempts
were corrected to hash schema-canonical unsigned package ordering before verification;
only the focused avatar counterexample and final full pass are claimed here.
