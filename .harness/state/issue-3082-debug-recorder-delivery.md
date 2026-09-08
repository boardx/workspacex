# Issue #3082 · debug recorder 交付记录（过程 / 决定 / 踩坑）

- 人类指令（2026-09-08，逐字）：「构建一个高效的调试模块，可以记录下数据在后台，来帮助你，
  一旦遇到这样的问题，你马上可以调试。而不需要依赖人类来做这样的手工调试。」
- 走的是 `ad-hoc-fix-pr-sop.md`（用户直接交办，不进 `feature_list.json`），轻量 issue #3082 + `Refs`。
- 交付：PR #3086，合入 main 为 `97f52b1`（2026-09-08T11:26:58Z，合入时 CI 全绿）。
- 背景 issue：#2873（deep-agent 假死两小时，两条取证 workflow 拿到的都是空日志，最后靠人类上 VM）。

> **本文件记「怎么做成的、为什么这么做、下一个人会撞到什么」。**
> 「这东西怎么用」不在这里——单一事实源是 `.harness/instructions/observability.md`
> 的「出问题先查 debug recorder」一节，不要在本文件复述一份会漂移的副本。

## 1. 交付物指路

| 层 | 文件 |
|---|---|
| 契约（单源） | `packages/contracts/src/system-debug-trace.ts` |
| 端口 + 脱敏 | `apps/api/src/application/ports/debug-trace.port.ts` |
| 记录器（环形缓冲 + 批量 flush） | `apps/api/src/application/diagnostics/debug-recorder.ts` |
| 落库 / 裁剪 / 读回 | `apps/api/src/infrastructure/diagnostics/pg-debug-event-store.ts` |
| HTTP 流水 + 卡住判定 | `apps/api/src/interface/middleware/debug-request-recorder.ts` |
| 只读口（平台运营准入） | `apps/api/src/interface/controllers/system-debug-trace.controller.ts` |
| 表 + 两个 SECURITY DEFINER 读函数 | `apps/api/migrations/20260910040000_debug_events.sql` |
| CLI（不经 HTTP，不需要登录） | `apps/api/scripts/debug-trace-cli.ts` |
| 测试 | `apps/api/tests/diagnostics/` |

## 2. 关键设计决定（为什么不是「再来一个 error_logs」）

1. **记的是「炸之前和炸周围」，不是「炸了那一刻」。** `error_logs` 只在异常真的抛出来时才有一行；
   #2873 那种挂着不返回的请求**什么都不抛**，在只记 finish 的日志里根本不存在。所以新增
   `http.request.stalled`：超过阈值还没结束就**立即**记一条，不等它结束；配套「飞行中请求」列表。
   这是本模块相对 `error_logs` 唯一不可替代的增量，砍掉它这个模块就没有存在理由。
2. **权限边界逐条照抄 `error_logs`，不新发明。** `app_rw` 只 INSERT/DELETE + `(id, created_at)` 的
   SELECT；诊断内容只能经 SECURITY DEFINER 函数由 `app_diag_ro` 读；PUBLIC 显式 REVOKE；HTTP 口挂
   `PlatformOperatorGuard`。脱敏复用 `error-log.port.ts` 的同一套正则与截断，不写第二份。
3. **中间件而不是 Nest interceptor。** 理由与 `trace.ts` 头注逐字相同：interceptor 在 guard 之后，
   被 guard 拒掉的 401/403 就没有记录——而排查「为什么这个用户看不到数据」时，最先要看的就是它们。
4. **批量落库 + DB 挂了继续攒。** 每请求一条 INSERT 会把请求流水变成一倍写压力（5 连接的池）。
   且最需要诊断数据的时刻恰恰是基础设施在出事的时刻，所以写失败不丢事件、内存仍可读
   （`source=memory`），记录器自身的计数也是对外可见的排查线索。
5. **表里那一列叫 `org_ref` 不叫 `org_id`。** `lint-permission-paths.mjs` 按 `org_id` 列判定「租户表」；
   这张表是基础设施自我观测（同 `error_logs`、`_kernel_migrations` 那一类），叫 `org_id` 会把它误报成
   一张需要 RLS 的租户表。列名在这里是**给机械门看的信号**，不是随手起的。

## 3. 验证（可复现）

合入前实际跑过、全绿：

```bash
# 单测 + 真 Postgres（迁移、jsonb 往返、过滤翻页、trace 正序、双重裁剪、
# app_rw 读 msg 必 42501 / app_diag_ro 写必 42501 的反证）
pnpm exec vitest run tests/diagnostics/ tests/logging/     # 15 文件 141 用例

# 真 Nest 应用端到端：未登录 401 → 落库 → 平台超管按响应头 x-trace-id 读回同一条
# http.request；普通成员三条路由均 403；source=memory 在 flush 前可读
pnpm exec vitest run tests/diagnostics/debug-trace-http.test.ts

pnpm exec tsx scripts/migrate-check.ts   # 空库 replay 全绿
pnpm --filter @repo/api lint             # 全绿
```

