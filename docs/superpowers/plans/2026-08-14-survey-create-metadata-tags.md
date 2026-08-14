# Survey Creation Metadata and Tag Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a required-name, multi-tag creation dialog for blank and single-module surveys, then expose survey tags with OR filtering on the list.

**Architecture:** Keep one `SurveyCreationDraft` as the authority for name, tags, and optional source module. Serialize that object into one `draft` query parameter at the list-to-designer route boundary, decode it once in the page, and pass it through the workflow shell into the mock model. Keep creation UI in a focused dialog component and derive filter choices from the same tags stored on survey cards.

**Tech Stack:** Next.js App Router, React, TypeScript, Radix Dialog, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- Work only in `/private/tmp/workspacex-survey-create-metadata-tags` on `codex/survey-create-metadata-tags`.
- A survey has a required trimmed name and zero or more normalized unique tags.
- Multiple selected tag filters use OR semantics; text search and the tag predicate combine with AND semantics.
- Module-based creation selects exactly one question module and clones its questions.
- Blank creation starts with zero questions and both creation paths open the full workflow timeline.
- Do not add dependencies, backend persistence, tag taxonomy management, multiple-module composition, or report-module changes.
- Run targeted Survey tests during TDD. Do not run `./init.sh` or the whole monorepo test suite for each task.

---

## File structure

- Create `apps/web/lib/survey/creation-draft.ts`: creation draft type, normalization, single-parameter encoding, and safe decoding.
- Create `apps/web/components/survey/resource-library/survey-create-dialog.tsx`: accessible two-stage creation dialog.
- Create `apps/web/tests/ui/survey-creation-draft.test.ts`: draft codec and normalization tests.
- Create `apps/web/tests/ui/survey-create-dialog.test.tsx`: dialog behavior and navigation tests.
- Modify `apps/web/lib/survey/workflow-model.ts`: initialize new survey title and copied questions from the decoded draft.
- Modify `apps/web/lib/survey/resource-library.ts`: add card tags as the list/filter single source.
- Modify `apps/web/components/survey/resource-library/survey-resource-library.tsx`: open the dialog, render tags, and apply tag filters.
- Modify `apps/web/app/studio/survey/[surveyId]/page.tsx`: decode only the `draft` query parameter for new full surveys.
- Modify `apps/web/components/survey/workflow/survey-workflow-shell.tsx`: preserve one encoded draft while switching workflow steps.
- Modify `apps/web/tests/ui/survey-workflow-model.test.ts`, `survey-workflow-shell.test.tsx`, `survey-resource-library.test.tsx`, and `survey-route-layout.test.tsx`: regression and route coverage.

### Task 1: Creation draft codec and workflow initialization

**Files:**
- Create: `apps/web/lib/survey/creation-draft.ts`
- Create: `apps/web/tests/ui/survey-creation-draft.test.ts`
- Modify: `apps/web/lib/survey/workflow-model.ts`
- Modify: `apps/web/tests/ui/survey-workflow-model.test.ts`
- Modify: `apps/web/app/studio/survey/[surveyId]/page.tsx`
- Modify: `apps/web/components/survey/workflow/survey-workflow-shell.tsx`
- Modify: `apps/web/tests/ui/survey-workflow-shell.test.tsx`
- Modify: `apps/web/tests/ui/survey-route-layout.test.tsx`

**Interfaces:**
- Produces: `SurveyCreationDraft = { name: string; tags: string[]; sourceModuleId?: string }`.
- Produces: `normalizeSurveyCreationDraft(input): SurveyCreationDraft | null`.
- Produces: `encodeSurveyCreationDraft(draft): string` and `decodeSurveyCreationDraft(value): SurveyCreationDraft | null`.
- Changes `createSurveyWorkflowMock` to consume `creationDraft?: SurveyCreationDraft` instead of `sourceModuleId?: string`.
- Changes `SurveyWorkflowShell` to consume `creationDraft?: SurveyCreationDraft` and preserve it as one `draft` query parameter.

- [ ] **Step 1: Write failing codec and model tests**

Add tests with these assertions:

