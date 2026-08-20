# 进度日志 — Sprint 01/19

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: 无（F966 已 passing，本 sprint 完成）
- 当前 blocker: 无

## 会话记录
### 2026-08-20（F965 已合入 main 后，用真栈截图验证保真度时发现真 bug）
- 背景：F965（成果沉淀 tab 成果去向/审计与反馈接真）已合入 main（PR #1633）。
  用真栈截图（`pnpm run shots:project-results`，复用 `playwright.fullstack-smoke.config.ts`）
  对齐已签核基线图时，发现「审计与反馈」区显示 404——诊断出 `next.config.mjs`
  从未给 `GET /provenance` 写 Next.js rewrite 规则（同 `/blueprints`/`/messages`
  注释描述的坑：F965 之前 `queryProvenance` 零真实调用方，这个路由缺口一直没被
  撞到）。该修复在 F965 合入时未及并入（另一并行分支先合并了 PR，见 issue #1627
  评论记录），本 sprint 补上。
- 本轮目标: F966 —— 补 `GET /provenance` 的 rewrite 缺口 + 真栈截图取证工具。
- 已完成:
  - `apps/web/next.config.mjs`：补一行 `/provenance` 裸路径 rewrite。
  - `apps/web/e2e/project-results-shots.spec.ts`：真栈截图取证 spec（零 expect，
    同 `chat-main-shots.spec.ts` 先例），登录 + 拍成果沉淀 tab default 与三个
    `?as=` 视角（因生产安全边界 R12 V8 三个视角截图与 default 像素级相同，已在
    文件头注如实记录，角色差异改由已通过的组件测试验证）。
  - `apps/web/playwright.fullstack-smoke.config.ts`：新增具名 project
    `project-results-shots`（`dependencies: ["seeded"]`，复用同一次起栈/种子，
    不是第二份栈定义；CI 的 `verify:fullstack-smoke` 只显式点
    `--project=seeded-github-import`，不会拉起这个新 project）。
  - `package.json`：新增 `shots:project-results` / `shots:project-results:raw`
    （同 `shots:chat-main` 模式）。
  - `.gitignore`：`.project-results-shots/` 过程物不进仓库（同 `.chat-shots/` 惯例）。
  - 设计签核：`design-signoff.md` 追加 F966 到 `covers:`（零新增设计面自查追加，
    这是最窄的一种——纯路由配置修复 + 零 expect 取证工具）。
- 运行过的验证:
  - `pnpm --filter web run typecheck`（绿）。
  - `pnpm --filter web exec vitest run tests/ui/project-results-live.test.tsx`（绿）。
  - `pnpm run shots:project-results` 两轮真栈跑（修复前「审计与反馈」404；修复后
    变成真实、正确的 403 `PROJECT_ROLE_INSUFFICIENT`，38/38 全绿）。
  - `pnpm harness verify --sprint 01/19 --feature F966` → passing。
- 已记录证据: `evidence/F966.verify.log`。
- 提交记录: 分支 `worker/dev-project-01-provenance-rewrite-fix`。
- 已知风险或未解决问题:
  - **UIUX 保真度：8/10**（真栈截图，对照 `ui-preview/project-v2/uc-00-3-results-*.png`）。
    未到 9-10 分的两个缺口（证据缺口，非代码缺陷）：① `fullstack-smoke-fixture.ts`
    未给这个项目种 `backflow`/`provenance` 数据，两节拍到的是真实空态而非「有数据」
    的成功态；② 只拍了 default 一态，未覆盖完整七态矩阵。
  - **PR 流程教训**：F965 的原 PR #1633 在本会话仍在做真栈验证/发现 bug 期间被
    另一个并行分支/流程先合并了（squash，标题仍写 F964，实际内容已是重编号后的
    F965）——本会话后续的 404 修复未及赶上那次合并，因此拆成独立的 F966 补上。
    这提示：同一 feature 若有多个并行 agent/session 在处理，PR 合并时机可能早于
    「所有验证工作完成」，后续发现的问题需要拆成新 feature 补，而不是假设原 PR
    还能追加。
- 下一步最佳动作: 人工审核并合并本 PR；下一轮若要冲 UIUX 9-10 分，给
  `fullstack-smoke-fixture.ts` 补 backflow/provenance 种子数据 + 用
  `FULLSTACK_E2E.leadEmail` 登录补一张「审计与反馈有数据」的成功态截图。
