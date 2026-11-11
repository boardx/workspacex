import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

async function loginAsSeededUser(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
}

test("Agent 目录可以独立于组织后台访问", async ({ page }) => {
  await loginAsSeededUser(page);

  await page.goto("/agent");
  await expect(page).toHaveURL(/\/agent$/);
  await expect(page.getByTestId("agent-directory")).toBeVisible();
});
