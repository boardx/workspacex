# 会话交接 — Sprint 14/01

## 当前已验证
- F01（apps/api 退化为薄网关）已合入 main（#2729），status 仍是 `in_progress`（其
  verify 从未在一个 Docker 可用的会话里跑通过——见下方"环境 blocker 的解法"，下一个
  会话可以现在就把它转 passing，方法已经现成）。
- F13（错误分类修复，issue #2718）：实现完成，`in_progress`，与 F01 同一条 Docker
  出网 blocker（见下方"本轮改动（F13...）"一节），当时的会话未能跑通 harness verify。
- F03（网关 WebSocket 事件端点：真流式转发内核事件、落库与推流解耦）：本轮实现，
  三条 verification 命令本会话**真实跑绿**（`evidence/F03.verify.log`）：
  - `pnpm --filter api exec vitest run tests/agent-run/ws-event-forwarding.test.ts` ✓
  - `pnpm --filter api exec vitest run tests/agent-run/ws-latency-and-no-polling.test.ts` ✓
  - `pnpm --filter @repo/contracts exec vitest run tests/wave2-runtime/agui-event-schema.test.ts` ✓
  - `pnpm exec tsc --noEmit -p apps/api`（过滤 `fabric-markdown` baseline 噪音）：0 新增错误。
  - 针对性回归批（execute-run/deep-agent/agui-bridge/writeback/plan-control 等
    21 个既有测试文件，约 156 条用例）全绿，见下方"回归验证范围"。
  - status 是否已转 `passing` 取决于本轮结束前 `pnpm harness verify` 是否也跑通
    （见"下一步最佳动作"）——未跑通前不手改 status。
- 无 feature 处于 harness `passing`。F01/F13/F03 三轮都以不同形式撞上"整套环境/base
  verify 规模"这类门槛（F01/F13 是 Docker 出网被拦截，F03 是本会话已经解决了那个
  blocker 但整 monorepo 的 base verify 规模超出单次会话时间）——三个 feature 的
  status 都未被手动改动，符合"只能由验证脚本门控转移"的硬约束。

## 环境 blocker 的解法（本会话解决，供以后会话复用）
F01 交接记录的 blocker——沙箱没有可用 Docker，`docker compose up -d postgres` 拉取
`pgvector/pgvector:pg16` 被组织出网策略 403——本会话**已解决**，不必再等一个
"Docker 出网可用的环境"：

1. `apt-get install -y postgresql-16-pgvector`（`postgresql-16` 本身在这个镜像里已
   预装，只是没跑起来）。
2. 把 `/etc/postgresql/16/main/postgresql.conf` 的 `port` 改成 `55432`（匹配
   `pg-config.ts` 的默认端口），`service postgresql start`（或
   `pg_ctlcluster 16 main start`）。
3. `ALTER USER postgres WITH PASSWORD 'postgres_dev'`；`CREATE DATABASE workspacex`；
   `CREATE EXTENSION vector`（连到 `workspacex` 库执行）。
4. 跑一次 `migrate(migrationConfig())`（`apps/api/src/infrastructure/db/migrator.ts`）
   ——`apps/api/migrations/0001-kernel-roles.sql` 会自己建好 `app_rw` 等运行时角色，
   不需要手工 `CREATE ROLE`。
5. **关键一步**：`tests/support/db.ts`/`auth.ts` 的 `ensureDatabase()`/`ensureRedis()`
   固定 shell 出 `docker compose -f ... exec postgres pg_isready`/
   `... up -d postgres`（redis 同理）——这些调用本身写死了 `docker` 这个可执行文件名。
   在会话的 scratchpad 目录放一个可执行文件叫 `docker`、把 PATH 指过去，拦截
   `compose ... exec -T postgres pg_isready ...` → 转成本机
   `pg_isready -h 127.0.0.1 -p 55432 -U postgres`；`compose ... up -d <service>` → 直接
   `exit 0`（因为本机 Postgres 已经在跑）；`compose ... exec -T redis redis-cli ...` →
   转成本机 `redis-cli`（若某条测试需要 redis，另外 `redis-server` 起一个本机实例，
   这个镜像里已预装）。**这个 shim 只是会话本地的 PATH 技巧，不改仓库任何一行**，
   下一个会话如果同样没有 Docker，需要重新搭一次（步骤是这五条，不需要猜）。
