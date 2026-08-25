/**
 * F15（issue #1877）—— profile / org-admin 截图级保真度评审的真栈取证。
 *
 * 与 `chat-main-shots.spec.ts` 不同：这条**不是纯取证工具**——它带真实断言
 * （375/1280 两档不出现横向溢出，对应 rubric #10「响应式不溢出」的机械可验部分），
 * 因此不需要走 `lint-spec-gate-coverage.mjs` 的豁免清单：它本来就该被门控跑到。
 * 复用 `playwright.self-service-profile.config.ts` 已有的整栈
 * （postgres/redis/minio + 真实 API + 真实登录），不新增第二份栈定义。
 *
 * 截图落在 `.profile-org-fidelity-shots/`（同 `.chat-shots/` 的理由：过程物，
 * 每轮重抓，不是事实源，已加入 .gitignore），供 rev-uiux 逐张打分用，
 * 也是本 feature「三档视口」（375/768/1280）覆盖要求的证据。
 */
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { SELF_SERVICE_PROFILE_E2E } from "./self-service-profile-fixture";

const OUT = resolve(process.env.PROFILE_ORG_SHOTS_OUT ?? ".profile-org-fidelity-shots");
const MOBILE = { width: 375, height: 812 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 900 };

// 同 chat-main-shots 的理由：三条路由要冷编译，默认 30s 常不够。
test.setTimeout(180_000);

/** rubric #10：给定视口截图后，页面不能出现横向滚动（内容被裁切/溢出）。 */
async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `横向溢出：scrollWidth(${overflow.scrollWidth}) > clientWidth(${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth);
}

test("profile fidelity shots", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });

  await page.setViewportSize(DESKTOP);
  await page.goto("/login");
  // ⚠ 用专属的 `fidelityEmail`，**不要**换回 `adminEmail`（#2086）：那个账号会被
  // 并行 worker 上的 `self-service-profile.spec.ts` 真的改掉密码并 logout，
  // 使这里已经登录成功的会话失效，随后 `/profile` 被踢回登录页、
  // `profile-screen` 永不出现——这正是本条曾连红十次的原因。
  await page.getByTestId("login-email").fill(SELF_SERVICE_PROFILE_E2E.fidelityEmail);
  await page.getByTestId("login-password").fill(SELF_SERVICE_PROFILE_E2E.fidelityPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  const viewports: Array<{ name: string; size: { width: number; height: number } }> = [
    { name: "mobile-375", size: MOBILE },
    { name: "tablet-768", size: TABLET },
    { name: "desktop-1280", size: DESKTOP },
  ];

  // ---- profile ----
  for (const { name, size } of viewports) {
    await page.setViewportSize(size);
    await page.goto("/profile");
    await expect(page.getByTestId("profile-screen")).toBeVisible();
    await page.waitForTimeout(400);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: `${OUT}/profile-${name}.png`, fullPage: true });
  }

  // ---- org-admin：团队标签（默认态）+ 成员标签（含 F06 的权限下拉入口） ----
  for (const { name, size } of viewports) {
    await page.setViewportSize(size);
    await page.goto("/org-admin");
    await expect(page.getByTestId("org-admin-screen")).toBeVisible();
    await page.waitForTimeout(400);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: `${OUT}/org-admin-teams-${name}.png`, fullPage: true });

    await page.getByTestId("org-admin-tab-members").click();
    await expect(page.getByTestId("org-admin-member-list")).toBeVisible();
    await page.waitForTimeout(400);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: `${OUT}/org-admin-members-${name}.png`, fullPage: true });
  }
});
