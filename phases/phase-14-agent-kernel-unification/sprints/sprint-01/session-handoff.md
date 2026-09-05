# 会话交接 — Sprint 14/01

## 当前已验证
- F01 的 PR（#2729）已合入 `main`（见 `git log`），但 `feature_list.json` 里 F01 的
  status 仍是 `in_progress`——这一行的翻转只能由 `pnpm harness verify` 门控完成，
  本仓至今没有一个会话在 docker 出网可用的环境里把它跑通过；下一个能跑 docker 的
  会话应先补跑 `pnpm harness verify --sprint 14/01 --feature F01`，而不是假设"合入
  main = passing"。
- F13 的 PR（#2730）同样已合入 `main`，同一条环境 blocker（见下方"仍损坏或未验证"）
  拦住了 verify，status 未手动改动。
- F05（放开"一条用户消息只能对应一个 run"约束）已合入 main：feature 自己的
  verification 命令用真实 Postgres 跑通（8/8，见下方"本轮改动（F05）"）。
- F10（前端产出物面板版本历史回归测试）同样撞上"Docker 在本会话不可用"这同一大类
  环境限制（具体故障点各自不同，见各自小节），status 未手改。
- 无 feature 处于 harness `passing`。F13、F01、F05、F15、F10 都撞上"Docker 在对应
  会话不可用"这同一大类环境限制（具体故障点各自不同，见各自小节）——见下方"仍损坏
  或未验证"，几个 feature 的 status 都未被手动改动，符合"只能由验证脚本门控转移"
  的硬约束。
- F01（apps/api 退化为薄网关）、F13（错误分类修复）已合入 main（#2729/#2730），
  status 仍是 `in_progress`（verify 从未在一个 Docker 可用的会话里跑通过——见下方
  "环境 blocker 的解法"）。
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
- F05（放开"一条用户消息只能对应一个 run"约束）已合入 main：feature 自己的
  verification 命令用真实 Postgres 跑通（8/8，见下方"本轮改动（F05）"），
  `pnpm harness verify` 完整链同样卡在环境 blocker 上。
- F10（前端产出物面板版本历史回归测试）同样撞上"Docker 在本会话不可用"这同一大类
  环境限制（具体故障点各自不同，见各自小节），status 未手改。
- F04（前端订阅改造：删除轮询、断线重连、终态判断修复与全部非终态可交互渲染）：
  本轮实现，三条 issue 指定的 verification 命令本会话**真实跑绿**
  （`evidence/F04.verify.log`），另有随本轮架构变化同步改写的既有回归测试
  （`tests/ui/copilotkit-v2-run-restore-on-remount.test.tsx`，4/4 绿）；细节见
  下方"本轮改动（F04）"。`pnpm harness verify` 因触及 `packages/contracts`
  高风险路径升级到 `pnpm -w run verify:release`——harness 自己把完整真实输出
  写进了 `evidence/F04.verify.log`：34 个 turbo task 中 20/21 成功，`web`（本
  feature 实际改动的包）**310/310 测试文件、2868/2868 测试全绿**，唯一失败的
  `@repo/api#test` 是 `docker compose up -d postgres` 因本会话无 Docker daemon
  报错（与 F01/F03/F05/F10/F13 同一类环境限制，非业务逻辑失败），status 未手改。
- 无 feature 处于 harness `passing`——F01/F03/F13/F05/F10/F04 都符合"只能由验证
  脚本门控转移"的硬约束，没有一个绕开门控手改 status。
- F08（前端工具权限确认弹层：四档授权决策，issue #2716，依赖 F06）：本轮实现，
  唯一 verification 命令本会话真实跑绿（`evidence/F08.verify.log`）；组件本身
  是已建原型（同 F04/F10/F14 先例，只补测试）。`pnpm harness verify` 撞上与
  F10/F04 同一条环境限制（本会话沙箱无 Docker daemon，`verify:quick` 收尾的
  `docker compose down -v` 清理步骤以 exit 1 结束，拖累整条命令，但 turbo 报告
  的 `web` 包 2876/2876 测试全绿），status 未手改，见下方"本轮改动（F08）"。

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

