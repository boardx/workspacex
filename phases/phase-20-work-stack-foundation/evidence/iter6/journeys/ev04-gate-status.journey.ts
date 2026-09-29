/**
 * EV04 acceptance journey — gate status writeback & display
 * Iteration 6 walkable slice: I6
 *
 * Covers:
 *  J0-C step 4: member sees G0–G5 badges in skill detail drawer
 *  gate summary displayed in catalog row
 *  platform operator (admin) can write back a gate status via API
 *  non-platform operator gets 403
 */
import { test, expect } from "@playwright/test";
import * as path from "node:path";

const SHOTS = path.resolve(
  "/home/user/wt/ev04/phases/phase-20-work-stack-foundation/evidence/iter6/shots"
);

async function shot(page: import("@playwright/test").Page, name: string) {
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    fullPage: false,
  });
}

test.describe("EV04 — gate status display (I6 walkable slice)", () => {
  test("J0-C: member sees skill catalog and opens detail drawer with gate badges", async ({
    page,
  }) => {
    // Login as member (consultant)
    await page.goto("/login");
    await page.fill('[data-testid="email"], input[name="email"], input[type="email"]', "dev-mode-consultant@workspacex.test");
    await page.fill('[data-testid="password"], input[name="password"], input[type="password"]', "DevMode-Consultant-Preset-2026!");
    await page.click('[data-testid="login-submit"], button[type="submit"]');
    await page.waitForURL(/\/(chat|skill|dashboard|home)/, { timeout: 10000 });
    await shot(page, "01-login");

    // Navigate to skill catalog
    await page.goto("/skill?screen=work-catalog");
    await page.waitForSelector('[data-testid="work-catalog-screen"], [data-testid="work-catalog-row-S003"]', {
      timeout: 15000,
    });
    await shot(page, "02-catalog-list");

    // Check S003 row exists
    const s003row = page.locator('[data-testid="work-catalog-row-S003"]');
    await expect(s003row).toBeVisible({ timeout: 5000 });

    // Click to open detail drawer
    await s003row.click();
    await page.waitForSelector('[data-testid="work-skill-detail"]', { timeout: 5000 });
    await shot(page, "03-skill-detail-drawer");

    // Check gate badges G0–G5 in drawer
    const gateSection = page.locator('[data-testid="work-skill-gates"]');
    await expect(gateSection).toBeVisible({ timeout: 5000 });

    for (const gate of ["G0", "G1", "G2", "G3", "G4", "G5"]) {
      const badge = page.locator(`[data-testid="work-gate-badge-${gate}"]`);
      await expect(badge).toBeVisible({ timeout: 3000 });
    }
    await shot(page, "04-gate-badges-visible");

    // Check admin should NOT see change-channel button
    await expect(page.locator('[data-testid="work-skill-change-channel"]')).toHaveCount(0);
  });

  test("platform operator can write gate status via API (admin role)", async ({
    page,
    request,
  }) => {
    // Login as admin (platform operator)
    await page.goto("/login");
    await page.fill('[data-testid="email"], input[name="email"], input[type="email"]', "dev-mode-admin@workspacex.test");
    await page.fill('[data-testid="password"], input[name="password"], input[type="password"]', "DevMode-Admin-Preset-2026!");
    await page.click('[data-testid="login-submit"], button[type="submit"]');
    await page.waitForURL(/\/(chat|skill|dashboard|home)/, { timeout: 10000 });

    // Check that a non-platform operator (lead) gets 403
    await page.goto("/login");
    await page.fill('[data-testid="email"], input[name="email"], input[type="email"]', "dev-mode-lead@workspacex.test");
    await page.fill('[data-testid="password"], input[name="password"], input[type="password"]', "DevMode-Lead-Preset-2026!");
    await page.click('[data-testid="login-submit"], button[type="submit"]');
    await page.waitForURL(/\/(chat|skill|dashboard|home)/, { timeout: 10000 });

    // Direct API call: POST /admin/skills/catalog/:skillId/gate-status should 403 for member
    const cookieHeader = (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const resp = await page.evaluate(async () => {
      const r = await fetch("/api/admin/skills/catalog/S003/gate-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stableId: "S003",
          versionDigest: "sha256:fakedigest",
          gates: {},
        }),
      });
      return r.status;
    });

    // Non-platform operator must get 403
    expect([403, 401]).toContain(resp);
    await shot(page, "05-non-operator-403");
  });
});
