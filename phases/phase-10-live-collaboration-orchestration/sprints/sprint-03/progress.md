# 进度日志 — Sprint 10/03

## 当前已验证状态(唯一真相)
- 仓库根目录: `.claude/worktrees/agent-a813593b4dc917d2b`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: 无——本 sprint（F02）已 `passing`，[PR #1734](https://github.com/boardx/workspacex/pull/1734) 待人类合并
- 当前 blocker: 无

## 会话记录
### 2026-08-22 00:32（F02 完成）
- 本轮目标：F02 角色可见性服务端矩阵（viewer-role 束续做，把 F01 前端隐藏收窄成服务端真拒绝面）
- 已完成：
  - 新增独立端点 `GET /projects/:projectId/viewer-options`（`packages/contracts/src/viewer-role.ts`），不复用 `getProjectGrouping`（该端点服务筹备阶段全量视图，语义互斥）
  - `apps/api/src/application/live-collab/get-viewer-options.ts`：纯函数 `projectGroupsForRole`/`toViewerOptions`/`promptTextForRole`
  - `apps/api/src/interface/controllers/blueprint.controller.ts`：新增路由
  - `apps/web/lib/live-collab-viewer-role.ts` + `tab-live.tsx`/`project-workbench.tsx`：前端接线，优先读服务端返回值
  - 顺带修复：`third-artifact-map.json` 补 phase-10 5 个契约束的 API 契约声明（group-checkin/segment-engine 复用声明、module-routing/stage-aggregation 的"当前无 HTTP 面"declaration + R12 coverage 表）；修复 `lint-contract-source.mjs` 抓到的两处 `ViewerOption` 手写重复定义
- 运行过的验证：`pnpm --filter web run typecheck`、`pnpm --filter api exec tsc --noEmit`、`node .harness/scripts/lint-contract-source.mjs`、`get-viewer-options.test.ts`（16 用例）+ `project-live-viewer-switcher.test.tsx`（9 用例）、`pnpm harness verify --sprint 10/03 --feature F02`（含 high_risk 档 `verify:release`）、合并 main 后独立跑 `apps/api` 全量测试确认干净（648 文件/5787 用例，0 失败）
- 已记录证据：`evidence/F02.verify.log`
- 提交记录：分支 `worker/usamshen-f02-10-viewer-role-server-matrix`，PR [#1734](https://github.com/boardx/workspacex/pull/1734)（`Closes #1688`）
- 已知风险或未解决问题：`?viewer=` URL 参数尚未驱动 `requestedViewerId`（服务端拒绝面已就绪且已测试，前端触发路径未接线）；观察者对分组转写/对话详情的拒绝不在本 feature 范围（全仓无对应接口）
- 机器负载观察：本轮 push/verify 多次撞上高负载导致的 PG 连接中断（`Connection terminated unexpectedly`，1分钟均值一度到 65+），不是代码问题；等负载降到 <10 后重试即成功，见本会话 session-handoff.md 的负载处置记录
- 下一步最佳动作：等 PR #1734 合入 main。viewer-role 束（F01/F02）到此全部完成。下一个候选：F04（倒计时字段，跨 phase-01 议程束契约变更，需先联系对方）或 F06（group-checkin 束续做，到场写入/二维码/看加入页，depends_on F05 已合入可以开工）
