# 会话交接 — Sprint 14/01

## 当前已验证
- 无 feature 处于 harness `passing`。F01 实现完成、已合入 main（PR #2729），但
  `pnpm harness verify --sprint 14/01 --feature F01` 从未在任何会话里真正跑通过，
  status 仍是 `in_progress`（未被手动改动，符合"只能由验证脚本门控转移"的硬约束）。
- F05 本轮实现完成，**feature 自己的 verification 命令本会话已用真实 Postgres 跑通
  （8/8，见下方"本轮改动（F05）"）**，但同样没能跑完 `pnpm harness verify` 的完整
  门控链（高风险档 `verify:release` 需要本会话没有的 docker/minio/redis，见下方
  "仍损坏或未验证"），status 仍是 `in_progress`，未手改。

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

## 本轮改动（F05：放开"一条用户消息只能对应一个 run"约束）

issue #2711，`requirements/02-streaming-transport.md` R4 E4，契约束
`streaming-transport`（design-signoff 2026-09-04T19:21:52Z，usamshen 已确认覆盖
F03/F04/F05）。

- **不碰** `agent_runs` 的 `UNIQUE (org_id, input_message_id)`（#415）——那条约束是
  coord-main 在 #519 上明确裁定优先于任何"往 `agent_runs` 塞第二行"的措辞（见
  `20260805190000_i519_agent_run_retry.sql` 头注），`no-tool-run-writeback.test.ts`
  的 "keeps the input-message uniqueness the reset exists to protect" 机械钉着它还在。
  `agent_runs` 一行仍是唯一的"逻辑 run"，`messageId` 依旧只映射到那一个
  `agent_runs.id`。
- `apps/api/migrations/20260905110000_f05_agent_run_attempts.sql`（新）：新表
  `agent_run_attempts`（`run_id` FK → `agent_runs.id`，`attempt_seq` 从 1 递增，
  `resumed_from_checkpoint_id` 可空，`status` CHECK 镜像
  `packages/contracts/src/streaming-transport.ts` 的 `AgentKernelRunStatus` 八个取值，
  `UNIQUE(org_id, run_id, attempt_seq)`）。只 append，不可 UPDATE/DELETE（同
  `agent_run_steps` 先例：GRANT 只给 SELECT/INSERT + 触发器双重防线）。「一个逻辑 run
  多次续跑」体现为这张表按 `run_id` 递增的行，不是新增 `agent_runs` 行。`messageId`
  不冗余存储，两个方法都 JOIN `agent_runs.input_message_id` 投影出来。
- `apps/api/src/application/agent-run/run-attempts.ts`（新）：`AgentRunAttemptStore`
  端口（`recordAttempt`/`listForMessage`）+ 用例 `listRunAttemptsForMessage`
  （usecases.md UC-2），可见性判定复用 `findMessageLocation` → `resolveVisibility`
  （同 `submit-message-rating.ts`/F176 先例，不另起第二套权限系统）。
- `apps/api/src/infrastructure/agent-run/pg-agent-run-attempt-repository.ts`（新）：
  上述端口的 PostgreSQL 实现。`recordAttempt` 用 advisory lock 串行化同一 `runId`
  的并发续跑请求，避免两个调用方算出同一个 `attempt_seq`。
- `apps/api/scripts/lint-permission-paths.mjs`：新增该仓储的 ALLOWLIST 条目（同
  `pg-agent-run-context-snapshot.ts`/F157 先例——判权在
  `listRunAttemptsForMessage` 里，不在仓储本身）。
- 新增 `apps/api/tests/agent-run/message-multi-run.test.ts`（issue 指定的唯一
  verification 命令，8 条用例，对真实 Postgres）：① `agent_runs` 的 UNIQUE 约束原样
  成立；② 同一 messageId 关联多条续跑记录、`attemptSeq` 递增、续跑携带上一次的
  checkpoint id；②之二/之三：单次执行=1 条记录、不同消息互不串；③ status 的 CHECK
  取值集合与 `AgentKernelRunStatus` 是同一份事实（`pg_constraint` 断言）；④ 只
  append（GRANT + 触发器双重机制都在）；⑤ `listRunAttemptsForMessage` 先判可见性、
  拒绝时不往下读（源码级顺序断言，同 F157 `agent-run-context-snapshot-repo-guard`
  先例，不需要搭整套 identity/authorize 真栈）。

