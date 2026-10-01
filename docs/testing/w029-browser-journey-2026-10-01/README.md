# W029 v2 business-input browser journey

Spec: `apps/web/e2e/w029-browser-journey.spec.ts`, preparation helper: `apps/web/e2e/support/workflow-browser-journey.ts`.

The isolated fullstack fixture administrator logs in through the real form. The helper verifies the actually enabled official role pack; when run independently on a fresh seed, it can explicitly enable the real offered pack through the UI. The spec grants `artifact.write` and `notify.inapp` through the organization settings UI and verifies persisted authorization. Existing exact write grants are verified, not redundantly changed.

D003 is resolved from the published member-readable directory. Its real AgentDetail `WorkflowRunEntry` starts the actual published `problem-to-prd` definition. The observed POST input, response instance ID, pinned role version and definition version are checked. Four actual gate drawers (`frame_gate`, `target_gate`, `solution_gate`, `prd_gate`) each require a real approve click followed by the confirmation click. The actual approval response and persisted completed stage must agree. Final success requires all stages succeeded, four persisted approved gates, finalized artifact/notification receipts, and a valid PRD output. Opening the actual persist-stage output link and refreshing must recover identical output and effect receipts.

No API interception, direct database seeding of a finished instance, or fabricated model result is used. Stage screenshots and JSON evidence are attached via `testInfo.outputPath`; Playwright trace is enabled. Only synthetic fixture data is involved; evidence remains local unless separately authorized.

## Real business-input evidence

The spec requires published v2 with required string `rawInput` (1–2000 characters). Through the actual trigger form it submits `团队反馈白板首次导入流程太复杂，请定义问题与PRD`. The observed real POST must contain version 2 and this exact input, and return a real instance ID. Empty-input v1 is not accepted as passing this journey.

The browser evidence proves UI-to-API submission and subsequent actual stages, approvals and persisted output. The authorized instance projection does not expose raw trigger input: this test does not expand that public contract. Frozen input and actual stage-input propagation require the companion real PostgreSQL/API integration test. Semantic relevance of the generated PRD is not established by a loopback upstream.

## Upstream and orchestration boundaries

Use the parent's derived local fullstack configuration and existing loopback-only `dashscope` alias. This checks real browser/API/PostgreSQL workflow orchestration with deterministic model responses. Actual model quality, generated business-content quality, and production devapp behavior remain **BLOCKED / unverified**. Sales and CRM execution are excluded by user authorization.

The parent owns project registration: the workflow project should explicitly depend on the official digital-human journey project; do not rely on file sorting. No original CI configuration, root scripts, or stack startup was changed here.

Preparation validation: TypeScript syntax transpilation passed for the two new files; `git diff --check` passed. No browser stack was started, no E2E run was performed, and no screenshots or traces have been produced at this commit. Integration typechecking and browser execution are the parent's next checks.