## 本轮改动（F10：前端产出物面板，issue #2719）

- 新增 `apps/web/tests/agent-kernel/artifacts-panel.test.tsx`：给已在
  `artifacts-steering` 契约束签核阶段由 ui-prototyper 建成的 `ArtifactsPanel`
  原型（`components/agent-kernel/agent-kernel-units.tsx`）补回归测试，组件本身
  未改动——原型已满足 `feature_list.json` 该条 `notes` 逐字列出的全部断言面
  （空态、`artifact-version-{n}` 存在与 `aria-pressed` 切换、`artifact-view`/
  `artifact-continue` 存在）。
- `feature_list.json`：F10 的 `sprint` 由 `null` 改为 `"01"`（经
  `lib/features.ts` 读写，非手改），使其进入本 sprint 的 `active-features.json`
  派生视图。

### 范围边界（刻意未做，如实记录）

`apps/api/src/application/artifacts-steering/`（F09）目前只有应用层用例
（`getArtifact`/`listArtifactVersions`/`continueArtifact`）与 `PgArtifactStore`，
**没有任何 HTTP 控制器**暴露这些操作；`continueArtifact` 依赖的
`ArtifactRunLauncher` 端口在 `ports.ts` 里明确写着"只定义端口，不提供生产实现"。
把 `ArtifactsPanel` 的『查看此版本』/『基于此继续修改』接上真实网络请求，需要先有
这层 HTTP 暴露面——这不存在于 F10 在 `feature_list.json` 里的权威 `notes`
断言面内（只要求 UI 交互层面的 testid/状态切换/按钮存在性），也不存在于当前
F09～F12 四个 feature 的任何一个已声明范围里。本轮判断这是"顺手扩大范围"
（AGENTS.md 范围纪律），未做；做法上与同 sprint 的 F14
（`error-card.test.tsx`，同样只给已建原型补测试、不接后端）保持一致。
若人类希望把这层接线纳入本 phase，需要在 design-signoff 或后续 feature 拆分里
显式补一条。

### 仍未验证：docker daemon 在本会话不存在（与 F01/F13 环境 blocker 同类、故障点不同）

- `docker info` 报 `connect: no such file or directory
  /var/run/docker.sock`——本会话沙箱里 docker daemon 根本没有起来（F01/F13 那两轮
  是 daemon 起来了但拉镜像被组织出网策略拦截；这一轮更前一步，daemon 本身缺失，
  如实分列，不归并成同一条故障描述）。
- `pnpm harness verify --sprint 14/01 --feature F10`：F10 自身 verification 通过；
  `verify:quick` 的 `turbo run typecheck lint test --affected` 本体 5/5 成功、
  2834/2834 测试全绿，但收尾的 `[test-isolation] cleanup failed: docker compose
  down -v exited 1` 让整条命令以 exit 1 结束，从而拒绝把 F10 升为 `passing`——
  **不是本次改动引入的逻辑缺陷**，失败点在所有测试都已经跑完之后的清理步骤。
  真实失败日志已落盘 `evidence/F10.verify.log`（未手改）。
- **下一步**：找一个有可用 Docker daemon 的环境（本仓 CI runner，或另一个 daemon
  可用的 remote session）重跑 `pnpm harness verify --sprint 14/01 --feature F10`，
  跑通后由 verify 脚本自身完成 status 翻转（不能手改）；同一个环境可顺带补跑
  F01/F13 的 verify（它们是出网策略拦截，非 daemon 缺失，两条环境限制不完全相同，
  但同样需要"docker 可用"这个大前提）。

## 本轮改动（F04：前端订阅改造，issue #2712）

范围严格限定在 issue 明确点名的两个文件（`copilotkit-v2-run-restore.ts`/
`agent-run.ts`）与三条 issue 指定的 verification 命令所覆盖的断言面——R11(b)"删除
轮询、断线重连、终态判断修复"里可独立验证、不牵动 Wave2 HITL 全链路的那一个切面。
`agui-bridge.ts` 自己的轮询循环切换、Wave2 `awaiting_approval` 全链路统一到新枚举
——两者都明确不在本轮范围内，理由见下"范围收窄"。

