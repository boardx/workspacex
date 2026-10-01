/**
 * AG06 — escalate interrupt kind acceptance journey (iter6)
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";

const API = process.env.WEB_API_URL ?? "http://127.0.0.1:24100";
const WEB = process.env.BASE_URL ?? "http://127.0.0.1:25100";
const SHOTS = "/home/user/wt/ag06/phases/phase-20-work-stack-foundation/evidence/iter6/shots";

test.beforeAll(() => { fs.mkdirSync(SHOTS, { recursive: true }); });

test("AG06-01: login as dev-mode-lead", async ({ page }) => {
  await page.goto(`${WEB}/login`);
  await page.screenshot({ path: `${SHOTS}/ag06-01-login-page.png` });

  await page.getByRole("textbox", { name: "工作邮箱" }).fill("dev-mode-lead@workspacex.test");
  await page.getByRole("textbox", { name: "密码" }).fill("DevMode-Lead-Preset-2026!");
  await page.screenshot({ path: `${SHOTS}/ag06-02-login-filled.png` });
  await page.getByRole("button", { name: "登录" }).click();

  // login can redirect to projects, chat, or other app routes
  await page.waitForURL(/\/(chat|dashboard|home|agent|skill|workflows|projects|research)/, { timeout: 30000 });
  await page.screenshot({ path: `${SHOTS}/ag06-03-post-login.png` });
  expect(page.url()).toContain("127.0.0.1:25100");
});

test("AG06-02: API healthz check", async ({ request }) => {
  const r = await request.get(`${API}/healthz`);
  expect(r.status()).toBe(200);
});

test("AG06-03: J3c UI slice not yet walkable (documented gap)", async () => {
  // interrupt-card-escalate requires I8 CT content features
  // ACCEPTANCE-JOURNEYS.md: "J3c完全 = I5(AG06) + I8内容"
  console.log("J3c UI: NOT YET WALKABLE — requires CT04-CT06 (I8)");
  expect(true).toBe(true);
});
