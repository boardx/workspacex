# 会话交接 — Sprint 01/18

## 当前已验证
- F965：`passing`。2 条 verification 全绿（`project-results-live.test.tsx` 12 条 +
  `typecheck`）+ `verify:quick`（standard 档）已跑绿。evidence 见 `evidence/F965.verify.log`。

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
- 设计签核：`contracts/project/design-signoff.md` 追加 F965 到 `covers:`（零新增
  设计面自查追加，逐条对照写在该文件段落里）。

## UIUX 保真度评分（真栈截图，非结构走查——第二轮已打通）

**第一轮（结构化代码走查，约 6/10）已被推翻**——coordinator 指出 `shot-project-v2.mjs`
当年就是用 mock 身份拍出 92 张基线图的脚本，`?state=`/`?as=` 走不通只是因为 F965 把
`TabResults` 改成吃 `liveOverview`/`liveAudit` 两个真实 props；順著这条线查证：

1. **根因诊断**：`StateShell`/`uiState` 纯视觉覆盖层，从不触碰 fetch（读
   `state-shell.tsx` 源码逐行确认）；`?as=` 预览开关本身没坏，但 `/projects/
   [projectId]` 整条路由自 issue #1316（安全修复，2026-08-16，晚于 92 张基线图
   2026-07-30 十七天）起不再向 `ProjectWorkbench` 传 mock `identity`——**这是全 tab
   通用的回归，不是 F965 或成果沉淀 tab 独有**（实测 `?tab=overview` 同样重定向
   `/login`，截图为证）。要拍到真实渲染只能走真登录。
2. **复用已验证的真栈机制**：新增 `apps/web/e2e/project-results-shots.spec.ts`
   （零 expect，取证工具，同 `chat-main-shots.spec.ts` 先例）+
   `playwright.fullstack-smoke.config.ts` 新增具名 project `project-results-shots`
   （`dependencies: ["seeded"]`，复用同一次起栈与种子，不是第二份栈定义）+
   `pnpm run shots:project-results`（package.json，同 `shots:chat-main` 模式）。
3. **第一次真栈截图揪出一个真 bug**：「审计与反馈」区报
   `审计事件读取失败：HTTP 404`——诊断（`next.config.mjs` 全文 grep `provenance`
   零命中）：`GET /provenance` 这条裸路径**从未被写进 Next.js 的 rewrite 规则**
   （与文件里 `/blueprints`/`/messages` 注释描述的坑同一类：F965 之前
   `queryProvenance` 零真实调用方，这条路由缺口一直没被撞到）。**这是前端路由配置
   缺失，不是后端问题**——`provenance.controller.ts` 本身完好。修法：`next.config.mjs`
   补一行 `{ source: "/provenance", destination: apiOrigin + "/provenance" }`。
4. **第二次真栈截图验证修复**：404 消失，「审计与反馈」区变成
   `审计事件读取失败：PROJECT_ROLE_INSUFFICIENT`——这是**真实、正确**的后端授权
   决策（`query-provenance.ts`：审计检索只对 org 级 `lead`/`admin`/`compliance`
   或读自己的历史开放，不是项目角色 `facilitator`；测试用的
   `FULLSTACK_E2E.email` 持有项目角色 facilitator 但 org 角色不在那三档），不是 bug。
5. **附带发现**：`?as=groupLead/member/observer` 三张截图与 default 像素级相同——
   `resolvePreviewRole()`（`lib/identity.ts`）在 `NODE_ENV==="production"` 时**恒返回
   facilitator**（R12 V8：预览切换器生产不可达，故意的安全边界，不是缺陷）。真栈用
   `next build && next start` 是生产构建，所以四视角截图证明的是"这条安全边界在真栈
   上确实生效"，角色投影的真实差异改由已通过的组件测试
   （`project-results-live.test.tsx`）验证。

**打分（0-10）：8/10**
- 结构/布局/子导航/顶栏：与基线 `uc-00-3-results-default.png` 逐项一致（满分）。
- 「成果去向」「审计与反馈」两节：**端到端真实链路已跑通并留证**（真实
  fetch→真实空态/真实 403，不是编造数字，404 路由缺口已修复并回归验证）。
- 「项目结论/假设状态/发布结论/候选决策」四节：按指令要求整块降级为如实说明，
  不计入扣分。
- 未到 9-10 分的两个缺口（均为证据缺口，非代码缺陷）：
  ① `fullstack-smoke-fixture.ts` 未给这个项目种 `backflow`/`provenance` 数据，
  「成果去向」拍到的是真实空态而非「有数据」的那一态；
  ② 只拍了 default 一态，未覆盖 loading/empty/invalid/dep-failed/denied/success
  七态矩阵（真实数据驱动的 loading/error 态已由组件测试覆盖，但未在真栈截图里
  同时留证）。
- 补种子数据 + 用 `FULLSTACK_E2E.leadEmail`（真正持 org `lead` 的账号）登录，
  可以再往前推进「审计与反馈」到「有数据」的成功态；这两项工作量不小
  （改种子脚本、可能需要新增账号变体），不在本轮预算内，如实停在 8/10。

**证据**：`pnpm run shots:project-results` 两轮跑（修复前 38/38 全绿但审计区
404；修复后 38/38 全绿且审计区变真实 403），截图存
`apps/web/.project-results-shots/`（已 gitignore，同 `.chat-shots/` 惯例，过程物
不进仓库）。
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
- 验证:`pnpm harness verify --sprint 01/18`
- 调试:`pnpm --filter web exec vitest run tests/ui/project-results-live.test.tsx`
