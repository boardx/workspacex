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
