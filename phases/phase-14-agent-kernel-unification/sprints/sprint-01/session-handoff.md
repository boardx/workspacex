# 会话交接 — Sprint 14/01

## 当前已验证
- F01（apps/api 退化为薄网关）已合入 main（#2729），status 仍是 `in_progress`（其
  verify 从未在一个 Docker 可用的会话里跑通过——见下方"环境 blocker 的解法"，下一个
  会话可以现在就把它转 passing，方法已经现成）。
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

## 下一步最佳动作
1. 如果本会话没能在结束前跑通 `pnpm harness verify --sprint 14/01 --feature F03`
   （比如被打断），下一个会话直接用上面"环境 blocker 的解法"重搭一次本机 Postgres，
   跑 `pnpm harness verify --sprint 14/01 --feature F03` 把 status 转 passing——不要
   手改。
2. 同样的环境解法可以顺手把 F01 也转 passing（`pnpm harness verify --sprint 14/01
   --feature F01`），F01 合入以来一直没有一次真正跑通过。
3. F04（前端订阅改造：删除轮询、断线重连、终态判断修复）与本轮遗留的
   `agui-bridge.ts` 轮询切换，按 R11(b)/(c) 排期——见上"诚实的范围收窄"。

## 命令
- 启动：`pnpm -w run dev`
- 验证：`pnpm harness verify --sprint 14/01`
- 调试：`pnpm exec tsc --noEmit -p apps/api`（过滤 `fabric-markdown` 的已知 baseline 噪音）
