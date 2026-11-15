import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve, join, isAbsolute } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LOCAL_ADMIN_EMAIL } from "../../../packages/local-runtime/src/config";

const repo = resolve(process.cwd(), "../..");
const dataDir = process.env.AIDT_LOCAL_DATA_DIR!;
const ports = {
  postgres: Number(process.env.PGPORT), api: Number(process.env.WORKSPACEX_API_PORT),
  web: Number(process.env.WORKSPACEX_WEB_PORT), sandbox: Number(process.env.SKILL_SANDBOX_PORT),
  deepAgent: Number(process.env.WORKSPACEX_DEEP_AGENT_PROVIDER_PORT), ollama: Number(process.env.WORKSPACEX_MODEL_PROVIDER_PORT),
  asr: Number(process.env.WORKSPACEX_ASR_PROVIDER_PORT),
};
const args = ["--data-dir", dataDir, "--repo-root", repo, "--ports", Object.entries(ports).map(([k, v]) => `${k}=${v}`).join(",")];
const origin = `http://127.0.0.1:${ports.api}`;
type Health = { state: string; details?: { healthy?: boolean; phase?: string; checkedAt?: string; capabilities?: { id: string; available: boolean }[] } };
function cli(command: string, timeoutMs = 25_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("pnpm", ["aidt:local", command, ...args], { cwd: repo, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Local ${command} command timed out`)); }, timeoutMs);
    child.stdout.on("data", b => { stdout += String(b); }); child.stderr.on("data", b => { stderr += String(b); });
    child.once("error", e => { clearTimeout(timer); reject(e); });
    child.once("exit", code => { clearTimeout(timer); resolveResult({ code: code ?? 1, stdout, stderr }); });
  });
}
function report(stdout: string): Health { return JSON.parse(stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1)) as Health; }
async function free(port: number): Promise<boolean> {
  return new Promise(done => { const server = createServer(); server.once("error", () => done(false)); server.listen(port, "127.0.0.1", () => server.close(() => done(true))); });
}
async function login(page: Page) {
  const secret = JSON.parse(readFileSync(join(dataDir, "secrets.json"), "utf8")) as { adminPassword: string };
  await page.goto("/login");
  await page.getByTestId("login-email").fill(LOCAL_ADMIN_EMAIL);
  await page.getByTestId("login-password").fill(secret.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });
}
async function api(page: Page, path: string) {
  return page.evaluate(async ({ origin, path }) => {
    const r = await fetch(`${origin}${path}`, { headers: { authorization: `Bearer ${localStorage.getItem("wsx.sessionToken")}` } });
    return { status: r.status, data: await r.json() };
  }, { origin, path });
}

test("native local start/save/stop/restart preserves AIDT and human text without Docker or a model fixture", async ({ page, browser }) => {
  const output = process.env.AIDT_LOCAL_OUTPUT_DIR ?? test.info().outputDir;
  expect(process.env.WORKSPACEX_ISOLATION_ID).toBeTruthy();
  expect(isAbsolute(dataDir)).toBe(true);
  for (const port of Object.values(ports)) expect(Number.isInteger(port) && port > 0).toBe(true);
  mkdirSync(output, { recursive: true });
  const evidence: Record<string, unknown> = { isolationId: process.env.WORKSPACEX_ISOLATION_ID, dataDir, ports, supplierFixture: false, docker: false };
  let owner: ChildProcess | undefined;
  let ownerExit: Promise<number> | undefined;
  let ownerCode: number | null = null;
  async function start(cycle: number) {
    expect(existsSync(join(dataDir, "run", "aidt-owner.json"))).toBe(false);
    ownerCode = null;
    const log = join(output, `native-start-${cycle}.log`);
    owner = spawn("pnpm", ["aidt:local", "start", ...args], { cwd: repo, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    owner.stdout!.on("data", b => appendFileSync(log, b)); owner.stderr!.on("data", b => appendFileSync(log, b));
    ownerExit = new Promise(done => owner!.once("exit", code => { ownerCode = code ?? 1; done(ownerCode); }));
    await expect.poll(async () => {
      if (ownerCode !== null) throw new Error(`Native start ${cycle} exited ${ownerCode}; inspect its private local log`);
      const result = await cli("health");
      if (result.code !== 0) return false;
      const health = report(result.stdout);
      if (health.details?.healthy) {
        writeFileSync(join(output, `health-${cycle}.json`), JSON.stringify(health, null, 2));
        return true;
      }
      return false;
    }, { timeout: 360_000, intervals: [1000, 2000, 3000] }).toBe(true);
    const first = report((await cli("health")).stdout), second = report((await cli("health")).stdout);
    expect(second.details?.checkedAt).not.toBe(first.details?.checkedAt);
    expect(second.details?.capabilities?.find(c => c.id === "chat-model")?.available).toBe(false);
    return second;
  }
  async function stop(cycle: number) {
    const result = await cli("stop", 150_000);
    expect(result.code).toBe(0);
    expect(await ownerExit).toBe(0);
    const status = report((await cli("status")).stdout);
    expect(status.state).toBe("stopped");
    expect((await cli("health")).code).toBe(1);
    const released = await Promise.all(Object.values(ports).map(async port => ({ port, free: await free(port) })));
    expect(released.every(p => p.free)).toBe(true);
    expect(existsSync(join(dataDir, "pgdata"))).toBe(true);
    writeFileSync(join(output, `stopped-${cycle}.json`), JSON.stringify({ status, ports: released, savedDataRetained: true }, null, 2));
    owner = undefined; ownerExit = undefined;
  }
  try {
    const doctor = await cli("doctor");
    expect(doctor.code).toBe(0);
    writeFileSync(join(output, "doctor.json"), JSON.stringify(report(doctor.stdout), null, 2));
    await start(1);
    const secretsBefore = createHash("sha256").update(readFileSync(join(dataDir, "secrets.json"))).digest("hex");
    await login(page);
    await page.getByTestId("rail-aidt").click();
    await page.getByTestId("aidt-new").click();
    await page.getByTestId("project-new-name").fill(`本地持久验收 ${randomUUID().slice(0, 8)}`);
    const createStarted = Date.now();
    const createResponse = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/projects");
    await page.getByTestId("project-new-create").click();
    const created = await createResponse;
    expect(created.status()).toBeLessThan(300);
    evidence.projectCreateApiMs = Date.now() - createStarted;
    // Native next dev compiles this large workspace on its first real navigation.
    // Keep the cold path visible; never prewarm it to disguise first-use latency.
    await expect(page).toHaveURL(/\/aidt\/[^/?]+$/, { timeout: 240_000 });
    await expect(page.getByTestId("aidt-step-1")).toBeVisible({ timeout: 240_000 });
    evidence.projectCreateRouteMs = Date.now() - createStarted;
    const projectId = new URL(page.url()).pathname.split("/").pop()!;
    evidence.projectId = projectId;
    const statement = `真实本地保存 ${randomUUID()}：研究学生取餐时的等待体验。`;
    await page.getByTestId("aidt-step-1").click();
    await page.getByTestId("aidt-open-output").click();
    await page.getByLabel("初始问题", { exact: true }).fill(statement);
    await page.getByTestId("aidt-shared-save").click();
    await expect(page.getByTestId("aidt-shared-receipt")).toContainText("V1");
    const saved = await api(page, `/projects/${projectId}/aidt/stages/1`);
    expect(saved.status).toBe(200);
    expect(Object.values(saved.data.stage.content.draft.fields)).toContain(statement);
    evidence.stageRevision = saved.data.stage.revision;
    const humanText = `纯成员文字持久验收 ${randomUUID()}`;
    await page.getByTestId("global-member-chat-open").click();
    await page.getByTestId("project-member-input").fill(humanText);
    await page.getByTestId("project-member-send").click();
    await expect(page.getByTestId("project-member-message").filter({ hasText: humanText }).first()).toHaveAttribute("data-delivery", "stored");
    await page.screenshot({ path: join(output, "native-member-stored.png"), fullPage: true });
    await page.getByTestId("global-member-chat-close").click();
    await stop(1);
    await start(2);
    expect(createHash("sha256").update(readFileSync(join(dataDir, "secrets.json"))).digest("hex")).toBe(secretsBefore);
    const context = await browser.newContext({ baseURL: `http://127.0.0.1:${ports.web}` });
    try {
      const fresh = await context.newPage(); await login(fresh);
      await fresh.goto(`/aidt/${projectId}?step=1&tool=outcome`);
      await expect(fresh.getByLabel("初始问题", { exact: true })).toHaveValue(statement, { timeout: 60_000 });
      const restored = await api(fresh, `/projects/${projectId}/aidt/stages/1`);
      expect(restored).toEqual(saved);
      const messages = await api(fresh, `/projects/${projectId}/member-chat/messages`);
      expect(messages.status).toBe(200);
      expect(messages.data.items.some((m: { text: string }) => m.text === humanText)).toBe(true);
      await fresh.setViewportSize({ width: 375, height: 812 });
      await fresh.screenshot({ path: join(output, "native-stage-after-restart-375.png"), fullPage: true });
      await fresh.getByTestId("global-member-chat-open").click();
      await expect(fresh.getByTestId("project-member-message").filter({ hasText: humanText }).first()).toHaveAttribute("data-delivery", "stored");
      await fresh.screenshot({ path: join(output, "native-member-after-restart-375.png"), fullPage: true });
      evidence.projectId = projectId; evidence.stageRevision = restored.data.stage.revision;
      evidence.memberMessagesReadBack = messages.data.items.length; evidence.secretsPreserved = true;
    } finally { await context.close(); }
    await stop(2);
    evidence.nativeStartStopCycles = 2;
    evidence.completed = true;
  } finally {
    if (owner && ownerCode === null) { await cli("stop", 150_000).catch(() => undefined); await ownerExit; }
    writeFileSync(join(output, "persistent-roundtrip.json"), JSON.stringify(evidence, null, 2));
  }
});
