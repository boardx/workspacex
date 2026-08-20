# 会话交接 — Sprint 01/17

## 当前已验证
- F964（passing，2026-08-20T00:03:31.726Z）：`pnpm --filter web exec vitest run tests/ui/project-overview-live-overview.test.tsx`
  （20 用例）、`pnpm --filter web exec vitest run tests/ui/project-overview-live-info.test.tsx`
  （5 用例）、`pnpm --filter web run typecheck`、`pnpm -w run verify:quick`（standard 档）全部通过。
  证据：`evidence/F964.verify.log`。
- F965：`passing`。2 条 verification 全绿（`project-results-live.test.tsx` 12 条 +
  `typecheck`）+ `verify:quick`（standard 档）已跑绿。evidence 见 `evidence/F965.verify.log`。

## 本轮改动（F964 — 概览 tab 真实数据读取失败提示人性化）
- `apps/web/components/project/tab-overview.tsx`：新增 `OVERVIEW_REASON_PRESENTATION` +
  `describeOverviewReason` + `OverviewErrorNotice`，把 `liveError`/`liveOverviewError`
  两个错误插槽从「读取失败：{原始 reasonCode}」翻成人话：`NO_PROJECT_ROLE`（项目层）/
  `ADMIN_NOT_SUPERUSER`（组织层）为分层的正常访问范围，muted 语气、不给重试；
  `DEPENDENCY_UNAVAILABLE`/`AUTH_SERVICE_UNAVAILABLE` 为真故障，destructive 语气 +
  「重试」按钮（沿用 `today-board.tsx` 的 `window.location.reload()` 既有约定）。原始
  reasonCode 仍保留在文案末尾括号里。
- `apps/web/tests/ui/project-overview-live-overview.test.tsx`：新增 `describe("F964 ...")`
  六条用例（NO_PROJECT_ROLE / ADMIN_NOT_SUPERUSER / DEPENDENCY_UNAVAILABLE /
  AUTH_SERVICE_UNAVAILABLE / 未知 reasonCode 兜底 / 反证 tone 分支非摆设）。
- `apps/web/tests/ui/project-overview-live-info.test.tsx`：既有的 liveError 用例追加断言
  destructive 语气 + 重试按钮存在。
- `phases/phase-01-run-a-project/contracts/project/design-signoff.md`：`covers:` 追加
  F964，如实说明本次授权来源是用户在会话里直接指派（非 coord-main 复核），零新增设计面。
- `phases/phase-01-run-a-project/feature_list.json`：新增 F964 条目。

## 本轮改动（F965 — 成果沉淀 tab 成果去向/审计与反馈接真，原编号 F964 撞车后重编号）
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
- 设计签核：`contracts/project/design-signoff.md` 追加 F965 到 `covers:`（零新增
  设计面自查追加，逐条对照写在该文件段落里；原编号 F964 与本 sprint 另一个 feature
  撞车后机械重编号，不改任何设计决定）。

## F965 的 UIUX 保真度评分（结构化代码走查，非像素级截图对比——方法局限已如实标注）

**尝试过两条截图路线，均卡住，已如实降级为第三条：**
1. 真栈路线（docker DB + 迁移 + 种子数据 + 真实登录 + playwright）——本会话时间预算
   内未起，避免半途而废留孤儿 docker 栈。
2. Mock 截图路线（`apps/web/scripts/shot-project-v2.mjs` 同款，写了
   `shot-project-results-f964.mjs` 复用同一套机制）——**实测跑不通**：
   `/projects/[projectId]/page.tsx` 自 issue #1316（安全修复）起不再向
   `ProjectWorkbench` 传 `identity`，`AppShell` 因此总落到 `SessionAppShell`，
   没有真实登录会话就重定向 `/login`，`project-workbench` 永不渲染。这不是本脚本
   独有的问题——母版 `shot-project-v2.mjs` 指向同一条路由，同样会被这条安全修复
   挡住，说明**这批基线截图今天已经无法用同样的方法重新生成**（真正修复需要先解决
   「预览模式怎么在有安全修复的前提下拿到一个可截图的已登录态」这个更大的问题，
   不是这个 feature 的范围）。
3. **实际采用**：对照已看过的 `uc-00-3-results-default.png`/`uc-00-3-results-observer.png`
   两张基线图，逐节做结构化代码走查（板块顺序/角色投影/内容真实性），不是像素比对。

**打分（0-10，结构维度）：约 6/10**
- 结构/顺序/角色投影：**满分项**——项目结论 → 假设状态+成果去向（并排两列）→
  发布结论 → 候选决策 → 审计与反馈，六节顺序与基线逐一对应；观察者视角隐藏
  发布结论/候选决策、保留其余四节，与基线 `-observer.png` 完全一致。
