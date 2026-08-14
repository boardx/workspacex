# Guided Research Split Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give guided research steps a one-third AI conversation workspace and two-thirds compact task workspace, while rendering the final report at the full research-content width.

**Architecture:** Keep `GuidedResearchFlow` and all API/state transitions intact. Strengthen the existing `GuidedResearchStepLayout` as the responsive split shell, make `GuidedResearchSkillAssistant` fill that shell, and render `ReportScreen` outside the split shell with a wide report composition. Layout behavior is guarded by component-level visual contracts plus browser comparison against the two user-supplied screenshots.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, existing shadcn-style components, Vitest, Testing Library.

## Global Constraints

- GitHub issue: `#1253`; the delivery PR must include `Closes #1253`.
- Research home stays full-width and unchanged.
- `brief`, `directions`, `outline`, and `search` use a proportional one-third/two-thirds split on large screens.
- `report` hides the Skill assistant and uses the entire guided-research content width.
- Do not change research APIs, persistence, checkpoint semantics, route names, or session restoration.
- Reuse existing semantic tokens, spacing scale, components, icons, and test IDs; add no dependency or hard-coded visual value.
- Preserve the mobile Skill disclosure and prevent horizontal overflow at 375px, 768px, and 1280px.

---

### Task 1: Lock the approved layout contract with failing tests

**Files:**
- Modify: `apps/web/tests/ui/guided-research-skill-assistant.test.tsx:78-100`
- Modify: `apps/web/tests/ui/guided-research-visual-contract.test.tsx:97-160`

**Interfaces:**
- Consumes: `GuidedResearchStepLayout`, `GuidedResearchFlow`, and existing `research-skill-assistant`, `research-step-main`, and `research-report` test IDs.
- Produces: stable DOM contracts `data-layout="skill-workspace-thirds"`, `data-testid="research-skill-messages"`, `data-testid="research-skill-composer"`, and `data-layout="full-width-report"`.

- [ ] **Step 1: Replace the generic split-shell assertion with the proportional shell contract**

Update the existing layout test to assert the new explicit contract:

```tsx
const workspace = screen.getByTestId("research-step-main").parentElement;
expect(workspace).toHaveAttribute("data-layout", "skill-workspace-thirds");
expect(workspace).toHaveClass("lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]");
```

- [ ] **Step 2: Add the complete conversation-surface assertions**

Render `GuidedResearchSkillAssistant` and add:

```tsx
expect(screen.getByTestId("research-skill-assistant")).toHaveAttribute("data-surface", "full-height-conversation");
expect(screen.getByTestId("research-skill-messages")).toHaveClass("overflow-y-auto");
expect(screen.getByTestId("research-skill-composer")).toBeInTheDocument();
```

- [ ] **Step 3: Separate guided steps from the report in the visual contract loop**

Loop only over `brief`, `directions`, `outline`, and `search` when asserting the Skill workspace. Add a report assertion:

```tsx
api.getGuidedResearchSession.mockResolvedValueOnce(sessionAt("report"));
render(<GuidedResearchFlow step="report" sessionId="grs-visual" />);
await screen.findByTestId("research-flow-report");
expect(screen.queryByTestId("research-skill-assistant")).not.toBeInTheDocument();
expect(screen.getByTestId("research-report")).toHaveAttribute("data-layout", "full-width-report");
```

- [ ] **Step 4: Run the targeted tests and confirm RED**

Run:

```bash
pnpm --filter web exec vitest run tests/ui/guided-research-skill-assistant.test.tsx tests/ui/guided-research-visual-contract.test.tsx
```

Expected: failures show the old `skill-workspace` layout, missing conversation-region test IDs, and old `toc-report-citations` report layout.

- [ ] **Step 5: Commit the contract tests**

```bash
git add apps/web/tests/ui/guided-research-skill-assistant.test.tsx apps/web/tests/ui/guided-research-visual-contract.test.tsx
git commit -m "test(research): require split workspace and wide report"
```

---

### Task 2: Build the one-third conversation workspace shell

**Files:**
- Modify: `apps/web/components/research-studio/guided-research-step-layout.tsx:3-18`
- Modify: `apps/web/components/research-studio/guided-research-skill-assistant.tsx:78-119`
- Test: `apps/web/tests/ui/guided-research-skill-assistant.test.tsx`

