# Survey Markdown Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock-driven five-step survey UI with a real, Markdown-source-backed three-stage workspace: design, publish/collect, and review responses.

**Architecture:** Build on the merged survey runtime and source compiler already on `origin/main`. Retire the survey-specific side rail and mock runtime from the production routes; compose focused home, stage-navigation, Markdown editor, publication, and response-review components around the existing REST source/lifecycle APIs. Templates and reporting remain contextual, optional routes.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind/shadcn UI primitives, Zod contracts, Nest/Express API, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-survey-markdown-workspace-redesign.md`

## Global Constraints

## Execution checkpoint — 2026-09-27

Continue in the existing worktree `/Users/shenyangjun/.codex/worktrees/survey-workspace-home/workspacex`. Do not create another worktree. Switch branches only after accounting for all current changes. One issue / one PR; human merge only.

### Stacked delivery checkpoint — 2026-09-27 evening

Human instructed continuous implementation without waiting for earlier PR merges. The existing worktree is reused throughout. PRs target `main` but are stacked; merge in dependency order, manually. Actual checks are reported, never presumed successful.

| Issue | PR | Delivered scope |
| --- | --- | --- |
| #4378 | #4415 | Markdown design, correction before application, source persistence and conflict recovery; three primary stages. |
| #4416 | #4417 | Collection dashboard and real collection metrics/activity. |
| #4418 | #4422 | Adjacent response list/details, excluded-sample filters and Markdown export. |
| #4421 | #4424 | Optional report, Markdown projection/export and paper-like report display. |
| #4423 | #4432 | Default designer preview/settings, local QR generation, template-free publish/default report, integrated acceptance. |
| #4433 | #4435 | Debounced autosave for applied valid unpublished existing drafts, explicit conflict/error recovery. |
| #4436 | #4443 | Named creation dialog, blank/Markdown/template entries, canonical persisted Markdown tags and tag search. |
| #4441 | #4446 | On-demand narrow-screen outline/settings panels, retained selection and edits, inline desktop studio. |
| #4445 | Pending | Copy frozen published questions into an independent editable draft, without migrating answers or altering the old link. |

Fresh integrated seeded Playwright passed both template lifecycle and blank Markdown lifecycle again after independent review fixes (2 tests, 3m52s including cleanup). Desktop/mobile response screenshots are test artifacts. Review caught visual-editor locking on empty/space-containing titles and default report rejection for unanswered optional questions; regressions reproduce before fixes and pass afterward. All 29 survey UI files / 252 tests, 26 source/report contract tests and 15 isolated API regressions pass; API/web typechecks pass. CI on #4415/#4417 exposed two outdated publishing test fixtures/selectors; both corrected locally (7 publishing tests pass), with propagation to earlier branches still pending.

Autosave implementation for #4433 is verified by 16 workspace regressions and a fresh actual browser run (2 lifecycles, 2m55s including cleanup) with visual editing → automatic save → reload persistence → publication → respondent submission. Invalid/unapplied/new/published/error/conflict states are excluded; version conflicts keep the local content without repeated retries. Full web suite: 620 files / 5318 tests passed, 5 skipped; 6 tests in `tests/whiteboard/board-content-tools.test.tsx` failed on local Node 22.14 WebCrypto rejecting a jsdom-realm ArrayBuffer. Isolated rerun reproduces all six; whiteboard implementation/tests have no diff against `origin/main`. This is not a full-suite-green claim and no unrelated whiteboard production code is changed. Earlier publishing test corrections have been pushed to #4415 and #4417; new CI is running.

Creation dialog and tags (#4436): three fresh real-browser lifecycles passed (2m11s including cleanup), including named/tagged creation, reload persistence, automatic save, publication, respondent submission, default report, and template-dialog creation. All 29 survey UI files / 256 tests and 10 source compiler tests passed. API lifecycle/HTTP tests: 9 passed, including a regression reproducing then fixing tag loss when a legacy structured-save client omits tags. Tags are serialized in the canonical `survey-tags` Markdown fence, not stored in a browser-only metadata model. No status filter or top-right import action was introduced.

Responsive designer (#4441): RED reproduced always-mounted mobile settings; 91 focused regressions passed after implementing accessible on-demand panels. Fresh seeded browser: 3 lifecycles passed (2m52s including cleanup), with 390px outline selection, settings edit/close, autosave, reload persistence and the same publication/response/report flow. Desktop panels remain inline; the question editor is mounted only once in either presentation.

Draft derivation (#4445): 18 focused tests passed, covering frozen published rather than newer draft questions, copied metadata, no migrated answers/publication and failed-create retry without navigation. Fresh real browser: 3 lifecycles passed (3m17s including cleanup), including copying a published survey, independently editing and publishing the copy under a different link, then verifying the original link still renders the original question and the original answer is retained. Existing authenticated create contracts and canonical source generation are reused, with no new controller/repository.

Not yet delivered: real AI natural-language/PDF/voice extraction and repeat-response/success-page controls. No survey AI-generation operation or repeat/success fields exist in the current signed survey API surface; backend extensions require an explicit design delta rather than browser-only switches. These are remaining work, not completed widgets; no fabricated AI, settings, metadata or industry benchmarks are shown.

| Order | Remaining delivery | Acceptance / current status |
| --- | --- | --- |
| 1 | Home navigation and cards — #4297 | Merged in PR #4383, main commit a77615305. No homepage status filter or top-right Markdown import. |
| 2 | Markdown design — #4378 | Source save, three-stage navigation, correction modal, conflict comparison, safe creation retry and design-area Markdown upload implemented. 19 related UI tests and typecheck passed; fresh browser verification running. AI file/voice generation and visual designer fidelity remain separate follow-ups, not silently claimed delivered. |
| 3 | Publish and collect | Two-column collection dashboard, real settings, link/QR sharing, immutable published revision, readiness and stop-collection confirmation. |
| 4 | Response review | Table + adjacent details, search/pagination, valid/review/excluded filtering, explicit exclusion reason and exports; no fabricated metadata. |
| 5 | Optional templates and reports | Contextual template/report actions, Markdown report source and paper-like report layout, protected sample threshold, real Word/PDF export. |
| 6 | Integrated acceptance | Blank/template/Markdown creation through publish, real respondent submission, review and optional report; refresh persistence, errors/conflicts and responsive layouts. |

Evidence: the real seeded Playwright `survey-complete-flow.spec.ts` passed (1 test, 4.2 minutes); lock queue took 7m25s separately. This proves the existing template lifecycle, not the fidelity of every new prototype screen or the unfinished AI import path. Every subsequent batch needs its own targeted tests and browser evidence before being declared ready.

The screenshot's AI import must return editable Markdown for correction before application. If a real file/voice/model endpoint is unavailable, document that gap rather than label a local parser as AI.

- Use the current `origin/main` as the integration base; dependent branches may stack temporarily with explicit dependencies until human merge. Do not discard uncommitted work to change branches.
- Keep WorkspaceX global navigation; remove only the survey-specific secondary left navigation.
- Primary navigation has exactly `design`, `publish`, and `responses`; templates and reports are contextual optional actions.
- Markdown remains the single editable/persisted structure source; do not add browser-only question schemas or mock persistence.
- Published respondent revisions and historic answers are immutable; source changes require a draft/republish path.
- Every issue has one branch and one PR; create no automatic merge and submit only after browser verification and green CI.

## Review Focus

1. A stale editor save must preserve local Markdown and show a conflict resolution action rather than silently overwrite newer remote content — Task 2 test.
2. A Markdown compile error must leave the last valid draft/published revision intact and map the diagnostic to a visible editor location — Task 2 test.
3. A survey with a published revision must not display a newer draft as if respondents are answering it — Task 3 API/UI regression test.
4. Empty, failed, or forbidden list/response fetches must not render as an empty successful state — Tasks 1 and 4 tests.
5. A report below its valid-sample threshold must be available as a protected draft only, without blocking collection or response review — Task 5 test.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/web/components/survey/shell/survey-app-shell.tsx` | Keep global app shell and remove survey resource side rail. |
| `apps/web/components/survey/live/survey-library.tsx` | Real survey home, filters, status cards, and contextual template entry. |
| `apps/web/components/survey/live/survey-stage-nav.tsx` | Three-stage navigation and lifecycle-aware eligibility. |
| `apps/web/components/survey/live/markdown-survey-editor.tsx` | Markdown draft input, compilation diagnostics, autosave/conflict state. |
| `apps/web/components/survey/live/compiled-survey-preview.tsx` | Read-only compiled-draft preview used by design and pre-publish checks. |
| `apps/web/components/survey/live/publish-collect-workspace.tsx` | Publish readiness, settings, sharing, and collection summary. |
| `apps/web/components/survey/live/response-review-workspace.tsx` | Response list, selection drawer, validity actions, and export. |
| `apps/web/components/survey/live/survey-workspace.tsx` | Thin route-level coordinator; no local mock model. |
| `apps/web/lib/survey/runtime-client.ts` | Typed source/lifecycle mutation helpers and conflict normalization. |
| `apps/web/tests/ui/survey-*.test.tsx` | Component/regression tests for live flows. |
| `apps/web/tests/e2e/survey-markdown-workspace.spec.ts` | Browser evidence for the three-step flow. |
| `apps/api/tests/survey/survey-source-*.test.ts` | Source, lifecycle, revision-immutability, and migration regressions. |

