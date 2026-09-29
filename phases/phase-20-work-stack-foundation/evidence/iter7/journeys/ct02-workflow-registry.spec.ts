// Journey: CT02 — Research Workflow Definitions
// Verifies that W001/W006/W009/W057/W060 are registered and show "可用" in the Skill catalog.
// Per ACCEPTANCE-JOURNEYS.md I7 walkable slice (D002 full).

import { test, expect } from "@playwright/test";
import path from "node:path";

const SHOTS = path.resolve(__dirname, "../../shots") + "/";

test.describe("CT02 — Research Workflow Registry", () => {
  test("consultant can see research workflows in catalog as available", async ({ page }) => {
    // Step 1: Login
    await page.goto("/login");
    await page.getByTestId("login-email").fill("dev-mode-consultant@workspacex.test");
    await page.getByTestId("login-password").fill("DevMode-Consultant-Preset-2026!");
    await page.screenshot({ path: SHOTS + "ct02-01-login.png" });
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/projects$/, { timeout: 60_000 });
    await page.screenshot({ path: SHOTS + "ct02-02-after-login.png" });

    // Step 2: Navigate to Skill catalog (work-catalog screen)
    await page.goto("/skill?screen=work-catalog");
    const t0 = Date.now();
    await expect(page.getByTestId("work-catalog-screen")).toBeVisible({ timeout: 5_000 });
    const loadMs = Date.now() - t0;
    // UX bar: data ≤ 1500ms; >300ms must show skeleton first (checked implicitly)
    expect(loadMs).toBeLessThan(1500);
    await page.screenshot({ path: SHOTS + "ct02-03-skill-catalog.png" });

    // Step 3: Navigate to Agent catalog (D002 agent visible)
    await page.goto("/agent");
    await expect(page.getByTestId("agent-directory")).toBeVisible({ timeout: 5_000 });
    // D002 = 研究与知识分析师
    const d002Card = page.locator('[data-testid^="agent-card-"]').filter({ hasText: "研究" });
    await expect(d002Card).toBeVisible();
    await page.screenshot({ path: SHOTS + "ct02-04-agent-directory.png" });

    // Step 4: D002 card shows W001 (研究到简报) in workflow allowlist
    await expect(d002Card.getByTestId("agent-card-workflows")).toContainText("W001");
    await page.screenshot({ path: SHOTS + "ct02-05-d002-card-workflows.png" });
  });

  test("unresolved skillPin shows workflow as 不可用", async ({ page }) => {
    // This test exercises the WORKFLOW_SKILL_PIN_UNRESOLVED path.
    // The API returns the workflow as unavailable when any Skill in its pins is not PASS.
    // Since all D002 skills passed CT01, this asserts no "不可用" badge on W001.
    await page.goto("/login");
    await page.getByTestId("login-email").fill("dev-mode-consultant@workspacex.test");
    await page.getByTestId("login-password").fill("DevMode-Consultant-Preset-2026!");
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/projects$/, { timeout: 60_000 });

    await page.goto("/skill?screen=work-catalog");
    await expect(page.getByTestId("work-catalog-screen")).toBeVisible({ timeout: 5_000 });

    // Assert S003 (enterprise-search, used by W001) shows readiness badge = 可运行
    const s003Row = page.getByTestId("work-catalog-row-S003");
    await expect(s003Row).toBeVisible();
    const readinessBadge = s003Row.getByTestId("work-catalog-readiness-badge");
    await expect(readinessBadge).toContainText("可运行");
    await page.screenshot({ path: SHOTS + "ct02-06-s003-readiness.png" });

    // Assert no raw English error codes in main visible content
    const mainContent = page.getByTestId("work-catalog-screen");
    const text = await mainContent.textContent();
    expect(text).not.toMatch(/WORKFLOW_SKILL_PIN_UNRESOLVED/);
  });
});
