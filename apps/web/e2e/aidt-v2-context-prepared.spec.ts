import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { chat, skills, wave2Runtime } from "@repo/contracts";
import { AidtContextSelector, operations as contextOperations, type AidtContextReceipt } from "@repo/contracts/aidt-run-context";
import { CancelRunOutput } from "@repo/contracts/run-control";
import { REAL_MODEL_SMOKE, REAL_MODEL_SKIP_REASON } from "./real-model-smoke-fixture";
import { sendViaWorkbench, V2_SEND_WIRE } from "./chat-v2-send";
import { aidtV2Api, loginAidtV2, readAidtV2Stage } from "./support/aidt-v2-acceptance";
import { prepareAidtV2StageCase } from "./support/aidt-v2-stage-cases";
import { aidtV2WireMetadata, validateAidtV2Receipt } from "./support/aidt-v2-wire-metadata";
import { apiPath } from "./support/real-model-api";

test.beforeAll(() => {
  expect(process.env.AIDT_V2_PREPARED_ONLY, "必须独立启用零模型受理用例").toBe("1");
  expect(process.env.AIDT_V2_AUTOSTART_CONFIRMED, "必须由栈owner明确确认executor autostart0，不能自行关执行或猜状态").toBe("0");
  expect(REAL_MODEL_SKIP_REASON).toBeNull();
  expect(new URL(REAL_MODEL_SMOKE.baseUrl).hostname).toBe("127.0.0.1");
  expect(process.env.WORKSPACEX_ISOLATION_ID).toBeTruthy();
});