CI（合入时刻，head `c68a42b`）：required 三条 `verify-control-plane` / `verify-affected` /
`verify-full-compile` + `merge-gate` + `fullstack-smoke` + `gates-fast` / `gates-runtime` +
`gates-test ×4` + `e2e-core-loop` + `native-document-chain` 全部 success。

## 4. 踩到的三道机械门（下一个往 apps/api 加「表 + 契约 + 端口」的人会同样撞到）

1. **`lint-contract-source`（在 `gates-fast` 里，本次唯一一次 CI 红）**：端口里写
   `export type DebugEventLevel = "info" | "warn" | "error"` 会被判「重复定义契约类型」——
   契约里已经有 `C.DebugEventLevel`。正确形式是 `z.infer<typeof C.DebugEventLevel>`（ADR-020 单源）。
   ⚠ 本地 `pnpm --filter @repo/api lint` **跑不到这条**：它挂在仓库根的
   `.harness/scripts/lint-contract-source.mjs`，不在 api 包的 lint 链里。往契约里加类型、又要在
   api 侧用它时，本地先补跑一次 `node .harness/scripts/lint-contract-source.mjs`，别等 CI 告诉你。
2. **`lint-no-builtin-capabilities` 的命名启发式**：一个纯粹的常量
   `const DEFAULT_QUIET = ["/health", "/ok", …]`（跳过记录的探针路径前缀）被判成「内置能力清单」——
   判据看的是**变量名**（`default*` / `*capabilities` / `*skills` … 见该脚本的 `LIST_NAME_RE`）加
   数组字面量，不看语义。改名 `QUIET_PATH_PREFIXES` 即过。教训：给数组常量起名时避开
   `default/builtin/seed/starter` 前缀与 `agents/skills/models/templates/capabilities` 后缀，
   否则会被一道与你无关的门拦下。
3. **`lint-global-scope-test-fixtures`（issue #2982）**：测试里对没有 `org_id` 的表做全表
   `DELETE` 属于「全局作用域夹具」，必须在文件顶部声明收敛人：
   `// @global-scope-fixture table:debug_events: <谁收敛它>`。不声明就红。

## 5. 本会话的环境事实：没有 docker 也跑通了真库测试（**环境权宜，不是新标准**）

本轮跑在远程执行环境里，**没有 docker**，而 `tests/support/db.ts` / `auth.ts` 的
`ensureDatabase()` / `ensureRedis()` 是通过 `docker compose exec … pg_isready` / `redis-cli PING`
探活的，于是一上来就 `postgres did not become ready`。实际做法：

- `apt-get install postgresql-16` + `postgresql-16-pgvector`（`0009-f10-retrieval-index.sql` 需要
  `CREATE EXTENSION vector`），本机起在约定端口 `55432`；`redis-server --port 56379`。
- 在 PATH 前面放一个 `docker` 垫片脚本，把上面那两条探活命令转发到本机实例。
- **隔离外壳的环境变量一条都不能省**：`WORKSPACEX_DB` / `PGDATABASE` / `PGHOST` / `PGPORT` /
  `REDIS_*` / `COMPOSE_PROJECT_NAME` / `WORKSPACEX_DB_CONNECTION_BUDGET` …
  少一条 `assertIsolatedDatabase` 就在 global setup 第一行拒绝跑（#538 的门，行为正确）。

⚠ 三条限制，别把这段当成推荐做法：① 它只让**真 Postgres/Redis 的那些套件**能跑，不等价于
标准跑法 `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- …`；② 垫片只转发探活，
`docker compose down -v` 那类收尾在垫片下是空操作，收尾得自己 `pg_ctl stop`；
③ 本机实例会在会话中途被回收（本轮实测中途被杀过一次，表现为 vitest 报
`postgres did not become ready`），重跑前先 `pg_isready` 确认。

同一轮里 `tests/kernel/` 有 3 个文件失败，全部是这套环境事实造成的（缺 redis 夹具、
测试自己 `CREATE DATABASE` 的升级路径用例），**与本次改动无关**——825 条通过。

## 6. 没做的（端口已就位，下一轮直接接）

1. `agent_run.*` 生命周期打点（`started` / `kernel_called` / `heartbeat` / `failed`）：注入
   `DEBUG_TRACE_PORT` 调 `record()` 即可，让「这个 run 卡在哪一步」变成一次 trace 查询。
   这是 #2873 第 1 条「run 级诊断包」还缺的那一半。
2. 前端「运行详情」页的「复制诊断包」按钮（读 `GET /system/debug/traces/:id`）。
3. `deep-agent-service`（Python）侧：把 OTel span 投到同一张表，或至少输出带 runId 的结构化日志。
4. #2873 第 2/3 条（runner 用户加 `systemd-journal`/`docker` 组、deep-agent 的 HEALTHCHECK 与
   假死自愈）不在本次范围内，仍挂在 #2873 上。
