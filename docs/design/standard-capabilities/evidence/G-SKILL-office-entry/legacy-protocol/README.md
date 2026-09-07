# Office runtime protocol compatibility

The package now explicitly selects the supplied legacy script protocol or actually available native tools. Original creation recipes remain byte-for-byte included. It does not grant tools or claim execution/rendering from generated script text.

Validation: before the change, direct actual officeSkillPackage projection assertion for the legacy branch failed (exit 1); after the change four package projections and content-derived version changes passed (projection.txt). Existing canonical isolated command passed 2 tests and cleaned up (tests.txt):

`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/skill/office-full-packages.test.ts`

The real PG test confirms repeated/concurrent seed idempotency and immutable prior version bytes. New content receives a different digest-derived version ID. No existing agent pin is rewritten.

This is not a real-model legacy file-delivery pass. Existing devapp workflow runs 34051778927 and 34046573278 failed before browser/model execution because the local test-account configuration was absent. The existing browser lane can verify actual downloaded PDF bytes after authorized account configuration; no new authentication bypass or test framework was introduced.
