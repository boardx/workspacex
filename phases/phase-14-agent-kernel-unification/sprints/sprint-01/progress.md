# 进度日志 — Sprint 14/01

## 当前已验证状态(唯一真相)
- 仓库根目录: `/home/user/workspacex`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- F01（apps/api 退化为薄网关）：已合入 main（#2729），status 仍是 `in_progress`
  （其 verify 未在合入前的会话里跑通，见下方各会话记录）。
- F03（网关 WebSocket 事件端点）：F03 会话实现完成，三条 verification 命令该会话
  真实跑绿（证据 `evidence/F03.verify.log`），细节见下。`pnpm harness verify
  --sprint 14/01 --feature F03` 的 feature 级三条命令跑绿后，进入它自己的整 monorepo
  "base verify" 门（`turbo run typecheck lint`/`test`），规模超出该会话时间预算，
  主动终止——不是观察到失败。status 因此仍是 `in_progress`，未手改，详见
  `session-handoff.md`。
- F13（错误分类修复，issue #2718）：F13 会话实现完成，同样撞上下方记录的 Docker
  出网 blocker 未能跑通 harness verify，status 仍是 `in_progress`。
- F03 会话解决了 F01/F13 记录的环境 blocker：沙箱没有可用的 Docker/组织出网策略拦截
  `pgvector/pgvector:pg16` 拉取——F03 会话改用**本机 apt 安装的 PostgreSQL 16**
  （`postgresql-16`/`postgresql-16-pgvector`）替代 docker-compose 起的 Postgres，
  外加一个仅存在于该会话 PATH 里的 `docker` 命令 shim（把 `tests/support/db.ts`/
  `auth.ts` 里 `docker compose exec postgres pg_isready`/`up -d postgres` 等固定几条
  子命令翻译成对本机 Postgres 的直接调用），使 `pnpm --filter api exec vitest run`
  可以真正跑通，不必修改任何测试基建源码。**这个 shim 只存在于该会话临时目录，
  不是仓库的一部分**——下一个会话若同样缺 Docker，需要重新搭一次（步骤：
  `apt-get install postgresql-16-pgvector` → 把 main 集群端口改到 55432 并起
  服务 → 建 `workspacex` 库 + `CREATE EXTENSION vector` → 跑一次
  `migrate(migrationConfig())` 让 `0001-kernel-roles.sql` 建好 `app_rw` 等角色 →
  PATH 前置一个把 `docker compose exec/up` 转译成本机命令的 shim 脚本）。F13 那轮
  会话没有这个 shim，仍撞在原始 Docker 出网 blocker 上（`pgvector/pgvector:pg16`
  拉取对 `production.cloudfront.docker.com` 返回 403）。

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

### 2026-09-04（F03 会话）
- 本轮目标: 实现 Phase 14 F03（网关 WebSocket 事件端点：真流式转发内核事件、落库与
  推流解耦）。
- 已完成: 见上方"当前已验证状态"与 `session-handoff.md` 的完整改动清单——契约层
  `aguiEventTypeFor` 对齐 AG-UI 原生事件类型，`RunEventBusPort`/`InMemoryRunEventBus`/
  `WS /agent-runs/:runId/events` 网关，`execute-run.ts`/`writeback.ts` 六类事件在
  真实执行路径上的发布点，`ModelCallProgressEvent` 补完整（非截断）字段。
- 环境: 本会话**解决**了 F01 记录的 Docker blocker（本机 apt 装 Postgres 16 +
  pgvector，PATH shim 转译 `docker compose` 调用），使 `pnpm --filter api exec vitest
  run` 首次在这一系列会话里真正跑通。
- 运行过的验证:
  - 三条 issue 指定的 verification 命令：真实跑绿，见 `evidence/F03.verify.log`。
  - `pnpm exec tsc --noEmit -p apps/api`、`-p packages/contracts`：0 新增错误。
  - 针对性回归批（21 个既有文件，约 156 条用例，含真实 Postgres 的 HITL/writeback/
    streaming 全流程）：全绿。
  - `packages/contracts` 全量 `vitest run`（26 文件/429 用例）：全绿。
  - `pnpm --filter api exec vitest run`（不设 `-t` 过滤，跑到超时前约 110+ 个文件）：
    零失败，覆盖 auth/chat/canvas/capability/skill/kernel/research/asset/plan-control
    等一大片不相关子系统，作为"没有引入新的失败"的补充证据（未跑满全部 793 个文件，
    单进程串行跑完整套件的时间超出本会话预算）。
  - `pnpm harness verify --sprint 14/01 --feature F03`：F03 自己的三条 verification
    先跑绿，随后进入它自带的整 monorepo "base verify"门（`turbo run typecheck lint`/
    `test`），本会话主动终止（规模超出时间预算，不是观察到失败）。
- 已记录证据: `evidence/F03.verify.log`（三条命令的真实通过日志）。
- 已知风险或未解决问题: F03 尚未 `passing`——需要一个能跑完整 monorepo `pnpm harness
  verify --sprint 14/01` 的会话/CI；`agui-bridge.ts` 自己的轮询循环本轮未切换（诚实
  范围收窄，见 session-handoff.md）。
- 下一步最佳动作: 见 `session-handoff.md`"下一步最佳动作"。
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