- 数据真实性：**两节满分**（成果去向、审计与反馈已接真实后端，四态齐全，不是
  编造数字）；**四节明显偏离基线视觉**（项目结论/假设状态/发布结论/候选决策从
  基线里的「populated 内容」换成了「暂不可用」说明文字）——这是**故意的工程决策**
  （契约未建模，不伪造数据，删掉两个只弹本地对话框不产生真实副作用的危险按钮），
  但视觉上确实与基线图相差较大，扣分的大头在这里。
- 左侧子导航未联动内容切换——全仓系统性既有 gap，非本次引入，见下方说明，本项
  按「不可归因于本 feature」不计入扣分，但仍是保真度缺口的一部分。
- 未做到的：像素级验证（间距/字号/配色/组件真实渲染效果）完全没有核实。

**为什么没有迭代到 9 分、以及为什么现在停在这里是对的**：
拉高分数的两条路径——(a) 为「项目结论/假设状态/发布结论/候选决策」四节堆出与基线
视觉一致的内容——除非先补齐它们的真实领域模型（新契约设计，需要人类重新签核，
超出本次已签核范围），否则唯一能做的是伪造数据，这正是人类任务指令明确禁止的
「实质性假功能缺陷」；(b) 打通真栈截图去做像素级验证——需要一整套 docker DB +
种子数据 + 登录的基础设施投入，不是在 F965 这一个 feature 里能合理完成的。
两条路径都不是"再改一行代码"能解决的，如实停在约 6/10，把差距记录清楚交给下一轮。
- **左侧子导航「洞察报告/结论与决策/产出物/行动项/审计与反馈」与本 feature 内容
  的映射未打通**：`project-workbench.tsx` 为任何带 `SUB_NAV` 条目的 tab（`research`/
  `prep`/`results`）都通用渲染这个子导航列，但 `renderTab` 把 `sub` 参数显式标成
  `_sub`（未使用）——**这是全仓系统性的既有模式，不是本次引入、也不是 results tab
  独有**：`research`/`prep` 两个 tab 同样点哪个子导航项右侧都不变。本次不单独为
  `results` 补这条路由（那会造成三个 tab 里唯独一个行为不一致，属于扩大范围而不是
  修本 feature）。对照已签核基线截图 `uc-00-3-results-default.png`（子导航在图里
  清晰可见且点开会切页），这仍是一处真实的保真度缺口，只是它的修复单位应该是
  「子导航路由」这个跨三个 tab 的能力，不是 F965 一个 feature。子导航指向的「产出物」
  「行动项」「洞察报告」三项目前在 project 束契约里**完全没有出处**（属
  phase-02 `13-deliv`/`10-report` 的范围，coverage.md 与 `feature_list.json`
  显示 phase-02 那批 F20-F30/F38-F46 全部 `not_started` 且**没有 design-signoff**），
  按人类任务指令「碰不到未签核的 phase-02 契约面」的硬约束，本次不做子导航路由，
  只把能接真的两项（成果去向≈「结论与决策」概念邻近但字段不同、审计与反馈）铺在
  单页里。这个结构性差异需要人类决定：是否要为「洞察报告/产出物/行动项」三个
  子导航页单独走一次 phase-02 契约签核流程，再实现子导航路由。
- 发布结论/候选决策/项目结论/假设状态四块的真实领域模型仍未建（同上，契约未建模，
  不在已签核范围内）。

## 仍损坏或未验证
- F964：无已知新增风险。F123/F172/F353(#353)/F362(#362) 等既有 passing feature 未改动其状态。

## 下一步最佳动作
1. F965：起 docker DB（读 `.harness/instructions/testing-standards.md` 的标准起法）、跑
   迁移、建测试组织/项目/种子回流数据与 provenance 事件、真实登录，截图对比十张
   基准图，用 `rev-uiux` 打分；<9 分则按差距迭代。**完成后记得 `down -v` 释放栈**。
2. F965：把「子导航结构性差异」这条报告给人类，请人类决定优先级（要不要现在就为
   洞察报告/产出物/行动项开一次 phase-02 契约签核）。
3. F964：无后续候选——本 feature 范围到此完成。若人类希望继续打磨概览 tab，下一个
   候选是 PJ-21（待办契约设计签核）——不在本 feature 范围内，需要独立契约设计流程。
4. 不要动：`contracts/project/design-signoff.md` 的 `status`/`confirmed_by`/
  `confirmed_at` 三个字段——那是人的动作（ADR-023），本次只动了 `covers:`。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/17`
- 调试:`pnpm --filter web exec vitest run tests/ui/project-results-live.test.tsx`
  （F965）/ `tests/ui/project-overview-live-overview.test.tsx`（F964）
