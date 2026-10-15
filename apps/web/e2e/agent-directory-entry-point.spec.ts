/**
 * AG04 review 指出的缺口——`/agent` 目录页此前在 `lib/navigation.ts` 里零导航入口，
 * e2e 也是零，同 testing-standards.md 点名的 Ava/Surveys/Admin 先例：「e2e 全是
 * page.goto() 直连，没人断言入口」。这里补上一条最小的真实入口可达性验证：
 * 真实登录 → 左栏导航能看到「Agent 目录」→ 点击真的落到 `/agent` 并渲染目录屏
 * （不是 goto 直连，是从产品里点出来的）。
 */
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

test("Agent 目录从左栏导航可达，不是只能敲 URL 进的孤岛", async ({ page }) => {
  await loginAsSeededUser(page);

  // 2026-09-30：Agent 目录收进左栏「更多」三点菜单，先点开再找入口
  await page.getByTestId("rail-more").click();
  const navEntry = page.getByTestId("rail-agent-directory");
  await expect(navEntry).toBeVisible();
  await navEntry.click();

  await expect(page).toHaveURL(/\/agent$/);
  await expect(page.getByTestId("agent-directory")).toBeVisible();
});

// #5704: real seeded API and database; no request interception or model calls.
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
