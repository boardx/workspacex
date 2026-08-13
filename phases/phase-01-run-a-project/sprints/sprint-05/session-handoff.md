# 会话交接 — Sprint 01/05

## 当前已验证
- F173 尚未 passing；11 条 feature verification 全部通过，API/Web typecheck 通过。
- `tests/identity/self-service-iter2.test.ts` 在第一次全仓门控超时，随后隔离单跑 7/7 通过。

## 本轮改动
- `/rec` 复用 Chat 的 `AsrProviderPort` 和 `KERNEL_ASR_*` 配置。
- 删除个人专用 Aliyun Fun-ASR provider/session；保留一次性 ticket、用户/组织隔离、稳定 BoardX 事件。
- final 先落库后推送；按服务端接收 PCM bytes 计量；修复停止期错误和延迟 open 后断线的资源泄漏。

## 仍损坏或未验证
- 两轮 `verify:base` 在本机异常高负载下被无关 API 测试超时阻断：第二轮 559 files / 5209 tests 已通过，仅 skill migration hook 失败并残留连接。
- exact SHA `26f6749b` 的独立 feature review 尚未返回。

## 下一步最佳动作
- 先处理 review findings；机器负载恢复后重跑完整 harness verify。不要绕过基础门控或手改 passing。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/05`
- 调试:`pnpm --filter api exec vitest run tests/recording/personal-realtime-asr-gateway.test.ts`
