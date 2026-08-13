# 会话交接 — Sprint 01/05

## 当前已验证
- F169 仍为 `in_progress`，不能假标 passing；四条 feature verification 均已通过。
- `pnpm --filter @repo/contracts run test`：13 files / 194 tests passed。
- 隔离数据库 API 测试：3/3 passed，包含协作者可编辑与非协作者 404。
- 研究 UI 回归：3 files / 13 tests passed；web 与 contracts typecheck 通过。
- 权限路径和洋葱依赖 lint 均通过。
- 预推送 Web 全量回归：114 files / 975 tests passed；API 默认 typecheck 通过。
- `lint-contract-source` 已确认 Web mock 直接派生 contracts，不再重声明 checkpoint 类型。

## 本轮改动
- `packages/contracts/src/research.ts`：版本化 brief/directions/outline 与四个 checkpoint 操作。
- `apps/api`：迁移、事务仓储、生成端口、controller 和真实 DB 测试。
- `apps/web`：真实会话 API 驱动的方向/大纲编辑、确认、重新生成交互及测试。

## 仍损坏或未验证
- 首次 `pnpm harness verify --sprint 01/05 --feature F169` 的四条 feature verification 全绿，但后续 `verify:base` 曾红于 API 数据库连接中断和 Web 录音历史偶发失败；预推送复跑 Web 全量已全绿。
- 预推送 API 全量跑到 560 files / 5212 tests，仅契约单源门禁发现 Web mock 重声明 `GuidedResearchDirection`；已在 `0e722017` 修复，并用 `lint-contract-source`、web 默认 typecheck 复核通过。

## 下一步最佳动作
1. 推送 `worker/coord-deep-research-01-f169-human-checkpoints`，创建 PR 并在正文写 `Closes #1110`。
2. 等 CI；若 `verify:base` 再现无关数据库连接中断，引用 `evidence/F169.verify.log`，不要扩大 F169 范围。
3. CI 全绿后交给 `coord-main` 合并；本角色没有 merge 权限。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/05 --feature F169`
- 调试:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-session-human-checkpoints.test.ts`
