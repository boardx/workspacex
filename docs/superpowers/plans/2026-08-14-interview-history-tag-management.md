# Interview History Tag Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace status filtering on the interview history screen with dynamic single-select Tag filtering, and let users persistently edit or delete local Mock interview cards.

**Architecture:** Keep the service response and local Mock drafts as one combined history read model in `InterviewStudioHome`, then derive available Tags and visible cards client-side. Add narrow metadata-update and delete operations to the existing Mock draft store. Render Mock-only card actions in a focused component using Radix Dropdown Menu and Dialog primitives; real server rows remain read-only.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Radix UI, Vitest, Testing Library, browser localStorage.

## Global Constraints

- Only `mock-batch-*` interviews may be edited or deleted in this slice.
- Real backend interview rows remain read-only and must not receive local shadow mutations.
- Tag filtering is single-select and includes an “全部” option.
- Interview names are required and limited to 100 characters; Tags are trimmed, deduplicated, and limited to 5.
- Editing metadata must not modify topic, step, experts, questions, progress, results, report, or source pointers.
- Deletion requires explicit confirmation and removes the complete Mock draft.
- Reuse existing dependencies and Radix primitives; add no package dependency.
- Preserve unrelated dirty worktree changes and stage only files owned by this plan.

---

### Task 1: Add Explicit Mock Metadata and Delete Operations

**Files:**
- Modify: `apps/web/lib/mock/digital-interview-drafts.ts`
- Test: `apps/web/tests/digital-interview-drafts.test.ts`

**Interfaces:**
- Consumes: existing `updateMockDigitalInterviewDraft(interviewId, updater)` and `normalizeTags(tags)`.
- Produces: `updateMockDigitalInterviewMetadata(interviewId: string, input: { readonly name: string; readonly tags: readonly string[] }): MockDigitalInterviewDraft`.
- Produces: `deleteMockDigitalInterviewDraft(interviewId: string): void`.

- [ ] **Step 1: Write failing storage tests**

Add imports for the two new functions, then add tests equivalent to:

```ts
it("只更新 Mock 访谈名称与标签并保留流程内容", () => {
  const draft = createMockDigitalInterviewDraft({ name: "旧名称", tags: ["旧标签"] });
  const updated = updateMockDigitalInterviewMetadata(draft.interviewId, {
    name: " 新名称 ",
    tags: ["采购", "采购", " 德国 ", "储能", "决策", "B2B", "超限"],
  });

  expect(updated).toMatchObject({ name: "新名称", tags: ["采购", "德国", "储能", "决策", "B2B"] });
  expect(updated.currentStep).toBe(draft.currentStep);
  expect(updated.version).toBe(draft.version + 1);
});

it("删除 Mock 草稿后不再出现在历史存储中", () => {
  const keep = createMockDigitalInterviewDraft({ name: "保留", tags: [] });
  const removed = createMockDigitalInterviewDraft({ name: "删除", tags: [] });

  deleteMockDigitalInterviewDraft(removed.interviewId);

  expect(listMockDigitalInterviewDrafts().map((draft) => draft.interviewId)).toEqual([keep.interviewId]);
});
```

Also assert that a blank name throws `MOCK_INTERVIEW_NAME_REQUIRED` and a non-Mock ID throws `MOCK_INTERVIEW_NOT_FOUND`.

- [ ] **Step 2: Run the focused storage suite and verify RED**

Run:

```bash
pnpm --filter web exec vitest run tests/digital-interview-drafts.test.ts
```

Expected: FAIL because `updateMockDigitalInterviewMetadata` and `deleteMockDigitalInterviewDraft` are not exported.

- [ ] **Step 3: Implement the two narrow storage operations**

Add:

```ts
export function updateMockDigitalInterviewMetadata(
  interviewId: string,
  input: { readonly name: string; readonly tags: readonly string[] },
): MockDigitalInterviewDraft {
  const name = input.name.trim();
  if (!name) throw new Error("MOCK_INTERVIEW_NAME_REQUIRED");
  return updateMockDigitalInterviewDraft(interviewId, (draft) => ({
    ...draft,
    name: name.slice(0, 100),
    tags: normalizeTags(input.tags),
  }));
}

export function deleteMockDigitalInterviewDraft(interviewId: string): void {
  const drafts = readAll();
  if (!interviewId.startsWith("mock-batch-") || !drafts[interviewId]) {
    throw new Error("MOCK_INTERVIEW_NOT_FOUND");
  }
  const { [interviewId]: _removed, ...remaining } = drafts;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
}
```

Keep `normalizeTags` as the single metadata normalization source.

- [ ] **Step 4: Run the focused storage suite and verify GREEN**

Run the same Vitest command. Expected: all draft compatibility and new CRUD tests pass with no warnings.

- [ ] **Step 5: Commit only the storage task**

```bash
git add apps/web/lib/mock/digital-interview-drafts.ts apps/web/tests/digital-interview-drafts.test.ts
git commit -m "feat(interview): manage mock history metadata"
```