test("health-only native S2 acceptance fixes server sources, exposes a collapsed prepared receipt and cancels the owned queued run", async ({ page }, info) => {
  await loginAidtV2(page);
  const { projectId } = await prepareAidtV2StageCase(page, 2);
  const stages = await Promise.all([1, 2, 3, 4, 5, 6].map(id => readAidtV2Stage(page, projectId, id)));
  const selector = AidtContextSelector.parse({ schemaVersion: 1, projectId, purpose: "stage", stageId: 2, stageRevisions: stages.flatMap(row => row && row.stageId <= 2 ? [{ stageId: row.stageId, revision: row.revision }] : []) });
  const markers = stages.flatMap(row => row ? Object.entries(row.content.draft.fields).filter(([, value]) => value.length >= 12 && !/^[\[{]/.test(value)).map(([field, marker]) => ({ stageId: row.stageId, field, marker })) : []);
  await page.goto(`/aidt/${projectId}?step=2&tool=chat`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("aidt-step-skill").waitFor({ state: "visible" });
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBeTruthy();
  const threadId = new URL(page.url()).searchParams.get("thread")!;
  const mountResponse = await aidtV2Api(page, skills.operations.listThreadDeviations.path.replace(":threadId", encodeURIComponent(threadId)));
  expect(mountResponse.status).toBe(200);
  const mounted = skills.operations.listThreadDeviations.out.parse(mountResponse.data).temporary.filter(row => row.removedAt === null);
  expect(mounted).toHaveLength(1);
  const prompt = `合成零模型受理检查 ${randomUUID()}\n学生只问：还需要补哪些研究问题？不宣称已访谈。`;
  const beforeMessages = await aidtV2Api(page, `/chat/threads/${encodeURIComponent(threadId)}/messages?limit=100`);
  expect(beforeMessages.status).toBe(200);
  const priorIds = new Set(chat.operations.listMessages.out.parse(beforeMessages.data).messages.map(row => row.id));
  const nativeRequests: string[] = [], receiptRequests: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && V2_SEND_WIRE.test(path)) nativeRequests.push(path);
    if (request.method() === "GET" && /\/agent-runs\/[^/]+\/aidt-context$/u.test(path)) receiptRequests.push(path);
  });
  let runId: string | undefined, cancelAttempted = false, cancelled = false, nativeSent = false;
  let serverReceipt: AidtContextReceipt | undefined, queuedVerified = false, uiReadVerified = false;
  const cancelOwnedQueuedRun = async () => {
    if (!runId || cancelAttempted) return;
    cancelAttempted = true;
    // Existing controller/usecase path; queued cancellation is terminal and never starts execution.
    const result = await aidtV2Api(page, `/agent-runs/${encodeURIComponent(runId)}/cancel`, "POST");
    expect(result.status).toBe(202);
    expect(CancelRunOutput.parse(result.data).status).toBe("cancelled");
    const final = await aidtV2Api(page, `/agent-runs/${encodeURIComponent(runId)}`);
    expect(final.status).toBe(200); expect(wave2Runtime.operations.getAgentRun.out.parse(final.data).status).toBe("cancelled");
    cancelled = true;
  };
  try {
    const request = await sendViaWorkbench(page, prompt);
    nativeSent = true;
    let human: ReturnType<typeof chat.operations.listMessages.out.parse>["messages"][number] | undefined;
    // Resolve durable ownership first so even a later QA assertion failure can safely cancel this exact run.
    await expect.poll(async () => {
      const response = await aidtV2Api(page, `/chat/threads/${encodeURIComponent(threadId)}/messages?limit=100`);
      expect(response.status).toBe(200);
      human = chat.operations.listMessages.out.parse(response.data).messages.find(row => !priorIds.has(row.id) && row.authorKind === "human" && row.text === prompt && row.agentRunId);
      runId = human?.agentRunId ?? undefined;
      return Boolean(runId);
    }).toBe(true);
    expect(human?.text).toBe(prompt);
    const wire = aidtV2WireMetadata(request.postDataJSON(), markers, "aidt-empathize", selector, [prompt]);
    const actual = await aidtV2Api(page, `/agent-runs/${encodeURIComponent(runId!)}`);
    expect(actual.status).toBe(200);
    const run = wave2Runtime.operations.getAgentRun.out.parse(actual.data);
    expect(run.status).toBe("queued"); expect(run.threadId).toBe(threadId); expect(run.skillVersionIds).toEqual([mounted[0]!.versionId]);
    queuedVerified = true;
    expect(receiptRequests).toEqual([]);
    const path = contextOperations.receipt.path.replace(":runId", encodeURIComponent(runId!));
    const server = await aidtV2Api(page, path); expect(server.status).toBe(200);
    const receipt = validateAidtV2Receipt(server.data, { selector, runId: runId!, skillVersionId: mounted[0]!.versionId, requireDispatch: false });
    expect(receipt.application).toMatchObject({ state: "prepared", assembledContextHash: null, messageDispatchedAt: null, checkpointResumedAt: null });
    serverReceipt = receipt;
    const panel = page.getByTestId("aidt-run-context-receipt");
    await expect(panel).toBeVisible(); expect(await panel.evaluate(node => (node as HTMLDetailsElement).open)).toBe(false);
    expect(receiptRequests).toHaveLength(1); // The one explicit independent GET above; collapsed UI did not read.
    const uiGet = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === apiPath(path));
    await panel.locator("summary").first().click();
    const uiResponse = await uiGet; expect(uiResponse.status()).toBe(200);
    expect(validateAidtV2Receipt(await uiResponse.json(), { selector, runId: runId!, skillVersionId: mounted[0]!.versionId, snapshotHash: receipt.snapshotHash, requireDispatch: false })).toEqual(receipt);
    uiReadVerified = true;
    await expect(panel).toContainText("材料已固定"); await expect(panel).toContainText("尚未确认交给模型");
    await panel.getByText("来源核对信息", { exact: true }).click(); await expect(panel.getByText(receipt.snapshotHash, { exact: true })).toBeVisible();
    expect(nativeRequests).toHaveLength(1);
    expect(await Promise.all([1, 2, 3, 4, 5, 6].map(id => readAidtV2Stage(page, projectId, id)))).toEqual(stages);
    await cancelOwnedQueuedRun();
    await info.attach("zero-model-native-prepared-receipt", { contentType: "application/json", body: Buffer.from(JSON.stringify({ projectId, threadId, runId, promptIsSynthetic: true, humanExact: true, wire, receipt, queuedBeforeCancel: true, cancelled, nativeSendCount: nativeRequests.length, savedStagesUnchanged: true, paidLedgerFunctionCalled: false, supplierExecutionRequested: false, ownerPhysicalUsageRecheckRequired: true }, null, 2)) });
  } finally {
    if (nativeSent && !runId) {
      const response = await aidtV2Api(page, `/chat/threads/${encodeURIComponent(threadId)}/messages?limit=100`);
      if (response.status === 200) runId = chat.operations.listMessages.out.parse(response.data).messages.find(row => !priorIds.has(row.id) && row.authorKind === "human" && row.text === prompt)?.agentRunId ?? undefined;
    }
    await cancelOwnedQueuedRun();
    if (nativeSent && !cancelled) throw new Error("OWNED_QUEUED_RUN_CLEANUP_NOT_CONFIRMED_KEEP_EXECUTOR_DISABLED");
    await info.attach("zero-model-owned-run-cleanup", { contentType: "application/json", body: Buffer.from(JSON.stringify({ projectId, threadId, runId, nativeSent, queuedVerified, serverReceipt, uiReadVerified, cancelAttempted, cancelled, nativeSendCount: nativeRequests.length, paidLedgerFunctionCalled: false, supplierExecutionRequested: false, ownerPhysicalUsageRecheckRequired: true }, null, 2)) });
  }
});
