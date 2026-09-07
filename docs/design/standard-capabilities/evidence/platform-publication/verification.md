# Standard workflow package startup publication

The existing platform catalog startup now imports five fixed shipped pack manifests through `importSkillStarterPack`, using the existing platform service actor, tenant repository, publication function and idempotency receipt. No second Skill publisher is introduced. The five manifests are defined only in `STANDARD_PLATFORM_PACKS`; Office remains on its existing startup path.

Real PostgreSQL verification: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/skill/standard-platform-packs.test.ts` passed 2/2. It checks complete persisted files, replay without new versions, and actual GET /skills responses for ordinary consultant members in two distinct organizations. Both see the same published platform Skill version. Raw output is `ordinary-member-api.txt`; the wrapper cleaned its own stack.

An earlier 3-file group passed the six existing catalog tests and six context authorization tests but the new visibility assertion wrongly expected English `enabled`. The actual contract uses `已启用`; correcting that assertion produced the passing two-test run above. This is not a claim that the earlier group passed unchanged.

Deployment source inspection: `.harness/scripts/vm/deploy.sh` checks out the selected repository revision and `provision.sh` starts the API from that repository. The pack path is resolved relative to the infrastructure module, so the shipped manifests are part of that checkout. This change has not been deployed or tested on an external production host. Future package upgrades and real-model Skill execution remain separate acceptance work.
