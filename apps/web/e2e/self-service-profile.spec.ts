/**
 * #638/#639 —— 用户个人资料自助服务 + 组织团队管理，真实浏览器验收
 * （`phases/phase-01-run-a-project/design-deltas/self-service-profile/verification.md`
 * 的「e2e 门」）。
 *
 * 链路一节不许省：Chromium → Next 同源代理 → NestJS 控制器 → application 用例
 * → repository → PostgreSQL，走真实登录、真实密码、真实 team CRUD——不是 mock。
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
 *
 * ## "删除非空团队被拒绝"这条反证怎么造
 *
 * org-admin 这一轮的产品范围里没有"加成员"入口（`org-admin-screen.tsx` 文件头写明），
 * 所以不能在 UI 里现拼一个非空团队。种子里天然种了一个带一名成员的团队
 * （`SELF_SERVICE_PROFILE_E2E.seedTeamName`），直接拿它当反证对象——这是真实状态，
 * 不是为了让测试好写而伪造的场景。
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
  await expect(page).toHaveURL(/\/login(\?|$)/);
  const verdict = judgeLogoutLanding(page.url(), "/profile");
  expect(verdict.ok, verdict.reason).toBe(true);
}

test.describe.serial("用户个人资料自助服务 + 组织团队管理", () => {
  // 三步共用一个页面/一个会话，且改密码这一步必须发生在改名之后——顺序化，
  // 不用各自独立 `test()`：改密码会让后面任何一次新登录都必须用新密码，
  // 拆开写只会逼着后面的用例重复"先用哪个密码登录"这段逻辑。
  test("改姓名刷新后仍在 → 改密码后新密码可登录、旧密码不可 → 团队创建/改名/删除 + 非空团队删除被拒绝", async ({ page }) => {
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

    /* ── 3. 团队：创建 → 改名 → 删除（空团队能删） ───────────────────────── */
    await page.goto("/org-admin");
    await expect(page.getByTestId("org-admin-screen")).toBeVisible();
    await expect(page.getByTestId("org-admin-team-list")).toBeVisible();

    const createdTeamName = "E2E 新建团队";
    const renamedTeamName = "E2E 已改名团队";

    await page.getByTestId("org-admin-create-team-input").fill(createdTeamName);
    await page.getByTestId("org-admin-create-team").click();
    await expect(page.getByTestId("org-admin-team-banner")).toContainText("已创建");

    // ⚠ 不能一路用 `hasText` 定位这一行再复用：进入改名/确认改名态之后，这一行的
    // 可见文本会被替换成一个 `<input>`（值不算 innerText）+ 两个纯图标按钮，
    // `hasText` 定位符是**惰性重新求值**的，届时会重新解析出"这一行文本里根本
    // 没有团队名"从而一个都匹配不到，`.fill()` 会在这里死等到超时——不是应用的
    // bug，是选择器的 bug（实测过一次，见 PR #797 这轮修复记录）。用 `data-testid`
    // 钉住这一行（`teamId` 不随改名/确认态变化），后续动作都对它取。
    const createdRowByText = page.getByTestId("org-admin-team-list").locator("li", { hasText: createdTeamName });
    await expect(createdRowByText).toBeVisible();
    const createdTeamTestId = await createdRowByText.getAttribute("data-testid");
    if (!createdTeamTestId) throw new Error("新建团队后拿不到这一行的 data-testid");
    const row = page.getByTestId(createdTeamTestId);

    await row.getByRole("button", { name: "改名" }).click();
    await row.getByRole("textbox").fill(renamedTeamName);
    await row.getByRole("button", { name: "确认改名" }).click();
    await expect(page.getByTestId("org-admin-team-banner")).toContainText("已改名");
    await expect(row).toContainText(renamedTeamName);
    await expect(row).not.toContainText(createdTeamName);

    await row.getByRole("button", { name: "删除" }).click();
    await row.getByRole("button", { name: "确认删除" }).click();
    await expect(page.getByTestId("org-admin-team-banner")).toContainText("已删除");

    // 空团队删除必须真的写库，不是只改了 React state——刷新后仍然不见。
    await page.reload();
    await expect(page.getByTestId(createdTeamTestId)).toHaveCount(0);

    /* ── 4. 反证：非空团队删除必须被拒绝 ──────────────────────────────────── */
    // 这一步全程停在 view/confirm-delete 两态之间，两态下团队名都是可见文本，
    // 不撞上面那个坑，但同样钉成 `data-testid` 求稳，跟上面统一手法。
    const seedRowByText = page.getByTestId("org-admin-team-list")
      .locator("li", { hasText: SELF_SERVICE_PROFILE_E2E.seedTeamName });
    await expect(seedRowByText).toBeVisible();
    const seedTeamTestId = await seedRowByText.getAttribute("data-testid");
    if (!seedTeamTestId) throw new Error("拿不到种子非空团队这一行的 data-testid");
    const seedRow = page.getByTestId(seedTeamTestId);
    await expect(seedRow).toContainText("1 名成员");

    await seedRow.getByRole("button", { name: "删除" }).click();
    await seedRow.getByRole("button", { name: "确认删除" }).click();

    // 拒绝必须体现在两处：错误 banner + 那一行原样还在（没被乐观删除）。
    await expect(page.getByTestId("org-admin-team-banner")).toContainText("不能直接删除");
    await expect(seedRow).toBeVisible();
    await expect(seedRow).toContainText("1 名成员");

    expect(failures, `浏览器控制台/页面报了未预期的错误：${failures.join("; ")}`).toEqual([]);
  });
});
