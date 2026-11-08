/** Agent directory remains discoverable through organization administration. */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

// 2026-09-29：本 spec 排在 fullstack-smoke 的 `seeded` project，那条链的种子
// （fullstack-smoke-fixture / seed）只提供 FULLSTACK_E2E 账号，不建 dev-mode 预设账号——
// 原先 `loginAsDevRole` 在 CI 上停在 /login（#4622）。改用与同 project 其他 spec
// （如 agenda-segment-create-smoke）相同的真实表单登录；「Agent 目录」入口不按角色门控。
async function loginAsSeededUser(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
}

test("Agent 目录从组织后台入口可达", async ({ page }) => {
  await loginAsSeededUser(page);

  await expect(page.getByTestId("rail-agent-directory")).toHaveCount(0);
  const navEntry = page.getByTestId("rail-admin");
  await navEntry.scrollIntoViewIfNeeded();
  await expect(navEntry).toBeInViewport();
  await navEntry.click();

  const catalogEntry = page.getByRole("link", { name: /Agent 目录/ });
  if (await catalogEntry.count()) await catalogEntry.first().click();
  await expect(page).toHaveURL(/\/org-admin\/agent/);
  await expect(page.getByTestId("agent-directory")).toBeVisible();
});
