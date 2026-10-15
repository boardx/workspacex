import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

async function loginAsSeededUser(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
}

// #5704: real seeded API and database; no synthetic successful responses or model calls.
test("role cards visual acceptance: activation, responsive layout, filters and draft", async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/agent");
  await page.getByRole("button", { name: "官方角色", exact: true }).click();
  await expect(page.getByTestId("official-role-card-grid")).toBeVisible();
  for (const [label, width, height] of [["desktop",1440,1000],["tablet",768,1024],["mobile",390,844]] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`01-official-${label}.png`), fullPage: true });
  }
  const pendingContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const member = await pendingContext.newPage();
    await loginAsSeededUser(member);
    await member.goto("/agent");
    await expect(member.getByTestId("agent-directory-enable-official")).toHaveCount(0);
    await member.getByRole("button", { name: "官方角色", exact: true }).click();
    await expect(member.getByTestId("official-role-card-grid")).toBeVisible();
    await expect(member.getByRole("button", { name: "启用官方数字人", exact: true })).toHaveCount(0);
    await member.screenshot({ path: info.outputPath("01-member-pending-mobile.png"), fullPage: true });
  } finally { await pendingContext.close(); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "启用官方数字人", exact: true }).click();
  await expect(page.getByTestId("agent-directory-official")).toHaveCount(0, { timeout: 120_000 });
  const cards = page.locator('[data-testid^="agent-card-"]').filter({ has: page.getByTestId("agent-card-start-chat") });
  await expect(cards.first()).toBeVisible();
  for (const [label, width, height, columns] of [["desktop",1440,1000,3],["tablet",768,1024,2],["mobile",390,844,1]] as const) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => cards.first().evaluate(el => getComputedStyle(el.parentElement!).gridTemplateColumns.split(" ").length)).toBe(columns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.getByTestId("agent-directory-search").boundingBox())!.height).toBeGreaterThanOrEqual(36);
    for (const img of await cards.locator("img").all()) {
      await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`02-organization-${label}.png`), fullPage: true });
  }
  // Fault injection only aborts a read; recovery uses the real server unchanged.
  const directoryRead = /\/agents\/directory(?:\?|$)/;
  await page.route(directoryRead, route => route.abort("failed"));
  await page.reload();
  await expect(page.getByTestId("agent-directory-error")).toBeVisible();
  await page.screenshot({ path: info.outputPath("03-read-error-mobile.png"), fullPage: true });
  await page.unroute(directoryRead);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(cards.first()).toBeVisible();
  const search = page.getByTestId("agent-directory-search");
  await search.fill("no-such-role-5704");
  await expect(page.getByTestId("agent-directory-empty")).toBeVisible();
  await page.screenshot({ path: info.outputPath("03-filter-empty-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(cards.first()).toBeVisible();
  const filters = page.getByTestId("agent-directory-filter-category");
  await filters.getByRole("button", { name: "销售", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("销售代表");
  await filters.getByRole("button", { name: "全部", exact: true }).click();
  await expect.poll(() => cards.count()).toBeGreaterThan(1);
  await search.focus();
  await search.press("Tab");
  await expect(filters.getByRole("button", { name: "全部", exact: true })).toBeFocused();
  await cards.first().getByTestId("agent-card-task-examples").getByRole("button").first().click();
  await expect(page).toHaveURL(/\/chat\?.*prefill=/);
  const prompt = new URL(page.url()).searchParams.get("prefill")!;
  await expect(page.locator("textarea").first()).toHaveValue(prompt);
  await expect(page.getByTestId("loading")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("04-prefilled-draft-mobile.png"), fullPage: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const member = await context.newPage();
    await loginAsSeededUser(member);
    await member.goto("/agent");
    await expect(member.getByTestId("agent-directory-enable-official")).toHaveCount(0);
    await member.getByRole("button", { name: "官方角色", exact: true }).click();
    await expect(member.getByText("本组织已启用全部官方数字人。", { exact: true })).toBeVisible();
    await expect(member.getByRole("button", { name: "启用官方数字人", exact: true })).toHaveCount(0);
    await member.screenshot({ path: info.outputPath("05-member-official-mobile.png"), fullPage: true });
  } finally { await context.close(); }
});
