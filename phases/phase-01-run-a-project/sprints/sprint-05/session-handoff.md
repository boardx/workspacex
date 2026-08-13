# 会话交接 — Sprint 01/05

## 当前已验证
- F169 的实现已由 PR #1126 合入 `main`；其阶段状态由原 owner 按 harness 门禁收尾。
- F173 为 `passing`；11 条 feature verification、完整基础验证、API/Web 定向测试与 typecheck 已通过。
- F173 人类签核字段已填写为可解析时间，独立 reviewer 对运行时实现 APPROVE。

## 本轮改动
- F169：版本化研究 brief/directions/outline、持久化/API 和真实会话 UI。
- F173：`/rec` 与 Chat 共用 `AsrProviderPort`/`KERNEL_ASR_*`，保留独立 ticket、用户/组织隔离、稳定 BoardX 事件和正文持久化。
- F173：final 先落库后推送；服务端 PCM 计量；持久化失败、停止和断线均保证清理上游及浏览器 socket。

## 仍需完成
- 将 PR #1127 合入 `main`，确认 `ac06595d`（或后续 merge commit）进入 `origin/main` 血统并关闭 issue #1109。

## 命令
- 启动: `pnpm -w run dev`
- F173 验证: `pnpm harness verify --sprint 01/05 --feature F173`
- API 定向: `pnpm --filter api exec vitest run tests/recording/personal-realtime-asr-gateway.test.ts tests/recording/personal-realtime-asr-usage.test.ts`
