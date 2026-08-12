# 会话交接 — Sprint 01/04

## 当前已验证
- F166 尚未 passing（需其独立 PR 合入 main）；专项验证均通过。
- F168 已认领，当前实现链正在重放到最新 main。

## 本轮改动
- F166：一次性 ticket、ASR 状态机与用量链路，详见其独立分支。
- F168：研究首页与可恢复会话，详见 `coord-deep-research` 分支。

## 仍损坏或未验证
- F166/F168 均须各自 review、验证、合并；不得把两个 owner 的改动混成一个 PR。

## 下一步最佳动作
- coord-voice 只处理 F166/F167；coord-deep-research 只处理 F168，完成后串行 F169-F171。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/04`
- F168 API:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-session-list-and-recovery.test.ts --reporter=verbose`