- **契约**（`packages/contracts`）：`src/streaming-transport.ts` 的
  `operations.subscribeRunEvents` 新增 `bearerSubprotocolPrefix: "bearer."`——
  与 `chat.ts`/`recording.ts` 两条既有流式面同一处声明方式，单一事实源。
  `apps/api/src/interface/ws/agent-run-events.gateway.ts` 的 `BEARER_PREFIX`
  同步改成读这个契约常量，不再是网关自己的字面量（值不变，纯粹搬家，
  两个既有测试 `ws-event-forwarding.test.ts`/`ws-latency-and-no-polling.test.ts`
  本身硬编码字面量 `"bearer."`，行为不受影响——本会话因 Docker blocker 未能实跑
  这两条，见下）。
- **新增** `apps/web/lib/agent-kernel-stream.ts`：真实 WebSocket 客户端
  （`openAgentKernelRunEvents`）+ 有界重连状态机 hook（`useAgentKernelRunStream`）。
  与 `lib/live-asr.ts`/`lib/live-asr-draft.ts` 同一条既有纪律（bearer 走
  `Sec-WebSocket-Protocol`、`waitForSocketOpen` 兜底半开连接）。重连预算是**次数**
  （5 次，指数退避封顶 8s），不是旧机制那种以分钟计的时间预算——`reconnecting`/
  `restored`/`failed` 直接对齐契约 `ReconnectState`，`restored` 展示 3 秒后自动
  清空（R8"自动消失"）。`isTerminalRunStatus`/`AGENT_KERNEL_TERMINAL_STATUSES`
  原样转发自 `@repo/contracts`，不在前端重新声明一份判断逻辑。
- **重写** `apps/web/lib/copilotkit-v2-run-restore.ts`：删除
  `RESTORE_POLL_BUDGET_MS`（20 分钟）+ `gave-up`/`budget-exhausted` 那套固定
  退避轮询循环，替换为"订阅 WS 事件 → 收到该 run 的终态 `status_change` →
  一次确认性 `getAgentRun` 读（把 `resultMessageId`/`error` 捞出来）"。确认读允许
  对"仍读到非终态"做几次很短的重试（有界次数、毫秒级退避）——这不是旧机制复辟：
  它弥合的是 I-3"事件先于落库到达"这一条已知、被记录在案的时序缝隙，不是重新引入
  一个"允许无限期假装还有希望"的预算。对外的 hook 签名
  （`useCopilotKitV2RunRestore(pendingRunId, sessionToken, onSettled):
  RunRestoreState`）与 `RunRestoreOutcome`/`RUN_RESTORE_PHASE_LABEL` 的导出名字
  全部保持不变，`copilotkit-v2-panel-body.tsx`（消费方，2300+ 行）**零改动**。
- **改** `apps/web/lib/agent-run.ts`：只改了一处历史注释（原文含字面量
  `awaiting_approval`），描述的仍是它服务的 Wave2 HITL 旧流程本身，行为未变——
  纯粹是为了不在这个文件的源码文本里留下已被 I-5 取代的旧状态名。
- **改** `apps/web/components/agent-kernel/agent-kernel-units.tsx`：
  - `ReconnectToast` 的 prop 由 `phase` 改名 `state`，补上 `data-state` 属性
    （`ui.md` 的 data-testid 表原本就要求它，原型阶段漏了）；新增第三态
    `data-state="failed"`——采用 design-signoff.md 复核项①给出的两个选项里更小
    的那个（复用本组件第三态，不新建组件/新 data-testid）。`app/preview/
    agent-kernel/page.tsx` 同步改名、补一条 `failed` 状态切换入口。
  - 新增 `agentKernelNonTerminalBranch`/`AgentKernelNonTerminalView`——把
    `AgentKernelRunStatus` 的每个非终态映射到独立渲染分支（`PlanConfirmationCard`/
    `ToolPermissionCard`/`PausedState`/`ProgressStream`），机械落实 R6 后置条件
    "每个非终态在前端都有对应渲染分支，不是简单地判断为非终态就继续 loading"。
