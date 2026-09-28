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

- AI import interrupted by refresh or direct open: recover name/tags/proposal where possible and never silently lose an applied draft (Task 3).
- Old `?step=` links including `projectId`: land at the matching canonical page without losing project context (Task 2).
- Published survey editing: existing public response schema and snapshots remain unchanged (Tasks 4 and 5).
- Unsaved draft navigation and stale version: prevent loss/overwrite across dedicated routes (Tasks 2 and 4).
- Zero responses and API failure: show truthful empty/error states, not prototype sample data (Tasks 5 and 6).

## File responsibility map

| Unit | Files and responsibility |
| --- | --- |
| Route model | `apps/web/lib/survey/route-paths.ts` centralizes canonical URL generation and legacy-step mapping. |
| Route pages | `apps/web/app/studio/survey/[surveyId]/page.tsx` handles compatibility; new `design/page.tsx`, `publish/page.tsx`, `responses/page.tsx`, `responses/[responseId]/page.tsx`, `report/page.tsx` are durable destinations. `new/import/page.tsx` is the AI-only entry. |
| Creation and library | `apps/web/components/survey/live/create-survey-dialog.tsx` owns mode selection; `survey-library.tsx` owns card layout and navigation. |
| Shared workspace | `apps/web/components/survey/live/survey-workspace.tsx` is progressively split by view responsibility, preserving existing API operations and autosave; `question-editor.tsx`, `question-settings.tsx` own designer interactions. |
| Other views | `ai-proposal.tsx` import/proposal flow; `collection-overview.tsx`, `collection-settings.tsx`, `response-list.tsx` and report components own their respective screens. |
| Tests | `apps/web/tests/ui/survey-*.test.tsx`, `apps/web/tests/ui/survey-route-layout.test.tsx`, `apps/web/e2e/survey-complete-flow.spec.ts`, and targeted API source/version tests. |

## Task 1: Align authoritative design and obtain signoff

**Files:** `phases/phase-09-survey/contracts/survey/{ui,usecases,domain,coverage}.md`, `phases/phase-09-survey/design-coherence.md`, phase feature list through its approved loader/saver, screenshot material under `ui-preview/survey/`.

**Interfaces:** Consumes the approved spec and supplied prototype. Produces the human-reviewed UI/use-case/API contract and executable feature verification before product implementation.

- [ ] Compare all prototype screens with current code and capture the missing UI materials; update only material backed by real screenshots.
- [ ] Replace obsolete five-step language and reconcile phase feature scope with the three-step flow plus AI-only import, without hand-editing status/owner/evidence.
- [ ] Document API operations and failure modes for create/import/apply/save/publish/review/report; preserve existing Zod schemas as contract single source.
- [ ] Ask the human reviewer to sign UI, use cases and API contract in the bundle and confirm phase coherence. Stop before product code until this gate is satisfied.
- [ ] Run relevant harness design/readiness checks; commit contract material and link the issue/PR.

## Task 2: Align survey home and creation, with canonical route navigation

**Files:** Create `apps/web/lib/survey/route-paths.ts`; create route pages listed in the file map; modify `apps/web/app/studio/survey/[surveyId]/page.tsx`, `apps/web/components/survey/live/survey-workspace.tsx`, `survey-library.tsx`, `create-survey-dialog.tsx`; test `apps/web/tests/ui/survey-route-layout.test.tsx`, `survey-live-library.test.tsx`, `survey-create-dialog.test.tsx` and `survey-live-workspace.test.tsx`.

**Interfaces:** Produce `surveyPath(id: string, destination: "design" | "publish" | "responses" | "report", projectId?: string | null): string` and `legacySurveyStepPath(id: string, step: string | undefined, projectId?: string | null): string`.

- [ ] Add failing tests for prototype secondary navigation, tags, cards, creation dialog, blank/template direct design entry, each canonical destination, legacy step, `projectId`, refresh and history.
- [ ] Run the targeted UI tests; require new assertions to fail before implementation.
- [ ] Implement home/create visuals plus route helpers and pages; redirect old `?step=` links; preserve unsaved-change guard. Do not add status filtering or a top-right Markdown import action.
- [ ] Rerun targeted tests and `pnpm --filter web typecheck`; commit only this slice and open its issue-linked PR.

## Task 3: Align AI import and Markdown correction

**Files:** Modify `ai-proposal.tsx`; create `apps/web/app/studio/survey/new/import/page.tsx`; adjust `apps/web/lib/survey/creation-draft.ts` only if needed; tests `survey-ai-proposal.test.tsx`, `survey-create-dialog.test.tsx`, browser flow.

