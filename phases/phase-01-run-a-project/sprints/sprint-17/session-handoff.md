# 会话交接 — Sprint 01/17

## 当前已验证
- F964（passing，2026-08-20T00:03:31.726Z）：`pnpm --filter web exec vitest run tests/ui/project-overview-live-overview.test.tsx`
  （20 用例）、`pnpm --filter web exec vitest run tests/ui/project-overview-live-info.test.tsx`
  （5 用例）、`pnpm --filter web run typecheck`、`pnpm -w run verify:quick`（standard 档）全部通过。
  证据：`evidence/F964.verify.log`。

## 本轮改动
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

## 仍损坏或未验证
- 无已知新增风险。F123/F172/F353(#353)/F362(#362) 等既有 passing feature 未改动其状态。

## 下一步最佳动作
- 无后续候选——本 sprint 范围到此完成。若人类希望继续打磨概览 tab，下一个候选是
  PJ-21（待办契约设计签核）——不在本 feature 范围内，需要独立契约设计流程。

## 命令
- 启动：`pnpm -w run dev`
- 验证：`pnpm harness verify --sprint 01/17`
- 调试：`pnpm --filter web exec vitest run tests/ui/project-overview-live-overview.test.tsx`