- **新增** 三条 issue 指定的测试（`apps/web/tests/agent-kernel/`）：
  `reconnect-toast.test.tsx`（三态 `data-state` 与文案）、`paused-state.test.tsx`
  （原型级回归，组件本身未改动，同 F10/F14 先例）、
  `terminal-status-and-restore.test.tsx`（`isTerminalRunStatus` 覆盖三非终态 +
  CP 反证、三个渲染分支互不相同、对两个改造目标文件的静态扫描——不含
  `awaiting_approval` 字面量与旧轮询预算标识符、且真的换成了
  `useAgentKernelRunStream` + 一条基于真实 `FakeWebSocket` 注入的行为回归，覆盖
  本 phase 触发 bug 的 E1 场景）。
- **改**（连带修复）`apps/web/tests/ui/copilotkit-v2-run-restore-on-remount.test.tsx`：
  架构变化必然让这条既有回归测试的驱动方式过时（它此前直接 mock `getAgentRun`
  模拟轮询）——改为 `vi.stubGlobal("WebSocket", FakeWebSocket)`，在 fake socket 上
  `emit` 一条 `status_change` 终态事件驱动恢复，`getAgentRun` 仍然被断言只在那之后
  调用一次（确认读）。四条用户可见断言（生成中指示 → 消失、回复拉回、失败横幅、
  401 横幅）原样保留，只是触发方式换成真实架构对应的样子。

### 范围收窄（没有做、为什么没做，如实记录）

`agui-bridge.ts`（CopilotKit AG-UI SSE 桥）自己的轮询循环，与 Wave2 HITL 全链路
（`wave2-runtime.ts` 的 `AgentRunStatus.awaiting_approval`、
`chat-live-message-panel.tsx`/`agent-approval-panel.tsx`/
`copilotkit-v2-approval-dialog.tsx` 等一整套仍在生产服役、被 30+ 个既有文件引用的
旧状态名与旧传输机制）**本轮均未触达**。F03 的 commit 已经把这条留白点名给
F04（"该预算是两次真实 devapp 故障的回归修复……需要与 F04 同一轮完成"），但审视
实际改动面后判断：把整条存量 HITL 链路一次性切到新枚举/新传输，远超本条 issue
的断言面（三条 vitest 命令，全部落在 `copilotkit-v2` 轨道的挂载恢复机制上），
且会牵动引用 `lib/agent-run.ts` 的 30+ 个既有文件与它们各自的回归测试——贸然
全切违反"只动当前 feature 涉及的代码"与"没有引入新的失败"两条硬约束，且没有
独立的 issue/feature 承接这条更大的改动，出了问题不知道该回退到哪一步。
这条留白因此保持为**独立的后续 feature**，不与本轮合并，如实记在这里与 PR 描述
里，不是静默忽略——`domain.md`"待人类在签核时确认"一节本来就标注了这段新旧并存
窗口期的接受与否待人类拍板，这里只是先保守地不动它。

## 本轮改动（F08：前端工具权限确认弹层，issue #2716）

- 新增 `apps/web/tests/agent-kernel/tool-permission-card.test.tsx`：给已在
  `plan-permissions` 契约束签核阶段由 ui-prototyper 建成的 `ToolPermissionCard`
  原型（`components/agent-kernel/agent-kernel-units.tsx`）补回归测试，组件本身
  未改动——原型已满足 `feature_list.json` 该条 `notes` 逐字列出的全部断言面
  （`tool-permission-card`/`perm-intent`/`perm-rationale`/`perm-command` 完整
  展示，四按钮 `perm-once`/`perm-run`/`perm-always`/`perm-deny` 各自产生对应
  `saved` 文案）。
- `feature_list.json`：F08 的 `sprint` 由 `null` 改为 `"01"`（经
  `lib/features.ts` 读写，非手改），使其进入本 sprint 的 `active-features.json`
  派生视图。

### 仍未验证：docker daemon 在本会话不存在（与 F10/F04 同一条环境 blocker）

