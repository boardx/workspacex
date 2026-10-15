# Research compact pages — #5769

Real Next development route http://127.0.0.1:38752/research/new, current production ResearchNewRoute/ResearchIntake components. Synthetic manually entered requirement, no creation/model calls. Screenshots at 375/768/1280 plus expanded optional fields at 375. Geometry records no horizontal overflow, 192px goal editor, 36px main action and original floating assistant position. The main action and assistant do not overlap in the collapsed creation view.

The first web-only list attempt redirected to login. This limitation was subsequently resolved by the standard isolated fullstack renderer below; no authentication bypass or mocked browser routes were used. Plan/report already use the shared action components; this patch does not change their states or evidence.

Validation: 75 related UI tests passed after updating the existing list spacing assertion. Web TypeScript and focused Next lint passed. The new intake assertion first failed on the old multiline placeholder, then passed with all optional fields retained. Existing file import and creation retry tests remain green.

## Final authenticated renderer

Command: `WX_STUDY_ACTIONS_EVIDENCE=<absolute evidence directory>/authenticated pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded study-workflow-actions.spec.ts`

Final result: **1 passed**, test 1.2 minutes, full isolated startup/build/run/cleanup 6m22s. Real production Next build, login, Nest API, tenant PostgreSQL transaction and synthetic saved fixtures. The fixture synchronizes runtime and session projection (including report_id) in one tenant transaction following PgGuidedRuntimeStore.write.

At 375/768/1280: history search/sort, actual 36px creation and card actions, edit dialog with retained name and cancel, create route and return, resume saved report, saved plan with exactly one primary in exactly one plan footer, and no horizontal overflow. Existing report assertions verify a single shared footer, no nested action bars, 36px controls, completed/report-ready states and one spinner without skeletons. No generation/export commands were submitted; agent_runs and model_request_starts both remained zero. These are saved synthetic presentation states, not real source/model quality validation.

The initial failed attempt timed out awaiting a completed-session view action because only runtime state had been seeded; the session projection still described an active plan. This was a fixture inconsistency, not accepted as a passing run. It was corrected without changing production behavior. Final screenshots and after-metrics.json are from the corrected run.