**Interfaces:**
- Consumes: `assistant: React.ReactNode`, `children: React.ReactNode`, existing Skill state actions, and mobile `<details>` disclosure.
- Produces: a large-screen proportional grid, a full-height left surface, scrollable messages, and a bottom composer without changing Skill state APIs.

- [ ] **Step 1: Change the shell to the approved proportional grid**

Replace the fixed `20rem` column with:

```tsx
<div
  className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start"
  data-layout="skill-workspace-thirds"
>
```

Keep the mobile `<details>` and use the large-screen aside contract:

```tsx
<aside className="min-w-0 border-t border-border p-3 lg:sticky lg:top-4 lg:h-[calc(100vh-9rem)] lg:border-0 lg:p-0">
  {assistant}
</aside>
```

- [ ] **Step 2: Turn the assistant card into a full-height conversation surface**

Use the existing component with the new structural attributes:

```tsx
<section
  data-testid="research-skill-assistant"
  data-surface="full-height-conversation"
  className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border border-border bg-card p-4"
>
```

Mark the flexible message region:

```tsx
<div data-testid="research-skill-messages" className="mt-4 min-h-32 flex-1 space-y-3 overflow-y-auto pr-1">
```

Mark the composer while preserving its input/button behavior:

```tsx
<div data-testid="research-skill-composer" className="mt-4 flex shrink-0 gap-2">
```

- [ ] **Step 3: Run the Skill and visual contract tests**

Run:

```bash
pnpm --filter web exec vitest run tests/ui/guided-research-skill-assistant.test.tsx tests/ui/guided-research-visual-contract.test.tsx
```

Expected: the shell and assistant assertions pass; report assertions remain RED until Task 3.

- [ ] **Step 4: Commit the shell implementation**

```bash
git add apps/web/components/research-studio/guided-research-step-layout.tsx apps/web/components/research-studio/guided-research-skill-assistant.tsx
git commit -m "feat(research): expand Skill conversation workspace"
```

---

### Task 3: Compact the step workspace and make the report full width

**Files:**
- Modify: `apps/web/components/research-studio/guided-research-flow.tsx:105-166`
- Modify: `apps/web/components/research-studio/guided-research-flow.tsx:352-583`
- Modify: `apps/web/components/research-studio/guided-research-flow.tsx:592-665`
- Test: `apps/web/tests/ui/guided-research-flow.test.tsx`
- Test: `apps/web/tests/ui/guided-research-visual-contract.test.tsx`

**Interfaces:**
- Consumes: existing `FlowProgress`, `PageHeading`, `GuidedResearchStepLayout`, report outline, accepted citations, navigation callbacks, and complete-report action.
- Produces: compact right-side rhythm for four steps and `data-layout="full-width-report"` for report reading.

- [ ] **Step 1: Make the outer flow and progress compact without changing navigation**

Change the flow rhythm from `gap-5 pb-10` to `gap-4 pb-8`. Change progress padding/gaps to the nearest approved compact spacing tokens while keeping all five checkpoint buttons and disabled-future logic intact. Add `data-density="compact"` to `research-flow-progress` so tests do not depend only on copy.

- [ ] **Step 2: Apply compact right-workspace rhythm to the four split steps**

Immediately after each of the four opening `GuidedResearchStepLayout` tags, add `<div className="flex min-w-0 flex-col gap-4" data-density="compact-step">`. Close that wrapper immediately before the matching `</GuidedResearchStepLayout>`. Do not move any heading, notice, card, error, or action outside this wrapper.

Within these wrappers, reduce page-level `gap-5` / `space-y-5` use to `gap-4` / `space-y-4` where it controls whitespace between sections. Do not shrink input heights, textarea usability, button targets, or source action controls.

- [ ] **Step 3: Render the report outside `GuidedResearchStepLayout`**

Remove the report-only `GuidedResearchSkillAssistant` and return a full-width fragment containing the existing heading, warning, report, error, and completion action. The report root becomes:

```tsx
<div
  className="space-y-4"
  data-testid="research-report"
  data-layout="full-width-report"
>
```

- [ ] **Step 4: Replace the narrow three-column report composition**

Render the table of contents as a compact horizontal card above the body:

```tsx
<Card>
  <CardContent className="flex flex-wrap gap-2 p-4">
    {outline.map((item, index) => (
      <a key={item.id} href={`#report-${index}`} className="rounded-md border border-border px-3 py-2 text-11 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        {index + 1}. {item.title}
      </a>
    ))}
  </CardContent>
</Card>
```

Wrap the unchanged report `<article>` and unchanged citations `<Card>` in `<div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">`. Add `min-w-0` to the article class. Keep the article first and citations card second so citations stack below the article before `xl`.

This makes the article dominant at desktop widths and naturally stacks citations below it before `xl`.

- [ ] **Step 5: Run the complete guided-research UI suite**

Run:

```bash
pnpm --filter web exec vitest run --pool=forks --maxWorkers=1 --minWorkers=1 \
  tests/ui/guided-research-skill-assistant.test.tsx \
  tests/ui/guided-research-visual-contract.test.tsx \
  tests/ui/guided-research-flow.test.tsx \
  tests/ui/guided-research-home-live.test.tsx \
  tests/ui/guided-research-checkpoints-live.test.tsx
```

Expected: all files pass; report tests assert no Skill assistant and `full-width-report`.

- [ ] **Step 6: Run static UI verification**

Run:

```bash
pnpm --filter web run typecheck
cd apps/web && ./scripts/lint-design.sh
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit the compact steps and full-width report**

```bash
git add apps/web/components/research-studio/guided-research-flow.tsx apps/web/tests/ui/guided-research-flow.test.tsx apps/web/tests/ui/guided-research-visual-contract.test.tsx
git commit -m "feat(research): widen guided report workspace"
```

---

### Task 4: Perform browser design QA and prepare delivery

**Files:**
- Modify: `design-qa.md`
- Create: `phases/phase-01-run-a-project/ui-preview/guided-research/split-workspace.png`
- Create: `phases/phase-01-run-a-project/ui-preview/guided-research/full-width-report.png`

**Interfaces:**
- Consumes: the user-supplied interview reference screenshot, the user-supplied narrow report screenshot, the local `/research` route, and an authenticated guided-research session.
- Produces: same-viewport visual comparison evidence and a `design-qa.md` whose final result is `passed` or accurately `blocked`.

- [ ] **Step 1: Start the existing local application through the repository-standard command**

Use the standard project start path printed by `./init.sh`; do not introduce a new preview runtime or deployment configuration. Record the actual local web URL and API readiness output.

- [ ] **Step 2: Verify the four-step split layout in the in-app browser**

At a desktop viewport, open a valid guided session and inspect `brief`, `directions`, `outline`, and `search`. Confirm:

- the left conversation surface visibly occupies about one third;
- the composer stays at the bottom and messages scroll inside the left surface;
- the right work area uses the remaining two thirds and is visibly tighter than the current screenshot;
- no research secondary menu appears;
- primary actions still advance the real flow.

- [ ] **Step 3: Verify the report reading mode**

Open `flow=report` for the same session. Confirm:

- no Skill assistant is rendered;
- the report uses the full research content width;
- the horizontal table of contents anchors work;
- the article is the dominant column and citations remain visible;
- no horizontal overflow appears at 375px, 768px, or 1280px.

- [ ] **Step 4: Capture and compare the implementation with both references**

Save the split-step and report screenshots at the exact paths above. Open each source reference beside its same-state implementation capture and document visible P0/P1/P2 differences in `design-qa.md`. Fix and recapture until the file states:

```markdown
**Final result: passed**
```

If authenticated browser access or same-state capture is unavailable, state `**Final result: blocked**` and do not claim visual completion.

- [ ] **Step 5: Run final diff and repository checks**

```bash
git diff --check
node .harness/scripts/lint-ui-material.mjs
git status --short
```

Expected: no whitespace errors, UI material lint passes, and only issue `#1253` files/evidence are changed.

- [ ] **Step 6: Commit visual evidence and push the branch**

```bash
git add design-qa.md phases/phase-01-run-a-project/ui-preview/guided-research
git commit -m "test(research): record split workspace visual QA"
git push -u origin codex/research-split-workspace
```

- [ ] **Step 7: Create the delivery PR**

Create a ready PR titled `feat(research): add split AI workspace and wide report`, include the targeted test/typecheck/design-lint results, the two screenshot paths, the design QA result, and `Closes #1253`.