```ts
expect(normalizeSurveyCreationDraft({ name: "  新员工体验  ", tags: [" HR ", "HR", "文化", ""] })).toEqual({
  name: "新员工体验",
  tags: ["HR", "文化"],
});

const encoded = encodeSurveyCreationDraft({ name: "团队健康度", tags: ["协作"], sourceModuleId: "strategy" });
expect(decodeSurveyCreationDraft(encoded)).toEqual({ name: "团队健康度", tags: ["协作"], sourceModuleId: "strategy" });
expect(decodeSurveyCreationDraft("not-json")).toBeNull();

const blank = createSurveyWorkflowMock({
  surveyId: "new",
  creationDraft: { name: "空白问卷", tags: ["内部"] },
});
expect(blank.survey.title).toBe("空白问卷");
expect(blank.questions).toHaveLength(0);

const basedOnModule = createSurveyWorkflowMock({
  surveyId: "new",
  creationDraft: { name: "战略调查", tags: [], sourceModuleId: "strategy" },
});
expect(basedOnModule.survey.title).toBe("战略调查");
expect(basedOnModule.questions.map(({ id }) => id)).toEqual(["Q04", "Q05", "Q06"]);
```

- [ ] **Step 2: Run the focused tests and capture RED**

Run:

```bash
pnpm --filter web exec vitest run tests/ui/survey-creation-draft.test.ts tests/ui/survey-workflow-model.test.ts
```

Expected: FAIL because the codec and `creationDraft` option do not exist.

- [ ] **Step 3: Implement the minimal codec and model boundary**

Use one serialized object, not parallel name/tag/module query keys:

```ts
export interface SurveyCreationDraft {
  name: string;
  tags: string[];
  sourceModuleId?: string;
}

export function normalizeSurveyCreationDraft(input: unknown): SurveyCreationDraft | null {
  if (!input || typeof input !== "object") return null;
  const value = input as { name?: unknown; tags?: unknown; sourceModuleId?: unknown };
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return null;
  const tags = Array.isArray(value.tags)
    ? [...new Set(value.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))]
    : [];
  const sourceModuleId = typeof value.sourceModuleId === "string" && value.sourceModuleId.trim()
    ? value.sourceModuleId.trim()
    : undefined;
  return sourceModuleId ? { name, tags, sourceModuleId } : { name, tags };
}

export const encodeSurveyCreationDraft = (draft: SurveyCreationDraft) => JSON.stringify(normalizeSurveyCreationDraft(draft));

export function decodeSurveyCreationDraft(value?: string): SurveyCreationDraft | null {
  if (!value) return null;
  try { return normalizeSurveyCreationDraft(JSON.parse(value)); } catch { return null; }
}
```

In `createSurveyWorkflowMock`, use `creationDraft?.sourceModuleId` only when `surveyId === "new"` and `moduleEditor` is false. Use `creationDraft?.name ?? "未命名问卷"` for a new full survey title. Preserve the existing module-editor identity rules.

- [ ] **Step 4: Add route and shell regression tests, then implement route plumbing**

Test that a decoded draft reaches the shell, the entered title renders, blank creation has no question card, module creation has its copied question cards, and workflow step navigation retains exactly one `draft=` parameter without `sourceModule=`.

Update the page search parameter type to:

```ts
searchParams: { step?: string; state?: string; readonly?: string; mode?: string; draft?: string };
```

Decode only for `params.surveyId === "new" && searchParams.mode !== "module"`. In `navigate`, call `searchParams.set("draft", encodeSurveyCreationDraft(creationDraft))` when a draft exists.

- [ ] **Step 5: Run Task 1 tests and commit**

Run:

```bash
pnpm --filter web exec vitest run tests/ui/survey-creation-draft.test.ts tests/ui/survey-workflow-model.test.ts tests/ui/survey-workflow-shell.test.tsx tests/ui/survey-route-layout.test.tsx
```

Expected: PASS.

Commit:

```bash
git add apps/web/lib/survey/creation-draft.ts apps/web/lib/survey/workflow-model.ts apps/web/app/studio/survey/'[surveyId]'/page.tsx apps/web/components/survey/workflow/survey-workflow-shell.tsx apps/web/tests/ui/survey-creation-draft.test.ts apps/web/tests/ui/survey-workflow-model.test.ts apps/web/tests/ui/survey-workflow-shell.test.tsx apps/web/tests/ui/survey-route-layout.test.tsx
git commit -m "feat(survey): carry creation metadata into designer"
```

### Task 2: Accessible blank and module-based creation dialog

