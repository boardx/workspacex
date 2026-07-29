import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = "/Users/shenyanbin/Documents/workspacex/phases/phase-01-run-a-project/ui-preview/agent-runtime";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3400/preview/agent-runtime";

// 屏 → UC → 要抓的 (状态/视角) 组合
const SHOTS = [
  // permission (UC-4.1 / UC-21.1)
  ["uc-4-1-permission-default",   { screen: "permission", as: "maintainer", state: "default" }],
  ["uc-4-1-permission-cosign",    { screen: "permission", as: "admin", state: "default" }],
  ["uc-4-1-permission-loading",   { screen: "permission", as: "maintainer", state: "loading" }],
  ["uc-4-1-permission-empty",     { screen: "permission", as: "maintainer", state: "empty" }],
  ["uc-4-1-permission-invalid",   { screen: "permission", as: "maintainer", state: "invalid" }],
  ["uc-4-1-permission-dep-failed",{ screen: "permission", as: "maintainer", state: "dep-failed" }],
  ["uc-4-1-permission-denied",    { screen: "permission", as: "facilitator", state: "denied" }],
  ["uc-4-1-permission-success",   { screen: "permission", as: "admin", state: "success" }],
  // mcp-policy (UC-21.2)
  ["uc-21-2-mcp-policy-default",  { screen: "mcp-policy", as: "admin", state: "default" }],
  ["uc-21-2-mcp-policy-denied",   { screen: "mcp-policy", as: "maintainer", state: "denied" }],
  ["uc-21-2-mcp-policy-invalid",  { screen: "mcp-policy", as: "securityReviewer", state: "invalid" }],
  ["uc-21-2-mcp-policy-empty",    { screen: "mcp-policy", as: "admin", state: "empty" }],
  // routing (UC-20.3)
  ["uc-20-3-routing-default",     { screen: "routing", as: "facilitator", state: "default" }],
  ["uc-20-3-routing-denied",      { screen: "routing", as: "observer", state: "denied" }],
  ["uc-20-3-routing-invalid",     { screen: "routing", as: "facilitator", state: "invalid" }],
  ["uc-20-3-routing-dep-failed",  { screen: "routing", as: "facilitator", state: "dep-failed" }],
  ["uc-20-3-routing-success",     { screen: "routing", as: "facilitator", state: "success" }],
  // team (UC-4.2)
  ["uc-4-2-team-default",         { screen: "team", as: "facilitator", state: "default" }],
  ["uc-4-2-team-member",          { screen: "team", as: "member", state: "default" }],
  ["uc-4-2-team-observer",        { screen: "team", as: "observer", state: "default" }],
  ["uc-4-2-team-loading",         { screen: "team", as: "facilitator", state: "loading" }],
  ["uc-4-2-team-empty",           { screen: "team", as: "facilitator", state: "empty" }],
  ["uc-4-2-team-invalid",         { screen: "team", as: "facilitator", state: "invalid" }],
  ["uc-4-2-team-dep-failed",      { screen: "team", as: "facilitator", state: "dep-failed" }],
  ["uc-4-2-team-success",         { screen: "team", as: "facilitator", state: "success" }],
  // chat (UC-4.3)
  ["uc-4-3-chat-default",         { screen: "chat", as: "facilitator", state: "default" }],
  ["uc-4-3-chat-denied",          { screen: "chat", as: "observer", state: "default" }],
  ["uc-4-3-chat-member",          { screen: "chat", as: "member", state: "default" }],
  ["uc-4-3-chat-loading",         { screen: "chat", as: "facilitator", state: "loading" }],
  ["uc-4-3-chat-empty",           { screen: "chat", as: "facilitator", state: "empty" }],
  ["uc-4-3-chat-invalid",         { screen: "chat", as: "facilitator", state: "invalid" }],
  ["uc-4-3-chat-dep-failed",      { screen: "chat", as: "facilitator", state: "dep-failed" }],
  ["uc-4-3-chat-success",         { screen: "chat", as: "facilitator", state: "success" }],
  // audit (UC-4.4)
  ["uc-4-4-audit-default",        { screen: "audit", as: "admin", state: "default" }],
  ["uc-4-4-audit-facilitator",    { screen: "audit", as: "facilitator", state: "default" }],
  ["uc-4-4-audit-denied",         { screen: "audit", as: "groupLead", state: "denied" }],
  ["uc-4-4-audit-loading",        { screen: "audit", as: "admin", state: "loading" }],
  ["uc-4-4-audit-empty",          { screen: "audit", as: "admin", state: "empty" }],
  ["uc-4-4-audit-invalid",        { screen: "audit", as: "admin", state: "invalid" }],
  ["uc-4-4-audit-success",        { screen: "audit", as: "admin", state: "success" }],
];