## Task 1: Survey home and navigation simplification (Issue 1 / PR 1)

**Files:**
- Modify: `apps/web/components/survey/shell/survey-app-shell.tsx`
- Modify: `apps/web/components/survey/live/survey-library.tsx`
- Modify: `apps/web/app/studio/survey/page.tsx`
- Modify: `apps/web/tests/ui/survey-app-shell.test.tsx`
- Modify: `apps/web/tests/ui/survey-live-library.test.tsx` (or create if live-library coverage is absent)

**Interfaces:**
- Consumes: `surveyRequest<SurveyRuntime[]>("/surveys")` from `runtime-client.ts`.
- Produces: `LiveSurveyLibrary` with search and a single next action per runtime; no status filter, no top-right Markdown import, no `survey-section-nav` DOM node.

- [ ] **Step 1: Write failing UI tests for the retained global rail, absent survey side rail, and home loading/error/empty states.**

- [ ] **Step 2: Run the focused web tests and verify they fail against the current secondary navigation and generic list.**

Run: `pnpm --filter web test -- tests/ui/survey-app-shell.test.tsx tests/ui/survey-live-library.test.tsx`

Expected: FAIL because `survey-section-nav` still exists and state-specific home behavior is absent.

- [ ] **Step 3: Replace `SurveyAppShell`'s `left` content with the global shell only and reshape `LiveSurveyLibrary` into the approved status-aware home.**

