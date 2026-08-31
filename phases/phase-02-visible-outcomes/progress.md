# 进度日志 — Phase 02 让推演与成果可见

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: `pnpm -w run verify:base`
- 当前最高优先级未完成功能: <feature id / title>
- 当前 blocker: <无 / 描述>

## 会话记录
### 2026-07-28 04:39:05
- 本轮目标:
- 已完成:
- 运行过的验证:
- 已记录证据:
- 提交记录:
- 已知风险或未解决问题:
- 下一步最佳动作:

### 2026-08-31
- 本轮目标：实现 F01（任务对象统一五态 enum 与状态机，O-27 合法转移矩阵）。
- 已完成：
  - `packages/contracts/src/board.ts` 新增 `TaskStatus` 五态 zod enum（单一事实源），`index.ts` 导出。
  - `apps/api/src/domain/board/{task-status,transition-matrix}.ts`：五态从契约派生 + 纯函数 `decideTransition`（O-27 判定：前进无条件放行、回退须非空 reason、inbox 单向出、global scope 跨项目拒绝）。
  - `apps/api/src/application/board/{ports,errors,change-task-status}.ts`：`changeTaskStatus` 用例，单事务内校验+落库+（回退时）写审计。
  - `apps/api/migrations/20260831120000_f01_board_task_status.sql`：新建 `tasks` + `task_status_audit`（专属审计表，未复用 provenance_events/tenant_isolation_audit——语义不贴合），均 FORCE RLS。
  - `apps/api/tests/board/{status-enum-single-source,transition-matrix-o27}.test.ts`：81 个用例，覆盖枚举单源与 O-27 全部 20 个有序对 + 边界情形。
- 运行过的验证：
  - 两个测试文件的断言本身跑通（81/81 绿）——受限于沙箱无 docker daemon，仓库 vitest 全局配置强制要求 docker 起库，用等价（去掉 globalSetup、其余 include/exclude 不变）的本地 vitest 配置绕开了这一条与 feature 本身无关的前置检查，测试内容未改动。
  - `pnpm --filter api run typecheck`：本次新增代码零报错（唯一残留报错在 `packages/fabric-markdown`，改动前已存在，与本 feature 无关）。
  - 迁移：在本机安装的真实 PostgreSQL 16 + pgvector（非本仓 docker-compose 起的库）上，从空库完整重放全部既有迁移 + 本迁移，且 `--force` 全量重放一次，均成功；`tasks`/`task_status_audit` 的 FORCE RLS 策略、CHECK 约束、append-only 触发器已用 `psql \d` 与 `pg_class.relforcerowsecurity` 现场核验。
- 已记录证据：见 `phases/phase-02-visible-outcomes/feature_list.json` F01 的 `evidence` 字段。
- 提交记录：见本次 commit（分支 `claude/new-phase-task-management-daeg85`）。
- 已知风险或未解决问题：
  - F01 的 `sprint` 仍为 `null`，未分配到任何 sprint，本轮未跑 `pnpm harness verify`（需要 sprint 上下文）。
  - AGENTS.md 完成定义第 5/6 条（GitHub issue + PR 关闭）本轮未走：没有创建 issue、没有开 `worker/...` 分支、没有开 PR——这一环节需要人类走 `pnpm harness sync --apply` 之后的流程。
  - F01 的 `status` 未改动，仍是 `not_started`：按规矩只能由 `pnpm harness verify` 门控转移。
- 下一步最佳动作：人类将 F01 分配进某个 sprint 并跑 `pnpm harness sync --apply` / `pnpm harness verify`，走完 issue/PR 流程后 F01 才能转 `passing`。

