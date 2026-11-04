# Final production-browser evidence

Source `74c46f0e05d2fc23e1f1bd9ffc18ddd7acac0832`. The exact isolated seeded Playwright case passed 1/1, observed exit0. Runner case duration: 1.0m; wrapper total4m56s, cleanup1s. Own compose scope `wsx-024610af26badaf58bb6` dynamically contained0 containers after cleanup.

Command: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded e2e/i18n-research-entry.spec.ts --workers=1 --max-failures=1`.

Fresh production build, real login/API/PostgreSQL and the existing deterministic model fixture. Actual new intake → unsaved guard → persisted import → plan save/reload → report → locale switch → regenerate/previous report → metadata save/reload → delete cancel. No timeout/retry changes or response replacement. Workflow step labels pass full geometry bounds at375/1280; list metadata correctly asserts no workflow nav. Document width bounds also pass.

All ten PNGs in screenshots.json were individually viewed. Mobile step labels wrap fully; desktop/mobile controls and history remain readable. Chinese canonical report/name/body and authored tags are intentionally retained. Screenshot hashes are in screenshots.json. This does not claim live external model/ASR or native Skill conversion bytes.
