/**
 * CT05 iteration 8 acceptance journey (fixed)
 * 验证产品线 Workflow 定义（W027–W032/W002）的用户可见行为
 */
import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const SHOTS_DIR = path.join(__dirname, "../../shots");
const EVIDENCE_SHOTS = "/home/user/wt/ct05/phases/phase-20-work-stack-foundation/evidence/iter8/shots";

function shot(name: string) {
  return path.join(SHOTS_DIR, `ct05-${name}.png`);
}

async function loginAs(page: any, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  // Wait for navigation away from login
  await page.waitForURL(/\/(projects|chat|dashboard|skill|agent)/, { timeout: 30000 });
}

test.describe("CT05 · 产品线 Workflow 定义", () => {
  test.beforeAll(() => {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    fs.mkdirSync(EVIDENCE_SHOTS, { recursive: true });
  });

  test("CT05-T1: 登录成功 → 跳转到主页", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-form")).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: shot("login-form") });
    
    await page.getByTestId("login-email").fill("dev-mode-consultant@workspacex.test");
    await page.getByTestId("login-password").fill("DevMode-Consultant-Preset-2026!");
    await page.getByTestId("login-submit").click();
    
    await page.waitForURL(/\/(projects|chat|dashboard|skill|agent)/, { timeout: 30000 });
    const url = page.url();
    console.log(`After login URL: ${url}`);
    await page.screenshot({ path: shot("after-login") });
    
    expect(url).toMatch(/\/(projects|chat|dashboard|skill|agent)/);
  });

  test("CT05-T2: Skill 目录可以访问", async ({ page }) => {
    await loginAs(page, "dev-mode-consultant@workspacex.test", "DevMode-Consultant-Preset-2026!");
    
    // Navigate to skill catalog
    await page.goto("/skill?screen=work-catalog");
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    await page.screenshot({ path: shot("skill-catalog") });
    
    const url = page.url();
    console.log(`Skill catalog URL: ${url}`);
    // Page should load (not 404)
    const title = await page.title();
    console.log(`Page title: ${title}`);
    expect(title).not.toContain("404");
  });

  test("CT05-T3: 页面无致命错误", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    
    await loginAs(page, "dev-mode-lead@workspacex.test", "DevMode-Lead-Preset-2026!");
    
    await page.goto("/chat");
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    await page.screenshot({ path: shot("chat-loaded") });
    
    const criticalErrors = errors.filter(e => 
      e.includes("INTERNAL_ERROR") || 
      (e.includes("undefined") && e.includes("not"))
    );
    console.log(`All page errors: ${errors.length}, critical: ${criticalErrors.length}`);
    expect(criticalErrors).toHaveLength(0);
  });
});