Use real `SurveyRuntime` data only. Provide `我的问卷 / 模板 / 报告模板` as top contextual navigation, search, create actions, and a card next-action mapping: draft/ready → design, collecting/closed → responses. Status may appear on cards, never as a homepage filter.

- [ ] **Step 4: Run focused UI and type checks.**

Run: `pnpm --filter web test -- tests/ui/survey-app-shell.test.tsx tests/ui/survey-live-library.test.tsx && pnpm --filter web typecheck`

Expected: PASS.

- [ ] **Step 5: Browser-check survey home at desktop and narrow viewport; capture no-secondary-rail evidence.**

- [ ] **Step 6: Commit and open the linked PR after CI is green.**

Commit: `feat(survey): simplify survey home navigation`

## Task 2: Markdown design workspace (Issue 2 / PR 2)

**Files:**
- Create: `apps/web/components/survey/live/markdown-survey-editor.tsx`
- Create: `apps/web/components/survey/live/compiled-survey-preview.tsx`
- Create: `apps/web/components/survey/live/survey-stage-nav.tsx`
- Modify: `apps/web/components/survey/live/survey-workspace.tsx`
- Modify: `apps/web/lib/survey/runtime-client.ts`
- Modify: `apps/web/tests/ui/survey-live-workspace.test.tsx`
- Modify: `apps/api/tests/survey/survey-source-http.test.ts`

**Interfaces:**
- Consumes: `SurveySourceStateSchema`, `surveySourceRequest`, and the existing protected survey-source endpoints.
- Produces: `MarkdownSurveyEditor({ source, expectedVersion, onSaved })` and `SurveyStageNav({ active: "design" | "publish" | "responses", status, onSelect })`.

- [ ] **Step 1: Write failing API/UI tests for valid source save, invalid compiler diagnostics, version conflict, local-text preservation, and the three-item stage nav.**

- [ ] **Step 2: Run tests to verify the existing JSON/question-editor path cannot meet those assertions.**

Run: `pnpm --filter api test -- tests/survey/survey-source-http.test.ts && pnpm --filter web test -- tests/ui/survey-live-workspace.test.tsx`

Expected: FAIL because the live workspace saves a browser-owned `SurveyDraftInput` instead of Markdown source.

- [ ] **Step 3: Implement typed source fetch/save helpers and the design stage components.**

The editor saves source with expected version, shows `saving/saved/error/conflict`, retains text on any failed mutation, renders compiler diagnostics with line numbers, and updates `CompiledSurveyPreview` only from server-accepted compilation output. The stage nav exposes only design/publish/responses.

