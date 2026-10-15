import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import { research } from "@repo/contracts";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

interface AuditClient { query(sql: string, params: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { PgDatabase } = createRequire(resolve(process.cwd(), "../api/package.json"))("./src/infrastructure/db/pg-database.ts");
async function asApp<T>(work: (client: AuditClient) => Promise<T>): Promise<T> {
  if (!process.env.WORKSPACEX_ISOLATION_ID || !process.env.WORKSPACEX_DB?.startsWith("wsx_")) throw new Error("owned isolated database required");
  const config = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "import {appConfig} from '../api/src/infrastructure/db/pg-config.ts'; process.stdout.write(JSON.stringify(appConfig()));"], { cwd: process.cwd(), encoding: "utf8" }));
  const db = new PgDatabase(config);
  try { return await db.withTenant(FULLSTACK_E2E.orgId, work); } finally { await db.close(); }
}

async function seedSavedPlan(page: Page, name: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 30000 });
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  const headers = { authorization: `Bearer ${token}` };
  const created = await page.request.post("/__fullstack_api/research/guided-sessions", { headers, data: {
    title: name, tags: [], idempotencyKey: randomUUID(), collaboratorUserIds: [],
    brief: { topic: "采购验证", goal: "核对采购审批", timeRange: "", region: "", focus: "" },
  } });
  expect(created.ok()).toBeTruthy();
  const session = research.GuidedResearchSession.parse(await created.json());
  const path = `/__fullstack_api/research/guided-sessions/${session.sessionId}/runtime`;
  const initial = research.GuidedResearchRuntime.parse(await (await page.request.get(path, { headers })).json());
  const saved = research.GuidedResearchRuntime.parse({ ...initial, version: 1, currentNode: "outline", completed: false,
    availableNodes: ["brief", "directions", "outline"], generatedNodes: ["brief", "directions", "outline"],
    outline: [{ id: "chapter", title: "采购验证", questions: ["如何核验审批？"], enabled: true, order: 0 }] });
  await asApp(async c => {
    await c.query("UPDATE guided_research_runtime SET state=$3::jsonb WHERE org_id=$1 AND session_id=$2", [FULLSTACK_E2E.orgId, session.sessionId, JSON.stringify(saved)]);
    await c.query("UPDATE guided_research_sessions SET stage='outline',resume_stage='outline',status='active',progress=40,source_count=0,report_id=NULL,brief=$3::jsonb WHERE org_id=$1 AND id=$2", [FULLSTACK_E2E.orgId, session.sessionId, JSON.stringify(saved.brief)]);
  });
  return { session, path, headers, saved };
}

/** R2: one real save round trip, controlled transport delay, then normal reload. */
test("R2 plan saving feedback belongs to save and survives a real API/PG refresh", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const output = resolve(process.env.WX_RESEARCH_UX_EVIDENCE ?? testInfo.outputPath("evidence"));
  await mkdir(output, { recursive: true });
  const activity = () => asApp(c => c.query("SELECT (SELECT count(*) FROM agent_runs WHERE org_id=$1)::int AS runs,(SELECT count(*) FROM model_request_starts WHERE org_id=$1)::int AS requests", [FULLSTACK_E2E.orgId])).then(result => result.rows[0]);
  const before = await activity();
  const generationCommands: string[] = [];
  page.on("request", request => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (/runtime\/commands/.test(path) && request.postDataJSON()?.action !== "save") generationCommands.push(path);
    if (/report-files|\/(?:generate|execute)(?:\/|$)/.test(path)) generationCommands.push(path);
  });
  const { session, path, headers, saved } = await seedSavedPlan(page, "研究 R2 保存反馈");
  await page.goto(`/research/${session.sessionId}/plan`);
  await page.getByRole("button", { name: "编辑计划 1：采购验证", exact: true }).click();
  await page.getByRole("textbox", { name: "计划 1", exact: true }).fill("审批责任验证");
  await page.getByRole("textbox", { name: "计划 1", exact: true }).press("Enter");
  await page.getByRole("button", { name: "保存计划", exact: true }).click();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const received = new Promise<void>(done => { started = done; });
  await page.route("**/runtime/commands", async route => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.action === "save") { started(); await gate; }
    await route.continue();
  });
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  let feedback: unknown;
  try {
    await received;
    const save = page.getByRole("button", { name: "保存计划", exact: true });
    const generate = page.getByTestId("research-plan-actions").getByRole("button", { name: "生成报告", exact: true });
    await expect(save).toBeDisabled();
    feedback = { saveBusy: await save.getAttribute("aria-busy"), generateBusy: await generate.getAttribute("aria-busy"), saveSpinners: await save.locator(".animate-spin").count(), generateSpinners: await generate.locator(".animate-spin").count() };
    await page.screenshot({ path: resolve(output, "r2-saving.png"), fullPage: true });
  } finally { release(); }
  await expect(page.getByRole("button", { name: "保存计划", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "编辑计划 1：审批责任验证", exact: true })).toBeVisible();
  const persisted = research.GuidedResearchRuntime.parse(await (await page.request.get(path, { headers })).json());
  expect(persisted.outline[0]?.title).toBe("审批责任验证");
  expect(persisted.version).toBeGreaterThan(saved.version);
  const after = await activity();
  expect(after).toEqual(before);
  expect(generationCommands).toEqual([]);
  await writeFile(resolve(output, "r2-result.json"), JSON.stringify({ feedback, modelBefore: before, modelAfter: after, persistedVersion: persisted.version, persistedTitle: persisted.outline[0]?.title }, null, 2));
  await page.screenshot({ path: resolve(output, "r2-reloaded.png"), fullPage: true });
  expect(feedback).toEqual({ saveBusy: "true", generateBusy: null, saveSpinners: 1, generateSpinners: 0 });
});


