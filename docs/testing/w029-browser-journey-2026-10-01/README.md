# W029 mechanical browser journey

Spec: `apps/web/e2e/w029-browser-journey.spec.ts`, preparation helper: `apps/web/e2e/support/workflow-browser-journey.ts`.

The isolated fullstack fixture administrator logs in through the real form. The helper verifies the actually enabled official role pack; when run independently on a fresh seed, it can explicitly enable the real offered pack through the UI. The spec grants `artifact.write` and `notify.inapp` through the organization settings UI and verifies persisted authorization. Existing exact write grants are verified, not redundantly changed.

D003 is resolved from the published member-readable directory. Its real AgentDetail `WorkflowRunEntry` starts the actual published `problem-to-prd` definition. The observed POST input, response instance ID, pinned role version and definition version are checked. Four actual gate drawers (`frame_gate`, `target_gate`, `solution_gate`, `prd_gate`) each require a real approve click followed by the confirmation click. The actual approval response and persisted completed stage must agree. Final success requires all stages succeeded, four persisted approved gates, finalized artifact/notification receipts, and a valid PRD output. Opening the actual persist-stage output link and refreshing must recover identical output and effect receipts.

No API interception, direct database seeding of a finished instance, or fabricated model result is used. Stage screenshots and JSON evidence are attached via `testInfo.outputPath`; Playwright trace is enabled. Only synthetic fixture data is involved; evidence remains local unless separately authorized.

## Important trigger-schema gap

The current v1 published definition supplies `{type: "object"}` without problem/evidence properties or required fields. The UI therefore starts with `{}`. The spec records the actual schema and outgoing request, asserts an empty trigger and null goal, and explicitly marks user-problem consumption **BLOCKED**. A mechanically successful run must not be reported as correct analysis of a supplied user's problem. Once the trigger schema is repaired, this spec must be updated to supply and verify meaningful input.

## Upstream and orchestration boundaries

Use the parent's derived local fullstack configuration and existing loopback-only `dashscope` alias. This checks real browser/API/PostgreSQL workflow orchestration with deterministic model responses. Actual model quality, actual authored-input quality, and production devapp behavior remain **BLOCKED / unverified**. Sales and CRM execution are excluded by user authorization.

The parent owns project registration: the workflow project should explicitly depend on the official digital-human journey project; do not rely on file sorting. No original CI configuration, root scripts, or stack startup was changed here.

Preparation validation: TypeScript syntax transpilation passed for the two new files; `git diff --check` passed. No browser stack was started, no E2E run was performed, and no screenshots or traces have been produced at this commit. Integration typechecking and browser execution are the parent's next checks.