- [ ] **Step 4: Run source-contract, API, and UI tests.**

Run: `pnpm --filter contracts test -- survey-source.test.ts && pnpm --filter api test -- tests/survey/survey-source-http.test.ts && pnpm --filter web test -- tests/ui/survey-live-workspace.test.tsx`

Expected: PASS.

- [ ] **Step 5: Browser-check Markdown edit → saved preview and invalid-source diagnostic; save screenshots.**

- [ ] **Step 6: Commit and open the linked PR after CI is green.**

Commit: `feat(survey): add markdown design workspace`

## Task 3: Publish and collect workspace (Issue 3 / PR 3)

**Files:**
- Create: `apps/web/components/survey/live/publish-collect-workspace.tsx`
- Modify: `apps/web/components/survey/live/survey-workspace.tsx`
- Modify: `apps/web/components/survey/live/survey-library.tsx`
- Modify: `apps/web/tests/ui/survey-live-publishing.test.tsx`
- Modify: `apps/api/tests/survey/survey-source-lifecycle.test.ts`

**Interfaces:**
- Consumes: the source compilation state, existing `prepare`, `publish`, `close`, and publication endpoints.
- Produces: `PublishCollectWorkspace({ runtime, source, onRuntimeChanged })`, which cannot publish invalid source and always identifies the respondent-facing revision.

- [ ] **Step 1: Write failing tests for readiness diagnostics, publish/close state transitions, share-link visibility, and source edit after publication not rewriting the live revision.**

- [ ] **Step 2: Run lifecycle and publishing UI tests to verify failures.**

Run: `pnpm --filter api test -- tests/survey/survey-source-lifecycle.test.ts && pnpm --filter web test -- tests/ui/survey-live-publishing.test.tsx`

Expected: FAIL because the old workspace presents the five-step state and lacks source-revision messaging.

- [ ] **Step 3: Implement the publish/collect stage around server readiness and lifecycle commands.**

Display blocking checks, publish/stop collection confirmations, current link/QR controls, anonymity/limit/deadline summary, collection counts, and “draft requires republish” state. Do not infer readiness in a second client rule set.

- [ ] **Step 4: Run focused API/UI tests and typecheck.**

Run: `pnpm --filter api test -- tests/survey/survey-source-lifecycle.test.ts && pnpm --filter web test -- tests/ui/survey-live-publishing.test.tsx && pnpm --filter web typecheck`

Expected: PASS.

- [ ] **Step 5: Browser-check readiness failure, publish, link access, and stop-collection flow.**

- [ ] **Step 6: Commit and open the linked PR after CI is green.**

Commit: `feat(survey): redesign publish and collect stage`

## Task 4: Response review workspace (Issue 4 / PR 4)

**Files:**
- Create: `apps/web/components/survey/live/response-review-workspace.tsx`
- Modify: `apps/web/components/survey/live/response-list.tsx`
- Modify: `apps/web/components/survey/live/survey-workspace.tsx`
- Modify: `apps/web/tests/ui/survey-live-workspace.test.tsx`
- Create: `apps/web/tests/ui/survey-response-review-workspace.test.tsx`

**Interfaces:**
- Consumes: current runtime response collection and response mutation/export endpoints.
- Produces: response filters, selected-response detail drawer, explicit validity/exclusion action, and authorized export controls.

- [ ] **Step 1: Write failing tests for response fetch error versus empty state, filter result, drawer detail from the published question revision, explicit exclusion reason, and export action.**

- [ ] **Step 2: Run response UI tests to verify they fail.**

Run: `pnpm --filter web test -- tests/ui/survey-live-workspace.test.tsx tests/ui/survey-response-review-workspace.test.tsx`

Expected: FAIL because the existing response view is coupled to the broad mock-style workspace and does not own the requested states.

- [ ] **Step 3: Implement the focused response table and detail drawer.**

Render answers against the response's published revision, preserve query/filter state, require a reason for exclusion, and make export unavailable when the current actor lacks permission.

- [ ] **Step 4: Run focused UI tests and typecheck.**

Run: `pnpm --filter web test -- tests/ui/survey-live-workspace.test.tsx tests/ui/survey-response-review-workspace.test.tsx && pnpm --filter web typecheck`

Expected: PASS.

- [ ] **Step 5: Browser-check submitted response selection, exclusion, and export affordance.**

- [ ] **Step 6: Commit and open the linked PR after CI is green.**

