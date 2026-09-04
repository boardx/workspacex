# 会话交接 — Sprint 14/01

## 当前已验证
- F01 的 PR（#2729）已合入 `main`（见 `git log`），但 `feature_list.json` 里 F01 的
  status 仍是 `in_progress`——这一行的翻转只能由 `pnpm harness verify` 门控完成，
  本仓至今没有一个会话在 docker 出网可用的环境里把它跑通过；下一个能跑 docker 的
  会话应先补跑 `pnpm harness verify --sprint 14/01 --feature F01`，而不是假设"合入
  main = passing"。
- 无 feature 处于 harness `passing`。本轮（F13）与上一轮（F01）都撞上同一条环境
  blocker——见下方"仍损坏或未验证"，两个 feature 的 status 都未被手动改动，符合
  "只能由验证脚本门控转移"的硬约束。同一条环境 blocker 在 F15（本文件底部新增一节）
  再次出现。

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

## 本轮改动（F13：错误分类修复，toFailure 精确归类，issue #2718）

范围严格限定在 R11(a) 切分出来的那一小片（`toFailure` 精确化），不碰
R11(b)/(c)（人性化转换层、前端卡片、transcript 存储）——那是 F14/F15 的事。

- `apps/api/src/application/agent-run/run-skill-script.ts`：`toFailure` 新增
  `ModelCallError` 分支（归 `MODEL_CALL_FAILED`），排在原有三个具名异常分支之后、
  真兜底之前；真兜底（认不出的异常）从原来的 `SANDBOX_UNAVAILABLE` 改成
  `UNKNOWN_EXECUTION_ERROR`（R7：诚实的"不知道"优先于张冠李戴）。`SkillScriptOutcome`
  的 `failureCode` 联合类型同步加了这两个字面量。
  - 触发本 phase 故障的诱因：回喂重试的 `deps.regenerate(feedback)` 是一次真实模型
    调用（`execute-run.ts` 接的是 `deps.model.complete(...)`），失败时抛
    `ModelCallError`——改前这个异常类型 `toFailure` 完全没处理，直接落进兜底，
    被记成 `SANDBOX_UNAVAILABLE`；运维会去查一个没坏的沙箱容器。
- 新增 `apps/api/tests/agent-run/failure-classification.test.ts`（issue #2718 指定的
  唯一 verification 命令）：
  - E1 回归：`regenerate` 抛 `ModelCallError("MODEL_CALL_FAILED", ...)` ⇒
    `failureCode === "MODEL_CALL_FAILED"`，且带一条 CP 反证（重放旧兜底逻辑本身，
    证明它确实会把这个异常判成 `SANDBOX_UNAVAILABLE`）。
  - 兜底诚实：一个非 `ModelCallError`/非沙箱类的意外异常 ⇒
    `failureCode === "UNKNOWN_EXECUTION_ERROR"`。
  - 不回归：`SandboxUnavailableError` 仍然归 `SANDBOX_UNAVAILABLE`（本次没有动这条）。
  - 反证方法：把 `run-skill-script.ts` 的改动 `git stash` 掉后重跑同一份测试，
    确认前两条断言真的会红（见下方"已做的替代验证"第 2 条），不是空转的 vacuous test。

### 仍损坏或未验证（与 F01 同一条环境 blocker，本轮重新确认过一次）
- 本会话 docker 服务本身没有起来（`/var/run/docker.sock` 不存在，`service docker
  start` 因 `ulimit: error setting limit (Operation not permitted)` 失败）；手动
  `dockerd --storage-driver=vfs` 能把 daemon 本身跑起来，但 `docker compose up -d
  postgres` 拉取 `pgvector/pgvector:pg16` 时对 `production.cloudfront.docker.com`
  返回 `403 Forbidden`——与 F01 那轮记录的是同一条组织出网策略拦截（`/root/.ccr/
  README.md`："403/407 = 出网策略拒绝，不要绕过"），不是本轮改动引入的新问题。
  真实失败日志已落盘 `evidence/F13.verify.log`（`pnpm harness verify --sprint 14/01
  --feature F13` 的原始输出，未手改）。
