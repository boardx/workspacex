# 开发模式：预设账号/角色，agent 跳过登录直接测

> 解决的问题：agent 跑 e2e / 手动验证功能时经常先卡在"账号"本身——没有账号可登录、
> 临时建的账号互相踩踏（并发 worker 用同一账号登录会被 `kick-device-invalidates-session`
> 互踢）、密码要现记、角色边界靠猜。这不是登录逻辑有 bug，是账号本身太贵。

## 这不是绕过鉴权的后门

"跳过登录"指的是 agent 不用再现填 `/login` 表单、不用现建账号、不用现记密码；
账号本身仍然要经过真实的 `POST /auth/login`（bcrypt 校验、lockout、session 签发）
才能拿到 session token。没有新增任何绕过鉴权的路径。

需要绕过整条登录 UI（比如 API 层 kernel 测试，只关心其它逻辑不关心登录本身）的场景，
仓库里已经有 `x-kernel-test-principal` 注入（`session-token-principal-resolver.ts`，
`KERNEL_ALLOW_TEST_PRINCIPAL=1 && NODE_ENV !== production`）——那是另一层，服务的是
另一类测试（API 集成测试），这份文档不重复它。

## 唯一事实源

`packages/dev-mode-accounts`（`@repo/dev-mode-accounts`）——4 个固定账号，一个
`OrgRole`（`admin` / `lead` / `consultant` / `compliance`）一个，邮箱/密码写死并随
repo 提交，共用同一个组织（`Dev Mode Org`）。

不要在别处再声明一份同样的账号列表——同一事实声明在两处正是这个仓库反复栽过的坑。
需要新增/改一个预设账号，改这一处，`apps/api` 的种子脚本和 `apps/web` 的 e2e helper
会自动跟着变。

## 用法

### 1. 种账号（只需跑一次，幂等，已存在的邮箱会跳过）

```bash
pnpm harness dev-mode seed
```

（等价于直接跑 `WORKSPACEX_DEV_MODE=1 pnpm --filter api exec tsx scripts/seed-dev-mode-accounts.ts`——
harness 命令只是包了一层，方便发现，门控/幂等逻辑仍在种子脚本本身。）

生产环境（`NODE_ENV=production`）直接抛错退出，不种任何东西——与
`KERNEL_ALLOW_TEST_PRINCIPAL` 同一套硬门约定。不传 `WORKSPACEX_DEV_MODE=1`
也会拒绝执行（不做静默默认行为）。

### 2. Playwright e2e：按角色登录，不用现记账号

```ts
import { loginAsDevRole } from "./dev-mode-login";

await loginAsDevRole(page, "lead"); // 走真实 /login，落在 /projects
```

### 3. 手动验证：直接读常量

```ts
import { DEV_MODE_ACCOUNTS, getDevModeAccount } from "@repo/dev-mode-accounts";
```

## 什么时候不该用这个

- 已有 spec 在断言**严格权限边界矩阵**、需要与其它 feature **隔离账号**避免并发 worker
  互踢设备会话的场景（`apps/web/e2e/fullstack-smoke-fixture.ts` 那一整套）——继续用
  那套专属账号，不要迁移过来。这 4 个预设账号是共享的，多个 spec 并发用同一个角色登录，
  一样会撞上 `kick-device-invalidates-session`。
- 需要断言"某个角色刚好没有某个权限"这类反证——`fullstack-smoke-fixture.ts` 里那些
  角色的边界注释是权威来源，不要假设这 4 个预设账号的角色语义会覆盖它已经踩过的坑。

## 验证

`packages/dev-mode-accounts/test/dev-mode-accounts.test.ts`：账号表与 `OrgRole` 枚举
一一对应、schema 校验、邮箱不重复、生产环境硬门。这条测不需要数据库，随
`pnpm --filter @repo/dev-mode-accounts test` 跑。

种子脚本本身需要真实 Postgres，跟着 `apps/api` 现有的 db 集成测试同一条基础设施走
（`pnpm harness verify` 会包一层 `with-test-isolation.ts`）。
