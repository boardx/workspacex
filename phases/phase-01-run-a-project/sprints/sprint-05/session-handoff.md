# 会话交接 — Sprint 01/05

## 当前已验证
- F169 仍为 `in_progress`，不能假标 passing；四条 feature verification 均已通过。
- `pnpm --filter @repo/contracts run test`：13 files / 194 tests passed。
- 隔离数据库 API 测试：3/3 passed，包含协作者可编辑与非协作者 404。
- 研究 UI 回归：3 files / 13 tests passed；web 与 contracts typecheck 通过。
- 权限路径和洋葱依赖 lint 均通过。

## 本轮改动
- `packages/contracts/src/research.ts`：版本化 brief/directions/outline 与四个 checkpoint 操作。
- `apps/api`：迁移、事务仓储、生成端口、controller 和真实 DB 测试。
- `apps/web`：真实会话 API 驱动的方向/大纲编辑、确认、重新生成交互及测试。

## 仍损坏或未验证
- `pnpm harness verify --sprint 01/05 --feature F169` 的四条 feature verification 全绿，但后续 `verify:base` 红：API 全量测试末尾 `Connection terminated unexpectedly`；Web `personal-transcription-history.test.tsx` 1/10 偶发失败。这两处不在 F169 diff。
- worktree 默认 `pnpm --filter api run typecheck` 会在 `packages/fabric-markdown` 报 DOM lib 缺失；`pnpm --filter api exec tsc --noEmit --incremental false --lib ES2022,DOM` 通过，main 工作区默认 typecheck 也通过。

## 下一步最佳动作
1. `git status --short && git diff --check`，确认只有 F169 与 sprint 证据。
2. 推送 `worker/coord-deep-research-01-f169-human-checkpoints`，创建 PR 并在正文写 `Closes #1110`。
3. 等 CI；若 `verify:base` 再现上述无关失败，引用 `evidence/F169.verify.log` 的失败位置，不要扩大 F169 范围修改录音或全仓 DB 测试。
4. CI 全绿后交给 `coord-main` 合并；本角色没有 merge 权限。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/05 --feature F169`
- 调试:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-session-human-checkpoints.test.ts`
