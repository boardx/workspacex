# 用户访谈全屏 Markdown 工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户访谈拆为保留 Workspace 导航的列表页与带统一六步 Header 的全屏 Markdown 工作台。

**Architecture:** 默认 `AppShell` 继续承载 `/itv` 列表；详情路由采用保持会话边界的沉浸式 `AppShell` 变体。工作台由 Header、阶段框架、Markdown 表面和按需 Skill 抽屉组成；服务端向前端投影版本化 Markdown artifacts，结构化字段只作为兼容读模型与受限编辑入口。

**Tech Stack:** Next.js、React、TypeScript、Tailwind、Zod contracts、PostgreSQL workflow repository、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-27-interview-fullscreen-markdown-workbench-design.md`

## Global Constraints

- `/itv` 必须保留 Workspace 左侧导航；`/itv/[interviewId]/setup` 必须是无 IconRail、TopBar、MobileTabs 与常驻 Skill 侧栏的全屏工作台。
- Header 是六步导航、返回列表和版本/Markdown 操作的唯一入口；离开未保存内容必须要求用户选择继续编辑或放弃更改。
- `brief`、`analysis`、`experts`、`outline`、`transcript`、`report` 的 Markdown artifact 是流程的唯一交换与渲染来源。
- AI 结果、重生成和重试不能静默覆盖已确认的版本；报告流继续采用 append-only Markdown，失败时必须保留已提交片段与错误码。
- 不修改既有权限、版本校验、幂等、证据审阅或报告恢复语义。

## Review Focus

- 无保存草稿时，通过 Header 跳步或返回列表不得出现确认弹窗；有草稿时必须出现且放弃后不得提交任何 API 写入。
- 窄屏的六步 Timeline 必须可滚动并保留完整步骤名称，不能将返回列表或当前步骤裁出视口。
- 旧访谈在没有全部 Markdown artifacts 的情况下必须由单一迁移器合成可读 artifact，而不是产生空白步骤。
- 失败的报告生成重试必须沿用已有 `report` Markdown 与 revision，不得丢失流式片段或证据资格。
- 结构化输入、Markdown 编辑和 Markdown 预览必须反映同一 source 字符串，不能出现两份可独立编辑的事实。

---

### Task 1: 沉浸式壳层与详情路由

**Files:**
- Modify: `apps/web/components/shell/app-shell.tsx`
- Modify: `apps/web/app/itv/[interviewId]/setup/page.tsx`
- Create: `apps/web/tests/ui/interview-immersive-shell.test.tsx`

**Interfaces:**
- Produces: `AppShell` prop `immersive?: boolean`，沉浸式时仍执行 Session/Feedback 边界但不渲染 Workspace chrome。
- Consumes: `DigitalInterviewSetup` 作为详情工作台内容；`/itv` 页保持未修改的默认 `AppShell` 行为。

- [ ] **Step 1: 写失败的壳层测试**

断言默认壳包含 `app-shell` 与 Workspace rail，`immersive` 壳只渲染工作台内容且没有 IconRail、TopBar、MobileTabs。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --dir apps/web exec vitest run tests/ui/interview-immersive-shell.test.tsx`

Expected: FAIL，因为 `immersive` 尚不存在。

- [ ] **Step 3: 实现 `AppShell({ immersive?: boolean })` 并在访谈详情路由启用它**

沉浸式分支复用 SessionAppShell、身份故障处理和 FeedbackProvider；不得由 CSS 隐藏全局 chrome。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --dir apps/web exec vitest run tests/ui/interview-immersive-shell.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交壳层改动**

```bash
git add apps/web/components/shell/app-shell.tsx apps/web/app/itv/[interviewId]/setup/page.tsx apps/web/tests/ui/interview-immersive-shell.test.tsx
git commit -m "feat(interview): add immersive workbench shell"
```

### Task 2: Markdown artifact 契约、投影与恢复

**Files:**
- Modify: `packages/contracts/src/interview.ts`
- Modify: `packages/contracts/tests/digital-interview-contract.test.ts`
- Modify: `apps/api/src/infrastructure/interview/pg-digital-interview-repository.ts`
- Modify: `apps/api/src/infrastructure/interview/workflow/pg-digital-interview-effects.ts`
- Modify: `apps/api/tests/itv/digital-interview-workflow-migration.test.ts`
- Modify: `apps/api/tests/itv/digital-interview-controller.test.ts`