**Interfaces:** AI mode opens `/studio/survey/new/import` carrying validated name/tags and creates/applies a real draft only after proposal confirmation. Import state must survive refresh through the existing creation-draft encoding or a deliberate persisted mechanism; URL data must be bounded and contain no uploaded file content.

- [ ] Add failing tests for text/file/recording input, direct AI import entry, Markdown edit/render/regenerate/apply, and refresh recovery.
- [ ] Run targeted tests red; implement the standalone import and correction screens without putting AI input in design.
- [ ] Run targeted tests, web typecheck and the creation section of `survey-complete-flow.spec.ts`; commit and submit one issue-linked PR for this behavior.

## Task 4: Rebuild the designer workspace

**Files:** Modify `survey-workspace.tsx`, `question-editor.tsx`, `question-settings.tsx`, `responsive-designer-panel.tsx`; split focused components when the existing file approaches the repository size limit; tests `survey-live-workspace.test.tsx`, `survey-question-types.test.tsx`, `survey-responsive-designer.test.tsx`, `survey-unsaved-navigation.test.tsx`.

**Interfaces:** Designer consumes existing `SurveyRuntime`/`SurveyDraftInput`; editing operations serialize back to canonical Markdown through `@repo/contracts/survey-source` and existing version-checked save API.

- [ ] Add failing tests for prototype toolbox/cover/section/question/settings structure and add/edit/reorder/duplicate/delete/required/options controls.
- [ ] Run targeted tests red; implement the three-column desktop and on-demand mobile panels, removing the visible AI generator and raw questionnaire source editor from design.
- [ ] Verify autosave, unsaved-route guard, conflict handling and published snapshot regressions; run web typecheck and affected API tests; commit and open a separate PR.

## Task 5: Align publication and collection

**Files:** Modify `collection-overview.tsx`, `collection-settings.tsx`, `share-code.tsx`, dedicated publish page; tests `survey-live-publishing.test.tsx`, `survey-collection-settings.test.tsx`, `survey-share-code.test.tsx`, API publication/version tests.

**Interfaces:** All status, counts, latest submissions and share URL come from persisted API state. Publication Markdown and success-page Markdown remain snapshot-bound.

- [ ] Add failing tests for prototype status/settings/share/recent-activity layout, expiry, stop/restart, zero data and API errors.
- [ ] Run targeted tests red; implement view and actions without mock metrics.
- [ ] Run UI/API tests, typecheck and publish/submit browser flow; commit and open its issue-linked PR.

## Task 6: Align response review

**Files:** Modify `response-list.tsx` and response detail route page; tests `survey-response-review.test.tsx`, `survey-response-download.test.tsx`, browser flow.

**Interfaces:** Response detail is addressable by response ID; review/export use existing API and Markdown projection.

- [ ] Add failing tests for list/detail direct links, filters, pagination, review, export and zero/error state.
- [ ] Run targeted tests red; implement adjacent list/detail against real responses.
- [ ] Run affected UI/API tests, typecheck and browser journey; commit and open its issue-linked PR.

## Task 7: Align optional questionnaire/report templates and analysis report

**Files:** Modify existing question/report template library and report components plus report route page; tests `survey-template-workspace-live.test.tsx`, `survey-report-document.test.tsx`, `survey-flexible-template.test.tsx`, browser flow.

**Interfaces:** Template reuse copies question content into a new draft; report generation reads valid answers from the correct publication version. Neither is a required stage before publish or review.

- [ ] Add failing tests for template navigation/reuse, optional report template editing, generation, Word/PDF or existing export affordances and empty/error states.
- [ ] Run targeted tests red; implement prototype-aligned optional views without inserting a fourth main step.
- [ ] Run affected UI/API tests, typecheck and browser flow; commit and open its issue-linked PR.

## Task 8: Prove cross-cutting quality, full fidelity and mergeability

**Files:** Extend `apps/web/e2e/survey-complete-flow.spec.ts` and evidence/screenshots; update sprint progress/handoff as required.

**Interfaces:** No new product API. Consumes all prior PRs and the signed contract.

- [ ] Exercise blank, template and AI paths through design, publish, public submission, response review and optional report against live API/database.
- [ ] Capture desktop/mobile screenshots for every prototype screen and record visual discrepancies; fix them in the owning PR rather than a catch-all untraceable change.
- [ ] Run `pnpm --filter web typecheck`, affected UI/API tests, `pnpm --filter web e2e -- survey-complete-flow.spec.ts`, `pnpm -w run verify:base`, and harness verification; store real evidence.
- [ ] Triage every PR check/review thread until the repository's PR classifier reports mergeable; do not self-merge unless authorized by repository role and review policy.
- [ ] Verify the merged version in devapp browser and update progress/handoff with exact remaining differences, if any.
