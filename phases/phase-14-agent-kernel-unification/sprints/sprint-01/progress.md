# 进度日志 — Sprint 14/01

## 当前已验证状态(唯一真相)
- 仓库根目录: `/home/user/workspacex`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F13（错误分类修复，issue #2718）——实现完成，
  `in_progress`，未能在本会话跑通 harness verify（环境 blocker，见下）。F01 的 PR
  #2729 已合入 main，但同一条环境 blocker 使其 status 也仍停在 `in_progress`。
- 当前 blocker: 本会话沙箱 Docker 出网被组织出网策略拦截（`pgvector/pgvector:pg16`
  拉取对 `production.cloudfront.docker.com` 返回 403），`apps/api` vitest 全局 setup
  强制要求真 Postgres，本会话因此无法跑通任何一条 `pnpm --filter api exec vitest run`
  命令。详见 `session-handoff.md`。

## 会话记录
### 2026-09-04 20:22:49
- 本轮目标: 实现 Phase 14 F01（apps/api 退化为薄网关：转发 run 到内核、旁路写账本、
  删除自有执行分支）。
- 已完成: 删除 `useLazySkillLoading` 伪循环与纯 complete()/completeStream() 分支，
  模型调用收敛为唯一一处 `invokeKernel(...)`；新增下发前健康检查
  （`checkKernelHealth` + `KERNEL_UNAVAILABLE` 终态码，含契约枚举与 DB 迁移）；
  execute-run.ts 1493 → 1364 行；新增两条 issue #2708 指定的 verification 测试文件。
- 运行过的验证:
  - `pnpm exec tsc --noEmit -p apps/api`（过滤已知 baseline 噪音 `fabric-markdown`）：0 新增错误。
  - `pnpm harness verify --sprint 14/01 --feature F01`：跑过，在 vitest 全局 DB setup
    阶段因 Docker 出网被拦而失败（非本次改动引入的逻辑缺陷，见下）。
  - 用 `tsx` 直接执行等价断言（绕开 vitest 全局 setup，纯内存 fake，无需真库）：
    四类场景（正常转发、KERNEL_UNAVAILABLE 快速失败、非 deep-agent provider 不受
    门控、completeStream 回退）全部通过，作为实现信心的补充说明（不是 harness 认可
    的证据）。
- 已记录证据: `evidence/F01.verify.log`（真实失败日志，未手改）。
- 提交记录: 见分支 `worker/remote-f01-14-f01` 的 PR（关联 issue #2708）。
- 已知风险或未解决问题: F01 尚未 `passing`——需要一个 Docker 出网可用的环境重跑
  `pnpm harness verify --sprint 14/01 --feature F01`。
- 下一步最佳动作: 在能跑 docker 的环境重跑 verify 把 F01 转 passing；之后按
  R11(b) 排 F02。

### 2026-09-04 21:39:27
- 本轮目标: 实现 Phase 14 F13（错误分类修复：`toFailure` 精确归类，取消
  `SANDBOX_UNAVAILABLE` 兜底误标，issue #2718）。
- 已完成: `run-skill-script.ts` 的 `toFailure` 新增 `ModelCallError` 分支（归
  `MODEL_CALL_FAILED`）；真兜底从 `SANDBOX_UNAVAILABLE` 改为 `UNKNOWN_EXECUTION_ERROR`
  （R7）；新增 `tests/agent-run/failure-classification.test.ts`（issue 指定的唯一
  verification 命令），含 E1 回归、CP 反证、兜底诚实、不回归四组断言。
- 运行过的验证:
  - `pnpm exec tsc --noEmit -p apps/api`：0 新增错误。
  - `pnpm harness verify --sprint 14/01 --feature F13`：跑过，在 vitest 全局 DB setup
    阶段因 Docker 出网被拦而失败（与 F01 那轮同一条环境 blocker，非本次改动引入的
    逻辑缺陷）。
  - 用临时 vitest config（只去掉 globalSetup）直接跑
    `failure-classification.test.ts` + 既有 `chat-skill-script-execution.test.ts`：
    共 15 个测试全绿；把本次改动 `git stash` 后重跑，新测试的前两条断言确实变红
    （证明测试抓得住真实回归，不是空转）。
- 已记录证据: `evidence/F13.verify.log`（真实失败日志，未手改）。
- 提交记录: 见分支 `worker/remote-f13-14-f13-error-classification` 的 PR（关联
  issue #2718）。
- 已知风险或未解决问题: F13 尚未 `passing`——需要一个 Docker 出网可用的环境重跑
  `pnpm harness verify --sprint 14/01 --feature F13`（F01 同样待补跑）。
- 下一步最佳动作: 在能跑 docker 的环境依次重跑 F01、F13 的 verify；F13 之后
  F14/F15（错误人性化转换层、transcript 存储改造）可并行开工。
