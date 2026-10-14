import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { research, interviewMarkdown } from "@repo/contracts";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
// Load the existing test adapter at runtime, so Next's frontend type check does
// not pull in the API migrator/deployment dependency graph and its Node env types.
interface AuditClient { query(sql: string, params: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
const { PgDatabase } = createRequire(resolve(process.cwd(), "../api/package.json"))("./src/infrastructure/db/pg-database.ts");
async function asApp<T>(orgId: string, work: (client: AuditClient) => Promise<T>): Promise<T> {
  // Reuse the production app-role config and tenant transaction. ESM config
  // loading is isolated from Next's ambient frontend ProcessEnv augmentation.
  const config = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    "import {appConfig} from '../api/src/infrastructure/db/pg-config.ts'; process.stdout.write(JSON.stringify(appConfig()));"],
  { cwd: process.cwd(), encoding: "utf8" }));
  const db = new PgDatabase(config);
  try { return await db.withTenant(orgId, work); } finally { await db.close(); }
}

/** Actual Next routes/login/API/PG saved fixtures; never submit a model command. */
test("research and interview use consistent command controls without model execution", async ({ page }) => {
  test.setTimeout(120000);
  if (!process.env.WORKSPACEX_ISOLATION_ID || !process.env.WORKSPACEX_DB?.startsWith("wsx_")) throw new Error("owned isolated database required");
  const baseline = process.env.WX_STUDY_ACTIONS_BASELINE === "1";
  const output = resolve(process.env.WX_STUDY_ACTIONS_EVIDENCE ?? "test-results/study-actions");
  await mkdir(output, { recursive: true });
  const activity = () => asApp(FULLSTACK_E2E.orgId, c => c.query("SELECT (SELECT count(*) FROM agent_runs WHERE org_id=$1)::int AS runs,(SELECT count(*) FROM model_request_starts WHERE org_id=$1)::int AS requests", [FULLSTACK_E2E.orgId])).then(result => result.rows[0]);
  const before = await activity();
  const modelCommands: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && /runtime\/commands|report-files|\/(?:generate|execute)(?:\/|$)/.test(new URL(request.url()).pathname)) modelCommands.push(new URL(request.url()).pathname); });
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  const headers = { authorization: `Bearer ${token}` };
  const created = await page.request.post("/__fullstack_api/research/guided-sessions", { headers, data: {
    title: "研究操作一致化验收", tags: [], idempotencyKey: randomUUID(), collaboratorUserIds: [],
    brief: { topic: "采购证据", goal: "核验采购流程", timeRange: "", region: "中国", focus: "决策责任" },
  } });
  expect(created.ok()).toBeTruthy();
  const session = research.GuidedResearchSession.parse(await created.json());
  const stateResponse = await page.request.get(`/__fullstack_api/research/guided-sessions/${session.sessionId}/runtime`, { headers });
  const state = research.GuidedResearchRuntime.parse(await stateResponse.json());
  const saved = research.GuidedResearchRuntime.parse({ ...state, version: 1, currentNode: "report", completed: true,
    availableNodes: ["brief", "directions", "outline", "research", "report"],
    outline: [{ id: "chapter", title: "采购验证", questions: ["如何核验决策责任？"], enabled: true, order: 0 }],
    report: { title: "采购决策研究", summary: "核验预算授权与采购责任。", introduction: "本报告基于已保存资料。",
      sections: [{ sectionId: "chapter", body: "先追访采购负责人，再核对预算授权。", sourceIds: [] }], conclusion: "优先验证真实采购流程。" } });
  await asApp(FULLSTACK_E2E.orgId, c => c.query("UPDATE guided_research_runtime SET state=$3::jsonb WHERE org_id=$1 AND session_id=$2", [FULLSTACK_E2E.orgId, session.sessionId, JSON.stringify(saved)]));
  const itvCreated = await page.request.post("/__fullstack_api/interviews/digital", { headers, data: { name: "访谈操作一致化验收", tags: [],
    scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: randomUUID() } });
  expect(itvCreated.ok()).toBeTruthy(); const { interviewId } = await itvCreated.json();
  const path = `/__fullstack_api/interviews/digital/${interviewId}/markdown`;
  const initial = interviewMarkdown.InterviewMarkdownEnvelope.parse(await (await page.request.get(path, { headers })).json());
  const initialized = await page.request.post(`${path}/initialize`, { headers, data: { expectedVersion: initial.version } });
  const source = interviewMarkdown.InterviewMarkdownEnvelope.parse(await initialized.json());
  expect((await page.request.post(`${path}/report`, { headers, data: { expectedVersion: source.version, expectedDocumentVersion: 0,
    markdown: "# 采购决策访谈\n\n## 核心发现\n先追访真实采购负责人，再核对预算授权。" } })).ok()).toBeTruthy();
  const metrics: unknown[] = [];
  for (const width of [1280, 768, 375]) for (const [domain, route] of [["research", `/research/${session.sessionId}/report`], ["interview", `/itv/${interviewId}/report`]] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(route);
    const file = page.getByRole("button", { name: "生成 PDF", exact: true });
    await expect(file).toBeEnabled();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const buttons = await page.getByRole("button").evaluateAll(elements => elements.filter(el => /返回|生成 PDF|生成 Word|更多操作|完成研究/.test(el.textContent ?? "")).map(el => {
      const style = getComputedStyle(el), box = el.getBoundingClientRect();
      return { text: el.textContent, height: box.height, background: style.backgroundColor, color: style.color, position: style.position };
    }));
    metrics.push({ domain, width, buttons });
    if (!baseline) {
      const footer = page.locator('[data-workflow-action-bar="footer"]');
      await expect(footer).toHaveCount(1);
      await expect(footer.locator('[data-workflow-action-bar]')).toHaveCount(0);
      expect(await footer.evaluate(node => node.previousElementSibling !== null && getComputedStyle(node).position !== "fixed")).toBe(true);
      expect(await footer.locator("button").evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height === 36))).toBe(true);
      const back = domain === "research" ? page.getByTestId("research-flow-back") : page.getByTestId("itv-return-history");
      expect(await back.evaluate(node => node.getBoundingClientRect().height)).toBe(36);
      expect(await back.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(await file.evaluate(node => getComputedStyle(node).backgroundColor));
      await back.click();
      await expect(page).toHaveURL(domain === "research" ? /\/research$/ : /\/itv\?tab=history$/);
      await page.goto(route);
      await expect(file).toBeEnabled();
    }
    await page.screenshot({ path: resolve(output, `${baseline ? "before" : "after"}-${domain}-${width}.png`), fullPage: true });
  }
  if (!baseline) {
    await asApp(FULLSTACK_E2E.orgId, c => c.query("UPDATE guided_research_runtime SET state=$3::jsonb WHERE org_id=$1 AND session_id=$2", [FULLSTACK_E2E.orgId, session.sessionId, JSON.stringify({ ...saved, completed: false })]));
    await page.goto(`/research/${session.sessionId}/report`);
    const primary = page.getByRole("button", { name: "完成研究", exact: true });
    const secondary = page.getByRole("button", { name: "更多操作", exact: true });
    await expect(primary).toBeEnabled();
    expect(await primary.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(await secondary.evaluate(node => getComputedStyle(node).backgroundColor));
    expect(await primary.evaluate(node => node.getBoundingClientRect().height)).toBe(36);
    expect(await primary.evaluate(node => node.closest('[data-workflow-action-bar="footer"]')?.lastElementChild?.contains(node))).toBe(true);
    metrics.push({ domain: "research", width: 375, state: "ready-to-complete", buttons: await page.locator('[data-workflow-action-bar="footer"] button').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, height: node.getBoundingClientRect().height, background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color, disabled: node.matches(':disabled') }))) });
    await page.screenshot({ path: resolve(output, "after-research-primary-375.png"), fullPage: true });
    const expectedPrimary = await primary.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color }));
    const currentInterview = interviewMarkdown.InterviewMarkdownEnvelope.parse(await (await page.request.get(path, { headers })).json());
    const intake = currentInterview.documents.find(document => document.step === "intake");
    expect((await page.request.post(`${path}/intake`, { headers, data: { expectedVersion: currentInterview.version, expectedDocumentVersion: intake?.version ?? 0, markdown: "# 研究需求\n\n核对采购授权与预算。" } })).ok()).toBeTruthy();
    await page.goto(`/itv/${interviewId}/intake`);
    const interviewPrimary = page.getByRole("button", { name: "下一步：确认分析", exact: true });
    const interviewSecondary = page.getByTestId("itv-return-history");
    await expect(interviewPrimary).toBeEnabled();
    await expect.poll(() => interviewPrimary.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color }))).toEqual(expectedPrimary);
    expect(await interviewPrimary.evaluate(node => node.getBoundingClientRect().height)).toBe(36);
    expect(await interviewPrimary.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(await interviewSecondary.evaluate(node => getComputedStyle(node).backgroundColor));
    metrics.push({ domain: "interview", width: 375, state: "intake-enabled-primary", buttons: await interviewPrimary.evaluate(node => ({ text: node.textContent, height: node.getBoundingClientRect().height, background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color })) });
    await page.screenshot({ path: resolve(output, "after-interview-primary-375.png"), fullPage: true });
    const loading = research.GuidedResearchRuntime.parse({ ...state, version: 2, currentNode: "outline", availableNodes: ["brief", "directions", "outline"], generatedNodes: ["brief", "directions"], busy: true, leaseUntil: "2099-01-01T00:00:00Z" });
    await asApp(FULLSTACK_E2E.orgId, c => c.query("UPDATE guided_research_runtime SET state=$3::jsonb WHERE org_id=$1 AND session_id=$2", [FULLSTACK_E2E.orgId, session.sessionId, JSON.stringify(loading)]));
    await page.goto(`/research/${session.sessionId}/plan`);
    await expect(page.getByTestId("research-step-loading")).toContainText("正在生成研究计划");
    await expect(page.locator(".animate-spin")).toHaveCount(1);
    await expect(page.locator(".animate-pulse")).toHaveCount(0);
    await page.screenshot({ path: resolve(output, "after-research-loading-375.png"), fullPage: true });
  }
  expect(modelCommands).toEqual([]);
  expect(await activity()).toEqual(before);
  await writeFile(resolve(output, `${baseline ? "before" : "after"}-metrics.json`), JSON.stringify({ metrics, modelActivityBefore: before, modelActivityAfter: await activity() }, null, 2));
});
