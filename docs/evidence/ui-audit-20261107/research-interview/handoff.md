# Research/interview audit fixes

Worktree: `/Users/shenyangjun/.codex/worktrees/f0e0/workspacex`. No git mutations, no lockfile changes, no Chrome control.

## #6344 — project creation association
Root cause: ResearchNewRoute bypassed old GuidedResearchFlow's onCreated linkProjectResource callback and dropped projectId on navigation.
Files for independent PR:
- apps/web/components/research-studio/research-new-route.tsx
- apps/web/tests/ui/research-new-project-context.test.tsx
- docs/evidence/ui-audit-20261107/research-interview/6344-red.log
- docs/evidence/ui-audit-20261107/research-interview/6344-green.log
RED: missing project link; GREEN: creation associates before navigation and return preserves context. Later study stage routing still needs its own follow-up.

## #6347 — generated outline prematurely confirmed
Root cause: expert confirm called generateStep(outline, confirmed, true), automatically POSTed outline/confirm and navigated runs. Existing outline was also automatically confirmed.
Files for independent PR:
- apps/web/components/itv/interview-markdown-editing-step.tsx
- apps/web/tests/ui/interview-markdown-editing.test.tsx
- docs/evidence/ui-audit-20261107/research-interview/6347-red.log
- docs/evidence/ui-audit-20261107/research-interview/6347-green.log
Fix: generated questions remain draft until explicit user confirmation; keep already-confirmed read-only behavior. Avoid second navigation callback after generation, which could reopen a route the user left.
Tests: WORKSPACEX_WEB_TEST_MAX_WORKERS=1 pnpm --filter web exec vitest run tests/ui/interview-markdown-editing.test.tsx tests/ui/research-new-project-context.test.tsx — 52 passed.

## Original investigation boundary (superseded by follow-ups below)
- PDF/Word generation: audit records generic failure only, no job IDs/run diagnostics. Existing #5837 is open for interrupted export before publication, #5832 fixed INVALID_FILE. Runtime accept's general agentId is valid. Do not weaken pin/body_read/execute/publish/file validation. Need readonly production report-file jobs, run events and actual exception before fix.
- Description-only research: source policy mode restrict currently requires domains (guided-source-policy.ts), no description-only mode. Supporting source-free reports requires explicit contract/quality-path design; do not disable source evidence gates silently.
- interview projectId across stage routes, research stage route project return.
No claim of browser export success, PR creation or integration.

## Follow-up #6356 — interview project navigation
Files: apps/web/components/itv/interview-markdown-workbench.tsx; apps/web/components/itv/digital-interview-workflow.tsx; apps/web/components/itv/interview-create-page.tsx; apps/web/tests/ui/interview-markdown-workbench.test.tsx; apps/web/tests/ui/interview-markdown-create.test.tsx. Red: project-navigation-red.log; Green (initial workbench): 6356-green.log. Creation now preserves explicit projectId too; latest combined route regression in route-regression.log.

## Follow-up #6361 — explicit source mode
Files:
- packages/contracts/src/research.ts (only materials SourcePolicy enum addition)
- apps/api/src/application/research/guided-source-policy.ts
- apps/api/src/application/research/guided-runtime-service.ts
- apps/api/src/application/research/guided-research-plan.ts
- apps/api/tests/research/guided-runtime-orchestration.test.ts
- apps/web/components/research-studio/research-intake.tsx
- apps/web/components/research-studio/guided-research-intent-plan.tsx
- apps/web/components/research-studio/guided-research-live.tsx
- apps/web/lib/guided-research-bootstrap.ts
- apps/web/tests/guided-research-bootstrap.test.ts
- apps/web/tests/ui/research-intake-source-mode.test.tsx
Evidence: 6361-red.log; 6361-api-green.log (52 tests); 6361-ui-green.log (3 tests).
New creation explicitly chooses materials/open; source choice is durably written before plan navigation. Plan bootstrap accepts source-policy-only first version, without replaying generated work. Plan sees policy; server materials mode blocks external retrieval; report canonical evidence excludes public sources. No source-free formal report introduced: insufficient materials fail closed with visible material gap. Existing old sessions without policy retain open compatibility. No permission gate weakening.

## Follow-up #6362 — report export investigation
Native config actual admission failed because no explicitly owned sandbox container was supplied; local docker ps had no running containers. report-native-admission.log records failure, not a pass. report-unit.log: 56 passed, 1 skipped. Parent controls production Chrome and has bounded readonly PG query for exact audit IDs. Await current execution facts; prior ConnectError remains only old evidence.

## Latest integration notes
- #6361 API regression now 53 passed, UI mode/bootstrap 3 passed, combined research/interview routes 40 passed before final stage-return test. Final stage-return/source-mode regression: 6361-route-green.log.
- ResearchStageRoute and guided-research-live history URL project preservation are #6344 follow-up hunks. guided-research-live also has #6361 bootstrap + material-gap hunks: split by hunk.
- apps/web/tests/ui/research-production-routes.test.tsx has #6361 executeResearchRuntime policy mock and #6344 final stage-return assertion; split by hunk.
- Parent supplied actual CN evidence: 7 exports failed MODEL_CALL_FAILED / tool_call_unresolved, not old ConnectError. Need exact unresolved tool and safe exception category. ToolCallUnresolved is open tool state at exception, not registry-missing proof. No P1 runtime behavior changed without that fact.

## Ready notification
Research/source + interview route edits are stable for parent review. Final source mode API: 6361-api-green.log; final source mode/bootstrap + research route tests: 6361-route-green.log (30 passed). Interview creation + workbench + research route combined: route-regression.log (40 passed). New intake test strict-index errors fixed with non-null assertions on verified calls; no full tsc rerun by worker.
Add apps/web/tests/ui/research-production-routes.test.tsx to #6361 file list for policy persistence mock; last project-return test belongs #6344. #6356 includes both interview-markdown-create.test.tsx and workbench test. No own git mutations or lockfile edits.
Report P1 remains investigation #6362: journal execute end was proven synthetic termination; current error detail is being read by parent. No runtime fix claimed.

## Review correction — default open, frozen again
Parent review identified default materials would block ordinary new research because imported demand text is not a verified source. Changed only research-intake.tsx and research-intake-source-mode.test.tsx: default open, explicit materials remains enforced, preserve runtime sourcePolicy domains/internalSourceIds and increment its revision. No creation-page internal material picker exists in inspected code; intent-plan editor already preserves initialPolicy IDs. UI explicitly says descriptions/imported text are demand, not automatically verified sources.
RED: 6361-default-open-red.log (2 failed).
GREEN: 6361-default-open-green.log (30 passed across intake modes, production routes and bootstrap).
Source/test writes are frozen again. No full tsc or git operations by worker.

## #6372 CI与恢复返工
旧home/i18n fixture未模拟新增策略持久化，已迁移并保留导航、字节、幂等与不重放模型断言。补查发现真实晚到回调和策略重试hash冲突：policy await之后增加active guard；version>0且已匹配mode复用持久策略；确需修改时command身份绑定session/version/mode。旧模型error的匹配策略可进入恢复页，不被当成策略写失败。Root独立4反例RED4/2，修复后source-mode6/6，组合97项加视觉8项通过，fixture类型窄化后home32/32重跑通过。未用fixture绕过原迟到断言；没有生产部署或浏览器复测假通过。
