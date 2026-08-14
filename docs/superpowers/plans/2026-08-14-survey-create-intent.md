# Survey Creation Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make creating a survey, creating a survey from a question module, and editing a reusable question module three unambiguous flows.

**Architecture:** Keep the existing Survey resource library and workflow components, but give each URL fact one authority. The library receives a typed `intent` for source selection, while the workflow receives a separate `sourceModuleId`; `mode=module` remains exclusively responsible for module editing. The workflow model clones source questions into a new survey and never combines that behavior with module-editor state.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Vitest, Testing Library, existing BoardX UI components.

## Global Constraints

- A created survey always shows the complete five-step workflow timeline.
- A reusable question-module editor never shows the workflow timeline.
- `sourceModule` and `mode=module` are mutually exclusive; module editing wins for malformed URLs containing both.
- Module editing derives module identity only from the `module-<moduleId>` path.
- Unknown `sourceModule` values yield an empty new survey and never unrelated fallback questions.
- Existing Survey routes, report-module routes, legacy `tab=templates`, read-only behavior, and AppShell navigation remain compatible.
- No new dependencies and no backend or persistence changes.

---

## File Map

- `apps/web/app/studio/survey/page.tsx`: parse the resource-library `intent` query and pass a typed intent to the library.
- `apps/web/app/studio/survey/[surveyId]/page.tsx`: parse `sourceModule` and suppress it when `mode=module` is active.
- `apps/web/components/survey/resource-library/survey-resource-library.tsx`: present module-management mode or survey-source-picker mode and route cards accordingly.
- `apps/web/components/survey/shell/survey-app-shell.tsx`: keep `问卷列表` active during the source-picker flow.
- `apps/web/components/survey/workflow/survey-workflow-shell.tsx`: accept the source module, initialize a full new-survey model, and preserve it while navigating workflow steps.
- `apps/web/components/survey/workflow/survey-design-step.tsx`: render survey-specific versus module-specific empty states.
- `apps/web/lib/survey/workflow-model.ts`: clone a valid source module into an empty new survey without mutating module data.
- `apps/web/tests/ui/survey-resource-library.test.tsx`: cover source-picker routing and management routing independently.
- `apps/web/tests/ui/survey-app-shell.test.tsx`: cover source-picker secondary-navigation activation.
- `apps/web/tests/ui/survey-workflow-shell.test.tsx`: cover blank survey, source-module survey, module editor, malformed URL precedence, and independent edits.
- `apps/web/tests/ui/survey-workflow-model.test.ts`: cover unknown source modules and cloning at the model boundary.

---

### Task 1: Separate the resource-library picker from module management

**Files:**
- Modify: `apps/web/app/studio/survey/page.tsx`
- Modify: `apps/web/components/survey/resource-library/survey-resource-library.tsx`
- Modify: `apps/web/components/survey/shell/survey-app-shell.tsx`
- Modify: `apps/web/tests/ui/survey-resource-library.test.tsx`
- Modify: `apps/web/tests/ui/survey-app-shell.test.tsx`

**Interfaces:**
- Consumes: `tab=modules`, `intent=create-survey`, and existing `SurveyResourceTab`.
- Produces: `SurveyResourceIntent = "create-survey" | null` and source-card destinations of `/studio/survey/new?step=design&sourceModule=<id>`.

- [ ] **Step 1: Write failing resource-library tests**

Add tests that render picker mode explicitly and assert both intent paths:

```tsx
it("从问卷列表进入模块选择器后创建完整问卷", () => {
  render(<SurveyResourceLibrary initialTab="modules" initialIntent="create-survey" uiState="default" />);

  expect(screen.getByRole("heading", { name: "选择问卷模块" })).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("survey-resource-card-module-strategy"));

  expect(push).toHaveBeenCalledWith("/studio/survey/new?step=design&sourceModule=strategy");
  expect(push).not.toHaveBeenCalledWith(expect.stringContaining("mode=module"));
});

it("模块管理页的卡片仍进入模块编辑器", () => {
  render(<SurveyResourceLibrary initialTab="modules" initialIntent={null} uiState="default" />);
  fireEvent.click(screen.getByTestId("survey-resource-card-module-strategy"));
  expect(push).toHaveBeenCalledWith("/studio/survey/module-strategy?step=design&mode=module");
});
```

Update existing renders to pass `initialIntent={null}`. Add a `从问卷模块新建` button test that expects `/studio/survey?tab=modules&intent=create-survey`.

