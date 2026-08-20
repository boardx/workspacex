# 会话交接 — Sprint 01/17

## 当前已验证
- F964：`passing`。2 条 verification 全绿（`project-results-live.test.tsx` 12 条 +
  `typecheck`）+ `verify:quick`（standard 档）已跑绿。evidence 见 `evidence/F964.verify.log`。

## 本轮改动
- 后端：无新增（复用 phase-00 已签核已实现的 `listBackflow`/`getProjectOverview`/
  `queryProvenance`，`queryProvenance` 只是补了两个契约里早就有、之前无调用方的
  可选参数 `targetKind`/`targetId`）。
- 前端：
  - `lib/live-provenance.ts`：`queryProvenance` 加 `targetKind`/`targetId` 可选参数。
  - `lib/live-projects.ts`：新增 `BackflowEntry` 类型 + `BACKFLOW_BADGE_LABEL`
    单一声明处。
  - `components/project/tab-overview.tsx`：改 import `BACKFLOW_BADGE_LABEL`，删本地
    重复声明。
  - `components/project/tab-results.tsx`：整体重写——「成果去向」「审计与反馈」
    接真；「项目结论」「假设状态」「发布结论」「候选决策」四块降级为如实空态。
  - `components/project/project-workbench.tsx`：`liveOverview` 拉取加入
    `tab==='results'`；新增 `liveAudit` 拉取（`tab==='results'` + `qs.org`）。
  - `lib/mock/project.ts`：删三个孤儿常量（`RESULTS`/`CANDIDATE_DECISIONS`/
    `AUDIT_TRAIL`），头注登记契约缺口。
- 设计签核：`contracts/project/design-signoff.md` 追加 F964 到 `covers:`（零新增
  设计面自查追加，逐条对照写在该文件段落里）。

## 仍损坏或未验证
- **UIUX 保真度评分未完成**（人类要求的 ≥9/10 门槛）：本会话起了 `pnpm --filter web dev`
  预览，但访问 `/projects/:id?tab=results` 会被 `SessionAppShell` 重定向到 `/login`
  ——没有真实登录会话就看不到成果沉淀 tab 的真实渲染。要做真栈截图对比
  （对齐 `ui-preview/project-v2/uc-00-3-results-*.png` 十张基准图），需要先起
  docker DB + 跑迁移 + 种子数据 + 真实登录，这一整套在本会话的时间预算内没有做
  （避免半途而废留孤儿 docker 栈——`agent-resource-cleanup-sop.md` 点名的事故模式）。
  **这是本次交付最大的已知缺口**，下一轮必须先做这个再谈"是否达到 9 分"。
- **左侧子导航「洞察报告/结论与决策/产出物/行动项/审计与反馈」与本 feature 内容
  的映射未打通**：`project-workbench.tsx` 为任何带 `SUB_NAV` 条目的 tab（`research`/
  `prep`/`results`）都通用渲染这个子导航列，但 `renderTab` 把 `sub` 参数显式标成
  `_sub`（未使用）——**这是全仓系统性的既有模式，不是本次引入、也不是 results tab
  独有**：`research`/`prep` 两个 tab 同样点哪个子导航项右侧都不变。本次不单独为
  `results` 补这条路由（那会造成三个 tab 里唯独一个行为不一致，属于扩大范围而不是
  修本 feature）。对照已签核基线截图 `uc-00-3-results-default.png`（子导航在图里
  清晰可见且点开会切页），这仍是一处真实的保真度缺口，只是它的修复单位应该是
  「子导航路由」这个跨三个 tab 的能力，不是 F964 一个 feature。子导航指向的「产出物」
  「行动项」「洞察报告」三项目前在 project 束契约里**完全没有出处**（属
  phase-02 `13-deliv`/`10-report` 的范围，coverage.md 与 `feature_list.json`
  显示 phase-02 那批 F20-F30/F38-F46 全部 `not_started` 且**没有 design-signoff**），
  按人类任务指令「碰不到未签核的 phase-02 契约面」的硬约束，本次不做子导航路由，
  只把能接真的两项（成果去向≈「结论与决策」概念邻近但字段不同、审计与反馈）铺在
  单页里。这个结构性差异需要人类决定：是否要为「洞察报告/产出物/行动项」三个
  子导航页单独走一次 phase-02 契约签核流程，再实现子导航路由。
- 发布结论/候选决策/项目结论/假设状态四块的真实领域模型仍未建（同上，契约未建模，
  不在已签核范围内）。

## 下一步最佳动作
1. 起 docker DB（读 `.harness/instructions/testing-standards.md` 的标准起法）、跑
   迁移、建测试组织/项目/种子回流数据与 provenance 事件、真实登录，截图对比十张
   基准图，用 `rev-uiux` 打分；<9 分则按差距迭代。**完成后记得 `down -v` 释放栈**。
2. 把「子导航结构性差异」这条报告给人类，请人类决定优先级（要不要现在就为
   洞察报告/产出物/行动项开一次 phase-02 契约签核）。
3. 不要动：`contracts/project/design-signoff.md` 的 `status`/`confirmed_by`/
  `confirmed_at` 三个字段——那是人的动作（ADR-023），本次只动了 `covers:`。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/17`
- 调试:`pnpm --filter web exec vitest run tests/ui/project-results-live.test.tsx`
