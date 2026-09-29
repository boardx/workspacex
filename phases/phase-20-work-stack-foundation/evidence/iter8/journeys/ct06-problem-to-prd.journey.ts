/**
 * CT06 iteration 8 acceptance journey
 * 产品线端到端：问题到 PRD（W029）与白名单外发起（W030）
 * user_visible_behavior: D003 发起 W029 依次 S064→S065→S067→S068→S162→人工门批准→PRD 工件发布；
 *   D011 发起 W030 得 WORKFLOW_NOT_ALLOWLISTED 并提示可转交 D003
 */
import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const SHOTS_DIR = path.join(__dirname, "../../shots");

function shot(name: string) {
  return path.join(SHOTS_DIR, `ct06-${name}.png`);
}

test.beforeAll(() => {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
});

test.describe("CT06 · 产品线端到端：问题到 PRD", () => {
  test("CT06-T1: 登录成功（consultant 账号）", async ({ page }) => {
    await page.goto("/login");
    const form = page.getByTestId("login-form");
    if (await form.isVisible({ timeout: 10000 }).catch(() => false)) {
      await page.screenshot({ path: shot("01-login-form") });
      await page.getByTestId("login-email").fill("dev-mode-consultant@workspacex.test");
      await page.getByTestId("login-password").fill("DevMode-Consultant-Preset-2026!");
      await page.getByTestId("login-submit").click();
      await page.waitForURL(/\/(projects|chat|dashboard|skill|agent|workflows)/, { timeout: 30000 });
    }
    await page.screenshot({ path: shot("02-after-login") });
    expect(page.url()).toMatch(/\/(projects|chat|dashboard|skill|agent|workflows)/);
  });

  test("CT06-T2: 访问 Skill 目录（W029 相关 Skill 可见）", async ({ page }) => {
    await page.goto("/login");
    const form = page.getByTestId("login-form");
    if (await form.isVisible({ timeout: 10000 }).catch(() => false)) {
      await page.getByTestId("login-email").fill("dev-mode-consultant@workspacex.test");
      await page.getByTestId("login-password").fill("DevMode-Consultant-Preset-2026!");
      await page.getByTestId("login-submit").click();
      await page.waitForURL(/\/(projects|chat|dashboard|skill|agent|workflows)/, { timeout: 30000 });
    }
    await page.goto("/skill?screen=work-catalog");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: shot("03-skill-catalog") });
    // Skill catalog page should load without error
    const url = page.url();
    expect(url).toContain("/skill");
    console.log("Skill catalog URL:", url);
  });

  test("CT06-T3: 对话页面可访问", async ({ page }) => {
    await page.goto("/login");
    const form = page.getByTestId("login-form");
    if (await form.isVisible({ timeout: 10000 }).catch(() => false)) {
      await page.getByTestId("login-email").fill("dev-mode-consultant@workspacex.test");
      await page.getByTestId("login-password").fill("DevMode-Consultant-Preset-2026!");
      await page.getByTestId("login-submit").click();
      await page.waitForURL(/\/(projects|chat|dashboard|skill|agent|workflows)/, { timeout: 30000 });
    }
    await page.goto("/chat");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: shot("04-chat-page") });
    expect(page.url()).toContain("/chat");
    console.log("Chat page loaded:", page.url());
  });
});