Commit: `feat(survey): add focused response review workspace`

## Task 5: Optional templates and protected reports (Issue 5 / PR 5)

**Files:**
- Modify: `apps/web/components/survey/library/template-library.tsx`
- Modify: `apps/web/components/survey/library/template-actions.tsx`
- Modify: `apps/web/components/survey/live/survey-workspace.tsx`
- Modify: `apps/web/components/survey/report/report-document.tsx`
- Modify: `apps/web/tests/ui/survey-template-library-live.test.tsx`
- Modify: `apps/web/tests/ui/survey-live-workspace.test.tsx`

**Interfaces:**
- Consumes: contextual home links, template source serialization, `surveyReportShareBlockedReason`.
- Produces: optional template application and report entry points without adding workflow stages.

- [ ] **Step 1: Write failing tests proving templates are reachable contextually but absent from the primary stage nav, and low-sample reports remain protected without disabling collection.**

- [ ] **Step 2: Run focused template/report tests to verify they fail.**

Run: `pnpm --filter web test -- tests/ui/survey-template-library-live.test.tsx tests/ui/survey-live-workspace.test.tsx`

Expected: FAIL because legacy five-step navigation makes template/report primary stages.

- [ ] **Step 3: Move template/report access to contextual actions and retain the protected-report threshold messaging.**

Template application writes/reviews Markdown through the source flow. Reporting is launched from responses and does not change the three-stage nav.

- [ ] **Step 4: Run focused UI tests and typecheck.**

Run: `pnpm --filter web test -- tests/ui/survey-template-library-live.test.tsx tests/ui/survey-live-workspace.test.tsx && pnpm --filter web typecheck`

Expected: PASS.

- [ ] **Step 5: Browser-check template start and insufficient-sample report behavior.**

- [ ] **Step 6: Commit and open the linked PR after CI is green.**

Commit: `feat(survey): make templates and reports optional`

## Task 6: Migration and end-to-end release evidence (Issue 6 / PR 6)

**Files:**
- Modify: `apps/api/src/application/survey/survey-service.ts`
- Modify: `apps/api/tests/survey/survey-source-lifecycle.test.ts`
- Create: `apps/web/tests/e2e/survey-markdown-workspace.spec.ts`
- Modify: affected survey route/UI test files from Tasks 1–5 only where the E2E findings reveal an integration defect.

**Interfaces:**
- Consumes: legacy `SurveyRuntime` aggregates, `sourceFromDraft`, and source compiler APIs.
- Produces: deterministic legacy-source initialization and browser evidence for the whole supported primary flow.

- [ ] **Step 1: Write failing API migration tests for a legacy aggregate without `source`, invalid legacy content, and existing published answers.**

- [ ] **Step 2: Run lifecycle tests and verify legacy behavior lacks the exact migration/error contract.**

Run: `pnpm --filter api test -- tests/survey/survey-source-lifecycle.test.ts`

Expected: FAIL until migration diagnostics and immutable published-response expectations are explicit.

- [ ] **Step 3: Implement minimal legacy source initialization/diagnostics in `SurveyService` without rewriting published response semantics.**

- [ ] **Step 4: Add Playwright E2E for create → Markdown save/preview → publish → respondent submit → response review → optional protected report.**

- [ ] **Step 5: Run API, web UI, and browser verification.**

Run: `pnpm --filter api test -- tests/survey/survey-source-lifecycle.test.ts && pnpm --filter web test -- tests/ui/survey-live-workspace.test.tsx && pnpm --filter web e2e -- tests/e2e/survey-markdown-workspace.spec.ts`

Expected: PASS, with screenshots/logs stored as PR evidence.

- [ ] **Step 6: Run repository-required verification, commit, and open the linked PR after CI is green.**

Run: `./init.sh && pnpm --filter web lint && pnpm --filter web typecheck`

Commit: `test(survey): verify markdown workspace migration flow`

## Plan Self-Review

- **Spec coverage:** Tasks 1–6 respectively cover navigation/home, Markdown design, publish/collect, response review, optional accelerators, and migration/E2E. All acceptance criteria map to at least one task.
- **Interfaces:** Task 2 introduces the source-editor and stage-nav boundary used by Tasks 3–5; all mutations remain in existing runtime/source contracts.
- **Review focus:** Each listed user-facing failure mode has an explicit owning task and failing-first test.
- **Scope:** The plan intentionally avoids global app navigation changes, schema duplication, and a parallel visual-form persistence model.