// 需要点开叠层再抓的补充屏
const OVERLAYS = [
  ["uc-4-1-permission-tool-whitelist-cosign", { screen: "permission", as: "admin", state: "default" }, "[data-testid='perm-cosign-action']", "[data-testid='perm-sign-dialog']"],
  ["uc-21-2-mcp-review-panel", { screen: "mcp-policy", as: "securityReviewer", state: "default" }, "[data-testid='mcp-review-open']", "[data-testid='mcp-review-dialog']"],
  ["uc-20-3-routing-nolocal-fail", { screen: "routing", as: "facilitator", state: "default" }, "[data-testid='routing-nolocal-toggle']", "[data-testid='routing-fail']"],
  ["uc-20-3-routing-change-confidential", { screen: "routing", as: "facilitator", state: "default" }, "[data-testid='routing-change-model']", "[data-testid='routing-change-dialog']"],
  ["uc-20-3-routing-explain", { screen: "routing", as: "facilitator", state: "default" }, "[data-testid='routing-confidential-explain']", "[data-testid='routing-explain-dialog']"],
  ["uc-4-3-chat-transfer-provenance", { screen: "chat", as: "facilitator", state: "default" }, "[data-testid='chat-transfer-cm-2']", "[data-testid='chat-transfer-dialog']"],
  ["uc-4-4-audit-drill-toolcalls", { screen: "audit", as: "admin", state: "default" }, "[data-testid='audit-drill-au-1']", "[data-testid='audit-drill-dialog']"],
  ["uc-4-4-audit-chain", { screen: "audit", as: "admin", state: "default" }, "[data-testid='audit-chain-a-crm-breach']", "[data-testid='audit-chain-dialog']"],
];

const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });

async function grab(name, q, { click, waitFor } = {}) {
  const page = await ctx.newPage();
  const consoleErrs = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrs.push(m.text()); });
  page.on("pageerror", (e) => consoleErrs.push("pageerror: " + e.message));
  const url = `${BASE}?${new URLSearchParams(q)}`;
  await page.goto(url, { waitUntil: "networkidle" });
  if (click) { await page.click(click); await page.waitForSelector(waitFor, { timeout: 5000 }); }
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const real = consoleErrs.filter((e) => !/fonts\.g|Google Font|net::ERR|Failed to load resource.*font|manifest|favicon/i.test(e));
  if (real.length) errors.push([name, real]);
  await page.close();
}

for (const [name, q] of SHOTS) await grab(name, q);
for (const [name, q, click, waitFor] of OVERLAYS) {
  try { await grab(name, q, { click, waitFor }); }
  catch (e) { errors.push([name, ["OVERLAY FAIL: " + e.message]]); }
}

await browser.close();
console.log("SHOTS:", SHOTS.length + OVERLAYS.length);
if (errors.length) { console.log("CONSOLE/OVERLAY ERRORS:"); for (const [n, e] of errors) console.log(" -", n, e.join(" | ").slice(0, 300)); }
else console.log("NO console/overlay errors");