- [ ] **Step 2: Write the failing secondary-navigation test**

```tsx
it("选择问卷来源模块时仍标记问卷列表入口", () => {
  pathname = "/studio/survey";
  search = "tab=modules&intent=create-survey";

  render(<SurveyAppShell><div>模块选择器</div></SurveyAppShell>);

  expect(screen.getByTestId("survey-section-nav-surveys")).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("survey-section-nav-modules")).not.toHaveAttribute("aria-current");
});
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
pnpm --filter web exec vitest run tests/ui/survey-resource-library.test.tsx tests/ui/survey-app-shell.test.tsx
```

Expected: FAIL because `initialIntent` is not accepted, the source button lacks the intent, source cards still open module editors, and the left navigation marks modules active.

- [ ] **Step 4: Implement typed picker intent and routing**

In the route page, accept `intent?: string`, normalize only the declared value, and pass it down:

```tsx
const intent = searchParams.intent === "create-survey" ? "create-survey" : null;
return <SurveyResourceLibrary initialTab={tab} initialIntent={intent} uiState={uiState} />;
```

In the library, export the single typed intent and derive `selectingSurveySource`:

```tsx
export type SurveyResourceIntent = "create-survey" | null;

const selectingSurveySource = tab === "modules" && initialIntent === "create-survey";
const openModule = (moduleId: string) => router.push(
  selectingSurveySource
    ? `/studio/survey/new?step=design&sourceModule=${moduleId}`
    : `/studio/survey/module-${moduleId}?step=design&mode=module`,
);
```

Change `从问卷模块新建` to `/studio/survey?tab=modules&intent=create-survey`. In picker mode show `选择问卷模块`, source-selection helper copy, and a back action to `/studio/survey`; do not show `新建问卷模块`.

In the secondary navigation, prioritize picker intent before the `tab=modules` rule:

```tsx
const activeSection = searchParams.get("intent") === "create-survey"
  ? "surveys"
  : pathname.startsWith("/studio/survey/templates")
    ? "reports"
    : searchParams.get("mode") === "module" || searchParams.get("tab") === "modules"
      ? "modules"
      : searchParams.get("tab") === "reports"
        ? "reports"
        : "surveys";
```

- [ ] **Step 5: Run tests and verify GREEN**

Run the Task 1 command again. Expected: both test files pass with no warnings.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/web/app/studio/survey/page.tsx \
  apps/web/components/survey/resource-library/survey-resource-library.tsx \
  apps/web/components/survey/shell/survey-app-shell.tsx \
  apps/web/tests/ui/survey-resource-library.test.tsx \
  apps/web/tests/ui/survey-app-shell.test.tsx
git commit -m "feat(survey): separate module picker intent"
```

---

### Task 2: Initialize a full survey from a selected module

**Files:**
- Modify: `apps/web/app/studio/survey/[surveyId]/page.tsx`
- Modify: `apps/web/components/survey/workflow/survey-workflow-shell.tsx`
- Modify: `apps/web/lib/survey/workflow-model.ts`
- Modify: `apps/web/tests/ui/survey-workflow-shell.test.tsx`
- Modify: `apps/web/tests/ui/survey-workflow-model.test.ts`

**Interfaces:**
- Consumes: `sourceModule=<moduleId>`, `moduleEditor`, and `getSurveyQuestionModuleQuestions(moduleId)`.
- Produces: `sourceModuleId?: string` on `SurveyWorkflowShell` and `sourceModuleId?: string` on `createSurveyWorkflowMock` options.

- [ ] **Step 1: Write failing workflow tests**

Add a second-module counterexample so the test cannot pass by returning the default profile questions:

```tsx
it("从模块创建的是带五步流程的新问卷", () => {
  render(<SurveyWorkflowShell
    surveyId="new"
    initialStep="design"
    uiState="default"
    readonly={false}
    sourceModuleId="strategy"
  />);

  expect(screen.getByRole("heading", { name: "未命名问卷" })).toBeInTheDocument();
  expect(screen.getByTestId("survey-workflow-steps")).toBeInTheDocument();
  expect(screen.getByTestId("survey-design-question-Q04")).toBeInTheDocument();
  expect(screen.getByTestId("survey-design-question-Q06")).toBeInTheDocument();
  expect(screen.queryByTestId("survey-design-question-Q01")).not.toBeInTheDocument();
});

