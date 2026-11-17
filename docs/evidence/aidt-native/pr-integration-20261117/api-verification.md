# AIDT develop 集成：API 新基线验证回执

**最终补验：** MemberChatReadOnlyReason导出重命名后，按`source /tmp/aidt-pr-env.sh`环境补跑`pnpm --filter @repo/api exec tsc --noEmit --incremental false`，实际退出0，日志`/tmp/aidt-pr-api-typecheck-member-reason.log`为空（正常tsc成功）。未重复625测试。重命名文件当前SHA256为`56595e40612f4bd2bd12a5fc7c5013d60c7ea2c37bae416d12ecb8bbf2357e10`。当前v5 PR判定、现有CLI main基线限制与CI/merge develop后回查命令见 `/tmp/aidt-pr-ci-followup.md`；只读显式v5判定适配器 `/tmp/aidt-pr-v5-classify.mjs` 待真实PR事实执行。

执行目录：`/workspace/aidt-pr-20261117`，2026-11-17 UTC。

- Git HEAD（执行前后相同）：`1a2ec212d38635a60b1337cc4a949ec564c0d7a8`。
- 本地 origin/develop：`4060bcf2017ef5775b762f2135f22042f8a96d19`。
- 实际测试工作树还包含 backend reviewer 已稳定、未提交的两文件 revision 上限修复；这不是 pristine HEAD 的测试结果。执行前后这两文件哈希不变：
  - `packages/contracts/src/aidt-stages.ts` SHA256 `0658791ee7128e7409a22a4aa5f9ed53b2e775a13840a87ee1c7a7f31f43e6ec`
  - `apps/api/tests/aidt-stages/shared-stage-unit.test.ts` SHA256 `9bad14162b7eee2ae1677c1f4a8a5d8574a9370de788617f0b12dcb8ff4e9790`
- 该修复由 backend reviewer 完成并通知稳定后才开始本轮；本 worker 未修改仓库文件。

## 实际结果

七套无数据库/无模型 API configs 共 **45 文件、625 项通过、0 失败、0 跳过**；非增量 TypeScript 检查退出 0。

| Label | 配置/命令 | 文件 | 通过 | 进程耗时 | 退出码 | 原始日志 |
|---|---|---:|---:|---:|---:|---|
| context-execute | `vitest.aidt-context-execute.config.ts` | 10 | 172 | 15.691s | 0 | `/tmp/aidt-pr-api-context-execute.log` |
| run-context | `vitest.aidt-run-context.config.ts` | 11 | 86 | 15.160s | 0 | `/tmp/aidt-pr-api-run-context.log` |
| isolation | `apps/api/vitest.aidt-isolation.config.ts`（repo根） | 7 | 52 | 8.852s | 0 | `/tmp/aidt-pr-api-isolation.log` |
| course-unit | `vitest.aidt-course-unit.config.ts` | 4 | 41 | 4.105s | 0 | `/tmp/aidt-pr-api-course-unit.log` |
| files-unit | `vitest.aidt-files-unit.config.ts` | 3 | 36 | 3.509s | 0 | `/tmp/aidt-pr-api-files-unit.log` |
| acceptance | `vitest.aidt-acceptance.config.ts` | 3 | 45 | 3.394s | 0 | `/tmp/aidt-pr-api-acceptance.log` |
| collaboration-unit | `vitest.aidt-collaboration-unit.config.ts` | 7 | 93 | 5.807s | 0 | `/tmp/aidt-pr-api-collaboration-unit.log` |
| typecheck | `tsc --noEmit --incremental false` | — | — | 49.562s | 0 | `/tmp/aidt-pr-api-typecheck.log`（空日志，进程明确退出0） |

所有 Vitest 命令为 `pnpm exec vitest run --config <config> --bail=1`；除 isolation 从repo根执行，其余 cwd 均为新 worktree `apps/api`。程序化原始回执含每个完整 argv、cwd、耗时、退出码与源码前后哈希：`/tmp/aidt-pr-api-results.json`。执行器：`/tmp/aidt-pr-api-runner.py`。

环境使用明确的 `/tmp/aidt-node/node_modules/node/bin/node`（v22.23.5）与 `/tmp/aidt-tools/node_modules/pnpm/bin/pnpm.cjs`（9.15.0）；PATH、PNPM_HOME 和 XDG_CONFIG/DATA/CACHE/STATE 均显式定位 `/tmp` 下。新 worktree 的 vitest/typescript 依赖解析至 `/tmp/aidt-pr-virtual-store`，没有回退到旧 worktree或触发home下pnpm安装。

## 三份共享夹具合并核对

只读比较新 worktree 对 `4060bcf20` 和旧 `00480eff1`：

1. `apps/api/scripts/seed-fullstack-smoke.ts` 同时保留 develop 的独立 credit actors（feedbackDraft、voiceJourney、interviewIntake）、facilitator wallet 20000000 与每独立 actor wallet 20000，并保留 AIDT collaboration org/三账号/受开关控制的 seed、独立 instructions profile。
2. `apps/web/e2e/fullstack-smoke-fixture.ts` 同时保留 develop 三类独立 actor identity 和 AIDT collaboration identity；scope派生一致，未把账号折回同一个。
3. `apps/web/playwright.fullstack-smoke.config.ts` 同时保留 develop 新 actor env 和 AIDT collaboration env、supplier专用spec排除及native/member specs接线。

以上是源码三方保留核查，不是实际数据库 seed、钱包、浏览器或模型运行验收；本 worker 未执行 seed脚本或更改任何余额。

## 证据边界

这些都是本次新 develop 集成工作树真实执行结果，没有复用旧 base 的298/86/52等日志作为当前通过证据。此处86和52即便与历史数字相同，也来自上表新生成日志。

API context execution 的 provider 是本地测试/loopback，acceptance config 是协议单测。没有数据库、Docker、迁移或付费模型调用；没有生产部署、GitHub CI或真人课堂验收声明。已知官方 E003 两项和课堂验收仍由总体报告保留未通过状态。

root 提交这两文件修复后，应确认其字节与上列哈希匹配，再把新commit SHA写入PR验证记录；若commit前改源码，按受影响范围补验证。本报告不代替后续同SHA远端六项required checks和review。
