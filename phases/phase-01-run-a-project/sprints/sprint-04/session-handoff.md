# 会话交接 — Sprint 01/04

## 当前已验证
- F166 尚未 passing（需 PR 合入 main）；其五条专项验证均通过，扩展测试 6 files/8 tests 通过。

## 本轮改动
- 新增短期一次性 ticket 表、ASR 用量事件表、个人 capture/segment 写入、阿里 Fun-ASR provider/state machine 与 BoardX WS gateway。

## 仍损坏或未验证
- `verify:base` 在宿主机高负载下等待隔离栈准入，未实际启动而人工中止；专项、migration、lint 均绿。
- F167 尚未开始，因此当前 `/rec` 按钮仍不会调用 ticket 或采集麦克风。

## 下一步最佳动作
- 先 review/合并 F166；随后单独领取 F167 做前端 AudioWorklet、BoardX client 和最终段刷新恢复。不要把 F167 混进本 PR。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/04`
- 调试:`WORKSPACEX_ISOLATION_SEED=f166-final pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/recording/*asr*.test.ts`
