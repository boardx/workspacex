# 进度日志 — Sprint 00/02

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: `pnpm -w run verify:base`
- 当前最高优先级未完成功能: <feature id / title>
- 当前 blocker: <无 / 描述>

## 会话记录
### 2026-07-28 18:32:09
- 本轮目标:
- 已完成:
- 运行过的验证:
- 已记录证据:
- 提交记录:
- 已知风险或未解决问题:
- 下一步最佳动作:

### 2026-07-29
- 本轮目标：建后端内核 F18，解除 F01~F13 的共同前置。
- 已完成：**F18 = passing**（八条 verification 全过）。`apps/api` 从零建起：
  NestJS + 洋葱四层 + 显式 SQL 迁移 + RLS 基线（app_rw 非 owner / FORCE / fail-closed）
  + Guard/ValidationPipe/ExceptionFilter 三道运行时门控 + 契约 zod 直达后端 DTO
  + docker compose（PG16-pgvector / MinIO / Redis）。
  补了两处门控空洞：`lint-arch-deps` 此前从未扫过一个文件；
  `lint-contract-source` 此前只覆盖前端侧。新增 `lint-error-leak`。
- 运行过的验证：见 evidence/F18.verify.log；另跑 doctor / validate-fl / verify-uc-coverage / verify:base。
- 已记录证据：`evidence/F18.verify.log`
- 已知风险或未解决问题：
  - ⚠ **G7 第一版是空转的**（孤儿子进程占端口，实际在测旧版本），反证才发现。
    已修，过程记在 `contracts/api-kernel/coverage.md` 第五节。这是第七次同类。
  - 凭证形态未定（属 phase-01 01-auth）；X-3 断言归 F16；合规 Q-1 仍是真阻塞。
- 下一步最佳动作：`pnpm harness new-sprint --phase 00 --id 03 --features F01`
