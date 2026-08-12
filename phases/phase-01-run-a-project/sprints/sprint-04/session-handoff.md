# 会话交接 — Sprint 01/04

## 当前已验证
- F166 尚未 passing（需其独立 PR 合入 main）；专项验证均通过。
- F168 已认领并已重放到最新设计分支；旧定向验证曾通过，但独立 review 新发现三类产品缺口，当前仍为 `in_progress`。

## 本轮改动
- F166：一次性 ticket、ASR 状态机与用量链路，详见其独立分支。
- F168：研究首页与可恢复会话，详见 `coord-deep-research` 分支。

## 仍损坏或未验证
- F166/F168 均须各自 review、验证、合并；不得把两个 owner 的改动混成一个 PR。F168 还需修复会话恢复、幂等键刷新稳定性和协作者可见性。

## 下一步最佳动作
- coord-voice 只处理 F166/F167；coord-deep-research 只处理 F168，完成后串行 F169-F171。

## F168 历史实现与证据
- `packages/contracts/src/research.ts`：guided session stage/brief/session 与 create/list/get 操作契约。
- `apps/api/migrations/20260812110000_f168_guided_research_sessions.sql`：owner-scoped 会话表、幂等键和 RLS。
- `apps/api/src/application/research/`、`apps/api/src/infrastructure/research/`、`apps/api/src/interface/controllers/guided-research.controller.ts`：持久化、恢复和 404 不可区分边界。
- `apps/web/lib/guided-research-api.ts` 与 guided UI：真实历史、创建和服务端 stage 恢复；mock 的 `GuidedResearchBrief` 改为从 contracts 推导。
- 新增 contracts/API/web 定向测试；实现提交 `e011b4ed`，draft PR #1081。

## 仍损坏或未验证
- 原定向验证记录在 `evidence/F168.verify.log`；它早于本轮 review，不能作为修复后的最终证据。
- PR #1081 尚未 review 通过或合并 main；根据完成定义，F168 不能 passing。

## 下一步最佳动作
1. 按 TDD 修复 session URL 恢复、跨刷新幂等键和 collaborator 可见性。
2. 将 F168 API verification 改为标准隔离外壳命令并刷新派生工作集。
3. 重新执行全部 feature verification、`verify:base` 和 doctor。
4. PR #1081 重新独立 review、合并 main，并通过 doctor 后，才允许 harness 将 F168 置为 passing。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/04`
- F168 API:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-session-list-and-recovery.test.ts --reporter=verbose`
- 头像偶发:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/org-admin/upload-org-avatar-http-route.test.ts --reporter=verbose`
- 契约单源:`node .harness/scripts/lint-contract-source.mjs`
