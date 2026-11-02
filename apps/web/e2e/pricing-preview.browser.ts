import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { EnterpriseCreditGrantRequest } from "@repo/contracts/billing-team";

// Generated review evidence must not overwrite already adopted signoff screenshots.
const shots = process.env.PRICING_PREVIEW_EVIDENCE_DIR ?? path.resolve(__dirname, "../test-results/pricing-preview");
const billingCalls = new WeakMap<Page, string[]>();
async function capture(page: Page, name: string) {
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
}
async function select(page: Page, id: string, label: string) {
  await page.getByTestId(id).click();
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  const calls: string[] = []; billingCalls.set(page, calls);
  for (const pattern of ["**/billing/**", "**/platform/organizations**"]) await page.route(pattern, route => {
    calls.push(new URL(route.request().url()).pathname); return route.abort();
  });
  await page.goto("/preview/pricing"); await expect(page.getByTestId("pricing-wallet")).toBeVisible();
});
test.afterEach(async ({ page }) => { expect(billingCalls.get(page)).toEqual([]); });

test("responsive account and purchase UI has no horizontal overflow", async ({ page }) => {
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 960 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, `account-${width}`);
    await page.getByTestId("pricing-open-plans").click();
    await expect(page.getByTestId("pricing-total")).toHaveText("¥199");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, `plans-${width}`);
    await page.keyboard.press("Escape");
  }
});

test("regional monthly and annual prices, renewal and channel visibility", async ({ page }) => {
  await select(page, "pricing-region", "美国 · USD");
  await page.getByTestId("pricing-open-plans").click();
  await expect(page.getByTestId("pricing-total")).toHaveText("$29");
  await expect(page.getByTestId("pricing-provider-wechat")).toHaveCount(0);
  await expect(page.getByTestId("pricing-renewal-note")).toContainText("自动续费");
  await page.getByTestId("pricing-cycle-year").click();
  await expect(page.getByTestId("pricing-total")).toHaveText("$290");
  await page.getByTestId("pricing-plan-team").click();
  await expect(page.getByTestId("pricing-total")).toHaveText("$1,490");
  await capture(page, "us-annual");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pricing-latest-subscription")).toContainText("月度订阅");
  await expect(page.getByTestId("pricing-latest-subscription")).toContainText("2026/12/01");
  await select(page, "pricing-region", "中国 · CNY");
  await page.getByTestId("pricing-buy-credits").click();
  await expect(page.getByTestId("pricing-provider-stripe")).toHaveCount(0);
  for (const [credits, amount] of [[10000, "¥129"], [50000, "¥599"], [200000, "¥2,199"]] as const) {
    await page.getByTestId(`pricing-pack-${credits}`).click(); await expect(page.getByTestId("pricing-total")).toHaveText(amount);
  }
  await capture(page, "credit-packages");
  await page.getByTestId("pricing-pay-preview").click();
  await expect(page.getByTestId("pricing-payment-result")).toContainText("已演示购买成功");
});

