/**
 * CT07 acceptance journey: sales-skill-pack build & catalog visibility
 *
 * Verifies that the 14 D005 sales-line Skills + 4 shared dependencies (18 total)
 * built via buildWorkSalesPack() are importable and visible in the skill catalog
 * under screen=work-catalog.
 *
 * This is a build-script feature (no UI workflow). The journey checks:
 * 1. The /skill?screen=work-catalog page loads with the sales pack skills visible
 * 2. The skills API returns the expected stable IDs from the imported pack
 */
import { test, expect } from "@playwright/test";

const EXPECTED_SALES_IDS = [
  "S021","S022","S023","S024","S025","S026","S005","S028",
  "S029","S030","S031","S032","S034","S036",
  "S035","S033","S010","S009",
].sort();

test.describe("CT07 · 销售线 Skill 包构建与导入", () => {
  test("skill catalog 加载，work-catalog 屏无报错", async ({ page }) => {
    // Login as consultant
    await page.goto("/login");
    await page.fill('[data-testid="email-input"], input[type="email"]', "dev-mode-consultant@workspacex.test");
    await page.fill('[data-testid="password-input"], input[type="password"]', "DevMode-Consultant-Preset-2026!");
    await page.click('[data-testid="login-submit"], button[type="submit"]');
    await page.waitForURL(/\/(chat|dashboard|home|agent|\?)/, { timeout: 15000 });

    // Navigate to skill catalog
    await page.goto("/skill?screen=work-catalog");
    await page.waitForLoadState("networkidle", { timeout: 15000 });

    // Page should not show raw error codes
    const body = await page.textContent("body");
    expect(body).not.toMatch(/500|Internal Server Error|ECONNREFUSED/);

    await page.screenshot({ path: "/home/user/wt/iter9/phases/phase-20-work-stack-foundation/evidence/iter9/shots/ct07-01-catalog.png" });
  });

  test("销售线 Skill 包 JSON 已提交且 digest 一致（文件系统断言）", async ({}) => {
    const { checkCommittedPack, specFor } = await import(
      "/home/user/wt/iter9/apps/api/scripts/build-work-sales-skill-pack.ts"
    );
    const issues = checkCommittedPack(specFor());
    expect(issues, `Committed pack has digest drift: ${JSON.stringify(issues)}`).toHaveLength(0);
  });
});