**Interfaces:**
- Produces: `DigitalInterviewWorkflowArtifact` and `DigitalInterviewWorkflowView.artifacts` with keys `brief | analysis | experts | outline | transcript | report`.
- Consumes: existing `DigitalInterviewWorkflowView`, report generation transport, revision and idempotency effects.

- [ ] **Step 1: 写失败的合同与恢复测试**

断言合同拒绝重复 artifact key、允许六种限定 key；读取旧 workflow 时产生全部六个非空的可渲染 artifact；确认与报告失败/重试保留对应 revision 与已提交 Markdown。

- [ ] **Step 2: 运行合同和 API 测试确认失败**

Run: `pnpm --dir packages/contracts test -- digital-interview-contract.test.ts && pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --dir apps/api exec vitest run tests/itv/digital-interview-workflow-migration.test.ts tests/itv/digital-interview-controller.test.ts`

Expected: FAIL，因为 artifact schema、投影和迁移器尚不存在。

- [ ] **Step 3: 实现 `DigitalInterviewWorkflowArtifact` 与唯一的 artifact 迁移/投影函数**

以结构化工作流字段合成旧记录的 `brief` 到 `report`；每个确认命令和报告流在既有事务内更新对应 artifact。仅 `report` 使用流的 append-only 规则；其他 artifact 以确认 revision 原子替换。

- [ ] **Step 4: 运行合同和 API 测试确认通过**

Run: 与步骤 2 相同。

Expected: PASS。

- [ ] **Step 5: 提交 Markdown 领域改动**

```bash
git add packages/contracts/src/interview.ts packages/contracts/tests/digital-interview-contract.test.ts apps/api/src/infrastructure/interview/pg-digital-interview-repository.ts apps/api/src/infrastructure/interview/workflow/pg-digital-interview-effects.ts apps/api/tests/itv/digital-interview-workflow-migration.test.ts apps/api/tests/itv/digital-interview-controller.test.ts
git commit -m "feat(interview): project workflow artifacts as markdown"
```

### Task 3: 统一 Header、阶段框架与 Markdown 表面

**Files:**
- Create: `apps/web/components/itv/interview-workbench-header.tsx`
- Create: `apps/web/components/itv/interview-stage-frame.tsx`
- Create: `apps/web/components/itv/interview-markdown-surface.tsx`
- Create: `apps/web/components/itv/interview-skill-drawer.tsx`
- Modify: `apps/web/components/itv/digital-interview-workflow.tsx`
- Modify: `apps/web/components/itv/digital-interview-setup.tsx`
- Modify: `apps/web/tests/ui/interview-setup-workflow.test.tsx`
- Modify: `apps/web/tests/ui/interview-detail-report.test.tsx`

**Interfaces:**
- Consumes: `DigitalInterviewWorkflowView.artifacts` 和 `AppShell` 的沉浸式详情壳。
- Produces: stable test IDs `itv-workbench-header`, `itv-workbench-timeline`, `itv-markdown-source`, `itv-markdown-preview`, `itv-skill-drawer`，保留现有步骤与返回测试 ID 的兼容别名。

- [ ] **Step 1: 写失败的工作台 UI 测试**

断言详情有一条六步 Header Timeline、点击 Header 切换阶段、返回列表仍受 dirty guard 保护、Markdown source 与 preview 共享文本、Skill 助手默认关闭且可打开。

- [ ] **Step 2: 运行 UI 测试确认失败**

Run: `pnpm --dir apps/web exec vitest run tests/ui/interview-setup-workflow.test.tsx tests/ui/interview-detail-report.test.tsx`

Expected: FAIL，因为新 Header、Markdown 表面和抽屉尚不存在。

- [ ] **Step 3: 实现四个工作台组件并拆分 `digital-interview-workflow.tsx`**

Header 只处理导航和工作台级操作；阶段框架统一标题、动作和宽度；Markdown 表面使用 artifact `markdown` 作为唯一状态源；Skill 消息与提议从左栏移入抽屉。将每个阶段重排为原型所示的需求、分析、专家、问题、执行和报告布局，同时保持现有确认、重试、报告导出与证据跳转。

