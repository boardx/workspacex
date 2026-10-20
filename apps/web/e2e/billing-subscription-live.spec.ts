/** Production /billing UI with controlled HTTP fixtures. No merchant/payment settlement claim. */
import { expect, test } from "@playwright/test";

test("configured Stripe checkout, return confirmation, Portal and uncertain status", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  expect(new URL(baseURL!).hostname).toBe("localhost");
  let status = "none", failRead = false, upgrades = 0, management = 0;
  await page.addInitScript(() => {
    localStorage.setItem("wsx.sessionToken", "billing-browser-session");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId: "billing-browser-user", orgs: ["billing-browser-org"], currentOrgId: "billing-browser-org", expiresAt: "2099-01-01T00:00:00Z" }));
  });
  await page.route(`${baseURL}/**`, async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace(/^\/api(?=\/)/, "");
    if (path === "/identity/me") return route.fulfill({ json: { org: { id: "billing-browser-org", name: "计费验证组织", kind: "organization", team: null, modelPolicy: "any", avatarUrl: null }, orgRole: "consultant", teamId: null, projectRole: null, groupId: null, displayName: "计费验证用户", avatarUrl: null } });
    if (path === "/billing/config") return route.fulfill({ json: { enabledProviders: ["stripe"] } });
    if (path === "/billing/wallet") return route.fulfill({ json: { wallet: { ownerType: "user", ownerId: "billing-browser-user", balance: 1250, totalPurchased: 1200, totalGranted: 50, updatedAt: new Date().toISOString() } } });
    if (path === "/billing/subscription") return failRead ? route.fulfill({ status: 503, json: { error: "unavailable" } }) : route.fulfill({ json: { status, planRef: null, currentPeriodEnd: null, cancelAtPeriodEnd: false } });
    if (path === "/billing/subscription/upgrade-link") {
      expect(new URL(req.url()).search).toBe(""); expect(req.postData()).toBeNull(); upgrades++;
      return route.fulfill({ json: { url: "https://checkout.stripe.com/c/pay/browser-evidence" } });
    }
    if (path === "/billing/subscription/management-link") {
      expect(new URL(req.url()).search).toBe(""); management++;
      return route.fulfill({ json: { url: "https://billing.stripe.com/p/session/browser-evidence" } });
    }
    if (["fetch", "xhr"].includes(req.resourceType())) return route.fulfill({ status: 404, json: {} });
    return route.continue();
  });
  // Browser navigation crosses the provider origin, while the destination is controlled locally.
  await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Controlled hosted checkout destination</h1>" }));
  await page.route("https://billing.stripe.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Controlled hosted billing destination</h1>" }));
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/billing");
  await page.getByRole("button", { name: "订阅 Pro", exact: true }).click();
  await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/browser-evidence");
  await page.goto(`${baseURL}/billing?subscription_return=1`);
  await expect(page.getByTestId("billing-subscription-status")).toHaveText("付款结果确认中");
  await expect(page.getByText("Pro 权益已生效")).toHaveCount(0);
  await page.getByRole("button", { name: "继续订阅付款" }).click();
  await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/browser-evidence");
  expect(upgrades).toBe(1);
  status = "active";
  await page.goto(`${baseURL}/billing?subscription_return=1`);
  await expect(page.getByText("Pro 权益已生效")).toBeVisible();
  await page.getByRole("button", { name: "管理订阅", exact: true }).click();
  await expect(page).toHaveURL("https://billing.stripe.com/p/session/browser-evidence"); expect(management).toBe(1);
  status = "past_due";
  await page.goto(`${baseURL}/billing?subscription_return=1`);
  await expect(page.getByRole("button", { name: "处理订阅付款" })).toBeVisible();
  await expect(page.getByRole("button", { name: "订阅 Pro", exact: true })).toHaveCount(0);
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/prototype-audit/billing-stripe-${width}.png`, fullPage: true });
  }
  failRead = true;
  await page.getByRole("button", { name: "刷新订阅状态" }).click();
  await expect(page.getByTestId("err-billing-subscription")).toContainText("无法确认订阅状态");
  await expect(page.getByRole("button", { name: "处理订阅付款" })).toHaveCount(0);
  await expect(page.getByText("Pro 权益已生效")).toHaveCount(0);
  expect(upgrades).toBe(1);
});
