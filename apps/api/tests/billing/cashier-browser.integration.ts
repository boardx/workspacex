/** Real Next → BillingModule/PG → signed loopback merchant and callback → real UI reads.
 * Only identity display is a browser fixture; no billing request or response is intercepted.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { billingCredits as billing } from "@repo/contracts";
import { notifyFixture } from "./wechat-notify-fixture";
import { user, org } from "./order-fixture";
import { asOwner } from "../support/db";
let fixture: Awaited<ReturnType<typeof notifyFixture>> | undefined;
let browser: Browser | undefined;
let web: ChildProcess | undefined;
let webClosed: Promise<void> | undefined;
let closed = false;
let spawnError: Error | undefined;
let output = "";
const webRoot = resolve(import.meta.dirname, "../../../web");
const evidence = resolve(webRoot, "../../phases/phase-21-billing-payment/sprints/sprint-06/evidence/actual-glue");
const port = Number(process.env.WORKSPACEX_WEB_PORT);
const origin = `http://127.0.0.1:${port}`;
function outputTail() { return output.slice(-16000); }
async function assertAllocatedPortFree() {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error("Allocated web port is occupied; no existing listener will be reused or killed")));
    probe.listen(port, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve()));
  });
}
async function waitForServer() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (closed) throw new Error(`Owned Next exited before readiness: ${outputTail()}`);
    if (!output.replace(/\u001b\[[0-9;]*m/g, "").includes("Ready in")) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
    try { const response = await fetch(`${origin}/billing`, { signal: AbortSignal.timeout(5000) }); if (response.ok && !closed && !spawnError) return; } catch { /* Owned server may still be compiling. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Owned Next readiness timed out: ${outputTail()}`);
}
async function stopWeb() {
  if (!web || !webClosed) return;
  const groupAlive = () => {
    if (!web?.pid) return false;
    try { process.kill(process.platform === "win32" ? web.pid : -web.pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      let snapshot = "unavailable";
      try { snapshot = execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,uid=,stat="], { encoding: "utf8" }).split("\n").filter(line => Number(line.trim().split(/\s+/)[2]) === web?.pid).join("\n"); } catch { /* Preserve the original permission failure. */ }
      throw new Error(`Owned Next group probe failed: pid=${web.pid} closed=${closed} exitCode=${web.exitCode} code=${(error as NodeJS.ErrnoException).code} members=${snapshot || "none"}`, { cause: error });
    }
  };
  const signal = (name: NodeJS.Signals) => { try { if (process.platform === "win32") web?.kill(name); else if (web?.pid) process.kill(-web.pid, name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } };
  const wait = async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { if (!groupAlive() && closed) { await webClosed; return true; } await new Promise(resolve => setTimeout(resolve, 50)); }
    return !groupAlive() && closed;
  };
  // A closed leader is insufficient: Next may still have owned workers in its group.
  if (groupAlive()) signal("SIGTERM");
  if (!await wait()) { if (groupAlive()) signal("SIGKILL"); if (!await wait()) throw new Error(`Owned Next process group did not stop: ${outputTail()}`); }
  await webClosed;
}
beforeAll(async () => {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Run through the standard test isolation wrapper with WORKSPACEX_WEB_PORT");
  mkdirSync(evidence, { recursive: true }); await assertAllocatedPortFree();
  fixture = await notifyFixture(); await fixture.reset();
  const require = createRequire(resolve(webRoot, "package.json"));
  const env: NodeJS.ProcessEnv = { ...process.env, NEXT_DIST_DIR: ".next-billing-cashier-glue", NEXT_PUBLIC_API_URL: "/__fullstack_api", FULLSTACK_E2E_API_ORIGIN: fixture.base };
  // The web test process never needs payment credentials, including any host configuration.
  for (const key of Object.keys(env)) if (/^(WECHAT_PAY_|STRIPE_)/.test(key)) delete env[key];
  web = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "-p", String(port)], { cwd: webRoot, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  const capture = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-1000000); };
  web.stdout?.on("data", capture); web.stderr?.on("data", capture);
  webClosed = new Promise<void>(resolve => { web!.once("close", () => { closed = true; resolve(); }); web!.once("error", error => { spawnError = error; closed = true; resolve(); }); });
  await waitForServer(); browser = await chromium.launch({ headless: true });
}, 120000);
afterAll(async () => {
  try { if (browser) for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: resolve(evidence, "actual-final.png"), fullPage: true }).catch(() => undefined); await browser?.close(); } finally { try { await stopWeb(); } finally { await fixture?.close(); mkdirSync(evidence, { recursive: true }); writeFileSync(resolve(evidence, "next.log"), outputTail()); } }
}, 120000);
it("creates through the real UI, credits through a verified callback and never double credits", async () => {
  const f = fixture!; const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(({ userId, orgId }) => {
    localStorage.setItem("wsx.sessionToken", "f04-user");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId, orgs: [orgId], currentOrgId: orgId, expiresAt: "2099-01-01T00:00:00Z" }));
  }, { userId: user, orgId: org });
  await page.route(url => url.origin === origin && url.pathname === "/__fullstack_api/identity/me", route => route.fulfill({ json: { org: { id: org, name: "Isolated billing acceptance", kind: "organization", team: null, modelPolicy: "any", avatarUrl: null }, orgRole: "admin", teamId: null, projectRole: null, groupId: null, displayName: "Isolated payer", avatarUrl: null } }));
  await page.goto(`${origin}/billing`);
  await page.getByRole("button", { name: "购买额度", exact: true }).click();
  await page.locator('input[type="radio"][value="f04-order-basic"]').check();
  const created = page.waitForResponse(response => new URL(response.url()).pathname === "/__fullstack_api/billing/orders" && response.request().method() === "POST");
  await page.getByTestId("billing-generate-qr").click();
  const response = await created; expect(response.status()).toBe(201);
  const { order } = billing.operations.createPaymentOrder.out.parse(await response.json());
  expect(order.ownerId).toBe(user); expect(order.status).toBe("PENDING");
  await expect.poll(() => page.getByTestId("billing-qr-code-area").count()).toBe(1);
  await expect.poll(() => page.locator('[data-testid="billing-qr-code-area"] canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0; for (let index = 0; index < data.length; index += 4) if (data[index]! < 80 && data[index + 3]! > 0) dark++;
    return dark;
  })).toBeGreaterThan(100);
  await expect.poll(() => page.getByTestId("billing-order-no").textContent()).toContain(order.orderNo);
  expect(f.state.calls).toBe(1); expect(f.state.signedRequests).toBe(1);
  await page.screenshot({ path: resolve(evidence, "actual-pending.png"), fullPage: true });
  const notice = f.notice(order.orderNo);
  const callbackStatus = (await f.post(notice.body, notice.headers)).status; expect(callbackStatus).toBe(200);
  await expect.poll(() => page.getByTestId("billing-success-badge").count(), { timeout: 15000 }).toBe(1);
  await expect.poll(() => page.getByTestId("billing-updated-balance").textContent()).toContain("1320");
  await expect.poll(() => page.getByTestId("billing-ledger-table").locator("tbody tr").count()).toBe(2);
  const accounting = () => asOwner(async c => ({
    wallet: (await c.query("SELECT balance,total_purchased FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [user])).rows,
    ledger: (await c.query("SELECT type,credits,balance_after FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1) ORDER BY credits DESC", [user])).rows,
  }));
  const before = await accounting(); expect(before.wallet).toHaveLength(1); expect(Number(before.wallet[0]!.balance)).toBe(1320); expect(before.wallet[0]).toEqual({ balance: 1320, total_purchased: 1200 }); expect(before.ledger).toEqual([{ type: "purchase", credits: 1200, balance_after: 1200 }, { type: "bonus", credits: 120, balance_after: 1320 }]);
  const duplicateCallbackStatus = (await f.post(notice.body, notice.headers)).status; expect(duplicateCallbackStatus).toBe(200); expect(await accounting()).toEqual(before);
  await page.getByTestId("billing-refresh-status").click();
  await expect.poll(() => page.getByTestId("billing-updated-balance").textContent()).toContain("1320");
  await page.screenshot({ path: resolve(evidence, "actual-success.png"), fullPage: true });
  writeFileSync(resolve(evidence, "receipt.json"), JSON.stringify({ merchant: "independent RSA loopback", identity: "isolated HTTP principal fixture", billingHttpIntercepted: false, database: "real isolated PostgreSQL", orderNo: order.orderNo, nativeRequests: f.state.calls, signedNativeRequests: f.state.signedRequests, callbackStatus, duplicateCallbackStatus, balance: 1320, ledgerRows: 2, productionMerchantAccepted: false }, null, 2));
}, 120000);
