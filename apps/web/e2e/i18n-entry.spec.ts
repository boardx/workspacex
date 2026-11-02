import { test, expect } from "@playwright/test";
// Runs against the real entry route; no authentication or content API is mocked.
test("root redirects to localized login and preserves language and form values", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("login-email")).toBeEnabled();
  await page.getByTestId("login-email").fill("locale-test@example.com");
  await page.getByTestId("language-switcher").selectOption("en");
  await expect(page.getByRole("heading", { name: "Sign in to WorkspaceX" })).toBeVisible();
  await expect(page.getByTestId("login-email")).toHaveValue("locale-test@example.com");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in to WorkspaceX" })).toBeVisible();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId("language-switcher")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByTestId("language-switcher").selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "登录 WorkspaceX" })).toBeVisible();
});