it("模块模式忽略同时出现的问卷来源参数", () => {
  render(<SurveyWorkflowShell
    surveyId="module-profile"
    initialStep="design"
    uiState="default"
    readonly={false}
    moduleEditor
    sourceModuleId="strategy"
  />);

  expect(screen.getByRole("heading", { name: "组织画像" })).toBeInTheDocument();
  expect(screen.getByTestId("survey-design-question-Q01")).toBeInTheDocument();
  expect(screen.queryByTestId("survey-design-question-Q04")).not.toBeInTheDocument();
  expect(screen.queryByTestId("survey-workflow-steps")).not.toBeInTheDocument();
});
```

Add a model test for an unknown module:

```ts
it("未知来源模块不会回退到完整示例题库", () => {
  const model = createSurveyWorkflowMock({ surveyId: "new", sourceModuleId: "missing" });
  expect(model.questions).toEqual([]);
  expect(model.survey.title).toBe("未命名问卷");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter web exec vitest run tests/ui/survey-workflow-shell.test.tsx tests/ui/survey-workflow-model.test.ts
```

Expected: FAIL because `sourceModuleId` is not a supported prop or model option and a new non-module survey currently loads all sixteen example questions.

- [ ] **Step 3: Implement model initialization and cloning**

Change model options to keep editing and sourcing distinct:

```ts
interface CreateSurveyWorkflowMockOptions {
  surveyId?: string;
  moduleId?: string;
  sourceModuleId?: string;
  moduleEditor?: boolean;
}
```

Select questions with explicit precedence:

```ts
const requestedModuleId = options.moduleEditor ? options.moduleId : options.sourceModuleId;
const knownModule = requestedModuleId
  ? SURVEY_QUESTION_MODULE_CARDS.some((item) => item.id === requestedModuleId)
  : false;
const selectedQuestions = options.moduleEditor && isNew && !options.moduleId
  ? []
  : requestedModuleId
    ? knownModule
      ? cloneQuestions(questions.filter((question) => question.chapterId === requestedModuleId))
      : []
    : isNew
      ? []
      : cloneQuestions(questions);
```

Define `cloneQuestions` once in this file and reuse it from `getSurveyQuestionModuleQuestions`:

```ts
const cloneQuestions = (questions: survey.SurveyWorkflowQuestion[]) => questions.map((question) => ({
  ...question,
  options: [...question.options],
}));
```

This preserves the existing full model for `sv-1`, keeps a blank module blank, makes a blank survey blank, and makes source-module surveys independent clones.

- [ ] **Step 4: Parse and propagate the source module**

Extend route search params with `sourceModule?: string`. Compute module mode first and pass no source when module mode is active:

```tsx
const moduleEditor = searchParams.mode === "module";
const sourceModuleId = moduleEditor ? undefined : searchParams.sourceModule;

return <SurveyWorkflowShell
  surveyId={params.surveyId}
  initialStep={parsedStep.success ? parsedStep.data : "design"}
  uiState={state}
  readonly={searchParams.readonly === "1"}
  moduleEditor={moduleEditor}
  sourceModuleId={sourceModuleId}
/>;
```

In `SurveyWorkflowShell`, initialize with both exclusive options and preserve the source on step navigation:

```tsx
const effectiveSourceModuleId = moduleEditor ? undefined : sourceModuleId;
const [model, setModel] = React.useState(() => createSurveyWorkflowMock({
  surveyId,
  moduleId,
  sourceModuleId: effectiveSourceModuleId,
  moduleEditor,
}));

const sourceQuery = effectiveSourceModuleId ? `&sourceModule=${effectiveSourceModuleId}` : "";
router.replace(`/studio/survey/${surveyId}?step=${step}${modeQuery}${sourceQuery}`);
```

- [ ] **Step 5: Run tests and verify GREEN**

Run the Task 2 command again. Expected: both test files pass with no warnings.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/web/app/studio/survey/'[surveyId]'/page.tsx \
  apps/web/components/survey/workflow/survey-workflow-shell.tsx \
  apps/web/lib/survey/workflow-model.ts \
  apps/web/tests/ui/survey-workflow-shell.test.tsx \
  apps/web/tests/ui/survey-workflow-model.test.ts
git commit -m "feat(survey): create surveys from question modules"
```

---

### Task 3: Distinguish blank-survey and blank-module design states

**Files:**
- Modify: `apps/web/components/survey/workflow/survey-design-step.tsx`
- Modify: `apps/web/components/survey/workflow/survey-workflow-shell.tsx`
- Modify: `apps/web/tests/ui/survey-workflow-shell.test.tsx`

**Interfaces:**
- Consumes: `moduleEditor` from `SurveyWorkflowShell`.
- Produces: `editorKind: "survey" | "module"` on `SurveyDesignStep`.

- [ ] **Step 1: Write the failing blank-survey test**

```tsx
it("空白新问卷使用问卷文案并保留五步流程", () => {
  render(<SurveyWorkflowShell surveyId="new" initialStep="design" uiState="default" readonly={false} />);

  expect(screen.getByText("当前问卷还没有题目")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "添加第一道题" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "从问卷模块选择" })).toBeInTheDocument();
  expect(screen.getByTestId("survey-workflow-steps")).toBeInTheDocument();
  expect(screen.queryByText("当前模块还没有题目")).not.toBeInTheDocument();
});
```

Retain the existing module empty-state test and its `从已有问卷模块创建` action as the counterexample.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter web exec vitest run tests/ui/survey-workflow-shell.test.tsx
```

Expected: FAIL because the shared empty state always says `当前模块还没有题目` and offers the module-copy action.

- [ ] **Step 3: Implement explicit editor-kind copy and actions**

Pass `editorKind={moduleEditor ? "module" : "survey"}` to `SurveyDesignStep`. Derive copy in the design step:

```tsx
const isModuleEditor = editorKind === "module";
const emptyTitle = isModuleEditor ? "当前模块还没有题目" : "当前问卷还没有题目";
const emptyDescription = isModuleEditor
  ? "从空白题目开始，或复制已有问卷模块作为基础后再修改。"
  : "从空白题目开始，或选择问卷模块作为新问卷的基础。";
```

Keep in-place module copying only for the module editor. For a blank survey, make the secondary action route to the source picker:

```tsx
{isModuleEditor ? (
  <Button variant="outline" onClick={() => setShowModuleChoices((current) => !current)}>
    从已有问卷模块创建
  </Button>
) : (
  <Button variant="outline" onClick={() => router.push("/studio/survey?tab=modules&intent=create-survey")}>
    从问卷模块选择
  </Button>
)}
```

Only render the in-place module choice grid when `isModuleEditor && showModuleChoices`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 3 command again. Expected: workflow tests pass with distinct survey/module empty states.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/web/components/survey/workflow/survey-design-step.tsx \
  apps/web/components/survey/workflow/survey-workflow-shell.tsx \
  apps/web/tests/ui/survey-workflow-shell.test.tsx
git commit -m "fix(survey): distinguish blank survey and module editors"
```

---

### Task 4: Verify the complete Survey flow and prepare review evidence

**Files:**
- Modify only if required by a failing Survey regression: the exact Survey file responsible for that regression.
- Do not modify unrelated packages, control-plane state, or feature status by hand.

**Interfaces:**
- Consumes: all behavior from Tasks 1–3.
- Produces: a clean exact SHA ready for independent feature review and PR creation.

- [ ] **Step 1: Run the complete targeted Survey suite**

```bash
pnpm --filter web exec vitest run \
  tests/ui/survey-resource-library.test.tsx \
  tests/ui/survey-app-shell.test.tsx \
  tests/ui/survey-route-layout.test.tsx \
  tests/ui/survey-workflow-shell.test.tsx \
  tests/ui/survey-workflow-model.test.ts \
  tests/ui/survey-template-editor-shell.test.tsx
```

Expected: all files and tests pass.

- [ ] **Step 2: Run type and design gates**

```bash
pnpm --filter web exec tsc --noEmit --incremental false
pnpm --filter web lint:design
git diff --check origin/main...HEAD
```

Expected: all commands exit 0.

- [ ] **Step 3: Run the production prerender counterexample**

```bash
pnpm --filter web build
```

Expected: build exits 0 and `/studio/survey` prerenders without the `useSearchParams` Suspense failure previously caught by fullstack smoke.

- [ ] **Step 4: Inspect scope and exact diff**

```bash
git status --short
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
```

Expected: clean worktree after commits; only the plan/spec and Survey files listed in the File Map are changed.

- [ ] **Step 5: Request independent review at the exact SHA**

Record `git rev-parse HEAD`, ask `rev-feature` to compare that exact SHA with `origin/main`, and require no Critical/Important/Minor findings before push.

- [ ] **Step 6: Push and open one PR for issue #1224**

Use branch `codex/survey-create-intent`. The PR body must include `Closes #1224`, the targeted verification commands, production build result, and the independent exact-SHA review verdict. Do not merge from this module-coordinator session.
