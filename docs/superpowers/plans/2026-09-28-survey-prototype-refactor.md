# Survey Prototype Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repository's one-feature/one-PR and human design-signoff gates take precedence over plan convenience.

**Goal:** Match the approved questionnaire prototype across library, conditional AI import, three-step workspace and optional reports, with durable routes and canonical Markdown data flow.

**Architecture:** Use dedicated App Router pages for durable destinations while reusing existing survey runtime API and domain actions. Keep transient editor selection and dialogs local. Move AI proposal input out of the design canvas and preserve legacy `?step=` URLs through redirects. Make each vertical slice independently reviewable and testable.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind, Zod contracts, Vitest, Playwright, existing survey API.

**Spec:** `docs/superpowers/specs/2026-09-28-survey-prototype-routes-design.md`

## Global Constraints

- Main progress indicator has exactly three stages: design, publish/collect, responses. AI creation alone has a preceding import stage.
- Blank and template creation enter design directly. The designer must not show AI generation or a raw questionnaire Markdown editor.
- Markdown is the canonical design source; AI output is a correctable proposal, applied explicitly. Publication and success-page snapshots do not change retroactively.
- The report template and generated report are optional. No status filter or top-right Markdown import on the library.
- Preserve existing permission, anonymity, server-enforced same-browser once-only, project-linking, version-conflict and unsaved-navigation behavior.
- Do not mark a phase feature `passing` by hand or self-sign the UI/use-case/API bundle. One issue and PR per implementation feature.
- Reuse the existing attached survey worktree; do not create another one for this work.

## Review Focus

- AI import interrupted by refresh or direct open: recover name/tags/proposal where possible and never silently lose an applied draft (Task 2).
- Old `?step=` links including `projectId`: land at the matching canonical page without losing project context (Task 1).
- Published survey editing: existing public response schema and snapshots remain unchanged (Tasks 3 and 4).
- Unsaved draft navigation and stale version: prevent loss/overwrite across dedicated routes (Tasks 1 and 3).
- Zero responses and API failure: show truthful empty/error states, not prototype sample data (Tasks 4 and 5).

## File responsibility map

| Unit | Files and responsibility |
| --- | --- |
| Route model | `apps/web/lib/survey/route-paths.ts` centralizes canonical URL generation and legacy-step mapping. |
| Route pages | `apps/web/app/studio/survey/[surveyId]/page.tsx` handles compatibility; new `design/page.tsx`, `publish/page.tsx`, `responses/page.tsx`, `responses/[responseId]/page.tsx`, `report/page.tsx` are durable destinations. `new/import/page.tsx` is the AI-only entry. |
| Creation and library | `apps/web/components/survey/live/create-survey-dialog.tsx` owns mode selection; `survey-library.tsx` owns card layout and navigation. |
| Shared workspace | `apps/web/components/survey/live/survey-workspace.tsx` is progressively split by view responsibility, preserving existing API operations and autosave; `question-editor.tsx`, `question-settings.tsx` own designer interactions. |
| Other views | `ai-proposal.tsx` import/proposal flow; `collection-overview.tsx`, `collection-settings.tsx`, `response-list.tsx` and report components own their respective screens. |
| Tests | `apps/web/tests/ui/survey-*.test.tsx`, `apps/web/tests/ui/survey-route-layout.test.tsx`, `apps/web/e2e/survey-complete-flow.spec.ts`, and targeted API source/version tests. |

## Task 0: Align authoritative design and obtain signoff

**Files:** `phases/phase-09-survey/contracts/survey/{ui,usecases,domain,coverage}.md`, `phases/phase-09-survey/design-coherence.md`, phase feature list through its approved loader/saver, screenshot material under `ui-preview/survey/`.

**Interfaces:** Consumes the approved spec and supplied prototype. Produces the human-reviewed UI/use-case/API contract and executable feature verification before product implementation.

- [ ] Compare all prototype screens with current code and capture the missing UI materials; update only material backed by real screenshots.
- [ ] Replace obsolete five-step language and reconcile phase feature scope with the three-step flow plus AI-only import, without hand-editing status/owner/evidence.
- [ ] Document API operations and failure modes for create/import/apply/save/publish/review/report; preserve existing Zod schemas as contract single source.
- [ ] Ask the human reviewer to sign UI, use cases and API contract in the bundle and confirm phase coherence. Stop before product code until this gate is satisfied.
- [ ] Run relevant harness design/readiness checks; commit contract material and link the issue/PR.

## Task 1: Introduce canonical route navigation

**Files:** Create `apps/web/lib/survey/route-paths.ts`; create route pages listed in the file map; modify `apps/web/app/studio/survey/[surveyId]/page.tsx`, `apps/web/components/survey/live/survey-workspace.tsx`, `survey-library.tsx`; test `apps/web/tests/ui/survey-route-layout.test.tsx` and `survey-live-workspace.test.tsx`.

**Interfaces:** Produce `surveyPath(id: string, destination: "design" | "publish" | "responses" | "report", projectId?: string | null): string` and `legacySurveyStepPath(id: string, step: string | undefined, projectId?: string | null): string`.

