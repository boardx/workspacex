/** Manual opt-in, existing real-model lane and native Chat. Capturing is not pedagogical approval. */
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { chat, skills } from "@repo/contracts";
import { operations as stageOperations } from "@repo/contracts/aidt-stages";
import { REAL_MODEL_SMOKE, REAL_MODEL_SKIP_REASON } from "./real-model-smoke-fixture";
import { RealModelEvidence } from "./support/real-model-evidence";
import { sendViaWorkbench } from "./chat-v2-send";
import { AIDT_STEPS } from "../features/aidt/lib/project-aidt";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";
import { SESSION_STORAGE_KEY } from "../components/session/session-provider";
import { assertLocalFacilitationTarget, facilitationReviewTemplate, selectFacilitationCases } from "./aidt-facilitation-cases";

const selected = selectFacilitationCases(process.env.AIDT_REAL_SCENARIOS);
const reasons = [REAL_MODEL_SKIP_REASON,
  process.env.AIDT_REAL_E2E === "1" ? null : "需要显式 AIDT_REAL_E2E=1",
  selected.length ? null : "需要选择1–2个 AIDT_REAL_SCENARIOS（不默认付费运行全部场景）",
  process.env.AIDT_REAL_PROVIDER_CONFIGURED === "1" ? null : "需要实际配置真实模型/Agent链路后设置 AIDT_REAL_PROVIDER_CONFIGURED=1；这是操作者声明，不是提供方真实性证明",
].filter(Boolean);
if (process.env.AIDT_REAL_E2E === "1") assertLocalFacilitationTarget(REAL_MODEL_SMOKE.baseUrl);
if (reasons.length) process.stdout.write(`[aidt-real-facilitation] NOT RUN: ${reasons.join("；")}\n`);
test.skip(reasons.length > 0, reasons.join("；"));
test.use({ actionTimeout: 30_000, navigationTimeout: 60_000, trace: "off", screenshot: "off", video: "off" });
const apiPrefix = (process.env.NEXT_PUBLIC_API_PATH_PREFIX || "/api").replace(/\/$/, "");
async function read(page: Page, endpoint: string): Promise<unknown> {
  return page.evaluate(async ({ url, storageKey }) => {
    const token = localStorage.getItem(storageKey);
    if (!token) throw new Error("AIDT_AUTHENTICATED_SESSION_MISSING");
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`AIDT_ACCEPTANCE_READ_${response.status}`);
    return response.json();
  }, { url: `${apiPrefix}${endpoint}`, storageKey: SESSION_TOKEN_STORAGE_KEY });
}
async function stages(page: Page, projectId: string) {
  return Promise.all([1, 2, 3, 4, 5, 6].map(async id => stageOperations.get.out.parse(await read(page, `/projects/${encodeURIComponent(projectId)}/aidt/stages/${id}`))));
}
async function messages(page: Page, threadId: string) {
  const endpoint = chat.operations.listMessages.path.replace(":threadId", encodeURIComponent(threadId));
  return chat.operations.listMessages.out.parse(await read(page, `${endpoint}?limit=100`)).messages;
}
for (const scenario of selected.length ? selected : [null]) {
  test(`AIDT facilitation capture: ${scenario?.id ?? "missing-configuration"}`, async ({ page }, info) => {
    if (!scenario) throw new Error("AIDT_SCENARIO_SELECTION_REQUIRED");
    test.setTimeout(scenario.turns.length * REAL_MODEL_SMOKE.runTimeoutMs + 180_000);
    const evidence = new RealModelEvidence(path.join(REAL_MODEL_SMOKE.evidenceDir, "aidt-facilitation", `${Date.now()}-${scenario.id}`), [REAL_MODEL_SMOKE.password, REAL_MODEL_SMOKE.email]);
    const turns: { studentInput: string; runRequestPath: string; sawRunning: boolean; status: "running" | "captured" | "interrupted"; messages: { id: string; authorKind: string; agentRunId: string | null; text: string }[] }[] = [];
    let before: unknown, projectId: string | undefined, threadId: string | undefined;
    evidence.setContext("scenarioId", scenario.id);
    evidence.setContext("sourceSections", scenario.sections);
    evidence.setContext("syntheticInput", true);
    evidence.setContext("semanticAcceptance", "pending-human-review");
    evidence.setContext("providerIdentity", "operator-declared-real; must correlate run IDs with actual supplier records");
    evidence.writeText("review-template.json", JSON.stringify(facilitationReviewTemplate(scenario), null, 2));
    try {
      await page.goto("/login");
      await page.getByTestId("login-email").fill(REAL_MODEL_SMOKE.email);
      await page.getByTestId("login-password").fill(REAL_MODEL_SMOKE.password);
      await page.getByTestId("login-submit").click();
      await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });
      // Attach only after login. Raw traces and request headers are deliberately not collected.
      await evidence.attach(page);
      await page.getByTestId("rail-aidt").click();
      await page.getByTestId("aidt-new").click();
      await page.getByTestId("project-new-name").fill(`引导验收·合成练习·${scenario.id}·${Date.now()}`);
      await page.getByTestId("project-new-create").click();
      await expect(page).toHaveURL(/\/aidt\/[^/?]+$/);
      projectId = new URL(page.url()).pathname.split("/").pop()!;
      await page.getByTestId(`aidt-step-${scenario.stage}`).click();
      await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
      await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBeTruthy();
      threadId = new URL(page.url()).searchParams.get("thread")!;
      const orgId = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || "null")?.currentOrgId as string | undefined, SESSION_STORAGE_KEY);
      expect(orgId).toBeTruthy();
      const catalog = skills.operations.listSkills.out.parse(await read(page, `${skills.operations.listSkills.path}?orgId=${encodeURIComponent(orgId!)}&entry=library`));
      const expectedSkill = catalog.items.find(item => item.platformStableName === AIDT_STEPS[scenario.stage - 1]!.skill && item.status === "已启用");
      expect(expectedSkill, "当前阶段必须在实际授权Skill目录中").toBeTruthy();
      const mountEndpoint = skills.operations.listThreadDeviations.path.replace(":threadId", encodeURIComponent(threadId));
      const mounts = skills.operations.listThreadDeviations.out.parse(await read(page, mountEndpoint));
      const active = mounts.temporary.filter(item => item.removedAt === null);
      expect(active.some(item => item.skillId === expectedSkill!.skillId && item.threadId === threadId)).toBe(true);
      evidence.setContext("projectId", projectId); evidence.setContext("threadId", threadId);
      evidence.setContext("catalogCurrentVersion", expectedSkill!.currentVersionId);
      evidence.setContext("mountedSkills", active.map(({ skillId, versionId }) => ({ skillId, versionId })));
      before = await stages(page, projectId);
      for (const prompt of scenario.turns) {
        const original = new Set((await messages(page, threadId)).map(message => message.id));
        const request = await sendViaWorkbench(page, prompt);
        const captured: (typeof turns)[number] = { studentInput: prompt, runRequestPath: new URL(request.url()).pathname, sawRunning: false, status: "running", messages: [] };
        turns.push(captured);
        evidence.writeText("turns.json", JSON.stringify(turns, null, 2));
        await expect.poll(async () => {
          const state = await page.getByTestId("copilotkit-v2-send").getAttribute("data-send-state").catch(() => null);
          if (state === "running") captured.sawRunning = true;
          const current = await messages(page, threadId!);
          captured.messages = current.filter(message => !original.has(message.id)).map(({ id, authorKind, agentRunId, text }) => ({ id, authorKind, agentRunId, text }));
          evidence.writeText("turns.json", JSON.stringify(turns, null, 2));
          const fresh = captured.messages.filter(message => message.authorKind === "agent" && message.agentRunId && message.text.trim());
          return captured.sawRunning && state !== null && state !== "running" && fresh.length > 0;
        }, { timeout: REAL_MODEL_SMOKE.runTimeoutMs, intervals: [300, 500, 1000] }).toBe(true);
        const fresh = (await messages(page, threadId)).filter(message => !original.has(message.id));
        expect(fresh.some(message => message.authorKind === "human" && message.text === prompt)).toBe(true);
        captured.messages = fresh.map(({ id, authorKind, agentRunId, text }) => ({ id, authorKind, agentRunId, text }));
        captured.status = "captured";
        evidence.writeText("turns.json", JSON.stringify(turns, null, 2));
        await expect(page.getByTestId("copilotkit-v2-error")).toHaveCount(0);
      }
      const after = await stages(page, projectId);
      expect(after, "模型回复不能替学生改写或确认共享阶段成果").toEqual(before);
      evidence.record("stage-records-unchanged", true, "Six actual stage GET projections equal before/after; no approval UI was clicked.");
      evidence.record("transport-captured", evidence.streamFailures().length === 0, "Native run requests and new durable agentRunId replies recorded; semantic review remains pending.");
      expect(evidence.streamFailures()).toHaveLength(0);
      evidence.writeText("capture-result.json", JSON.stringify({ captureCompleted: true, actualModelAcceptance: "pending-provider-correlation", teachingAcceptance: "pending-human-review", projectId, threadId, caseId: scenario.id }, null, 2));
    } catch (error) {
      for (const turn of turns) if (turn.status === "running") turn.status = "interrupted";
      evidence.record("capture-completed", false, error instanceof Error ? error.message : "AIDT capture failed");
      throw error;
    } finally {
      evidence.setContext("playwrightStatus", info.status ?? "unknown");
      evidence.writeText("turns.json", JSON.stringify(turns, null, 2));
      if (projectId && before) {
        evidence.writeText("stages-before.json", JSON.stringify(before, null, 2));
        const after = await stages(page, projectId).catch(() => null);
        evidence.writeText("stages-after.json", JSON.stringify(after, null, 2));
      }
      evidence.finish();
      // Trial groups and conversations remain named synthetic records for human review.
      // No destructive cleanup, permission changes, teacher notification or auto-approval.
    }
  });
}
