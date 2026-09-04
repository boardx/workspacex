# 进度日志 — Sprint 14/01

## 当前已验证状态(唯一真相)
- 仓库根目录: `/home/user/workspacex`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F13（错误分类修复，issue #2718）——实现完成，
  `in_progress`，未能在本会话跑通 harness verify（环境 blocker，见下）。F01 的 PR
  #2729 已合入 main，但同一条环境 blocker 使其 status 也仍停在 `in_progress`。F15
  （完整可审计 transcript 存储改造，issue #2723）同样实现完成、同一条环境 blocker
  未能本会话跑通 verify，见下方 2026-09-04 22:xx 记录。
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

### 2026-09-04 22:35（F15：完整可审计 transcript 存储改造，issue #2723）
- 本轮目标: 实现 R11(c)——`agent_run_steps` 从"digest+截断摘要"改为"完整内容+字段级
  加密"，新增 `getRunTranscript` 审计接口（仅 `admin` 角色可读，FORBIDDEN 先于
  RUN_NOT_FOUND 判定，防探针）。范围收窄（已在 PR 里如实标注）：本轮只对
  `model_called` 步骤捕获真实完整内容（`system`/`text`，对应 R3'-3"模型看到了什么、
  完整说了什么"）；`tool_call` 的完整参数/结果需要 `deep-agent-model-provider.ts`
  先暴露未截断数据，是明确的后续工作，不是被吞掉的缺口——在此之前 `tool_call` 行
  诚实报 `decryptStatus: "unreadable"`。
- 已完成: 新迁移（`agent_run_steps` 加两列加密全文）；新 cipher 模块
  （`transcript-content-cipher.ts`，AES-256-GCM，与 `aes-credential-cipher.ts` 同构但
  带 decrypt，因为审计接口必须能读回）；`AgentRunStore` 新增
  `readRunTranscriptSteps`；`execute-run.ts` 的 `record()` 与三处 `model_called`
  调用点透传完整内容；新用例 `get-run-transcript.ts`；`agent-run.controller.ts` 新增
  `GET /agent-runs/:runId/transcript`；`kernel.module.ts` 接入 cipher 工厂；新测试
  `tests/agent-run/transcript-full-content-rbac.test.ts`（issue 指定的唯一
  verification 命令，覆盖 V1-V5 各配一条 CP 反证）。
- 运行过的验证:
  - `pnpm --filter api exec tsc --noEmit -p .`：改动到的文件（含因接口新增方法而
    补 stub 的 6 个既有测试假件）0 个新增错误。
  - `pnpm --filter api run lint`（含 `lint-arch-deps`）：全绿。
  - `pnpm harness verify --phase 14 --feature F15`：跑过，在 vitest 全局 DB setup
    阶段因 Docker 出网被拦而失败——与 F01/F13 同一条环境 blocker，非本次改动引入的
    逻辑缺陷。
- 已记录证据: `evidence/F15.verify.log`（真实失败日志 + 本会话已做到的最大验证，
  未手改失败部分）。
- 提交记录: 见分支 `worker/remote-f15-14-f15-transcript-encryption` 的 PR（关联
  issue #2723）。
- 已知风险或未解决问题: F15 尚未 `passing`——需要一个 Docker 出网可用的环境（CI）
  重跑 `pnpm harness verify --phase 14 --feature F15`；`tool_call` 完整内容捕获是
  已标注的后续工作，不在本 PR 范围。
- 下一步最佳动作: 等 CI 跑通该 verification 命令；CI 若发现测试本身有问题需要在本
  PR 上修。
