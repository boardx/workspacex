# Research UX R2 — save feedback (#5784)

Distinct from R1: authenticated saved-plan edit → confirm save → controlled transport delay → real Nest/PostgreSQL write → normal reload. The short gate delays the actual save POST and always releases in finally; no response body is mocked and no barrier survives the test.

Before: saveBusy=null/saveSpinners0 while generateBusy=true/generateSpinners1. The real save still persisted version2 and the new title and survived refresh, isolating a UI feedback error. The new unit case also failed before the fix (2 existing passed).

After: saveBusy=true/saveSpinners1; generateBusy=null/generateSpinners0. API/PGversion2 and the title survive refresh. Model starts and agent runs remain0; no generation or export commands submitted. before/ and after/ contain actual screenshots and result JSON. Saved fixtures are synthetic, not claims of upstream/model research success.

Minimal fix: actual save control consumes existing WorkflowActionButton/loading=saving; the generation control uses the already existing research loadingNode. Busy guards, schema, saved fields and API remain unchanged.

Verification:8 relevant UI tests, TypeScript and focused lint. Actual focused case after fix:1 passed,14.8s test,49s full reserved stack/run/cleanup. Initial dev cold/home navigation took9s and exceeded a5s assertion; the navigation wait was set30s while still asserting the exact successful URL. The next before run reached the actual wrong-feedback assertion and is the accepted red evidence.

Reproduce: `WX_RESEARCH_UX_EVIDENCE=<absolute output> pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.research-ux.config.ts`. This config reuses the standard fullstack fixture/API/PG/provider environments and admission/cleanup; only local Web compilation uses Next dev to avoid repeated production builds between separate UX rounds. Authenticated production routes are exercised, but this is not deployed/production-bundle evidence.
