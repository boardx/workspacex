# W029 v2 business-input browser journey

Spec: `apps/web/e2e/w029-browser-journey.spec.ts`, preparation helper: `apps/web/e2e/support/workflow-browser-journey.ts`.

The isolated fullstack fixture administrator logs in through the real form. The helper verifies the actually enabled official role pack; when run independently on a fresh seed, it can explicitly enable the real offered pack through the UI. The spec grants `artifact.write` and `notify.inapp` through the organization settings UI and verifies persisted authorization. Existing exact write grants are verified, not redundantly changed.

D003 is resolved from the published member-readable directory. Its real AgentDetail `WorkflowRunEntry` starts the actual published `problem-to-prd` definition. The observed POST input, response instance ID, pinned role version and definition version are checked. Four actual gate drawers (`frame_gate`, `target_gate`, `solution_gate`, `prd_gate`) each require a real approve click followed by the confirmation click. The actual approval response and persisted completed stage must agree. Final success requires all stages succeeded, four persisted approved gates, finalized artifact/notification receipts, and a valid PRD output. Opening the actual persist-stage output link and refreshing must recover identical output and effect receipts.

No API interception, direct database seeding of a finished instance, or fabricated model result is used. Stage screenshots and JSON evidence are attached via `testInfo.outputPath`; Playwright trace is enabled. Only synthetic fixture data is involved; evidence remains local unless separately authorized.

## Real business-input evidence

The spec requires published v2 with required string `rawInput` (1–2000 characters). Through the actual trigger form it submits `团队反馈白板首次导入流程太复杂，请定义问题与PRD`. The observed real POST must contain version 2 and this exact input, and return a real instance ID. Empty-input v1 is not accepted as passing this journey.

The browser evidence proves UI-to-API submission and subsequent actual stages, approvals and persisted output. The authorized instance projection does not expose raw trigger input: this test does not expand that public contract. Frozen input and actual stage-input propagation require the companion real PostgreSQL/API integration test. Semantic relevance of the generated PRD is not established by a loopback upstream.

## Upstream and orchestration boundaries

Run `pnpm run verify:work-stack-browser` using the [dedicated isolated lane](../work-stack-browser/README.md), which reuses the fullstack configuration and its loopback-only `dashscope` alias. This checks real browser/API/PostgreSQL workflow orchestration with deterministic model responses. Actual model quality, generated business-content quality, and production devapp behavior remain **BLOCKED / unverified**. Sales and CRM execution are excluded by user authorization.

Both the normal fullstack configuration and dedicated lane explicitly place this workflow journey after official digital-human import. The dedicated root command uses standard isolation, production Next build/start, one worker and no retries; its raw entry requires an existing isolation environment.

## Round 7 execution state

Parent-reported local execution at source baseline `5b698e315` uses actual production Next → Nest → isolated PostgreSQL/Redis and deterministic model upstreams. Published v2 `rawInput` was submitted through the business form; actual persisted grants, four human approvals and all sixteen stages reaching `succeeded` were observed.

The journey is **not fully PASS**: the authorized instance projection returned `effects=[]`, preventing the final required effect-receipt/output reconciliation. This is a product defect tracked as backlog B17 and is being fixed. B16 remains unchecked until final output, receipts and refresh readback are verified. Stage success cannot substitute for final effect evidence. The parent owns actual screenshots/traces and the final report; none are invented in this update.

Real-model semantic PRD quality, deployed devapp, real voice and PDF analysis remain **BLOCKED**. Only sales Workflow/CRM tasks are deferred; this does not exclude D005 basic chat or shared Skills.

## Round 8 verification

Actual production Next/Nest/isolated PostgreSQL/Redis browser execution at `5f9b521650b5ec51db618ade069c17fe3702a975`: both registered journeys PASS, without route interception or automatic retries. W029 now proves two finalized effect views, PRD opening and identical output/effects after reload. Four roles prove persisted independent basic conversations. See [consolidated report](../work-stack-effects-2026-10-01/browser-e2e/REPORT.md). Earlier round 7 failure is retained as history; real-model semantic quality remains BLOCKED and sales Workflow/CRM remains DEFERRED.