**Files:**
- Create: `apps/web/components/survey/resource-library/survey-create-dialog.tsx`
- Create: `apps/web/tests/ui/survey-create-dialog.test.tsx`
- Modify: `apps/web/components/survey/resource-library/survey-resource-library.tsx`
- Modify: `apps/web/tests/ui/survey-resource-library.test.tsx`

**Interfaces:**
- Consumes: `SurveyCreationDraft` and `encodeSurveyCreationDraft` from Task 1.
- Consumes: `SURVEY_QUESTION_MODULE_CARDS` as the only module picker source.
- Produces: `SurveyCreateDialog({ open, mode, onOpenChange, onCreate })`, where `mode` is `"blank" | "module"` and `onCreate(draft: SurveyCreationDraft)` is called once after valid completion.

- [ ] **Step 1: Write failing dialog behavior tests**

Cover these exact behaviors:

```ts
expect(screen.getByRole("button", { name: "创建问卷" })).toBeDisabled();
fireEvent.change(screen.getByLabelText("问卷名称"), { target: { value: "季度协作调查" } });
fireEvent.change(screen.getByLabelText("标签（可选）"), { target: { value: "协作" } });
fireEvent.keyDown(screen.getByLabelText("标签（可选）"), { key: "Enter" });
expect(screen.getByRole("button", { name: "删除标签 协作" })).toBeInTheDocument();
```

Also prove comma commit, trimming, duplicate suppression, individual removal, close/reset, module-mode `下一步`, exactly one `aria-pressed="true"` module, back preserving metadata, and final `onCreate` containing one `sourceModuleId`.

- [ ] **Step 2: Run the dialog test and capture RED**

Run:

```bash
pnpm --filter web exec vitest run tests/ui/survey-create-dialog.test.tsx
```

Expected: FAIL because `SurveyCreateDialog` does not exist.

- [ ] **Step 3: Implement the dialog with the existing Radix pattern**

Follow `apps/web/components/itv/digital-interview-create-modal.tsx` for overlay, focus handling, title, description, close button, labeled input, chips, and actions. Keep one state object:

```ts
type CreationMode = "blank" | "module";
type DialogStep = "metadata" | "module";

const [draft, setDraft] = React.useState<SurveyCreationDraft>({ name: "", tags: [] });
const [tagInput, setTagInput] = React.useState("");
const [step, setStep] = React.useState<DialogStep>("metadata");
```

For blank mode, metadata submit calls `onCreate(normalizedDraft)`. For module mode, metadata submit advances to `module`; a module card replaces only `draft.sourceModuleId`; final submit calls `onCreate`. Closing resets all local state.

- [ ] **Step 4: Replace both direct navigation buttons with dialog entry points**

In `SurveyResourceLibrary`, keep one `createMode` state. `新建问卷` opens `blank`; `从问卷模块新建` opens `module`. Both pass this callback:

```ts
const createSurvey = (draft: SurveyCreationDraft) => {
  const params = new URLSearchParams({ step: "design", draft: encodeSurveyCreationDraft(draft) });
  router.push(`/studio/survey/new?${params.toString()}`);
};
```

Remove the old `intent=create-survey` list-to-modules selection path and its now-unused copy/branching. Do not change normal question-module management cards.

- [ ] **Step 5: Run Task 2 tests and commit**

Run:

```bash
pnpm --filter web exec vitest run tests/ui/survey-create-dialog.test.tsx tests/ui/survey-resource-library.test.tsx
```

Expected: PASS.

Commit:

```bash
git add apps/web/components/survey/resource-library/survey-create-dialog.tsx apps/web/components/survey/resource-library/survey-resource-library.tsx apps/web/tests/ui/survey-create-dialog.test.tsx apps/web/tests/ui/survey-resource-library.test.tsx
git commit -m "feat(survey): add guided survey creation dialog"
```

### Task 3: Survey card tags and OR filtering

**Files:**
- Modify: `apps/web/lib/survey/resource-library.ts`
- Modify: `apps/web/components/survey/resource-library/survey-resource-library.tsx`
- Modify: `apps/web/tests/ui/survey-resource-library.test.tsx`

