# 进度日志 — Sprint 10/01

## 当前已验证状态(唯一真相)
- 仓库根目录: `.claude/worktrees/live-collab-phase-plan`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F03（环节状态条现场呈现，复用 F963）——本 sprint 唯二 feature 之一，尚未开工
- 当前 blocker: 无（F02/F04/F05/F06/F07/F08/F09/F10 尚未开工，各自阻塞项见 feature_list.json 各条 notes；不影响 F03 开工）

## 会话记录
### 2026-08-20 22:57（F01 完成）
- 本轮目标：F01 视角切换器（viewer-role 束首个 feature，主持台·全场/分组二档 + 角色锁定）
- 已完成：
  - `apps/web/components/project/tab-live.tsx`：新增 `ViewerSwitcher`/`GroupPanel`/`computeViewerOptions`（纯函数），复用已 passing 的 `getProjectGrouping`（F950/Group[]）+ 真实会话身份 `useOptionalSession().identity.groupName`
  - `apps/web/components/project/project-workbench.tsx`：把「现场协作」tab 纳入既有 `liveGrouping` 拉取时机（此前只在「筹备」tab 拉）
  - `apps/web/tests/ui/project-live-viewer-switcher.test.tsx`：9 个新用例
- 运行过的验证：`pnpm --filter web typecheck`、`./apps/web/scripts/lint-design.sh`、`pnpm --filter web exec vitest run tests/ui/project-live-viewer-switcher.test.tsx`（+回归确认既有 18 个用例仍绿）、`pnpm harness verify --sprint 10/01 --feature F01`
- 已记录证据：`evidence/F01.verify.log`
- 提交记录：分支 `worker/usamshen-10-f01-viewer-switcher`，PR [#1665](https://github.com/boardx/workspacex/pull/1665)（`Closes #1654`），push 前 turbo affected 170 文件/1456 用例全绿
- 已知风险或未解决问题：F02（服务端角色矩阵）未做，前端目前只是「不渲染越权选项」，组员改 URL 参数仍可能拿到不该看的数据——记在 F02 notes，不是本次遗漏；「缺N人」「需介入」两个状态后缀仍是 ＊ 占位（分别依赖 F05、以及全仓无来源的现场介入判据）
- 下一步最佳动作：等 PR #1665 合入 main 后，`pnpm harness claim --phase 10 --feature F03 --owner usamshen` 领 F03，继续本 sprint；F02 需等 F01 合入且 owner 决定是否续做同束