---

### Task 2: Replace Status Filters with Dynamic Tag Filters

**Files:**
- Modify: `apps/web/components/itv/interview-studio-home.tsx`
- Test: `apps/web/tests/ui/interview-studio-home.test.tsx`

**Interfaces:**
- Consumes: combined `DigitalInterviewHistoryRow[]` already stored in the ready load state.
- Produces: a selected Tag state `selectedTag: string | undefined`, derived `availableTags`, and derived `visibleHistoryItems`.

- [ ] **Step 1: Write a failing UI test for dynamic single-select Tags**

Extend the existing API fixture so one row has `tags: ["采购决策", "德国"]` and another has `tags: ["报告"]`. Assert:

```ts
expect(await screen.findByRole("button", { name: "全部" })).toHaveClass("bg-primary");
expect(screen.getByRole("button", { name: "采购决策" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "德国" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "报告" })).toBeInTheDocument();
expect(screen.queryByRole("button", { name: "进行中" })).not.toBeInTheDocument();

fireEvent.click(screen.getByRole("button", { name: "报告" }));
expect(screen.getByTestId("itv-history-card-itv-2")).toBeInTheDocument();
expect(screen.queryByTestId("itv-history-card-itv-1")).not.toBeInTheDocument();
```

Also verify that the history request URL has no `status` query parameter.

- [ ] **Step 2: Run the focused home suite and verify RED**

```bash
pnpm --filter web exec vitest run tests/ui/interview-studio-home.test.tsx
```

Expected: FAIL because the page still renders status buttons and refetches by status.

- [ ] **Step 3: Implement client-side Tag derivation and filtering**

In `InterviewStudioHome`:

```ts
const [selectedTag, setSelectedTag] = React.useState<string | undefined>();

const historyItems = history.kind === "ready" ? history.items : [];
const availableTags = React.useMemo(
  () => Array.from(new Set(historyItems.flatMap((item) => item.tags))),
  [historyItems],
);
const visibleHistoryItems = selectedTag
  ? historyItems.filter((item) => item.tags.includes(selectedTag))
  : historyItems;
```

Load history once with `loadDigitalInterviewHistory()` and remove `status` from the effect dependency. Render `全部` followed by `availableTags`, and pass a ready state containing `visibleHistoryItems` to `HistoryContent` while preserving loading/error states.

Add an effect that clears `selectedTag` when it no longer exists in `availableTags`.

- [ ] **Step 4: Run the focused home suite and verify GREEN**

Run the same Vitest command. Expected: the Tag filtering regression and all existing Studio home tests pass.

- [ ] **Step 5: Commit only the Tag-filter task**

```bash
git add apps/web/components/itv/interview-studio-home.tsx apps/web/tests/ui/interview-studio-home.test.tsx
git commit -m "feat(interview): filter history by tag"
```

---

### Task 3: Add Mock-Only Edit and Delete Card Actions

**Files:**
- Create: `apps/web/components/itv/interview-history-card-actions.tsx`
- Modify: `apps/web/components/itv/interview-studio-home.tsx`
- Test: `apps/web/tests/ui/interview-studio-home.test.tsx`

**Interfaces:**
- Consumes: `DigitalInterviewHistoryRow`, `updateMockDigitalInterviewMetadata`, and `deleteMockDigitalInterviewDraft`.
- Produces: `InterviewHistoryCardActions({ item, onChanged }: { item: DigitalInterviewHistoryRow; onChanged: () => void })`.
- `onChanged` rebuilds the combined history state from current local Mock drafts plus the previously loaded server rows.

- [ ] **Step 1: Write failing UI tests for menu visibility and editing**

Create one local Mock draft and one server row, then assert only the Mock card has `itv-history-actions-<id>`. Open the menu, click “编辑”, update the name, remove the old Tag, add a new Tag with Enter, and save:

```ts
fireEvent.click(within(mockCard).getByRole("button", { name: "管理访谈" }));
fireEvent.click(await screen.findByRole("menuitem", { name: "编辑" }));
fireEvent.change(screen.getByTestId("itv-edit-name"), { target: { value: "新版采购访谈" } });
fireEvent.click(screen.getByLabelText("删除标签 采购"));
fireEvent.change(screen.getByTestId("itv-edit-tag-input"), { target: { value: "德国" } });
fireEvent.keyDown(screen.getByTestId("itv-edit-tag-input"), { key: "Enter" });
fireEvent.click(screen.getByTestId("itv-edit-submit"));

expect(await screen.findByText("新版采购访谈")).toBeInTheDocument();
expect(loadMockDigitalInterviewDraft(draft.interviewId)).toMatchObject({ name: "新版采购访谈", tags: ["德国"] });
```

Assert the server card has no “管理访谈” button.

- [ ] **Step 2: Run the focused home suite and verify edit RED**

Run the Studio home Vitest command. Expected: FAIL because no Mock card action menu or edit dialog exists.

