/** Real Next → BillingModule/PG → signed loopback merchant and callback → real UI reads.
 * Only identity display is a browser fixture; no billing request or response is intercepted.
 */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { billingCredits as billing } from "@repo/contracts";
import { notifyFixture } from "./wechat-notify-fixture";
import { user, org } from "./order-fixture";
import { asOwner } from "../support/db";
import { BILLING_ORDER_EXPIRY_WORKER } from "../../src/application/billing/billing-order-expiry.port";
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
const realNow = Date.now.bind(Date);
type Order = ReturnType<typeof billing.BillingOrder.parse>;

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
      // Darwin can reject kill(0) while the owned leader is a zombie awaiting
      // Node's child reaper. This is not a live group and must not be signalled.
      // Completion still requires the captured close event below; permission
      // failures with any other process-table evidence remain fatal.
      const members = snapshot.trim().split("\n").map(line => line.trim().split(/\s+/));
      if (process.platform === "darwin" && (error as NodeJS.ErrnoException).code === "EPERM" && members.length === 1) {
        const member = members[0]!;
        if (member.length === 5 && Number(member[0]) === web.pid && Number(member[2]) === web.pid && Number(member[3]) === process.getuid?.() && member[4]!.startsWith("Z")) return false;
      }
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
async function openCashier(page: Page) {
  await page.addInitScript(({ userId, orgId }) => {
    localStorage.setItem("wsx.sessionToken", "f04-user");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId, orgs: [orgId], currentOrgId: orgId, expiresAt: "2099-01-01T00:00:00Z" }));
  }, { userId: user, orgId: org });
  await page.route(url => url.origin === origin && url.pathname === "/__fullstack_api/identity/me", route => route.fulfill({ json: { org: { id: org, name: "Isolated billing acceptance", kind: "organization", team: null, modelPolicy: "any", avatarUrl: null }, orgRole: "admin", teamId: null, projectRole: null, groupId: null, displayName: "Isolated payer", avatarUrl: null } }));
  await page.goto(`${origin}/billing`);
  await page.getByTestId("rail-profile-menu").click();
  await page.getByTestId("billing-menu-purchase").click();
  await expect.poll(() => page.getByTestId("billing-cashier-dialog").count()).toBe(1);
}
async function createFromUi(page: Page, aged = false): Promise<Order> {
  await page.locator('input[type="radio"][value="f04-order-basic"]').check();
  const before = realNow();
  // Models an old immutable creation snapshot. Only this API/loopback merchant
  // process Date changes; browser/Next/PG clocks and all timers remain real.
  if (aged) { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(before - 16 * 60000); }
  let order: Order;
  try {
    const response = page.waitForResponse(value => new URL(value.url()).pathname === "/__fullstack_api/billing/orders" && value.request().method() === "POST");
    await page.getByTestId("billing-generate-qr").click();
    const created = await response; expect(created.status()).toBe(201);
    order = billing.operations.createPaymentOrder.out.parse(await created.json()).order;
  } finally { if (aged) vi.useRealTimers(); }
  expect(Date.now()).toBeGreaterThanOrEqual(before);
  if (aged) { expect(Date.parse(order.createdAt)).toBe(before - 16 * 60000); expect(Date.parse(order.expiredAt)).toBeLessThan(before); }
  else { expect(Date.parse(order.createdAt)).toBeGreaterThanOrEqual(before); expect(Date.parse(order.expiredAt)).toBeGreaterThan(realNow()); }
  return order;
}
async function closeThroughRealWorker(order: Order) {
  const read = () => asOwner(async c => (await c.query("SELECT status,created_at,expired_at,closed_at,last_error_code FROM billing_orders WHERE order_no=$1", [order.orderNo])).rows[0]);
  const before = await read();
  await fixture!.app.get<{runOnce(): Promise<void>}>(BILLING_ORDER_EXPIRY_WORKER).runOnce();
  const after = await read();
  expect(after).toMatchObject({ status: "CLOSED", last_error_code: null }); expect(after.closed_at).not.toBeNull();
  expect(after.created_at.toISOString()).toBe(order.createdAt); expect(after.expired_at.toISOString()).toBe(order.expiredAt);
  return { beforeStatus: before.status, afterStatus: after.status, closedAt: after.closed_at.toISOString(), worker: "actual DI lifecycle worker; automatic sweep may have won before observation" };
}
async function sourceAccounting(orderNo: string) {
  return asOwner(async c => ({
    order: (await c.query("SELECT status,closed_at,last_error_code FROM billing_orders WHERE order_no=$1", [orderNo])).rows[0],
    receipts: (await c.query("SELECT state,recovery_source_id FROM billing_payment_receipts WHERE order_no=$1 ORDER BY provider_event_id", [orderNo])).rows,
    ledger: (await c.query("SELECT type,credits,balance_after FROM credit_transactions WHERE source_type='payment_order' AND source_id=$1 ORDER BY credits DESC", [orderNo])).rows,
    wallet: (await c.query("SELECT balance,total_purchased FROM credit_wallets WHERE owner_type='user' AND owner_id=$1", [user])).rows,
  }));
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
beforeEach(async () => {
  for (const context of browser!.contexts()) await context.close();
  await fixture!.reset();
});
afterAll(async () => {
  try { if (browser) for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: resolve(evidence, "actual-final.png"), fullPage: true }).catch(() => undefined); await browser?.close(); } finally { try { await stopWeb(); } finally { await fixture?.close(); mkdirSync(evidence, { recursive: true }); writeFileSync(resolve(evidence, "next.log"), outputTail()); } }
}, 120000);
it("creates through the real UI, credits through a verified callback and never double credits", async () => {
  const f = fixture!; const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
  await openCashier(page);
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

it("naturally observes real expiry, regenerates a new order and credits only the replacement", async () => {
  const f = fixture!, page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
  await openCashier(page);
  const expired = await createFromUi(page, true);
  expect(expired.status).toBe("PENDING");
  const closure = await closeThroughRealWorker(expired);
  // No order HTTP interception or manual UI refresh: normal polling must see CLOSED.
  await expect.poll(() => page.getByTestId("billing-regenerate").count(), { timeout: 15000 }).toBe(1);
  expect(await page.getByTestId("billing-qr-code-area").count()).toBe(0);
  await page.screenshot({ path: resolve(evidence, "expiry-closed.png"), fullPage: true });
  await page.getByTestId("billing-regenerate").click();
  const replacement = await createFromUi(page);
  expect(replacement.orderNo).not.toBe(expired.orderNo);
  await expect.poll(() => page.getByTestId("billing-qr-code-area").count()).toBe(1);
  expect(await page.locator('[data-testid="billing-qr-code-area"] canvas').count()).toBe(1);
  expect(f.state.calls).toBe(2); expect(f.state.signedRequests).toBe(2);
  const notice = f.notice(replacement.orderNo);
  const callbackStatus = (await f.post(notice.body, notice.headers)).status; expect(callbackStatus).toBe(200);
  await expect.poll(() => page.getByTestId("billing-success-badge").count(), { timeout: 15000 }).toBe(1);
  await expect.poll(() => page.getByTestId("billing-updated-balance").textContent()).toContain("1320");
  await expect.poll(() => page.getByTestId("billing-ledger-table").locator("tbody tr").count()).toBe(2);
  const old = await sourceAccounting(expired.orderNo), paid = await sourceAccounting(replacement.orderNo);
  expect(old.order).toMatchObject({ status: "CLOSED", last_error_code: null }); expect(old.receipts).toEqual([]); expect(old.ledger).toEqual([]);
  expect(paid.order.status).toBe("SUCCESS"); expect(paid.receipts).toEqual([{ state: "done", recovery_source_id: null }]);
  expect(paid.wallet).toEqual([{ balance: 1320, total_purchased: 1200 }]);
  expect(paid.ledger).toEqual([{ type: "purchase", credits: 1200, balance_after: 1200 }, { type: "bonus", credits: 120, balance_after: 1320 }]);
  const duplicateCallbackStatus = (await f.post(notice.body, notice.headers)).status; expect(duplicateCallbackStatus).toBe(200);
  expect(await sourceAccounting(expired.orderNo)).toEqual(old); expect(await sourceAccounting(replacement.orderNo)).toEqual(paid);
  await page.screenshot({ path: resolve(evidence, "expiry-replacement-success.png"), fullPage: true });
  writeFileSync(resolve(evidence, "expiry-receipt.json"), JSON.stringify({ identity: "isolated principal fixture", merchant: "independent RSA loopback", initialCreationClock: "Date-only16minutes earlier; restored after response body", realTimersAndDatabaseClock: true, billingHttpIntercepted: false, orderTimestampsMutated: false, expiredOrderNo: expired.orderNo, replacementOrderNo: replacement.orderNo, closure, nativeRequests: f.state.calls, signedNativeRequests: f.state.signedRequests, callbackStatus, duplicateCallbackStatus, balance: 1320, creditedSource: replacement.orderNo, expiredSourceLedgerRows: 0, ledgerRows: 2, productionMerchantAccepted: false }, null, 2));
}, 120000);
it("keeps a late paid capacity failure manual and prevents a second payment in the real UI", async () => {
  const f = fixture!;
  await asOwner(c => c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance,total_granted) VALUES('user',$1,2147483640,2147483640)", [user]));
  const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } }); await openCashier(page);
  const order = await createFromUi(page, true), closure = await closeThroughRealWorker(order);
  await expect.poll(() => page.getByTestId("billing-regenerate").count(), { timeout: 15000 }).toBe(1);
  const notice = f.notice(order.orderNo);
  const callbackStatus = (await f.post(notice.body, notice.headers)).status; expect(callbackStatus).toBe(200);
  await page.getByTestId("billing-refresh-status").click();
  await expect.poll(() => page.getByTestId("billing-manual-recovery").textContent()).toContain("勿再次付款");
  expect(await page.getByTestId("billing-order-no").textContent()).toContain(order.orderNo);
  for (const testId of ["billing-regenerate", "billing-generate-qr", "billing-qr-code-area", "billing-success-badge"]) expect(await page.getByTestId(testId).count()).toBe(0);
  const before = await sourceAccounting(order.orderNo);
  expect(before.order).toMatchObject({ status: "CLOSED", last_error_code: "invalid_amount" }); expect(before.order.closed_at).not.toBeNull();
  expect(before.receipts).toEqual([{ state: "failed", recovery_source_id: `payment-recovery:${order.orderNo}` }]); expect(before.ledger).toEqual([]);
  expect(before.wallet).toEqual([{ balance: 2147483640, total_purchased: 0 }]);
  const duplicateCallbackStatus = (await f.post(notice.body, notice.headers)).status; expect(duplicateCallbackStatus).toBe(200);
  expect(await sourceAccounting(order.orderNo)).toEqual(before); expect(f.state.calls).toBe(1); expect(f.state.signedRequests).toBe(1);
  await page.screenshot({ path: resolve(evidence, "manual-paid-no-repayment.png"), fullPage: true });
  writeFileSync(resolve(evidence, "manual-paid-receipt.json"), JSON.stringify({ identity: "isolated principal fixture", merchant: "independent RSA loopback", initialCreationClock: "Date-only16minutes earlier; restored", ownedCapacityFixture: 2147483640, billingHttpIntercepted: false, orderTimestampsMutated: false, orderNo: order.orderNo, closure, callbackStatus, duplicateCallbackStatus, status: "CLOSED", lastErrorCode: "invalid_amount", regenerateVisible: false, qrVisible: false, successVisible: false, nativeRequests: f.state.calls, signedNativeRequests: f.state.signedRequests, ledgerRows: 0, productionMerchantAccepted: false }, null, 2));
}, 120000);