**Interfaces:**
- Extends `SurveyLibraryCard` with `tags: string[]`.
- Derives available tags from `SURVEY_LIBRARY_CARDS.flatMap((item) => item.tags)`; no second catalog.
- Keeps selected tags in `selectedTags: string[]` and applies `selectedTags.length === 0 || selectedTags.some((tag) => item.tags.includes(tag))`.

- [ ] **Step 1: Write failing display and filter tests**

Add assertions that cards display their assigned tag chips, tag buttons expose `aria-pressed`, selecting two tags uses OR, text and tags combine with AND, clearing restores all cards, and rerendering to modules clears both query and selected tags.

Use a data set where one selected tag matches `sv-1` and another matches `sv-team-health`, then assert both are visible while an unrelated survey is absent.

- [ ] **Step 2: Run the resource-library test and capture RED**

Run:

```bash
pnpm --filter web exec vitest run tests/ui/survey-resource-library.test.tsx
```

Expected: FAIL because cards have no tags and no tag filter exists.

- [ ] **Step 3: Add tags to the card authority and implement filtering**

Add realistic tags directly to each `SURVEY_LIBRARY_CARDS` item. Derive unique filter values with insertion order preserved:

```ts
const availableTags = [...new Set(SURVEY_LIBRARY_CARDS.flatMap((item) => item.tags))];
const matchesTags = selectedTags.length === 0 || selectedTags.some((tag) => item.tags.includes(tag));
const matchesQuery = item.title.includes(query.trim());
return matchesQuery && matchesTags;
```

Render a labeled `问卷标签筛选` group above the cards only on the survey tab. Each tag button toggles membership and uses `aria-pressed`. Render `清除标签筛选` only when a selection exists. Render card tags from `item.tags` using the existing Badge component.

- [ ] **Step 4: Reset list-only filters when leaving surveys**

Extend the existing `[tab]` effect:

```ts
React.useEffect(() => {
  setQuery("");
  setSelectedTags([]);
}, [tab]);
```

- [ ] **Step 5: Run Task 3 tests and commit**

Run:

```bash
pnpm --filter web exec vitest run tests/ui/survey-resource-library.test.tsx
```

Expected: PASS.

Commit:

```bash
git add apps/web/lib/survey/resource-library.ts apps/web/components/survey/resource-library/survey-resource-library.tsx apps/web/tests/ui/survey-resource-library.test.tsx
git commit -m "feat(survey): display and filter survey tags"
```

### Task 4: Integrated verification and handoff

**Files:**
- Verify only; modify production files only if a failing targeted regression demonstrates a feature-scoped defect.

**Interfaces:**
- Consumes the complete behavior from Tasks 1–3.
- Produces a clean exact SHA and evidence for review.

- [ ] **Step 1: Run the complete targeted Survey suite**

Run:

```bash
pnpm --filter web exec vitest run \
  tests/ui/survey-creation-draft.test.ts \
  tests/ui/survey-create-dialog.test.tsx \
  tests/ui/survey-resource-library.test.tsx \
  tests/ui/survey-workflow-model.test.ts \
  tests/ui/survey-workflow-shell.test.tsx \
  tests/ui/survey-route-layout.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 2: Run bounded static gates once**

Run:

```bash
pnpm --filter web exec tsc --noEmit --incremental false
pnpm --filter web lint:design
git diff --check 1b77066c8001cf4cef14740add7776ffddf8a576...HEAD
```

Expected: all commands exit 0. If TypeScript reports pre-existing failures outside Survey, record the exact files and separately prove no Survey errors; do not fix unrelated modules.

- [ ] **Step 3: Perform one browser acceptance pass**

Start the web app on one available port, then verify:

1. `/studio/survey` keeps the global rail and three Survey entries.
2. `新建问卷` requires a name, accepts multiple tags, and opens an empty full designer with the entered title.
3. `从问卷模块新建` preserves metadata, permits one module, and opens the full designer with copied questions.
4. Survey cards show tags; two selected filters use OR; text plus tags narrows results.
5. Returning to the list and changing Survey sections does not leak stale filters.

- [ ] **Step 4: Review scope and commit any test-only integration adjustment**

Run:

```bash
git status --short
git diff --stat 1b77066c8001cf4cef14740add7776ffddf8a576...HEAD
git log --oneline 1b77066c8001cf4cef14740add7776ffddf8a576..HEAD
```

Expected: only Survey implementation, Survey tests, and these design/plan documents are present; the worktree is clean after the final commit.