- [ ] Add failing route tests for each canonical destination, unknown legacy step, `projectId` preservation, direct refresh and browser navigation.
- [ ] Run `pnpm --filter web test -- survey-route-layout.test.tsx survey-live-workspace.test.tsx`; require the new assertions to fail before implementation.
- [ ] Add route helpers and pages; redirect old `?step=` links; replace in-app step URL writes with navigation that preserves unsaved-change guard.
- [ ] Rerun targeted tests and `pnpm --filter web typecheck`; commit only this slice and open its issue-linked PR.

## Task 2: Align library and conditional AI creation

**Files:** Modify `survey-library.tsx`, `create-survey-dialog.tsx`, `ai-proposal.tsx`; create `apps/web/app/studio/survey/new/import/page.tsx`; adjust `apps/web/lib/survey/creation-draft.ts` only if needed; tests `survey-live-library.test.tsx`, `survey-create-dialog.test.tsx`, `survey-ai-proposal.test.tsx`, browser flow.

**Interfaces:** Blank/template mode calls existing create API then `surveyPath(id, "design")`; AI mode opens `/studio/survey/new/import` carrying validated name/tags and creates/applies a real draft only after proposal confirmation. Import state must survive refresh through the existing creation-draft encoding or a deliberate persisted mechanism; URL data must be bounded and contain no uploaded file content.

- [ ] Add failing tests for the three creation modes, direct AI import entry, proposal correction/apply, refresh recovery and library prototype elements.
- [ ] Run targeted tests red; implement the library/create/import screens without an AI card in design.
- [ ] Run targeted tests, web typecheck and the creation section of `survey-complete-flow.spec.ts`; commit and submit one issue-linked PR for this behavior.

## Task 3: Rebuild the designer workspace

**Files:** Modify `survey-workspace.tsx`, `question-editor.tsx`, `question-settings.tsx`, `responsive-designer-panel.tsx`; split focused components when the existing file approaches the repository size limit; tests `survey-live-workspace.test.tsx`, `survey-question-types.test.tsx`, `survey-responsive-designer.test.tsx`, `survey-unsaved-navigation.test.tsx`.

**Interfaces:** Designer consumes existing `SurveyRuntime`/`SurveyDraftInput`; editing operations serialize back to canonical Markdown through `@repo/contracts/survey-source` and existing version-checked save API.

- [ ] Add failing tests for prototype toolbox/cover/section/question/settings structure and add/edit/reorder/duplicate/delete/required/options controls.
- [ ] Run targeted tests red; implement the three-column desktop and on-demand mobile panels, removing the visible AI generator and raw questionnaire source editor from design.
- [ ] Verify autosave, unsaved-route guard, conflict handling and published snapshot regressions; run web typecheck and affected API tests; commit and open a separate PR.

## Task 4: Align publication and collection

**Files:** Modify `collection-overview.tsx`, `collection-settings.tsx`, `share-code.tsx`, dedicated publish page; tests `survey-live-publishing.test.tsx`, `survey-collection-settings.test.tsx`, `survey-share-code.test.tsx`, API publication/version tests.

**Interfaces:** All status, counts, latest submissions and share URL come from persisted API state. Publication Markdown and success-page Markdown remain snapshot-bound.

- [ ] Add failing tests for prototype status/settings/share/recent-activity layout, expiry, stop/restart, zero data and API errors.
- [ ] Run targeted tests red; implement view and actions without mock metrics.
- [ ] Run UI/API tests, typecheck and publish/submit browser flow; commit and open its issue-linked PR.

## Task 5: Align response review and optional report

**Files:** Modify `response-list.tsx`, response detail/report route pages and existing report components; tests `survey-response-review.test.tsx`, `survey-response-download.test.tsx`, `survey-report-document.test.tsx`, browser flow.

**Interfaces:** Response detail is addressable by response ID; review/export use existing API and Markdown projection. Report generation remains optional and reads valid responses from the correct publication version.

- [ ] Add failing tests for list/detail direct links, filters, pagination, review, export, zero/error state and optional report navigation.
- [ ] Run targeted tests red; implement adjacent list/detail and prototype report views without making report a fourth required step.
- [ ] Run affected UI/API tests, typecheck and complete browser journey; commit and open one issue-linked PR per independently reviewable response/report slice.

## Task 6: Prove full fidelity and mergeability

**Files:** Extend `apps/web/e2e/survey-complete-flow.spec.ts` and evidence/screenshots; update sprint progress/handoff as required.

**Interfaces:** No new product API. Consumes all prior PRs and the signed contract.

- [ ] Exercise blank, template and AI paths through design, publish, public submission, response review and optional report against live API/database.
- [ ] Capture desktop/mobile screenshots for every prototype screen and record visual discrepancies; fix them in the owning PR rather than a catch-all untraceable change.
- [ ] Run `pnpm --filter web typecheck`, affected UI/API tests, `pnpm --filter web e2e -- survey-complete-flow.spec.ts`, `pnpm -w run verify:base`, and harness verification; store real evidence.
- [ ] Triage every PR check/review thread until the repository's PR classifier reports mergeable; do not self-merge unless authorized by repository role and review policy.
- [ ] Verify the merged version in devapp browser and update progress/handoff with exact remaining differences, if any.
