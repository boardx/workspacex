import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { auth, chat, skills, wave2Runtime } from "@repo/contracts";
import { operations, SharedStage, type SharedStageValue } from "@repo/contracts/aidt-stages";
import { AidtContextSelector, operations as aidtContextOperations, type AidtContextReceipt } from "@repo/contracts/aidt-run-context";
import { SESSION_TOKEN_STORAGE_KEY } from "../../lib/api-client";
import { SESSION_STORAGE_KEY } from "../../components/session/session-provider";
import { AIDT_STEPS } from "../../features/aidt/lib/project-aidt";
import { readAidtQuestionSnapshot } from "../../features/aidt/lib/aidt-verification-loop";
import { REAL_MODEL_SMOKE, REAL_MODEL_SKIP_REASON } from "../real-model-smoke-fixture";
import { sendViaWorkbench } from "../chat-v2-send";
import { apiPath } from "./real-model-api";
import { reserveAidtNativeRun, recordAidtNativeRequest, finishAidtNativeRun } from "./aidt-v2-run-ledger";
import { aidtV2WireMetadata, validateAidtV2Receipt } from "./aidt-v2-wire-metadata";

export function assertAidtV2Target(): void {
  expect(REAL_MODEL_SKIP_REASON, "实际凭据缺失必须失败，不以skip或回环模型补绿").toBeNull();
  expect(process.env.AIDT_V2_REAL_AGENT, "操作者必须明确启用有界真实Agent验收").toBe("1");
  const web = new URL(REAL_MODEL_SMOKE.baseUrl);
  const api = new URL(process.env.AIDT_V2_API_ORIGIN ?? "");
  for (const url of [web, api]) {
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.protocol).toBe("http:");
    expect(url.username + url.password).toBe("");
  }
  expect(process.env.WORKSPACEX_ISOLATION_ID, "必须沿用唯一栈的真实预约，不自造租约").toBeTruthy();
  expect(process.env.AIDT_V2_RUN_LEDGER, "收费请求必须共享跨进程总账，不因重启清零").toBeTruthy();
}

export async function loginAidtV2(page: Page, role: "lead" | "member" = "lead"): Promise<void> {
  try {
    const email = role === "lead" ? REAL_MODEL_SMOKE.email : process.env.AIDT_V2_MEMBER_EMAIL;
    const password = role === "lead" ? REAL_MODEL_SMOKE.password : process.env.AIDT_V2_MEMBER_PASSWORD;
    expect(Boolean(email && password), "实际角色凭据必须由栈负责人配置，不猜账号或复制会话").toBe(true);
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByTestId("login-email").fill(email!);
    await page.getByTestId("login-password").fill(password!);
    const response = page.waitForResponse(value => value.request().method() === "POST"
      && new URL(value.url()).pathname.endsWith(auth.operations.login.path));
    await page.getByTestId("login-submit").click();
    expect((await response).status()).toBe(200);
    // Navigation has its own existing 60s budget; a 5s content assertion is not a route-ready signal.
    await page.waitForURL(/\/home$/);
  } catch (error) {
    // Playwright error-context includes form values. Keep credentials out of automatic failure artifacts.
    await page.goto("about:blank").catch(() => undefined);
    throw error;
  }
}

/** Session stays in its real browser. Do not return/log bearer headers or supplier credentials. */
export async function aidtV2Api(page: Page, path: string, method: "GET" | "PUT" | "POST" | "PATCH" = "GET", body?: unknown) {
  return page.evaluate(async ({ url, method, body, storageKey }) => {
    const token = localStorage.getItem(storageKey);
    if (!token) throw new Error("AIDT_V2_AUTHENTICATED_SESSION_REQUIRED");
    const response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : null; }
    catch { throw new Error(`AIDT_V2_EXPECTED_JSON_${response.status}`); }
    return { status: response.status, data };
  }, { url: apiPath(path), method, body, storageKey: SESSION_TOKEN_STORAGE_KEY });
}

export async function aidtV2Bytes(page: Page, path: string) {
  return page.evaluate(async ({ url, storageKey }) => {
    const token = localStorage.getItem(storageKey);
    if (!token) throw new Error("AIDT_V2_AUTHENTICATED_SESSION_REQUIRED");
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const headers = Object.fromEntries(["content-type", "x-content-sha256", "x-artifact-id", "x-artifact-version-id", "x-upload-submitted-by", "x-upload-submitted-at"].map(key => [key, response.headers.get(key)]));
    return { status: response.status, base64: btoa(binary), headers };
  }, { url: apiPath(path), storageKey: SESSION_TOKEN_STORAGE_KEY });
}

