# Guided Research Persistent Skill Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the research Skill assistant visible in the same left-side workspace as the interview assistant for every guided research step, including the final report.

**Architecture:** Reuse the existing `GuidedResearchStepLayout` and `GuidedResearchSkillAssistant`; they already compose the first four research steps with a responsive left assistant column. Change only `ReportScreen` to use that same layout and remove the report-only exception from the visual contract. The assistant remains local UI state and does not change any guided-research API, persistence, navigation, or checkpoint rules.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, existing shadcn-style components, Vitest, Testing Library.

## Global Constraints

- Research home/list remains unchanged and has no workflow assistant.
- `brief`, `directions`, `outline`, `search`, and `report` render the existing `GuidedResearchSkillAssistant` through `GuidedResearchStepLayout`.
- Desktop uses the existing one-third/two-thirds Skill workspace; narrow screens retain the existing expandable assistant disclosure.
- Do not alter research APIs, session persistence, report contents, progress navigation, route names, or data contracts.
- Reuse existing visual tokens and components; add no dependency or hard-coded visual values.

---

### Task 1: Lock the report assistant requirement with a failing visual contract

**Files:**
- Modify: `apps/web/tests/ui/guided-research-visual-contract.test.tsx:123-133`

**Interfaces:**
- Consumes: `GuidedResearchFlow`, `GuidedResearchStepLayout`, and stable test ID `research-skill-assistant`.
- Produces: a report-stage regression assertion requiring the same `skill-workspace-thirds` layout as the other four guided steps.

- [ ] **Step 1: Replace the report-only exception with the persistent assistant assertion**

Replace the assertion that expects no assistant with this exact contract:

```tsx
const assistant = screen.getByTestId("research-skill-assistant");
expect(assistant.closest("[data-layout]")).toHaveAttribute("data-layout", "skill-workspace-thirds");
expect(screen.getByTestId("research-report")).toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm --filter web exec vitest run tests/ui/guided-research-visual-contract.test.tsx
```

Expected: the report-stage assertion fails because `ReportScreen` does not render `research-skill-assistant`.

- [ ] **Step 3: Commit the failing contract test**

```bash
git add apps/web/tests/ui/guided-research-visual-contract.test.tsx
git commit -m "test(research): require assistant on report step"
```

### Task 2: Render the existing assistant beside the report

**Files:**
- Modify: `apps/web/components/research-studio/guided-research-flow.tsx:604-676`
- Test: `apps/web/tests/ui/guided-research-visual-contract.test.tsx`

**Interfaces:**
- Consumes: `GuidedResearchStepLayout`, `GuidedResearchSkillAssistant`, report `demoState`, `sessionId`, `onSession`, and `onNavigate` already supplied to `ReportScreen`.
- Produces: a `report` step with the same persistent research assistant, local Skill state keyed by `${sessionId ?? "pending"}:report`, and unchanged report content/actions in `research-step-main`.

- [ ] **Step 1: Wrap the report content in the shared step layout**

Make `ReportScreen` return `GuidedResearchStepLayout` with this assistant prop:

```tsx
assistant={
  <GuidedResearchSkillAssistant
    step="report"
    sessionKey={`${sessionId ?? "pending"}:report`}
    snapshot={{ step: "report", value: { reportSummary: demoState.reportSummary } }}
    onSnapshotChange={(next) => {
      if (next.step === "report") {
        setDemoState((current) => ({ ...current, ...next.value }));
      }
    }}
  />
}
```

Keep the existing report root (`data-testid="research-report"`), citation cards, error handling, and completion action as the layout children. Do not modify report generation or completion calls.

- [ ] **Step 2: Run the focused visual contract test to verify it passes**

Run:

```bash
pnpm --filter web exec vitest run tests/ui/guided-research-visual-contract.test.tsx
```

Expected: all visual-contract tests pass, including the report assistant assertion.

- [ ] **Step 3: Run research behavior regression tests**

Run:

```bash
pnpm --filter web exec vitest run \
  tests/ui/guided-research-flow.test.tsx \
  tests/ui/guided-research-skill-assistant.test.tsx \
  tests/ui/guided-research-home-live.test.tsx
```

Expected: all tests pass, proving assistant application/undo, report completion, session recovery, and home behavior are unchanged.

- [ ] **Step 4: Run static validation**

Run:

```bash
pnpm --filter web run typecheck
pnpm --filter web run lint:design
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 5: Commit the implementation**

```bash
git add apps/web/components/research-studio/guided-research-flow.tsx
git commit -m "feat(research): keep Skill assistant on report step"
```

### Task 3: Publish the isolated feature branch

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-guided-research-persistent-skill-assistant-design.md`
- Modify: `docs/superpowers/plans/2026-08-15-guided-research-persistent-skill-assistant.md`

**Interfaces:**
- Consumes: commits from Tasks 1 and 2, branch `codex/research-persistent-skill-assistant`.
- Produces: a draft pull request targeting `main`, with the report-step assistant behavior, its regression evidence, and the approved design record.

- [ ] **Step 1: Confirm the isolated branch contains only the design, plan, test, and implementation files**

Run:

```bash
git status --short
git diff --check origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: no unrelated working-tree changes and no whitespace errors.

- [ ] **Step 2: Push the feature branch and open a draft pull request**

Run:

```bash
git push -u origin codex/research-persistent-skill-assistant
gh pr create --base main --head codex/research-persistent-skill-assistant --draft \
  --title "feat(research): keep Skill assistant visible through report" \
  --body "Keep the guided-research Skill assistant in the shared workspace for all five workflow steps, including the report. Adds a report-stage regression contract and retains existing research behavior checks."
```

Expected: GitHub returns the new draft PR URL.
