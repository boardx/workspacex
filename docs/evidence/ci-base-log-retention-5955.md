# #5955 — 完整 base 超时的日志保留

2026-10-27，复用 e435，PR 目标 develop。

## 已知事实与边界

run 40493158039 与 develop run 40499219659 的 full-regression-core 均在 80 分钟执行预算结束。artifact 只有已结束任务的 Turbo 分组日志，没有运行中的 API 完成分组；不能据此确定 API 卡在哪条测试，也不能断言是 Docker、数据库或隔离锁死。

实际断言失败中的 local-runtime parity 另由 #5953 修复。最新 run 的 web 部分为 951 files、8307 passed、5 skipped。静态排查虽发现若干同步 Docker 调用未设超时，但尚无动态证据证明它们导致本次挂起。

## 诊断改进

- `verify:ci-base:raw` 使用安装版 Turbo 已支持的 `--log-order=stream`，保留完整测试命令、串行并发和失败继续收集策略。
- 执行步骤后用 always 收集 apps / packages 的 `.turbo/turbo-test.log` 至现有 artifact 目录下的非隐藏 task-logs，保留包相对路径，不遍历 node_modules。
- 不修改 80 分钟步骤预算、不跳过测试、不改变原始退出码或成功证据的产生条件。

## 验证

新增反证先失败：原 workflow 没有日志收集步骤。修复后 5 files / 18 tests passed，覆盖未完成日志收集、嵌套及含空格路径、忽略 node_modules、无 apps/packages 时无日志成功，以及现有任务所有权、独立车道、完整 base 手动入口与预检门控。

执行命令：`pnpm exec vitest run --config .harness/vitest.config.ts .harness/scripts/ci-base-log-retention.test.ts .harness/scripts/ci-base-ownership.test.ts .harness/scripts/ci-full-regression.test.ts .harness/scripts/ci-manual-base-lane.test.ts .harness/scripts/ci-base-preflight.test.ts`，exit 0。

本变更只解决诊断缺口。必须用新的完整 base 运行确认具体耗时/失败位置，不能把日志门控通过说成完整回归通过。