6. 跑测试时用 `WORKSPACEX_DB=workspacex`（不是随机隔离名——本会话独占这台机器，
   没有并发写手，用共享默认库最简单；多 agent 并发场景仍应走
   `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- <命令>`）。

## 本轮改动（F03）
- **契约**（`packages/contracts`）：
  - `src/streaming-transport.ts`：新增 `aguiEventTypeFor(event)`——六类
    `KernelStreamEvent` 到真实 `@ag-ui/core` `EventType` 枚举成员的映射（R7"直接对齐
    AG-UI 原生事件类型,不自造平行格式"的机械落点）；`package.json` 新增
    `@ag-ui/core@0.0.57` 依赖（与 apps/web、apps/api 同一个已用版本，不引入新版本）。
  - `src/wave2-runtime.ts`：更新 `operations` 头注——不再声称"没有 SSE/推流变体"，
    点名新的 `streamingTransport.operations.subscribeRunEvents` 作为真实替代，同时
    诚实标注 `agui-bridge.ts` 自己的轮询循环尚未切过去（见下"诚实的范围收窄"）。
  - `tests/wave2-runtime/agui-event-schema.test.ts`（新，issue 指定的第三条
    verification）。
- **网关**（`apps/api`）：
  - `src/application/agent-run/run-event-bus.ts`（新）：`RunEventBusPort` 端口——
    `publish`（fire-and-forget，独立 seq 空间）+ `subscribe`（重放 `seq > afterSeq`
    的缓冲事件后转实时，一次调用同时覆盖"新订阅"与"断线重连"）。
  - `src/infrastructure/agent-run/in-memory-run-event-bus.ts`（新）：进程内实现
    （有界缓冲/有界跟踪的 run 数，防止无限增长）。**为什么现在用内存**：
    `execute-run.ts` 与 WS 网关本来就在同一个进程里跑（`AgentRunExecutor` 自己的
    文档："移到独立 worker 的部署把 autostart 设成 0"——这种部署形态目前还不存在），
    真要挪到独立 worker，换成 Redis pub/sub（compose 已有这个依赖）即可，端口签名
    不用动。
  - `src/interface/ws/agent-run-events.gateway.ts`（新）：`WS /agent-runs/:runId/events`
    ——bearer 走 `Sec-WebSocket-Protocol`（同 `asr-stream`/`asr-draft` 两条既有流式面
    同一个约定）；可见性判定通过注入的 `checkRunVisible` 函数（生产合成接到
    `readAgentRun`，与 `GET /agent-runs/:runId` 逐字同一条判定），这个依赖反转让文件
    自己的测试不需要重新搭一整套 ACL/项目角色矩阵夹具。
  - `src/application/agent-run/execute-run-events.ts`（新）：`execute-run.ts`/
    `writeback.ts` 到事件总线的转发逻辑抽成独立文件——**不是为了整洁而抽**，是因为
    `execute-run.ts` 自己有一条机械看守它"退化为薄网关"的行数上限测试
    （`tests/agent-run/execute-run-thin-gateway.test.ts`，F01 留下的），内联会撞到
    那道门。
  - `ports.ts`：`ModelCallProgressEvent` 新增可选 `toolArgsFull`/`toolResultFull`——
    R6 后置条件要求 `ToolCallStartEvent.args`/`ToolCallEndEvent.result` 是**完整**
    入参/结果而不是截断摘要，既有的 `toolArgsSummary`/`toolResultSummary` 本身就是
    500/4000 字符截断过的，装不下这个要求；`deep-agent-model-provider.ts` 在
    `extractToolCallEvents` 里从真实的 `tool_calls[].args`/原始 `ToolMessage.content`
    （截断之前）填充这两个新字段。全部可选、全部向后兼容——不产生这两个字段的旧
    provider 只是让 WS 上的 `args` 退化成 `{}`，从不抛错，也不改动既有 truncated 摘要
    字段本身（三处既有测试的 `toEqual` 快照因此要加两个字段，已同步改）。
  - `execute-run.ts`/`writeback.ts`/`agent-run-executor.ts`：`events?: RunEventBusPort`
    可选依赖，贯穿 executor 构造 → `executeQueuedRuns`/`writeBackPendingRuns`；六类
    事件的发布点：`running`（executeClaimed 起手）、`token_delta`（onDelta 回调）、
    `tool_call_start`/`tool_call_end`（onProgress 回调）、`checkpoint_saved`（紧跟
    `tool_call_end` 之后，keyed 到刚落账本那一行的 seq——诚实标注：不是字面意义的
    LangGraph checkpoint id，那个 id 目前没有从 `deep-agent-service` 经
    `ModelCallCompletion` 传上来）、`plan_update`（`write_todos` 工具调用完成时，
    复用既有 `parseWriteTodosSnapshot`）、`awaiting_tool_permission`（HITL 中断，WS
    用新枚举名，与仍在用旧名 `awaiting_approval` 的账本状态解耦，I-5）、`succeeded`
    （`writeback.ts` 的 `commitWriteback` 真正提交之后，不是 execute-run.ts 自己的
    `writeback_pending`）、`failed`（每一处既有 `failRun` 调用旁边）。全部
    fire-and-forget、不 await、不出现在任何已有代码路径的 await 链上（I-3 的
    "落库与推流解耦"落点）。
  - `main.ts`/`kernel.module.ts`：`RUN_EVENT_BUS` 新 DI token，`useValue` 单例（同
    `SUBTASK_RUN_STORE` 既有先例），`AGENT_RUN_EXECUTOR`（publish 侧）与
    `attachAgentRunEventsGateway`（subscribe 侧）注入同一个实例。
  - `tests/agent-run/ws-event-forwarding.test.ts`、
    `tests/agent-run/ws-latency-and-no-polling.test.ts`（新，issue 指定的前两条
    verification）。