- [ ] **Step 3: Implement the Mock-only action menu and edit dialog**

Use `@radix-ui/react-dropdown-menu` for the bottom-right ellipsis menu and `@radix-ui/react-dialog` for the edit dialog. Reuse `Button`, `Input`, `Label`, and the create-modal Tag entry semantics. Requirements encoded in the component:

```ts
if (!item.interviewId.startsWith("mock-batch-")) return null;
```

- Trigger: `aria-label="管理访谈"`, `data-testid="itv-history-actions-${item.interviewId}"`.
- Menu items: “编辑” and destructive “删除”.
- Edit dialog: prefilled name and Tags, max 100/5, submit disabled for blank name.
- Errors remain visible in the open dialog instead of closing it.

Place the action component in the footer row opposite the primary action so it sits at the bottom-right of the card.

- [ ] **Step 4: Run the focused home suite and verify edit GREEN**

Run the Studio home Vitest command. Expected: edit behavior passes and existing history actions still route correctly.

- [ ] **Step 5: Write the failing delete-confirmation test**

Open the Mock menu and click “删除”. First click “取消” and assert the card and local draft remain. Open again, confirm deletion, then assert both are absent:

```ts
fireEvent.click(within(mockCard).getByRole("button", { name: "管理访谈" }));
fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }));
expect(screen.getByRole("dialog", { name: "删除访谈" })).toHaveTextContent("主题、专家、问题、进度和报告");
fireEvent.click(screen.getByRole("button", { name: "取消" }));
expect(loadMockDigitalInterviewDraft(draft.interviewId)).not.toBeNull();

fireEvent.click(within(mockCard).getByRole("button", { name: "管理访谈" }));
fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }));
fireEvent.click(screen.getByTestId("itv-delete-confirm"));
expect(screen.queryByTestId(`itv-history-card-${draft.interviewId}`)).not.toBeInTheDocument();
expect(loadMockDigitalInterviewDraft(draft.interviewId)).toBeNull();
```

- [ ] **Step 6: Run the focused home suite and verify delete RED**

Expected: FAIL because delete confirmation is not implemented.

- [ ] **Step 7: Implement the delete confirmation dialog**

Use a second Radix Dialog state. On confirm, call `deleteMockDigitalInterviewDraft(item.interviewId)`, close the dialog, then call `onChanged()`. Use `data-testid="itv-delete-confirm"` on the destructive button and keep the cancel button non-destructive.

- [ ] **Step 8: Run the focused home suite and verify full task GREEN**

Run the Studio home suite again. Expected: Tag filtering, edit, delete cancellation, delete confirmation, read-only server rows, existing creation, and existing routing all pass.

- [ ] **Step 9: Commit only the card-action task**

```bash
git add apps/web/components/itv/interview-history-card-actions.tsx apps/web/components/itv/interview-studio-home.tsx apps/web/tests/ui/interview-studio-home.test.tsx
git commit -m "feat(interview): edit and delete mock history cards"
```

---

### Task 4: Verify the Integrated History Experience

**Files:**
- Verify: `apps/web/components/itv/interview-history-card-actions.tsx`
- Verify: `apps/web/components/itv/interview-studio-home.tsx`
- Verify: `apps/web/lib/mock/digital-interview-drafts.ts`
- Verify: `apps/web/tests/digital-interview-drafts.test.ts`
- Verify: `apps/web/tests/ui/interview-studio-home.test.tsx`

**Interfaces:**
- Consumes all completed tasks.
- Produces fresh verification evidence only; no new behavior.

- [ ] **Step 1: Run both focused regression suites together**

```bash
pnpm --filter web exec vitest run tests/digital-interview-drafts.test.ts tests/ui/interview-studio-home.test.tsx
```

Expected: both files pass with zero failures.

- [ ] **Step 2: Run Web type checking**

```bash
pnpm --filter web run typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Run design lint**

```bash
pnpm --filter web run lint:design
```

Expected: exit code 0 with no new design violations.

- [ ] **Step 4: Inspect owned diff and verify scope**

```bash
git diff --check
git diff -- apps/web/components/itv/interview-history-card-actions.tsx apps/web/components/itv/interview-studio-home.tsx apps/web/lib/mock/digital-interview-drafts.ts apps/web/tests/digital-interview-drafts.test.ts apps/web/tests/ui/interview-studio-home.test.tsx
```

Confirm the diff contains no backend mutation, no real-row shadow state, and no unrelated worktree changes.

- [ ] **Step 5: Record final implementation commit if Task 3 did not already include all owned files**

```bash
git add apps/web/components/itv/interview-history-card-actions.tsx apps/web/components/itv/interview-studio-home.tsx apps/web/lib/mock/digital-interview-drafts.ts apps/web/tests/digital-interview-drafts.test.ts apps/web/tests/ui/interview-studio-home.test.tsx
git commit -m "test(interview): verify history tag management"
```

Skip this commit only when there are no owned uncommitted changes.