- **已做的替代验证**（不是 harness 认可的证据，只是本轮实现信心的补充说明）：
  1. `pnpm exec tsc --noEmit -p apps/api`：0 个新增错误（含新测试文件本身）。
  2. 用一份临时 vitest config（只去掉 `globalSetup`，其余设置逐字照抄
     `vitest.config.ts`，不落进仓库）跑
     `tests/agent-run/failure-classification.test.ts`：4 个测试全绿；同时跑既有
     `tests/agent-runtime/chat-skill-script-execution.test.ts`（11 个测试）确认未
     回归。把 `run-skill-script.ts` 的改动 `git stash` 后重跑，前两条断言按预期
     变红（`SANDBOX_UNAVAILABLE` vs 期望的 `MODEL_CALL_FAILED`/
     `UNKNOWN_EXECUTION_ERROR`），证明测试确实抓得住这条回归。
- **下一步**：找一个 docker 出网可用的环境（本仓 CI 的 `verify-affected` runner，
  或另一个出网策略不同的 remote session）重跑
  `pnpm harness verify --sprint 14/01 --feature F13`，跑通后由 verify 脚本自身完成
  status 翻转（不能手改）；同一个环境顺带把 F01 的 verify 也补跑掉（见上）。

## 本轮改动（F15：完整可审计 transcript 存储改造，issue #2723）

范围严格限定在 R11(c)：`agent_run_steps` 完整内容 + 字段级加密 + RBAC 审计接口。
只依赖 F01（已合入 main），不碰 F14（人性化转换层/前端卡片，仍 `not_started`）。

- `apps/api/migrations/20260905110000_f15_transcript_full_content.sql`（新）：
  `agent_run_steps` 加两个可空列 `input_full_content_enc`/`output_full_content_enc`
  （密文），幂等 `IF NOT EXISTS`，append-only 账本不回填历史行。
- `apps/api/src/infrastructure/agent-run/transcript-content-cipher.ts`（新）：
  `AesGcmTranscriptContentCipher`（AES-256-GCM，与 `aes-credential-cipher.ts` 同构
  密文布局），但**带 decrypt**——与 credential cipher"刻意不可逆"的设计相反，因为
  审计接口的存在意义就是让授权角色读回明文（R3'-3）。`decrypt` 永不抛异常，任何
  失败（钥匙不对/密文被篡改/格式不对）一律返回 `null`（I-4/E3）。
  `transcriptContentCipherFromEnv()`（读 `AGENT_RUN_TRANSCRIPT_KEY`）未配置时返回
  `null` 而非抛错——与 `credentialCipherFromEnv()` 的"缺 key 启动失败"故意不同，
  见该文件头注。
- `apps/api/src/application/agent-run/ports.ts`：新增 `TranscriptContentCipher` 端口、
  `TranscriptStep` 类型（`z.infer` 自契约，不复述）、`AppendedRunStep` 新增可选的
  `inputFullContent`/`outputFullContent`（明文，加密只在 infrastructure 层做，
  onion 分层要求 application 层不得直接碰 cipher）、`AgentRunStore` 新增
  `readRunTranscriptSteps`。
- `apps/api/src/infrastructure/agent-run/pg-agent-run-repository.ts`：构造函数新增
  可选 `cipher` 参数（默认 `null`，所有既有调用点 `new PgAgentRunRepository(db)`
  不受影响）；`appendStep` 的 INSERT 从 16 列扩到 18 列，加密写入两个新列；新增
  `readRunTranscriptSteps`（不复用 `readRun` 的折叠投影——审计要的是原始账本，
  只返回 `model_called`/`tool_call` 两种 kind；两列都为 NULL 或任一列解密失败都
  诚实报 `decryptStatus: "unreadable"`）。
- `apps/api/src/application/agent-run/execute-run.ts`：`record()` helper 新增可选
  `inputFullContent`/`outputFullContent`；三处 `model_called` 记录点（等待批准/
  失败/成功）透传 `system`（完整 prompt）与 `text`（完整回复，仅成功时有）。
  `tool_call`/`context_built` 未改动——前者是明确的后续工作，后者不在契约四类
  kind 之内。