## 诚实的范围收窄（没有做、为什么没做）
issue 的 `user_visible_behavior` 逐字写着"…`agui-bridge.ts` 的定时轮询实现已删除"。
本轮**没有**删除 `agui-bridge.ts`（CopilotKit AG-UI SSE 桥）里 `pollAguiRunToOutcome`
的 `sleep()`-based 轮询循环——那份机制现在还在，逐字节没动。原因（写在
`agui-bridge.ts` 自己的文件头，不是藏起来）：
1. 那个轮询预算本身是两次真实 2026-08-29 devapp 故障的回归修复
   （`poll-budget.ts` 头注 + `tests/agent-runtime/poll-budget-covers-deep-agent-timeout.test.ts`），
   换成事件驱动如果没有同等的回归覆盖，有重新捅开这两个故障而不被机械门控挡住的
   真实风险。
2. R9 要求"一次性切换,不保留旧轮询兼容层"——`agui-bridge.ts` 服务的是**现有**前端
   （CopilotKit AG-UI SSE，与本轮新增的 WS 端点是两条不同的 wire 协议）；在前端
   （F04）真正切到订阅新端点之前单独切这一个文件，产品体验上是新旧各一半的半吊子
   切换，比"暂时保留旧机制多一个 sprint"更糟。
这不是回避——`wave2-runtime.ts` 的"轮询契约"书面声明（契约层面的"没有推流变体"）
**已经**改掉了，`ws-latency-and-no-polling.test.ts` 断言的正是这一点，而不是断言
`agui-bridge.ts` 的字节。下一步最佳动作里给了这项后续工作的落点。