export async function createAidtV2Group(page: Page, scenario: string): Promise<string> {
  await page.getByTestId("rail-aidt").click();
  await page.getByTestId("aidt-new").click();
  await page.getByTestId("project-new-name").fill(`V2合成课堂验收·${scenario}·${randomUUID().slice(0, 8)}`);
  const created = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/projects") && response.request().method() === "POST");
  await page.getByTestId("project-new-create").click();
  expect((await created).status()).toBe(201);
  await page.waitForURL(/\/aidt\/[^/?]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

export async function openAidtV2Outcome(page: Page, projectId: string, step: number): Promise<void> {
  await page.goto(`/aidt/${projectId}?step=${step}&tool=outcome`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("aidt-shared-reload")).toBeEnabled();
  await expect(page.getByTestId("aidt-stage-output")).toBeVisible();
}

export async function readAidtV2Stage(page: Page, projectId: string, step: number) {
  const response = await aidtV2Api(page, `/projects/${projectId}/aidt/stages/${step}`);
  expect(response.status).toBe(200);
  return operations.get.out.parse(response.data).stage;
}

async function readAidtV2StageRevision(page: Page, projectId: string, stageId: number, revision: number, heads: readonly (SharedStageValue | null)[]) {
  const current = heads.find(stage => stage?.stageId === stageId && stage.revision === revision);
  if (current) return current;
  const query = operations.history.in.parse({ projectId, stageId, beforeRevision: revision + 1, limit: 1 });
  const response = await aidtV2Api(page, `${operations.history.path.replace(":projectId", encodeURIComponent(projectId)).replace(":stageId", String(stageId))}?beforeRevision=${query.beforeRevision}&limit=${query.limit}`);
  expect(response.status).toBe(200);
  const found = operations.history.out.parse(response.data).items[0];
  expect(found, "选择旧版本必须真实读该历史稿，不以当前head替代").toMatchObject({ projectId, stageId, revision });
  return found!;
}

export async function saveAidtV2Stage(page: Page, projectId: string, step: number): Promise<SharedStageValue> {
  const prior = await readAidtV2Stage(page, projectId, step);
  const saved = page.waitForResponse(response => new URL(response.url()).origin === new URL(REAL_MODEL_SMOKE.baseUrl).origin
    && new URL(response.url()).pathname === apiPath(`/projects/${projectId}/aidt/stages/${step}`) && response.request().method() === "PUT");
  await expect(page.getByTestId("aidt-shared-save")).toBeEnabled();
  await page.getByTestId("aidt-shared-save").click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const result = operations.save.out.parse(await response.json());
  expect(result.replayed).toBe(false);
  expect(result.stage.revision).toBe((prior?.revision ?? 0) + 1);
  await expect(page.getByTestId("aidt-shared-status")).toContainText(`V${result.stage.revision}`);
  expect(await readAidtV2Stage(page, projectId, step)).toEqual(result.stage);
  return result.stage;
}

/** One UI send, one actual durable run. Never retry a model request automatically. */
type IntentReview = { reviewSyntheticIntent?: (runId: string) => Promise<unknown> };
export async function askAidtV2Agent(page: Page, projectId: string, step: number, prompt: string, review?: IntentReview) {
  await page.goto(`/aidt/${projectId}?step=${step}&tool=chat`, { waitUntil: "domcontentloaded" });
  return sendAidtV2NativeTurn(page, projectId, AIDT_STEPS[step - 1]!.skill, prompt, "thread", review);
}

/** Also used by report UI after its student-reviewed request is explicitly offered. */
export async function sendAidtV2NativeTurn(page: Page, projectId: string, skillName: string, prompt: string, threadKey: "thread" | "summaryThread" = "thread", review?: IntentReview) {
  await page.getByTestId("aidt-step-skill").waitFor({ state: "visible" });
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get(threadKey)).toBeTruthy();
  const threadId = new URL(page.url()).searchParams.get(threadKey)!;
  const session = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null") as { currentOrgId?: string } | null, SESSION_STORAGE_KEY);
  expect(session?.currentOrgId).toBeTruthy();
  const catalogResponse = await aidtV2Api(page, `${skills.operations.listSkills.path}?orgId=${encodeURIComponent(session!.currentOrgId!)}&entry=library`);
  expect(catalogResponse.status).toBe(200);
  const catalog = skills.operations.listSkills.out.parse(catalogResponse.data);
  const skill = catalog.items.find(item => item.platformStableName === skillName && item.status === "已启用");
  expect(skill).toBeTruthy();
  const mountPath = skills.operations.listThreadDeviations.path.replace(":threadId", encodeURIComponent(threadId));
  const mounts = await aidtV2Api(page, mountPath);
  expect(mounts.status).toBe(200);
  const mountedSkill = skills.operations.listThreadDeviations.out.parse(mounts.data).temporary.find(item => item.skillId === skill!.skillId && item.removedAt === null);
  expect(mountedSkill?.versionId).toBeTruthy();
  const messagePath = `/chat/threads/${encodeURIComponent(threadId)}/messages?limit=100`;
  const readMessages = async () => {
    const response = await aidtV2Api(page, messagePath);
    expect(response.status).toBe(200);
    return chat.operations.listMessages.out.parse(response.data).messages;
  };
  const existingMessages = await readMessages();
  const before = new Set(existingMessages.map(message => message.id));
  const authoredStudentTexts = [...existingMessages.filter(message => message.authorKind === "human").map(message => message.text), prompt];
  const stagesBefore = await Promise.all([1, 2, 3, 4, 5, 6].map(id => readAidtV2Stage(page, projectId, id)));
  const stageLimit = Number(new URL(page.url()).searchParams.get("step"));
  let expectedSelector: AidtContextSelector;
  if (skillName === "dt-summarize-project") {
    const materials = page.getByTestId("aidt-summary-materials");
    if (!await materials.locator("pre").isVisible()) await materials.locator("summary").first().click();
    await expect(materials.locator("pre")).toBeVisible();
    const packet = JSON.parse(await materials.locator("pre").innerText()) as { projectId: string; currentStages: { stageId: number; revision: number }[]; historyRevisions: { stageId: number; revision: number }[] };
    expect(packet.projectId).toBe(projectId);
    expectedSelector = AidtContextSelector.parse({ schemaVersion: 1, projectId, purpose: "summary", stageRevisions: packet.currentStages.map(({ stageId, revision }) => ({ stageId, revision })), historyRevisions: packet.historyRevisions });
  } else {
    const refs = stagesBefore.filter((stage): stage is SharedStageValue => stage !== null && stage.stageId <= stageLimit).map(stage => ({ stageId: stage.stageId, revision: stage.revision }));
    const frozenS5 = stageLimit === 6 && stagesBefore[5] ? readAidtQuestionSnapshot(stagesBefore[5].content.draft)?.sourceStageRevision : null;
    if (frozenS5) { const ref = refs.find(row => row.stageId === 5); if (ref) ref.revision = frozenS5; else refs.push({ stageId: 5, revision: frozenS5 }); }
    const returnRevision = new URL(page.url()).searchParams.get("returnRevision");
    expectedSelector = AidtContextSelector.parse({ schemaVersion: 1, projectId, purpose: "stage", stageId: stageLimit, stageRevisions: refs,
      ...(returnRevision !== null ? { returnRevision: Number(returnRevision) } : {}) });
  }
  const selectedRefs = [...expectedSelector.stageRevisions, ...(expectedSelector.purpose === "summary" ? expectedSelector.historyRevisions : []), ...(expectedSelector.purpose === "stage" && expectedSelector.returnRevision !== undefined ? [{ stageId: 6, revision: expectedSelector.returnRevision }] : [])];
  const selectedStages = await Promise.all([...new Map(selectedRefs.map(ref => [`${ref.stageId}:${ref.revision}`, ref])).values()].map(ref => readAidtV2StageRevision(page, projectId, ref.stageId, ref.revision, stagesBefore)));
  const contextMarkers = [...stagesBefore.filter((stage): stage is SharedStageValue => stage !== null), ...selectedStages].flatMap(stage => Object.entries(stage.content.draft.fields)
    .filter(([, value]) => value.length >= 12 && !/^[\[{]/.test(value)).map(([field, marker]) => ({ stageId: stage.stageId, revision: stage.revision, field, marker })));
  const previousRunIds = new Set(await page.locator("[data-run-id]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-run-id"))));
  const reservation = reserveAidtNativeRun(projectId, threadId, skillName, prompt);
  let observedRunId: string | undefined;
  let failureCode = "ASSERTION_OR_NATIVE_RUN_FAILED";
  let reviewedPermissionId: string | null | undefined;
  let frozenReceipt: AidtContextReceipt | undefined;
  const intentChoices: unknown[] = [];
  let sawRunning = false;
  const watch = () => {
    // This observation reads the native UI state; no request is routed or replaced.
    return page.getByTestId("copilotkit-v2-send").getAttribute("data-send-state").then(state => {
      if (state === "running") sawRunning = true;
      return state;
    });
  };
  try {
    const request = await sendViaWorkbench(page, prompt);
    recordAidtNativeRequest(reservation, new URL(request.url()).pathname);
    console.info(`[aidt-v2] native request observed · ${skillName} · budget entry ${reservation}`);
    expect(new URL(request.url()).origin).toBe(new URL(REAL_MODEL_SMOKE.baseUrl).origin);
    const wireMetadata = aidtV2WireMetadata(request.postDataJSON(), contextMarkers, skillName, expectedSelector, authoredStudentTexts);
    await test.info().attach(`native-wire-shape-${skillName}`, { contentType: "application/json", body: Buffer.from(JSON.stringify(wireMetadata, null, 2)) });
    let fresh: Awaited<ReturnType<typeof readMessages>> = [];
    await expect.poll(async () => {
      const state = await watch();
      const runIds = await page.locator("[data-run-id]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-run-id")));
      observedRunId = runIds.find((id): id is string => Boolean(id && !previousRunIds.has(id))) ?? observedRunId;
      if (observedRunId) {
        if (!frozenReceipt) {
          const source = await aidtV2Api(page, aidtContextOperations.receipt.path.replace(":runId", encodeURIComponent(observedRunId)));
          expect(source.status).toBe(200);
          frozenReceipt = validateAidtV2Receipt(source.data, { selector: expectedSelector, runId: observedRunId, skillVersionId: mountedSkill!.versionId, requireDispatch: false });
        }
        const response = await aidtV2Api(page, `/agent-runs/${encodeURIComponent(observedRunId)}`);
        expect(response.status).toBe(200);
        const actualRun = wave2Runtime.operations.getAgentRun.out.parse(response.data);
        if (["failed", "cancelled", "paused"].includes(actualRun.status)) {
          failureCode = `NATIVE_RUN_${actualRun.status.toUpperCase()}_${actualRun.error ?? "UNKNOWN"}`;
          throw new Error(failureCode);
        }
        if (actualRun.status === "awaiting_tool_permission") {
          if (actualRun.pendingApproval?.toolName !== "confirm_task_intent" || !review?.reviewSyntheticIntent) {
            failureCode = "NATIVE_RUN_REQUIRES_EXPLICIT_STUDENT_REVIEW_NO_AUTOMATIC_PERMISSION";
            throw new Error(failureCode);
          }
          const permissionId = actualRun.pendingApproval.permissionRequestId;
          if (!permissionId) throw new Error("NATIVE_INTENT_PERMISSION_ID_REQUIRED");
          if (reviewedPermissionId && reviewedPermissionId !== permissionId) throw new Error("NATIVE_ADDITIONAL_TASK_CONFIRMATION_REQUIRES_SEPARATE_REVIEW");
          if (!reviewedPermissionId) {
            intentChoices.push(await review.reviewSyntheticIntent(observedRunId));
            reviewedPermissionId = permissionId;
          }
          return false;
        }
      }
      if (await page.getByTestId("copilotkit-v2-error").count()) {
        failureCode = "NATIVE_RUN_ERROR_BANNER_WITHOUT_SUCCESSFUL_DURABLE_REPLY";
        throw new Error(failureCode);
      }
      fresh = (await readMessages()).filter(message => !before.has(message.id));
      return sawRunning && state !== "running" && fresh.some(message => message.authorKind === "agent" && message.agentRunId && message.text.trim());
    }, { timeout: REAL_MODEL_SMOKE.runTimeoutMs, intervals: [300, 700, 1_000] }).toBe(true);
    expect(fresh.some(message => message.authorKind === "human" && message.text === prompt)).toBe(true);
    const reply = fresh.find(message => message.authorKind === "agent" && message.agentRunId && message.text.trim())!;
    const runResponse = await aidtV2Api(page, `/agent-runs/${encodeURIComponent(reply.agentRunId!)}`);
    expect(runResponse.status).toBe(200);
    const run = wave2Runtime.operations.getAgentRun.out.parse(runResponse.data);
    observedRunId = run.runId;
    expect(run.status).toBe("succeeded");
    expect(run.threadId).toBe(threadId);
    expect(run.resultMessageId).toBe(reply.id);
    expect(run.skillVersionIds).toEqual([mountedSkill!.versionId]);
    expect(run.modelProvider.toLowerCase()).not.toMatch(/fixture|loopback|mock/);
    await expect(page.getByTestId("copilotkit-v2-error")).toHaveCount(0);
    const source = await aidtV2Api(page, aidtContextOperations.receipt.path.replace(":runId", encodeURIComponent(run.runId)));
    expect(source.status).toBe(200);
    const sourceReceipt = validateAidtV2Receipt(source.data, { selector: expectedSelector, runId: run.runId, skillVersionId: mountedSkill!.versionId, snapshotHash: frozenReceipt?.snapshotHash,
      originalDispatchAttemptId: frozenReceipt?.application.state === "message-dispatch-observed" ? frozenReceipt.application.attemptId ?? undefined : frozenReceipt?.application.inheritedMessageDispatchAttemptId ?? undefined });
    const panel = page.getByTestId("aidt-run-context-receipt");
    await expect(panel).toBeVisible();
    expect(await panel.evaluate(node => (node as HTMLDetailsElement).open)).toBe(false);
    const uiRead = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === apiPath(aidtContextOperations.receipt.path.replace(":runId", encodeURIComponent(run.runId))));
    await panel.locator("summary").first().click();
    const uiResponse = await uiRead; expect(uiResponse.status()).toBe(200);
    const uiReceipt = validateAidtV2Receipt(await uiResponse.json(), { selector: expectedSelector, runId: run.runId, skillVersionId: mountedSkill!.versionId, snapshotHash: sourceReceipt.snapshotHash });
    await expect(panel).toContainText(sourceReceipt.application.state === "checkpoint-resume-observed" ? "已沿用原材料续跑" : "材料已随本轮消息派发");
    for (const ref of sourceReceipt.stageRevisions) await expect(panel.getByLabel("本轮实际使用的保存版本")).toContainText(`第 ${ref.stageId} 步 · V${ref.revision}`);
    for (const ref of sourceReceipt.historyRevisions) await expect(panel.getByLabel("本轮实际使用的保存版本")).toContainText(`历史第 ${ref.stageId} 步 · V${ref.revision}`);
    if (sourceReceipt.returnRevision !== undefined) await expect(panel).toContainText(`返工记录 · 第 6 步 V${sourceReceipt.returnRevision}`);
    await panel.getByText("来源核对信息", { exact: true }).click();
    await expect(panel.getByText(sourceReceipt.snapshotHash, { exact: true })).toBeVisible();
    await expect(panel.getByText(sourceReceipt.application.assembledContextHash!, { exact: true })).toBeVisible();
    expect(await Promise.all([1, 2, 3, 4, 5, 6].map(id => readAidtV2Stage(page, projectId, id))), "Agent不得替学生确认/保存阶段成果").toEqual(stagesBefore);
    finishAidtNativeRun(reservation, { succeeded: true, runId: run.runId });
    console.info(`[aidt-v2] durable native run succeeded · ${skillName} · ${run.runId}`);
    return { threadId, skillId: skill!.skillId, runId: run.runId, agentId: run.agentId, modelProvider: run.modelProvider, modelId: run.modelId,
      agentVersionId: run.agentVersionId, skillVersionIds: run.skillVersionIds, sawRunning, studentInput: prompt,
      assistantMessageId: reply.id, assistantText: reply.text, syntheticInput: true, stageSavedByAgent: false, selectorCoordinates: expectedSelector, sourceReceipt, uiReceipt,
      mountedSkillVersionId: mountedSkill!.versionId, wireMetadata,
      modelActorRole: process.env.AIDT_V2_ACCOUNT_ROLE ?? "unspecified", studentPermissionProvenByModelRun: false, intentChoices };
  } catch (error) {
    finishAidtNativeRun(reservation, { succeeded: false, runId: observedRunId, failureCode });
    throw error;
  }
}

export function copySaveInput(stage: SharedStageValue, fields: Record<string, string>) {
  return { projectId: stage.projectId, stageId: stage.stageId, operationId: randomUUID(), expectedRevision: stage.revision,
    sourceStageRevisions: stage.sourceStageRevisions, content: { ...stage.content, draft: { ...stage.content.draft, fields: { ...stage.content.draft.fields, ...fields } } } };
}

export { SharedStage };
