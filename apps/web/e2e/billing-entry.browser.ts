/** Frontend discovery/geometry evidence with explicit HTTP fixtures, not payment or auth E2E proof. */
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const evidence = resolve("../../docs/evidence/billing-entry-5714");
test("个人入口键盘可达，账户服务未开放时真实提示，三档无溢出", async ({ page, baseURL }) => {
  expect(new URL(baseURL!).hostname).toBe("localhost");
  mkdirSync(evidence, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem("wsx.sessionToken", "billing-ui-session");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId: "billing-ui-user", orgs: ["billing-ui-org"], currentOrgId: "billing-ui-org", expiresAt: "2099-01-01T00:00:00Z" }));
  });
  await page.route("http://localhost:3514/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/identity/me") {
      await route.fulfill({ json: { org: { id: "billing-ui-org", name: "账单验收组织", kind: "organization", team: null, modelPolicy: "any", avatarUrl: null }, orgRole: "consultant", teamId: null, projectRole: null, groupId: null, displayName: "账单验收用户", avatarUrl: null } });
    } else if (path === "/api/billing/config") {
      await route.fulfill({ json: { enabledProviders: [] } });
    } else {
      await route.fulfill({ status: 404, json: { reasonCode: "NOT_FOUND" } });
    }
  });
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "额度与订阅" })).toBeVisible();
    await expect(page.getByTestId("billing-provider-unavailable")).toBeVisible();
    await expect(page.getByTestId("err-billing-wallet")).toContainText("暂未开放");
    await expect(page.getByTestId("billing-wallet-balance")).toHaveCount(0);
    await expect(page.getByTestId("billing-qr-code-area")).toHaveCount(0);
    const sizes = await page.evaluate(() => ({ viewport: innerWidth, body: document.documentElement.scrollWidth }));
    expect(sizes.body).toBeLessThanOrEqual(sizes.viewport);
    await page.screenshot({ path: resolve(evidence, `billing-${width}.png`), fullPage: true });
  }
  // Start at normal document focus and reach the menu without targeting focus directly.
  let reached = false;
  for (let count = 0; count < 60; count++) {
    await page.keyboard.press("Tab");
    if (await page.getByTestId("rail-profile-menu").evaluate((node) => node === document.activeElement)) { reached = true; break; }
  }
  expect(reached).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("personal-menu-billing")).toBeVisible();
  await expect(page.getByTestId("personal-menu-profile")).toBeFocused();
  await page.screenshot({ path: resolve(evidence, "billing-menu.png") });
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("personal-menu-brain")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("personal-menu-usage-item")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("personal-menu-billing")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("personal-menu-theme")).toBeFocused();
  const theme = await page.getByTestId("personal-menu-theme").getAttribute("aria-pressed");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("rail-personal-menu")).toBeVisible();
  await expect(page.getByTestId("personal-menu-theme")).not.toHaveAttribute("aria-pressed", theme!);
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("personal-menu-billing")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/billing$/);
  await expect(page.getByTestId("rail-personal-menu")).toHaveCount(0);
});