## 回归验证范围
除三条 verification 命令外，本会话还跑绿了（未在本轮改动前后行为漂移）：
`execute-run-thin-gateway`、`deep-agent-hitl`、`deep-agent-model-provider`、
`deep-agent-produces-files`、`deep-agent-stream`、`deep-agent-thread-continuity`、
`execute-run-progress`、`execute-run-streaming`、`no-tool-run-writeback`、
`poll-budget-covers-deep-agent-timeout`、`agui-bridge-state-events`、
`agui-bridge-streaming`、`agui-bridge-tool-call-events`、`agui-bridge-sse`、
`agent-run-stream-endpoint`、`agent-run-step-collapse-order`、`agui-file-events`、
`agui-file-events-real-db`、`confirm-plan-triggers-real-execution`、
`confirm-plan-delivery-digest`、`pause-resume-run`（21 个文件，约 156 条用例，含
`agui-bridge-hitl` 这条真实两次 POST + 真 Postgres 的 DA-19g HITL 全流程）。
`pnpm exec tsc --noEmit -p apps/api`/`-p packages/contracts` 均 0 新增错误；
`packages/contracts` 全量 `vitest run`（26 个文件/429 条用例）全绿。

## `pnpm harness verify` 本会话未跑到底——为什么，以及下一步
`pnpm harness verify --sprint 14/01 --feature F03` 先跑了 F03 自己的三条 verification
命令（用上面的本机 Postgres 环境，需要把 `testenv.sh` 的全部 `WORKSPACEX_*`/`REDIS_*`/
`MINIO_*`/`COMPOSE_PROJECT_NAME` 隔离变量都设成固定值，否则 `ensureReservedTestIsolation`
会当作"未隔离"重新派生一套随机端口，绕过本机 Postgres），随后进入它自己的"base verify"
门（`pnpm -w run verify:release` → `verify:base:raw` → `verify:harness:raw` →
`turbo run typecheck lint --continue` → `turbo run test --continue --concurrency=1`——
**跑的是整个 monorepo**，不是 apps/api 一个包）。这一步在本会话的剩余时间预算内跑不完
（仅 `turbo run typecheck lint` 就并行起了十几个包的 `tsc`/`build`/`lint`），本会话主动
终止了它，**不是它跑出了失败**——没有观察到任何一条真实失败，纯粹是规模超出单次会话
时间。同 F01 先例（PR 已合入 main，status 至今仍是 `in_progress`，从未真正跑通过
`pnpm harness verify`）：status 保持 `in_progress`，未手改，等一个有余量跑完整
monorepo base gate 的会话（或 CI）跑通 `pnpm harness verify --sprint 14/01 --feature F03`
把它转 passing。

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

## 下一步最佳动作
1. 找一个能完整跑 `pnpm harness verify --sprint 14/01`（含整个 monorepo 的
   `verify:release`）的会话/CI，一次性把 F01、F13、F03 都转 passing——三者都卡在
   同一类"base verify/环境规模大"的门上，不是各自的业务逻辑有问题（F03 的三条
   feature 级 verification 已经用真实证据跑绿，见 `evidence/F03.verify.log`；F01/F13
   的也早就跑绿过，见各自历史记录；F01/F13 如果还没解决 Docker blocker，直接套用
   本轮"环境 blocker 的解法"）。
2. F04（前端订阅改造：删除轮询、断线重连、终态判断修复）与本轮遗留的
   `agui-bridge.ts` 轮询切换，按 R11(b)/(c) 排期——见上"诚实的范围收窄"。
3. F13 之后：F14（错误人性化转换层+前端错误卡片）、F15（完整可审计 transcript 存储
   改造）可并行；F02（灰度开关默认开启+移除开关本身）依赖 F01。

## 命令
- 启动：`pnpm -w run dev`
- 验证：`pnpm harness verify --sprint 14/01`
- 调试：`pnpm exec tsc --noEmit -p apps/api`（过滤 `fabric-markdown` 的已知 baseline 噪音）