test("Team separates seats used and purchased, prorates and explains expiry", async ({ page }) => {
  await page.getByTestId("pricing-view-team").click();
  await expect(page.getByTestId("pricing-subscription")).toContainText("已用 4 / 已购 5 席");
  await capture(page, "team");
  await page.getByTestId("pricing-add-seats").click();
  await expect(page.getByTestId("pricing-total")).toHaveText("¥74.5");
  await page.getByTestId("pricing-seat-plus").click();
  await expect(page.getByTestId("pricing-total")).toHaveText("¥149");
  await expect(page.getByTestId("pricing-purchase-dialog")).toContainText("2026/12/01");
  await capture(page, "team-add-seats");
  await page.getByTestId("pricing-pay-preview").click();
  await expect(page.getByTestId("pricing-payment-result")).toContainText("已演示购买成功");
  await capture(page, "team-seat-receipt");
  await page.keyboard.press("Escape");
  await select(page, "pricing-region", "美国 · USD");
  await page.getByTestId("pricing-add-seats").click();
  await expect(page.getByTestId("pricing-total")).toHaveText("$25");
  await expect(page.getByTestId("pricing-provider-stripe")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("pricing-provider-wechat")).toHaveCount(0);
  await capture(page, "team-us-add-seats");
  await page.keyboard.press("Escape");
  await select(page, "pricing-region", "中国 · CNY");
  await page.getByTestId("pricing-toggle-expired").click();
  await expect(page.getByTestId("pricing-add-seats")).toBeDisabled();
  await expect(page.getByTestId("pricing-subscription")).toContainText("登录与资料查看不受影响");
  await expect(page.getByTestId("pricing-latest-subscription")).toContainText("2026/09/30 — 2026/10/31");
  await capture(page, "team-expired");
  await page.getByTestId("pricing-subscription-history").click();
  await expect(page.getByTestId("pricing-history-dialog")).toContainText("订阅已到期");
  await expect(page.getByTestId("pricing-history-dialog")).not.toContainText("本期有效");
  await expect(page.getByTestId("pricing-team-history-item")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.getByTestId("pricing-toggle-cycle").click();
  await page.getByTestId("pricing-subscription-history").click();
  await expect(page.getByTestId("pricing-team-history-item")).toHaveCount(1);
  await expect(page.getByTestId("pricing-history-dialog")).toContainText("Team 年度订阅");
  await expect(page.getByTestId("pricing-history-dialog")).toContainText("¥9,990");
  await capture(page, "team-annual-history");
});

test("Enterprise upgrade confirmation, grant validation and visible result", async ({ page }) => {
  await page.getByTestId("pricing-view-admin").click();
  await page.getByTestId("pricing-upgrade-studio").click();
  await expect(page.getByTestId("pricing-admin-dialog")).toContainText("按原购买日发放至原到期日");
  await expect(page.getByTestId("pricing-admin-dialog")).toContainText("停止 Team 后续续费");
  await capture(page, "enterprise-upgrade");
  await page.getByTestId("pricing-admin-cancel").click();
  await expect(page.getByTestId("pricing-admin-plan-studio")).toHaveText("Team");
  await page.getByTestId("pricing-upgrade-studio").click();
  await page.getByTestId("pricing-admin-confirm").click();
  await expect(page.getByTestId("pricing-admin-plan-studio")).toHaveText("Enterprise");
  await page.getByTestId("pricing-grant-studio").click();
  await page.getByTestId("pricing-admin-confirm").click();
  await expect(page.getByTestId("err-pricing-grant")).toBeVisible();
  await expect(page.getByTestId("pricing-grant-reason")).toHaveAttribute("maxlength", String(EnterpriseCreditGrantRequest.shape.reason.maxLength));
  await capture(page, "team-contract-grant-invalid");
  await page.getByTestId("pricing-grant-reason").fill("演示追加额度");
  await capture(page, "enterprise-grant");
  await page.getByTestId("pricing-admin-confirm").click();
  await expect(page.getByTestId("pricing-admin-row-studio")).toContainText("74,000");
  await capture(page, "enterprise-list");
});

test("all seven review states are reachable and failures recover", async ({ page }) => {
  for (const [label, id] of [["加载", "loading"], ["空", "empty"], ["校验失败", "err-pricing-invalid"], ["依赖失败", "err-pricing-depfail"], ["无权限", "err-pricing-denied"], ["成功", "pricing-saved"], ["默认", "pricing-wallet"]] as const) {
    await select(page, "pricing-state", label); await expect(page.getByTestId(id)).toBeVisible();
    await capture(page, `state-${id}`);
  }
  await select(page, "pricing-state", "依赖失败"); await page.getByTestId("pricing-retry").click();
  await expect(page.getByTestId("pricing-wallet")).toBeVisible();
  await page.getByTestId("pricing-toggle-free").click();
  await expect(page.getByTestId("pricing-subscription")).toContainText("新用户一次性赠送");
  await capture(page, "free");
});

test("initial capacity and Enterprise account variants are reviewable",async({page})=>{
 await page.getByTestId("pricing-view-team").click();
 await select(page,"pricing-team-scenario","七人团队首次购买");
 await page.getByTestId("pricing-toggle-cycle").click();
 await page.getByTestId("pricing-initial-team-purchase").click();
 await expect(page.getByTestId("pricing-initial-capacity")).toContainText("本次购买 7 席");
 await expect(page.getByTestId("pricing-total")).toHaveText("¥12,970");
 await capture(page,"team-initial-seven");await page.keyboard.press("Escape");
 await select(page,"pricing-team-scenario","Enterprise · 无旧计划");
 await expect(page.getByTestId("pricing-enterprise-account")).toContainText("没有待发放");
 await expect(page.getByTestId("pricing-buy-credits")).toHaveCount(0);
 await capture(page,"enterprise-account-manual");
 await select(page,"pricing-team-scenario","Enterprise · 保留已付计划");
 await expect(page.getByTestId("pricing-enterprise-prepaid")).toContainText("2027/11/01");
 await expect(page.getByTestId("pricing-enterprise-prepaid")).toContainText("100,000");
 await capture(page,"enterprise-account-prepaid");
});
test("Enterprise upgrade recovers the original operation without optimistic activation",async({page})=>{
 await page.getByTestId("pricing-view-admin").click();
 await page.getByTestId("pricing-upgrade-outcome-processing").click();
 await page.getByTestId("pricing-upgrade-studio").click();await page.getByTestId("pricing-admin-confirm").click();
 await expect(page.getByTestId("pricing-admin-plan-studio")).toHaveText("Team");
 const reference=await page.getByTestId("pricing-upgrade-operation-studio").getAttribute("data-operation-ref");
 await capture(page,"enterprise-upgrade-processing");
 await page.getByTestId("pricing-upgrade-retry-studio").click();
 await expect(page.getByTestId("pricing-upgrade-operation-studio")).toHaveAttribute("data-operation-ref",reference!);
 await page.getByTestId("pricing-upgrade-outcome-succeeded").click();
 await page.getByTestId("pricing-upgrade-retry-studio").click();
 await expect(page.getByTestId("pricing-admin-plan-studio")).toHaveText("Enterprise");
 await expect(page.getByTestId("pricing-admin-row-studio")).toContainText("64,000");
 await page.getByTestId("pricing-upgrade-outcome-needs_review").click();
 await page.getByTestId("pricing-upgrade-product").click();await page.getByTestId("pricing-admin-confirm").click();
 await expect(page.getByTestId("pricing-admin-plan-product")).toHaveText("Team");
 await expect(page.getByTestId("pricing-upgrade-operation-product")).toContainText("联系平台");
 await capture(page,"enterprise-upgrade-needs-review");
});
