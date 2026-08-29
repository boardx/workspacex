/**
 * dev-mode-login.ts —— 开发模式的登录 helper：agent 拿一个 `OrgRole`，直接换到一个已登录的
 * `Page`,不用现记账号、不用每个 spec 各写一份 `loginAs`。
 *
 * ## 仍然是真实登录，不是第二条认证路径
 *
 * 走的还是 `/login` 页面 → 真实 `POST /auth/login`（`apps/web/lib/auth.ts` `login()`）→
 * bcrypt 校验 → session 签发,与仓库里现有十几处 `loginAs(page, email, password)`
 * （`agenda-segment-create-smoke.spec.ts` 等）逐字同一条路径。这里只是把"用哪个账号"
 * 从每个 spec 文件里的手填 email/password,换成 `@repo/dev-mode-accounts` 那份唯一事实源
 * 按角色查找——省的是"account 从哪来"这一步,不是登录逻辑本身。
 *
 * ## 什么时候该用这个,什么时候不该
 *
 * 用于:agent 想验证"某个角色能不能做某件事"这类日常功能可用性检查,不需要为这次检查
 * 单独种一条隔离账号。
 *
 * 不用于:已经在断言严格权限边界矩阵、需要与其它 feature 隔离账号（避免并发 worker
 * 互踢设备会话）的既有 spec——那些应继续用 `fullstack-smoke-fixture.ts` 的专属账号,
 * 不要迁移过来(这 4 个预设账号是共享的,多个 spec 并发用同一个角色登录,一样会撞上
 * `kick-device-invalidates-session`)。
 *
 * ## 使用前提
 *
 * 这 4 个账号必须已经被种进当前跑测试连的那个数据库——
 * `WORKSPACEX_DEV_MODE=1 pnpm --filter api exec tsx scripts/seed-dev-mode-accounts.ts`。
 * 没种过账号就调用这里的 helper,会在真实 `/login` 表单上拿到"账号或密码错误",
 * 这是预期失败,不是这个 helper 的 bug。
 */
import { expect, type Page } from "@playwright/test";
import { DEV_MODE_ACCOUNTS, getDevModeAccount, type DevModeOrgRole } from "@repo/dev-mode-accounts";

export { DEV_MODE_ACCOUNTS };

/**
 * 用预设角色账号登录,登录成功后停在 `/projects`（与仓库里其它 `loginAs` 断言的落点一致）。
 */
export async function loginAsDevRole(page: Page, role: DevModeOrgRole): Promise<void> {
  const account = getDevModeAccount(role);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(account.email);
  await page.getByTestId("login-password").fill(account.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}
