# 会话交接 — Sprint 14/01

## 当前已验证
- 无 feature 处于 harness `passing`（本轮 F01 实现完成，但 `pnpm harness verify` 在本会话
  的沙箱环境里无法真正跑通——见下方"仍损坏或未验证"，status 仍是 `in_progress`，未被
  手动改动，符合"只能由验证脚本门控转移"的硬约束）。

## 本轮改动（F01：apps/api 退化为薄网关）
- `apps/api/src/application/agent-run/execute-run.ts`：删除 `useLazySkillLoading` 伪循环
  分支与原先并列的纯 `complete()`/`completeStream()` 分支（`executeToolLoop` 此前已被
  #741 物理删除，本轮确认其确实不存在）；模型调用收敛成唯一一处
  `invokeKernel(deps.model, ...)`；新增 R4 A1/I-3 要求的下发前健康检查
  （`checkKernelHealth`，未过 ⇒ 不发起下游调用，直接 `KERNEL_UNAVAILABLE` 落终态）；
  删除随之变成死代码的 `ExecuteAgentRunDeps.streamingEnabled` 字段与 `"catalog"` 系统
  提示词模式。行数 1493 → 1364。
- `apps/api/src/application/agent-run/invoke-kernel.ts`（新）：抽出的唯一模型调用点，
  三种 provider 形状（completeWithProgress/completeStream/complete）优先级与改动前逐字
  相同，只是不再内联在 execute-run.ts 里。
- `apps/api/src/application/agent-run/ports.ts`：`ModelCallPort` 新增 OPTIONAL
  `checkKernelHealth?(modelProvider)`。
- `apps/api/src/infrastructure/agent-run/deep-agent-model-provider.ts`：实现
  `checkKernelHealth()`（探测 `${baseUrl}/ok`；未配置地址或探测失败都报
  `"unavailable"`）。
- `apps/api/src/infrastructure/agent-run/routing-model-call-port.ts`：新增
  `checkKernelHealth(modelProvider)` 的按 provider 委托（同 `supportsProgress`/
  `supportsVision` 既有形状）。
- `apps/api/src/infrastructure/agent-run/agent-run-executor.ts` /
  `apps/api/src/kernel.module.ts`：删除已死的 `streamingEnabled` 接线。
- `packages/contracts/src/wave2-runtime.ts`：`AgentRunError` 新增 `KERNEL_UNAVAILABLE`。
- `apps/api/migrations/20260904170000_f01_kernel_unavailable_error_code.sql`（新）：
  `agent_runs_error_code_check` / `agent_run_steps_failure_code_check` 两条 CHECK 约束
  同步加上该符号，与 zod 枚举保持集合相等（`no-tool-run-writeback.test.ts` 机械看守）。
- 删除 `apps/api/tests/agent-runtime/skill-lazy-loading.test.ts`（测的正是本轮物理删除的
  分支）。
- 新增 `apps/api/tests/agent-run/gateway-forwarding.test.ts`、
  `apps/api/tests/agent-run/execute-run-thin-gateway.test.ts`（issue #2708 指定的两条
  verification 命令）。

## 仍损坏或未验证
- **本会话的沙箱环境 Docker 出网被组织出网策略拦截**：`docker compose up -d postgres`
  拉取 `pgvector/pgvector:pg16` 时对 `production.cloudfront.docker.com` 返回
  `403 Forbidden`（见 `/root/.ccr/README.md` 的"403/407 = 出网策略拒绝，不要绕过"）。
  `apps/api` 的 vitest 套件对**所有**测试文件（哪怕是纯内存 fake、不碰真库的）都要求
  `tests/support/db-global-setup.ts` 的真 Postgres 全局 setup 先跑通，本会话因此**无法
  执行任何一条** `pnpm --filter api exec vitest run ...` 命令，包括 issue 里指定的两条
  verification 命令。已尝试的替代路径：确认本机已装 `postgresql-16`（apt），但
  `tests/support/db.ts` 的 `postgresReady()` 探测走的是
  `docker compose exec postgres pg_isready`，不是裸端口探测，绕不开 docker；未修改测试
  基础设施本身（超出 F01 范围，也不应该为了绕开一次性环境限制去改共享测试基建）。
- **已做的替代验证**（不是 harness 认可的证据,只是本轮实现信心的补充说明,写在这里供下
  一个能跑 docker 的会话核对）：
  1. `pnpm exec tsc --noEmit -p .`（过滤掉与本改动无关、baseline 就存在的
     `packages/fabric-markdown` DOM 类型错误后）：0 个新增错误。
  2. 用 `tsx` 直接跑一段等价于 `gateway-forwarding.test.ts`/
     `execute-run-thin-gateway.test.ts` 断言的脚本（绕开 vitest 的全局 DB setup，纯内存
     fake port，不连真库）：happy path 转发、`KERNEL_UNAVAILABLE` 快速失败（未发起下游
     调用）、非 deep-agent provider 不受门控、`completeStream` 回退、事件流中途报错四类
     场景全部按预期通过。
  3. 手动核对 `AgentRunError.options`（zod）与两条迁移 CHECK 约束的取值集合逐字相同
     （8 个符号，含新增的 `KERNEL_UNAVAILABLE`）。
  4. `pnpm harness verify --sprint 14/01 --feature F01` 确实跑过一次——在
     `gateway-forwarding.test.ts` 的 global setup 阶段因上面的 docker 出网问题失败，
     真实失败日志已落盘 `evidence/F01.verify.log`（未手改，保留原始 fingerprint）。
- **下一步**：找一个 Docker 出网不受限的环境（例如本仓 CI 跑 `verify-affected` 的
  runner，或另一个 remote session 若其出网策略不同）重跑
  `pnpm harness verify --sprint 14/01 --feature F01`，跑通后由 verify 脚本自身完成
  status 翻转（不能手改）。

## 下一步最佳动作
- 找到 Docker 出网可用的环境，重跑 `pnpm harness verify --sprint 14/01 --feature F01`
  把 F01 门控转 passing；不要在没跑通 verify 的情况下手改 `feature_list.json` 的 status。
- F01 之后按 `01-kernel-unification.md` R11(b) 排 F02（灰度开关默认开启+移除开关本身）。

## 命令
- 启动：`pnpm -w run dev`
- 验证：`pnpm harness verify --sprint 14/01`
- 调试：`pnpm exec tsc --noEmit -p apps/api`（过滤 `fabric-markdown` 的已知 baseline 噪音）
