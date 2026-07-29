# 会话交接 — Sprint 00/02

## 当前已验证

- **F18 后端内核 = `passing`**。八条 verification 全过：
  `typecheck` / `lint` / `test` / `lint-arch-deps` / `verify-rls.sh` /
  `verify-runtime-gates.sh` / `migrate:check` / `lint-contract-source`。
  证据：`evidence/F18.verify.log`。
- **F01 已自动解锁**：`sweep-unblock` 把它从 `blocked` 回填为 `not_started`。
- phase-00：**2 passing / 16 not_started**，18 features / 101 点。
- 五个契约束全部已签，一致性复核通过，覆盖矩阵完整。

## 本轮交付了什么

`apps/api` 从零建起：NestJS + 洋葱四层 + 显式 SQL 迁移 + RLS 基线 + 三道运行时门控。

**两处此前一直没人管的门控空洞，现在补上了**：

1. `lint-arch-deps` 从 ADR-020 写下那天起**从未扫过一个文件**——它对不存在的
   `apps/api/src` 打印「跳过」并 exit 0，而 ADR-020 称它「强制、与七道门控同级」。
   现在扫 22 个文件，且**断言的是扫描数不是退出码**（只断言退出码，这条永远为真）。
   同时补了「不在任何层的文件必须在组合根白名单里」——
   否则「把代码放进没有层名的目录」就是绕开门控的后门。
2. `lint-contract-source` **只覆盖前端侧**——ADR-020 的「zod → 后端 DTO」这一端
   从未被门控。现在扫描范围含 `apps/api`，且 V10 断言的是**扫描目录清单里有它**。

顺带加了一道 `lint-error-leak`：`architecture.md` 点名要「lint 拦响应体里的
`String(err)` / `err.message`」，此前没有。

## ⚠ 本轮抓到一次真正的空转，值得读

`verify-runtime-gates.sh` 的 **G7「测试注入通道在生产不可达」第一版是假的**：
它用 `pnpm exec tsx` 起子进程，`kill` 只杀掉 pnpm 包装器，**真正的服务被遗弃并继续占端口**。
此后每次运行都是**上一轮那个用正确代码起的孤儿进程**在应答——
删掉生产判断，G7 照样全绿。

修法：起之前先探端口（被占用即判失败），`detached` 起进程组、`kill(-pid)` 整组杀。
完整记录在 `contracts/api-kernel/coverage.md` 第五节。

**这是本项目第七次「门控看起来在跑其实没在测」。** 唯一能发现它的办法是造反证——
本轮十一道反证逐个跑过，结果全部记在同一节。

## 仍未做 / 已知边界

- **凭证形态未定**（JWT / session / mTLS）。Guard 只断言「principal 非空」这条结构约束，
  凭证走测试注入头，**且该通道在生产不可达**（G7 有反证）。真实认证属 phase-01 `01-auth`。
- **X-3 出网为零**：按签核确认的分工，本束只认领**落点**
  （`docker-compose.dev.yml` 的网络策略块，已署名），**deny-all 的断言归 F16**。
- **不引入 ORM**（签核时确认 A-4）。持久化走显式 SQL；`DatabasePort.withTenant(orgId, fn)`
  强制调用方说出租户，理由是 ORM 会把 `SET LOCAL` 的租户语义藏进连接池行为。
- **worker 进程入口未建**（属 phase-01）。但洋葱目录没写成 API 专属，领域层可共用。
- **合规/法务 Q-1（法定留存清单）仍是真阻塞**，卡住撤回删除相关 feature。

## 下一步最佳动作

**F01 两层角色本体**（5 点，被 4 个 feature 依赖）。现在它的前提真的具备了：
`acl_bindings` 的迁移直接加进 `apps/api/migrations/`，判定逻辑落 `application/use-cases/`，
`identity` 束契约（9 个操作，含 `authorizeBatch`）已定。

```bash
pnpm harness new-sprint --phase 00 --id 03 --features F01
```

⚠ **不要动的东西**：
- `rls_probe` 表与 `kernel-probe.controller.ts` —— 它们是**内核资产不是脚手架**，
  删掉等于删掉「RLS 真的在强制 / 三道门控真的挂着」的唯一证据。
- `lint-arch-deps.mjs` 的 `COMPOSITION_ROOT` 白名单 —— 每加一项都是一个不受分层保护的文件，
  测试断言它 ≤ 3 项。
- 任何 `design-signoff.md` / `design-coherence.md` 的 `status` 字段（人类专属）。

## 命令

- 起依赖：`pnpm --filter api run dev:deps`（PG 55432 / MinIO 59000 / Redis 56379）
- 起 API：`pnpm --filter api run dev`
- 迁移：`pnpm --filter api run migrate`
- 验证：`pnpm harness verify --sprint 00/02`
- 体检：`pnpm harness doctor --phase 00`