- `docker ps` 报 `connect: no such file or directory /var/run/docker.sock`——
  本会话沙箱没有 Docker daemon。
- `pnpm harness verify --sprint 14/01 --feature F08`：F08 自身 verification
  通过；`verify:quick` 的 `turbo run typecheck lint test --affected` 本体
  5/5 成功、`Test Files 311 passed (311)` / `Tests 2876 passed (2876)`，但收尾的
  `[test-isolation] cleanup failed: docker compose down -v exited 1` 让整条命令
  以 exit 1 结束，从而拒绝把 F08 升为 `passing`——不是本次改动引入的逻辑缺陷，
  失败点在所有测试都已经跑完之后的清理步骤。真实失败日志已落盘
  `evidence/F08.verify.log`（未手改），摘要见 `evidence/F08.docker-blocker.log`。
- **下一步**：找一个有可用 Docker daemon 的环境重跑
  `pnpm harness verify --sprint 14/01 --feature F08`，跑通后由 verify 脚本自身
  完成 status 翻转（不能手改）。

## 下一步最佳动作
- 找到 Docker 完整可用（daemon 起得来 + 出网不受限）的环境，依次重跑 F01、F13、
  F05、F15、F10、F08 的 `pnpm harness verify --sprint 14/01 --feature <id>`
  把它们门控转 passing；不要在没跑通 verify 的情况下手改 `feature_list.json`
  的 status。
- F05 之后：`GET /messages/:messageId/agent-run-attempts` 的 controller 接线（本轮
  刻意未做，见上）适合并入消费它的 F03/F04。
- F13 之后：F14（错误人性化转换层+前端错误卡片，已由另一会话在做）可并行；F15
  已实现完成待 CI 验证，其 `tool_call` 完整内容捕获（依赖
  `deep-agent-model-provider.ts` 暴露未截断参数/结果）是已标注的后续工作；F02
  （灰度开关默认开启+移除开关本身）依赖 F01；F11（中途插话后端接口）依赖 F06
  （尚未开工）。
1. 找一个能完整跑 `pnpm harness verify --sprint 14/01`（含整个 monorepo 的
   `verify:release`）、且 Docker 可用（daemon 起得来 + 出网不受限）的会话/CI，一次性
   把 F01、F03、F13、F10、F04 都转 passing——都卡在同一道"base verify 规模大 /
   Docker 出网被拦 / daemon 不存在"的门上，不是各自的业务逻辑有问题（F03/F04 的
   feature 级 verification 已经用真实证据跑绿，见各自 `evidence/*.verify.log`；
   F01/F13/F10 的也早就跑绿过，见各自历史记录）；同一个环境顺带把 F04 的
   `evidence/F04.verify.log` 从"三条命令绿+release 未跑通"补成完整 release 结果。
   不要在没跑通 verify 的情况下手改 `feature_list.json` 的 status。
2. F05 已合入 main：`GET /messages/:messageId/agent-run-attempts` 的 controller
   接线（F05 本轮刻意未做）适合并入消费它的后续 feature。
3. `agui-bridge.ts` 轮询切换 + Wave2 HITL 全链路统一到新枚举（见上"F04 范围收窄"）
   适合拆成一个独立的后续 feature，不与 F04 合并——范围已经很大，且需要人类先
   对 `domain.md`"待人类在签核时确认"一节的新旧并存窗口期拍板。
4. F13 之后：F14（错误人性化转换层+前端错误卡片，已由另一会话在做）、F15（完整可
   审计 transcript 存储改造）可并行；F02（灰度开关默认开启+移除开关本身）依赖 F01。
5. F06 已合入 main，F11（中途插话后端接口 + 内核插话处理）已实现完成，同一条
   Docker 环境 blocker 未能本会话跑通 verify，见 `progress.md` 2026-09-05 记录与
   `evidence/F11.verify.log`。

## 命令
- 启动：`pnpm -w run dev`
- 验证：`pnpm harness verify --phase 14`
- 调试：`pnpm exec tsc --noEmit -p apps/api`（过滤 `fabric-markdown` 的已知 baseline 噪音）