### 2026-08-31（续）
- 本轮目标：在 F01 地基上做 F02（看板两视图投影/卡片渲染/回写事务/三处计数）+ F06（我的今天四分区）的**范围收窄版**——用户明确要求跳过 F02/F06 依赖表里点名但工作量很大的 F03（六来源自动汇入）/F05（到期提醒）/F08（授权流），只做「先能真实可用」：能手工建卡、能拖动/点按改状态、`/tasks` 能看到真实的四分区数据。
- 已完成（详见 `feature_list.json` F02/F06 的 `evidence`/`notes`，此处只列文件清单）：
  - 契约：`packages/contracts/src/board.ts` 新增 `SourceKind`（7 值）/`RiskLevel`/`MyTodaySectionKey`/`BoardViewScope`。
  - 迁移：`apps/api/migrations/20260831130000_f02_f06_board_task_fields.sql`——在 F01 的 `tasks` 表上补 `source_kind`/`risk_level`/`waiting_on`/`sync_status` 四列 + CHECK 约束 + owner 不得是 agent 字面量的 DB 侧兜底约束。未新建表，FORCE RLS 沿用。
  - domain 层：`apps/api/src/domain/board/{source-kind,risk-level,owner-identity,card-projection,card-render,my-today-sections,today-summary}.ts`（全部纯函数，不连库）。
  - application 层：`apps/api/src/application/board/{create-task,list-tasks,get-my-today,change-task-status-with-writeback,writeback-port}.ts`；`ports.ts` 扩展 `TaskRepository`，新增 `TASK_REPOSITORY`/`TASK_STATUS_AUDIT_WRITER` 两个 DI token（F01 交付时不存在，因为 F01 明确"不锚 UI"）。
  - infrastructure 层：`apps/api/src/infrastructure/board/pg-task-repository.ts`——首次真实 SQL 实现，含 uc-11-1 R5 四角色权限过滤（facilitator/org-admin 全项目可见；groupLead/member 限 owner=我∨executor=我∨与我同组；observer 在 controller 层 403）。
  - interface 层：`apps/api/src/interface/controllers/board.controller.ts`——首次挂 REST 路由（`GET /tasks`、`POST /tasks`、`PATCH /tasks/:id/status`、`GET /tasks/today`），接入 `kernel.module.ts`。
  - lint：`apps/api/scripts/lint-permission-paths.mjs` 新增 `pg-task-repository.ts` 的豁免条目（同 F155 L3 检索先例：WHERE 子句本身即判权），配 `tests/board/pg-task-repository-guard.test.ts` 机械反证。
  - 前端：`apps/web/lib/live-tasks.ts`（真实 API 薄封装）、`apps/web/components/tasks/{today-board-live,tasks-content}.tsx`（真实数据路径，与既有 mock 版 `today-board.tsx` 并存不替换）、`apps/web/app/tasks/page.tsx` 改为按登录态选择渲染路径。
  - 测试：后端 `apps/api/tests/board/{view-projection-no-card-loss,owner-is-human-executor-split,writeback-transaction,my-today-sections-mutex,my-today-same-source-enum,pg-task-repository-guard}.test.ts`；前端 `apps/web/tests/ui/{my-today.render,my-today.signed-out}.test.tsx`。
- 运行过的验证（真实，非假装）：
  - `apps/api` 侧 8 个 board 测试文件、116 个用例全绿，其中涉及真实读写的用例（owner-is-human-executor-split 的 DB 分支、writeback-transaction 全部、my-today-same-source-enum 全部）跑在本机真实 PostgreSQL 16（同 F01 用的同一个实例，非本仓 docker-compose，因沙箱无 docker daemon，方法与 F01 完全一致：等价 vitest 配置只去掉 globalSetup 的 docker 前置检查）。
  - `pnpm --filter api run typecheck`：零新增报错（唯一残留报错在 `packages/fabric-markdown`，改动前已存在）。
  - `pnpm --filter api run lint`：全绿（含新增的白名单条目与其反证测试）。
  - `pnpm --filter web run typecheck`：零报错。
  - `pnpm --filter web run lint`：全绿。
  - `pnpm --filter web exec vitest run tests/ui/my-today.render.test.tsx`（feature_list 点名的确切命令）：3 用例全绿。
  - `pnpm --filter web run test`（全量）：269 个测试文件、2399 个用例全绿，确认没有引入回归。
- 已记录证据：见 `feature_list.json` F02/F06 的 `evidence` 字段（逐条列出真通过/近似实现/完全跳过三类，不含糊）。
- 已知风险或未解决问题（如实记录，详见 F02/F06 notes 的完整版本）：
  - 项目内四列/全局五列的看板 UI 在 `apps/web` 完全没有建（F02 原 notes 已经标注 `needs_ui_signoff`）——本次前端投入全部给了 F06「我的今天」，"拖动改列"目前只能通过 REST 接口验证。
  - F24/F43（真实来源回写适配器）、F03（六来源自动汇入）、F05（到期提醒/催办）、F07/F08（权限包与授权流）均未做——`WritebackPort` 只有手工创建这一种来源的 no-op 实现；①区"R2/R3 待审批"子类恒为空集；③区"agent 运行中"是 `executor` 前缀近似，无真实运行时；底注"M 项停下等授权"恒为 0；折算系数/口径表版本恒为 null（O-37 原文本就说"无依据"，未编造）。
  - 「我的今天」跨项目聚合收窄为"取第一个可见项目作为角色判定锚点"，不是真正的多项目求并集（那是 F04 的范围）。
  - 没有新增 `/tasks` 的 playwright e2e 冒烟（仓库现有 e2e 目录里没有对应 spec，新增成本较高——需要起真实前后端服务 + 真实登录，本次判断不可控，跳过）。
  - `sprint` 仍为 `null`，`status` 仍为 `not_started`，没有对应 GitHub issue/PR——同 F01 一样的未竟事项，需要人类走 `pnpm harness sync --apply` 之后的流程。
- 下一步最佳动作：人类评估是否需要现在补 F02 的看板 UI 页面（项目内四列/全局五列），或者优先推进 F03/F05/F07/F08 让 F02/F06 收窄掉的部分回补齐整；之后统一走 `pnpm harness sync --apply` / `pnpm harness verify` 走完 issue/PR 流程。