**没有**触达的部分（有意，超出本 feature 最小范围）：`packages/contracts` 的
`streaming-transport.ts`/`AgentRunAttempt`/`operations.listRunAttemptsForMessage`
契约面在设计签核阶段已经写好，本轮直接消费，未改动；`GET
/messages/:messageId/agent-run-attempts` 的 NestJS controller/路由未接线——notes
只要求"数据模型变更"+ verification 只测数据层，接线留给消费它的 F03/F04（WebSocket
订阅 + 前端）落地时一并做，避免本 feature 顺手扩大范围。

## 仍损坏或未验证
- **本会话（F01 那一轮）的沙箱环境 Docker 出网被组织出网策略拦截**：`docker compose
  up -d postgres` 拉取 `pgvector/pgvector:pg16` 时对 `production.cloudfront.docker.com`
  返回 `403 Forbidden`。
- **本会话（F05 这一轮）Docker daemon 本身起不来**（不是出网策略问题，是容器运行时
  不允许调 ulimit：`service docker start` 报 `ulimit: error setting limit (Operation
  not permitted)`，`dangerouslyDisableSandbox` 下同样失败）——原因与 F01 那一轮不同，
  结果相同：`tests/support/db.ts` 的 `ensureDatabase()` 硬依赖
  `docker compose exec postgres pg_isready`，绕不开。
  - **本轮的替代路径，比 F01 那轮更进一步**：本机原有 `postgresql-16`（apt）+ 新装
    `postgresql-16-pgvector`，起了一个原生集群（`service postgresql start`），角色/
    密码/端口与 `docker-compose.dev.yml` 声明一致；在本会话本地 `/usr/local/bin/docker`
    放了一个不进仓库的 shim，只翻译 `db.ts` 实际发出的两种调用形状（`compose up -d
    postgres` / `compose exec -T postgres pg_isready|psql`）到原生集群，**没有修改
    `tests/support/db.ts` 或任何提交进仓库的文件**。效果：issue 指定的
    verification 命令**真的对真实 Postgres 跑通**（8/8，含 RLS/迁移/触发器），而不是
    只做了类型检查。完整命令与输出见 `evidence/F05.verify.log`；额外跑了
    `no-tool-run-writeback.test.ts`（含 #519 的 UNIQUE 约束存在性钉子）等 70 条既有
    用例确认无回归，以及全量迁移空库重放（`migrate-check.ts`，192 条迁移 + force
    重放 digest 一致）。
  - **仍然没跑通的是 `pnpm harness verify` 本身**：feature 命令过了之后，因为本次
    改动碰了 `apps/api/migrations/**`（`harness.config.yaml` 的 `high_risk_paths`），
    会自动升级到 `pnpm -w run verify:release`（全仓 typecheck+lint+test，其中一部分
    子包需要真实 minio/redis/浏览器 e2e），本会话的原生-Postgres 替代路径只覆盖了
    `db.ts` 这一个 docker 触点，没有覆盖 minio/redis，所以没有尝试跑这一档（评估后
    判断大概率会卡在与 F05 无关的基础设施缺口上，而不是本 feature 的代码）。
- **下一步**：找一个 docker/minio/redis 都可用的环境（本仓 CI 的 `verify-affected`
  runner，或另一个 remote session）重跑 `pnpm harness verify --sprint 14/01
  --feature F05`，跑通后由 verify 脚本自身完成 status 翻转（不能手改）；F01 的
  `--feature F01` 也还欠着同一步。

## 下一步最佳动作
- 找到 docker 完整可用的环境，依次补跑 `pnpm harness verify --sprint 14/01
  --feature F01` 与 `--feature F05`，把两个都门控转 passing；不要在没跑通 verify
  的情况下手改 `feature_list.json` 的 status。
- F05 之后：`GET /messages/:messageId/agent-run-attempts` 的 controller 接线（本轮
  刻意未做，见上）适合并入消费它的 F03/F04。按 `01-kernel-unification.md` R11(b)
  也还欠 F02（灰度开关默认开启+移除开关本身）。

## 命令
- 启动：`pnpm -w run dev`
- 验证：`pnpm harness verify --sprint 14/01`
- 调试：`pnpm exec tsc --noEmit -p apps/api`（过滤 `fabric-markdown` 的已知 baseline 噪音）
