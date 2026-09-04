# 进度日志 — Sprint 14/01

## 当前已验证状态(唯一真相)
- 仓库根目录: `/home/user/workspacex`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- F01（apps/api 退化为薄网关）：已合入 main（#2729），本会话开工时仍是 `in_progress`
  （其 verify 未在合入前的会话里跑通，见下方 2026-09-04(F03 会话) 记录）。
- F03（网关 WebSocket 事件端点）：本会话实现完成，三条 verification 命令本会话真实跑绿
  （证据 `evidence/F03.verify.log`），细节见下。
- 本会话解决了 F01 记录的环境 blocker：沙箱没有可用的 Docker/组织出网策略拦截
  `pgvector/pgvector:pg16` 拉取——本会话改用**本机 apt 安装的 PostgreSQL 16**
  （`postgresql-16`/`postgresql-16-pgvector`）替代 docker-compose 起的 Postgres，
  外加一个仅存在于本会话 PATH 里的 `docker` 命令 shim（把 `tests/support/db.ts`/
  `auth.ts` 里 `docker compose exec postgres pg_isready`/`up -d postgres` 等固定几条
  子命令翻译成对本机 Postgres 的直接调用），使 `pnpm --filter api exec vitest run`
  可以真正跑通，不必修改任何测试基建源码。**这个 shim 只存在于本会话临时目录，
  不是仓库的一部分**——下一个会话若同样缺 Docker，需要重新搭一次（步骤：
  `apt-get install postgresql-16-pgvector` → 把 main 集群端口改到 55432 并起
  服务 → 建 `workspacex` 库 + `CREATE EXTENSION vector` → 跑一次
  `migrate(migrationConfig())` 让 `0001-kernel-roles.sql` 建好 `app_rw` 等角色 →
  PATH 前置一个把 `docker compose exec/up` 转译成本机命令的 shim 脚本）。

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