- `apps/api/src/application/agent-run/get-run-transcript.ts`（新）：`getRunTranscript`
  用例。RBAC 映射"运维/开发"→仅 `admin`（照抄 `admin-audit-read.ts` 的
  `isAuditReader` 先例，同样排除 `compliance`）；FORBIDDEN 判定**先于**任何存在性
  判断，防止把这条端点当 runId 探针。
- `apps/api/src/interface/controllers/agent-run.controller.ts`：新增
  `GET /agent-runs/:runId/transcript`。
- `apps/api/src/kernel.module.ts`：`AGENT_RUN_STORE` 工厂改传
  `transcriptContentCipherFromEnv()`。
- 因 `AgentRunStore` 新增必需方法，补 6 个既有测试文件里手搓的假件
  （`readRunTranscriptSteps: async () => null`）：`gateway-forwarding.test.ts`、
  `attachment-notice-in-context.test.ts`、`deep-agent-produces-files.test.ts`、
  `execute-run-progress.test.ts`、`execute-run-streaming.test.ts`、
  `vision-image-input.test.ts`。
- 新增 `apps/api/tests/agent-run/transcript-full-content-rbac.test.ts`（issue #2723
  指定的唯一 verification 命令）：V1 加密落库非明文、V2 admin 读到完整明文（HTTP +
  直调两条路径）、V3 RBAC 拒绝且先于存在性判断（含"把判权改回放行 compliance"的
  CP 反证）、V4 密钥不匹配/未配置时诚实 unreadable 不崩溃、V5 tool_call 范围诚实
  标注——每条正向断言配一条 `*-CP` 反证。

### 仍损坏或未验证（与 F01/F13 同一条环境 blocker）
- 同上文 F01/F13 记录的 Docker 出网限制：`docker compose up -d postgres` 拉取
  `pgvector/pgvector:pg16` 对 `production.cloudfront.docker.com` 返回
  `403 Forbidden`。本轮额外确认：`.harness/scripts/with-test-isolation.ts` 走的
  也是同一条 `docker compose up`，同样被拦——不是"忘了用隔离脚本"的问题。
  真实失败日志已落盘 `evidence/F15.verify.log`。
- **已做的替代验证**（不是 harness 认可的证据，写在这里供 CI/下一个会话核对）：
  1. `pnpm --filter api exec tsc --noEmit -p .`：本轮改动到的文件 0 个新增错误
     （已排除 baseline 就存在的 `fabric-markdown` DOM 类型噪音）。
  2. `pnpm --filter api run lint`：7 项架构体检全绿，含 `lint-arch-deps`——确认
     `get-run-transcript.ts`（application 层）没有导入 `transcript-content-cipher.ts`
     （infrastructure 层），加密只发生在 `PgAgentRunRepository` 内部。
  3. 逐行核对：`appendStep` INSERT 的 18 个参数位次与列名一一对应；密文格式
     `<iv-hex>.<authTag-hex>.<ciphertext-hex>` 与既有 `aes-credential-cipher.ts`
     同构；契约 `TranscriptStep`（`.strict()`）的 5 个字段名与仓储返回值逐一对应。
  4. 测试文件本身**从未在任何环境跑到绿**——这是本节明确承认的缺口，不是"看起来
     能跑"。CI 若发现测试逻辑本身有问题，需要在本 PR 上修，而不是绕过或删测试。

## 下一步最佳动作
- 找到 Docker 出网可用的环境，依次重跑 F01、F13、F15 的
  `pnpm harness verify --phase 14 --feature <id>` 把三者门控转 passing；不要在
  没跑通 verify 的情况下手改 `feature_list.json` 的 status。
- F13 之后：F14（错误人性化转换层+前端错误卡片）可并行；F15 已实现完成待 CI 验证；
  F15 的 `tool_call` 完整内容捕获（依赖 `deep-agent-model-provider.ts` 暴露未截断
  参数/结果）是已标注的后续工作；F02（灰度开关默认开启+移除开关本身）依赖 F01。

## 命令
- 启动：`pnpm -w run dev`
- 验证：`pnpm harness verify --phase 14`
- 调试：`pnpm exec tsc --noEmit -p apps/api`（过滤 `fabric-markdown` 的已知 baseline 噪音）
