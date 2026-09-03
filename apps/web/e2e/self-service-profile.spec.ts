/**
 * #638 —— 用户个人资料自助服务，真实浏览器验收
 * （`phases/phase-01-run-a-project/design-deltas/self-service-profile/verification.md`
 * 的「e2e 门」）。
 *
 * 链路一节不许省：Chromium → Next 同源代理 → NestJS 控制器 → application 用例
 * → repository → PostgreSQL，走真实登录、真实密码——不是 mock。
 *
 * ## issue #2615 收窄（原文件头"+ 组织团队管理"一节已不再成立）
 * 组织后台已去掉"团队"概念（团队是项目内部的概念，不是组织概念，见
 * `org-admin-screen.tsx` 文件头 2026-09-03 人类裁决②）——原来"团队创建/改名/删除 +
 * 非空团队删除被拒绝"这整段（原第 3/4 步）连带它验证的写路径一起不存在了：
 * `org-admin-screen.tsx` 不再有 `TeamsTab`/`CreateTeamForm`/`TeamRow`，`org-admin-*-team-*`
 * 系列 testid 全部不再渲染。本文件收窄为只测个人资料自助服务（改姓名 + 改密码 +
 * 活动记录），标题与文件头同步改写；仍会命中同一个 issue #638 的 e2e 门，
 * 只是不再兼管已撤除的 #639 团队管理。
 *
 * ## 活动记录非空断言（迭代 4，#638，回填 PR #797 独立复核撤回的那条）
 *
 * 六条写路径此前都没有写 `provenance` 记录，`/profile` 的活动记录面板永远为空——
 * 那一版的 e2e 因此**故意撤回**了"活动记录非空"这条断言（写在
 * `verification.md` 的"已知缺口"一节）。本轮六条写路径已补齐 `provenance.append`
 * （见 `packages/contracts/src/provenance.ts` 与 ADR-101 的 #638 追加记录），本文件把
 * 这条断言加回来：改名后 `profile-activity-list` 至少能看到一条真实记录。
 *
 * ## 为什么单独一个 org、一套 webServer（`playwright.self-service-profile.config.ts`）
 *
 * 本文件的改密码步骤会真的让这个账号的旧密码失效。跟 `fullstack-smoke` 那批 spec
 * 共用账号的话，账号密码被换掉之后别的 spec 会集体登录失败——这不是"不稳定"，
 * 是必然。所以这里种了一个只有本文件会碰的专属账号/组织，见
 * `self-service-profile-fixture.ts` 与 `scripts/seed-self-service-profile-e2e.ts`。
 */
import { expect, test, type Page } from "@playwright/test";
import { expectedPostLoginLanding, judgeLogoutLanding } from "./logout-landing";
import { SELF_SERVICE_PROFILE_E2E } from "./self-service-profile-fixture";

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function logout(page: Page) {
  await page.getByTestId("rail-profile-menu").click();
  await page.getByTestId("personal-menu-logout").click();
  // #2499：#2413 起登出后落点可能带 `?next=`（登出按钮 → /login；AppShell 匿名守卫 →
  // /login?next=<当前路径>，两次跳转谁后到谁说了算）。判定规则与反例见 `./logout-landing.ts`
  // 与 `tests/e2e/logout-landing.test.ts`：只接受这两种有意的落点，重复 next / 外域 /
  // 循环 / 错误目标 / 多余参数 / hash 一律红在这里，不留给登录后的 sanitizeReturnTo 掩盖。
  // 期望 origin 取 Playwright 配置的 baseURL——不能从 page.url() 反推，否则外域落点会自证合规。
  const expectedOrigin = String(test.info().project.use.baseURL);
  await expect(page).toHaveURL((url) => url.origin === new URL(expectedOrigin).origin && url.pathname === "/login");
  const verdict = judgeLogoutLanding(page.url(), "/profile", expectedOrigin);
  expect(verdict.ok, verdict.reason).toBe(true);
}

test.describe.serial("用户个人资料自助服务", () => {
  // 两步共用一个页面/一个会话，且改密码这一步必须发生在改名之后——顺序化，
  // 不用各自独立 `test()`：改密码会让后面任何一次新登录都必须用新密码，
  // 拆开写只会逼着后面的用例重复"先用哪个密码登录"这段逻辑。
  test("改姓名刷新后仍在 → 活动记录非空 → 改密码后新密码可登录、旧密码不可", async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));

    /* ── 1. 改姓名，刷新页面后仍在（不能只测保存后的即时状态） ────────────── */
    await loginAs(page, SELF_SERVICE_PROFILE_E2E.adminEmail, SELF_SERVICE_PROFILE_E2E.adminPassword);
    await page.goto("/profile");
    await expect(page.getByTestId("profile-screen")).toBeVisible();

    const newDisplayName = "SSP E2E Admin 改名后";
    await page.getByTestId("profile-display-name-input").fill(newDisplayName);
    await page.getByTestId("profile-save").click();
    await expect(page.getByTestId("profile-display-name-input")).toHaveValue(newDisplayName);

    await page.reload();
    await expect(page.getByTestId("profile-display-name-input")).toHaveValue(newDisplayName);

    /* ── 1b. 活动记录非空：改名写的 provenance 事件真的能读回来（迭代 4） ───── */
    await expect(page.getByTestId("profile-activity-section")).toBeVisible();
    const activityItems = page.getByTestId("profile-activity-list").locator("li");
    await expect(activityItems).not.toHaveCount(0);
    await expect(activityItems.first()).toContainText(`显示名改为"${newDisplayName}"`);

    /* ── 2. 改密码：正确当前密码 + 符合策略的新密码 ──────────────────────── */
    await page.getByTestId("profile-current-password-input").fill(SELF_SERVICE_PROFILE_E2E.adminPassword);
    await page.getByTestId("profile-new-password-input").fill(SELF_SERVICE_PROFILE_E2E.newPassword);
    await page.getByTestId("profile-password-submit").click();
    await expect(page.getByTestId("profile-password-success")).toBeVisible();

    // 改密码不登出本设备——当前会话应该仍然是登录态，这里退出是为了下面测「新/旧密码」。
    await logout(page);

    // 旧密码必须登不进去。
    await page.getByTestId("login-email").fill(SELF_SERVICE_PROFILE_E2E.adminEmail);
    await page.getByTestId("login-password").fill(SELF_SERVICE_PROFILE_E2E.adminPassword);
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // 新密码必须登得进去。落点由提交那一刻登录页 URL 上的 `next` 决定（登出落点若是
    // `/login?next=%2Fprofile`，登录后就回 /profile，不是 /projects）——见 `./logout-landing.ts`。
    await page.getByTestId("login-email").fill(SELF_SERVICE_PROFILE_E2E.adminEmail);
    await page.getByTestId("login-password").fill(SELF_SERVICE_PROFILE_E2E.newPassword);
    const landing = expectedPostLoginLanding(page.url());
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL((url) => url.pathname === landing && url.search === "");

    expect(failures, `浏览器控制台/页面报了未预期的错误：${failures.join("; ")}`).toEqual([]);
  });
});
