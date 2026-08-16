# 会话交接 — Sprint 01/12

## 当前已验证
- F195 已签核、已建 Issue #1432、已认领为 `in_progress`。
- 当前 worktree 已完成 F195A/B/C/D 的实现性闭环，但尚未宣称 feature passing：未跑 `pnpm harness verify --sprint 01/12`，未提交/PR/merge。
- 最新整体验证:
  - contracts F195: 13 tests ✅
  - API F195 workflow + F168 recovery: 11 tests ✅
  - deep-agent-service graph: 5 tests ✅
  - deep-agent-service Postgres recovery: 1 test ✅
  - web guided research UI: 32 tests ✅
  - web typecheck: exit 0 ✅
  - permission path lint: exit 0 ✅
  - arch deps lint: exit 0 ✅

## 本轮改动
- 新增/更新 Guided Research workflow 契约、schema 生成、node command 输入、projection、严格解析与 contract tests。
- 新增 API workflow service/controller wiring、command receipt/migration、structured directions/outline qwen3.7-plus generator，并用 fake provider 验证模型输出解析与幂等持久化。
- 新增 deep-agent-service Guided Research StateGraph、state schema、Postgres checkpointer recovery tests。
- 更新前端 guided research API client 与 flow 组件：`/research?session=...` 恢复、步骤切换 `history.replaceState`、workflow command 携带 `expectedGraphVersion` + nodeState、Skill 进度标识、报告工作区加宽。

## 仍损坏或未验证
- `pnpm harness tick` 失败：`COORD_GATEWAY_URL 未配置`。
- `pnpm --filter api run typecheck` 失败在 `packages/fabric-markdown` 的 DOM 类型缺失（`Element` / `CanvasRenderingContext2D` / `document`），不是本轮 F195 文件；未修无关模块。
- 真实 qwen3.7-plus 调用未用真实 key 验证；测试以 fake OpenAI-compatible provider 覆盖结构化输出。
- 尚未对 Issue #1432 写进展评论，尚未 PR/merge。

## 下一步最佳动作
- 先把本轮验证证据同步到 Issue #1432。
- 解决 `COORD_GATEWAY_URL` / 全局 api typecheck 阻塞后跑 `pnpm harness verify --sprint 01/12`。
- 不要手改 `active-features.json`；不要手动把 F195 标 passing。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/12`
- 调试:`pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts`
- 调试 API:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-workflow-command.test.ts tests/research/guided-session-list-and-recovery.test.ts`
- 调试 Web:`pnpm --filter web exec vitest run tests/ui/guided-research-flow.test.tsx tests/ui/guided-research-visual-contract.test.tsx && pnpm --filter web run typecheck`
- 轻量门禁:`node apps/api/scripts/lint-permission-paths.mjs && node .harness/scripts/lint-arch-deps.mjs`
