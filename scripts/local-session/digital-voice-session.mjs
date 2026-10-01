#!/usr/bin/env node
/**
 * Local browser/API/PGlite acceptance. The audio supplier must be an explicit
 * loopback simulator; Chromium supplies the fake microphone.
 *
 * node --import tsx scripts/local-session/digital-voice-session.mjs \
 *   --data-dir <fresh-local-data-dir> [--base http://127.0.0.1:14310] [--out <dir>]
 *
 * Requires a fresh organization with seven pending official roles. Credentials
 * are read from the local data directory and never included in evidence.
 */
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_ADMIN_EMAIL } from "../../packages/local-runtime/src/config.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
};
const dataDir = arg("data-dir");
if (!dataDir) throw new Error("--data-dir is required");
const base = new URL(arg("base", "http://127.0.0.1:14310"));
if (!["http:", "https:"].includes(base.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ||
    base.username || base.password) {
  throw new Error("--base must use a loopback host without URL credentials");
}
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const out = resolve(arg("out", join(root, "evidence", `digital-voice-${date}`)));
mkdirSync(out, { recursive: true });
const secrets = JSON.parse(readFileSync(join(resolve(dataDir), "secrets.json"), "utf8"));
if (typeof secrets.adminPassword !== "string") throw new Error("Local admin password is missing");
const command = `node --import tsx scripts/local-session/digital-voice-session.mjs --data-dir ${JSON.stringify(resolve(dataDir))} --base ${JSON.stringify(base.origin)} --out ${JSON.stringify(out)}`;
const supplier = "explicit loopback simulator; fake microphone; real browser/API/PGlite";
const { chromium } = createRequire(join(root, "apps/web/package.json"))("playwright-core");
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 }, permissions: ["microphone"], locale: "zh-CN",
});
const page = await context.newPage();
page.setDefaultTimeout(60_000);
// Refuse remote redirects before any login form can receive local credentials.
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (["http:", "https:"].includes(url.protocol) &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    await route.abort();
  } else {
    await route.continue();
  }
});
const results = [];
const step = async (name, action) => {
  await action();
  results.push({ name, passed: true });
  await page.screenshot({ path: join(out, `${results.length}.png`) });
  console.log("PASS", name);
};

try {
  await step("real local login", async () => {
    await page.goto(new URL("/login", base).href);
    await page.getByTestId("login-email").fill(LOCAL_ADMIN_EMAIL);
    await page.getByTestId("login-password").fill(secrets.adminPassword);
    await page.getByTestId("login-submit").click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  });
  await step("pending seven official roles", async () => {
    await page.goto(new URL("/chat", base).href);
    await page.getByTestId("chat-task-workbench-capability-picker").click();
    const enable = page.getByTestId("chat-task-workbench-capability-enable-official");
    await enable.waitFor();
    const text = await enable.innerText();
    if (!text.includes("7")) throw new Error(`expected pending 7: ${text}`);
  });
  await step("enable roles with dependencies", async () => {
    await page.getByTestId("chat-task-workbench-capability-enable-official").click();
    await page.getByTestId("chat-task-workbench-capability-group-dh").waitFor({ timeout: 180_000 });
    await page.getByTestId("chat-task-workbench-capability-group-pending").waitFor({ state: "detached", timeout: 180_000 });
  });
  await step("select design thinking expert", async () => {
    await page.getByTestId("chat-task-workbench-capability-group-dh")
      .getByRole("option").filter({ hasText: "设计思维专家" }).click();
    await page.getByTestId("chat-task-workbench-capability-popover").waitFor({ state: "detached" });
  });
  await step("loopback live voice and captions", async () => {
    await page.getByTestId("chat-composer-realtime-voice").click();
    await page.getByTestId("realtime-voice-caption-assistant").filter({ hasText: "好的" }).waitFor();
    if (await page.getByTestId("realtime-voice-error").count()) throw new Error("voice error visible");
  });
  await step("hang up and refresh persisted turns", async () => {
    await page.getByTestId("realtime-voice-hangup").click();
    await page.getByTestId("realtime-voice-session").waitFor({ state: "detached" });
    const messages = page.getByTestId("copilotkit-v2-messages");
    // Dialog teardown precedes asynchronous stop/persistence and URL resolution.
    // Wait for the resolved thread and its actual message body before refreshing.
    await messages.getByText("我是设计思维专家", { exact: false }).first().waitFor();
    await page.waitForURL((url) => /^\/chat\/[^/]+$/.test(url.pathname) || Boolean(url.searchParams.get("thread")));
    await page.reload();
    await messages.getByText("（模拟语音）你好，我想了解一下产品方案", { exact: false }).first().waitFor();
    await messages.getByText("我是设计思维专家", { exact: false }).first().waitFor();
  });
} catch (error) {
  const detail = String(error.message);
  results.push({ name: "failure", passed: false, detail });
  await page.screenshot({ path: join(out, "failure.png") });
  console.error(detail);
  process.exitCode = 1;
} finally {
  writeFileSync(join(out, "results.json"), `${JSON.stringify({ date, command, supplier, results }, null, 2)}\n`);
  writeFileSync(join(out, "report.md"), [
    "# 本地数字人与语音验证", "", `日期：${date}（Asia/Shanghai）`, "",
    `命令：\`${command}\``, "",
    "真实 Chromium、API、PGlite、登录与持久化；语音供应商为显式 loopback 模拟，麦克风为 Chromium 假设备。未验证真实供应商通话质量。", "",
    ...results.map((result) => `- ${result.passed ? "PASS" : "FAIL"} ${result.name}${result.detail ? `：${result.detail}` : ""}`), "",
  ].join("\n"));
  await browser.close();
}
