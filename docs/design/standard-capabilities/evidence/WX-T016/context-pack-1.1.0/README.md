# standard-context 1.1.0

Four skills (S001/S008/S011/S014) update the same retrieval guidance: default current-files; explicit organization-index; organization-hybrid only when trusted server configuration is available. Each package includes a retrieval-scope reference with actual inputs, primary-file coverage, citation kinds and unsupported graph-seed behavior. No default enabling, engine change, external configuration or seed upgrade is implied.

Old immutable 1.0.0 manifest remains in place. Its live S001/S008 evidence remains scoped to 1.0.0. The new version passed two real default-chain representative checks (S001/S008), including source identity/version comparison, actual artifact writeback and zero-tool negative controls. See g-skill-batch/context-1.1.0; this does not imply it has been deployed.

- 1.0.0 packDigest: `44d300ceac16980dd20f2936ec80f3062a37de326abca213feab98c127af09d9`
- 1.1.0 packDigest: `29d041d998c9267bb61f934c5aa6e3d4f83caa3a8effadcabc589992233e0681`

`node --import tsx skills/standard-context/scripts/build.ts` and `node --import tsx skills/standard-context/scripts/verify.ts` passed. Actual FileSkillStarterPackSource verifies twenty exact files, both immutable manifests, missing-root unavailability and tamper rejection.

Canonical isolation command `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/organization-hybrid-retrieval.test.ts` passed 7 tests with real PG/HTTP production composition, canonical permissions, late withdrawal and unconfigured hybrid rejection with zero provider calls. See hybrid.txt. No real paid reranker quality claim follows from this deterministic provider fixture.