- [ ] **Step 4: 运行 UI 测试确认通过**

Run: 与步骤 2 相同，并执行 `pnpm --dir apps/web typecheck`。

Expected: PASS。

- [ ] **Step 5: 提交工作台视觉与行为改动**

```bash
git add apps/web/components/itv apps/web/tests/ui/interview-setup-workflow.test.tsx apps/web/tests/ui/interview-detail-report.test.tsx
git commit -m "feat(interview): rebuild fullscreen markdown workbench"
```

### Task 4: 列表进入链路、浏览器回归与设计 QA

**Files:**
- Modify: `apps/web/components/itv/interview-studio-home.tsx`
- Modify: `apps/web/e2e/digital-interview-research-quality.spec.ts`
- Create: `design-qa.md`

**Interfaces:**
- Consumes: 任务 1 的沉浸式路由、任务 2 的 artifacts 和任务 3 的 Header test IDs。
- Produces: 列表到全屏工作台的端到端证据及通过的视觉 QA 报告。

- [ ] **Step 1: 写失败的 Playwright 场景**

场景依次断言：列表显示 Workspace shell；打开访谈后 `itv-workbench-header` 可见且 Workspace rail 不存在；Header 跳转到专家与报告；切换 Markdown source/preview；返回列表后 Workspace shell 再次可见。

- [ ] **Step 2: 运行 Playwright 确认失败**

Run: `pnpm --dir apps/web exec playwright test e2e/digital-interview-research-quality.spec.ts --config playwright.config.ts`

Expected: FAIL，直到重构后的 full-screen 断言与 Markdown UI 落地。

- [ ] **Step 3: 补齐列表卡片行为与稳定测试锚点**

列表继续使用现有 Workspace 框架；只调整进入动作、状态文案和原型所需的卡片信息，不复制工作台 Header。

- [ ] **Step 4: 运行浏览器回归与设计 QA**

Run: `pnpm --dir apps/web exec playwright test e2e/digital-interview-research-quality.spec.ts --config playwright.config.ts`

Expected: PASS。使用同一桌面 viewport 捕获原型对应的列表、需求、分析、专家、问题、执行和报告视图；把来源图片与实现截图一起比较，保存 `design-qa.md`，仅在无 P0/P1/P2 项时标为 `final result: passed`。

- [ ] **Step 5: 提交验证与视觉 QA 证据**

```bash
git add apps/web/components/itv/interview-studio-home.tsx apps/web/e2e/digital-interview-research-quality.spec.ts design-qa.md
git commit -m "test(interview): verify fullscreen markdown workflow"
```

### Task 5: 全量回归与 PR 更新

**Files:**
- Modify: 仅在前四个任务发现的回归文件。

**Interfaces:**
- Consumes: 任务 1–4 的通过状态。
- Produces: 已推送的 PR 更新和与本地一致的验证证据。

- [ ] **Step 1: 运行受影响包的完整验证**

Run: `pnpm --dir packages/contracts test -- digital-interview-contract.test.ts && pnpm --dir apps/api typecheck && pnpm --dir apps/web typecheck && pnpm --dir apps/web exec vitest run tests/ui/interview-setup-workflow.test.tsx tests/ui/interview-detail-report.test.tsx tests/ui/interview-immersive-shell.test.tsx && pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --dir apps/api exec vitest run tests/itv/digital-interview-workflow-migration.test.ts tests/itv/digital-interview-controller.test.ts && pnpm --dir apps/web exec playwright test e2e/digital-interview-research-quality.spec.ts --config playwright.config.ts`

Expected: all PASS.

- [ ] **Step 2: 检查范围与推送 PR**

Run: `git diff --check origin/main...HEAD && git status --short && git push`

Expected: 无空白错误；只包含本规格与本计划要求的访谈工作台变更；PR 检查重新触发。

- [ ] **Step 3: 等待并处理 PR 必需检查**

Run: `gh pr checks 4296 --repo boardx/workspacex --watch`

Expected: 所有必需检查通过、无未解决 review thread，PR 可合并。