/** R3: one controlled failed delivery, explicit keep-draft and user retry. */
test("R3 a failed save keeps the plan draft available for explicit retry", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const output = resolve(process.env.WX_RESEARCH_UX_EVIDENCE ?? testInfo.outputPath("evidence"));
  await mkdir(output, { recursive: true });
  const activity = () => asApp(c => c.query("SELECT (SELECT count(*) FROM agent_runs WHERE org_id=$1)::int AS runs,(SELECT count(*) FROM model_request_starts WHERE org_id=$1)::int AS requests", [FULLSTACK_E2E.orgId])).then(result => result.rows[0]);
  const before = await activity();
  const { session, path, headers } = await seedSavedPlan(page, "研究 R3 保存恢复");
  let attempts = 0;
  const generationCommands: string[] = [];
  await page.route("**/runtime/commands", async route => {
    const input = route.request().postDataJSON();
    if (route.request().method() === "POST" && input?.action === "save") {
      attempts += 1;
      if (attempts === 1 || attempts === 3) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "Controlled R3 delivery failure" } }) });
        return;
      }
    } else if (route.request().method() === "POST") generationCommands.push(route.request().url());
    await route.continue();
  });
  await page.goto(`/research/${session.sessionId}/plan`);
  await page.getByRole("button", { name: "编辑计划 1：采购验证", exact: true }).click();
  await page.getByRole("textbox", { name: "计划 1", exact: true }).fill("失败后保留的计划");
  await page.getByRole("textbox", { name: "计划 1", exact: true }).press("Enter");
  await page.getByRole("button", { name: "保存计划", exact: true }).click();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(page.getByText("计划未保存，请重试。", { exact: true })).toBeVisible();
  await page.getByTestId("research-recovery").locator("summary").first().click();
  const keep = page.getByRole("button", { name: "继续编辑保留的草稿", exact: true });
  await expect(keep).toBeEnabled();
  await page.screenshot({ path: resolve(output, "r3-recovery.png"), fullPage: true });
  await keep.click();
  await expect(page.getByTestId("research-recovery")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "编辑计划 1：失败后保留的计划", exact: true })).toBeVisible();
  const old = research.GuidedResearchRuntime.parse(await (await page.request.get(path, { headers })).json());
  expect(old.outline[0]?.title).toBe("采购验证");
  const save = page.getByRole("button", { name: "保存计划", exact: true });
  await writeFile(resolve(output, "r3-before-retry.json"), JSON.stringify({ saveCount: await save.count(), persistedTitle: old.outline[0]?.title, persistedVersion: old.version, attempts, modelBefore: before, modelNow: await activity() }, null, 2));
  await page.screenshot({ path: resolve(output, "r3-kept-draft.png"), fullPage: true });
  await expect(save).toBeEnabled();
  await save.click();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(save).toHaveCount(0);
  const current = research.GuidedResearchRuntime.parse(await (await page.request.get(path, { headers })).json());
  expect(current.outline[0]?.title).toBe("失败后保留的计划");
  expect(current.version).toBeGreaterThan(old.version);
  await page.reload();
  await expect(page.getByRole("button", { name: "编辑计划 1：失败后保留的计划", exact: true })).toBeVisible();
  expect(attempts).toBe(2);
  expect(generationCommands).toEqual([]);
  expect(await activity()).toEqual(before);
  await writeFile(resolve(output, "r3-retried.json"), JSON.stringify({ attempts, persistedTitle: current.outline[0]?.title, persistedVersion: current.version, modelAfter: await activity() }, null, 2));
  await page.screenshot({ path: resolve(output, "r3-retried.png"), fullPage: true });
  // A second controlled failure exercises explicit cancellation to acknowledgement.
  await page.getByRole("button", { name: "编辑计划 1：失败后保留的计划", exact: true }).click();
  await page.getByRole("textbox", { name: "计划 1", exact: true }).fill("取消时丢弃的草稿");
  await page.getByRole("textbox", { name: "计划 1", exact: true }).press("Enter");
  await page.getByRole("button", { name: "保存计划", exact: true }).click();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(page.getByText("计划未保存，请重试。", { exact: true })).toBeVisible();
  await page.getByTestId("research-recovery").locator("summary").first().click();
  await page.getByRole("button", { name: "继续编辑保留的草稿", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存计划", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存计划", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "编辑计划 1：失败后保留的计划", exact: true })).toBeVisible();
  await expect(page.getByText("计划未保存，请重试。", { exact: true })).toHaveCount(0);
  const cancelled = research.GuidedResearchRuntime.parse(await (await page.request.get(path, { headers })).json());
  expect(cancelled.version).toBe(current.version);
  expect(cancelled.outline).toEqual(current.outline);
  expect(attempts).toBe(3);
  expect(await activity()).toEqual(before);
  await writeFile(resolve(output, "r3-cancelled.json"), JSON.stringify({ attempts, persistedVersion: cancelled.version, persistedTitle: cancelled.outline[0]?.title, modelAfter: await activity() }, null, 2));
  await page.screenshot({ path: resolve(output, "r3-cancelled.png"), fullPage: true });
});
