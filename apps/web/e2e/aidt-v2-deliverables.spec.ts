import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { files, identity, wave2Runtime } from "@repo/contracts";
import { SESSION_STORAGE_KEY } from "../components/session/session-provider";
import { operations as contextOperations } from "@repo/contracts/aidt-run-context";
import { aidtResearchContentPath, parseAidtResearchMaterial } from "../features/aidt/lib/aidt-research-materials";
import { REAL_MODEL_SMOKE } from "./real-model-smoke-fixture";
import { V2_SEND_WIRE } from "./chat-v2-send";
import { apiPath } from "./support/real-model-api";
import { readCompletionState } from "./support/aidt-v2-completion-state";
import { observeAidtNativePrint, readAidtNativePrints } from "./support/aidt-v2-print-observation";
import { fillAidtV2Field } from "./support/aidt-v2-stage-cases";
import { aidtV2Api, aidtV2Bytes, createAidtV2Group, loginAidtV2, openAidtV2Outcome, readAidtV2Stage, saveAidtV2Stage } from "./support/aidt-v2-acceptance";

test.beforeAll(() => {
  expect(process.env.AIDT_V2_NO_MODEL_DELIVERABLES).toBe("1");
  expect(process.env.AIDT_V2_RUN_LEDGER, "零费材料用例不加载或消耗收费账本").toBeUndefined();
  expect(process.env.WORKSPACEX_ISOLATION_ID).toBeTruthy();
  expect(new URL(REAL_MODEL_SMOKE.baseUrl).hostname).toBe("127.0.0.1");
});
function watchGeneration(page: Page) {
  const requests: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && (V2_SEND_WIRE.test(path) || /\/pm-designs\/[^/]+\/(chat|variants)$/.test(path)
      || /\/agent-runs\/[^/]+\/(decision|resume|execute)$/.test(path))) requests.push(path);
  });
  return requests;
}

test("no-model S2: student manual fallback keeps the original and exports actual adopted-guide PDF bytes", async ({ page, context, browser }, info) => {
  const stateFile = process.env.AIDT_V2_COMPLETION_STATE!, stateBefore = readFileSync(stateFile);
  const state = readCompletionState(), projectId = state.projectId!;
  expect(state.phases.s2?.status).toBe("attempting");
  const runId = process.env.AIDT_V2_CANCELLED_S2_RUN_ID!; expect(runId).toBeTruthy();
  await loginAidtV2(page); const generations = watchGeneration(page);
  const run = await aidtV2Api(page, `/agent-runs/${runId}`); expect(run.status).toBe(200);
  expect(wave2Runtime.operations.getAgentRun.out.parse(run.data).status).toBe("cancelled");
  const receiptBeforeResponse = await aidtV2Api(page, contextOperations.receipt.path.replace(":runId", runId)); expect(receiptBeforeResponse.status).toBe(200);
  const receiptBefore = contextOperations.receipt.out.parse(receiptBeforeResponse.data);
  await openAidtV2Outcome(page, projectId, 2); const before = (await readAidtV2Stage(page, projectId, 2))!;
  const original = before.content.draft.fields.guide!; expect(original).toBeTruthy();
  await expect(page.getByTestId("aidt-interview-guide-print")).toBeDisabled();
  const manual = "FALLBACK-S2-MANUAL-20261116\n本次AI任务未成功，以下是学生人工自行修订，不是采纳AI结论。\n1. 请讲述一次在陌生地方寻找取餐区域的经过。\n2. 当时你留意了哪些提示？\n3. 哪个地方还需要别人解释？\n这只是合成课堂访谈计划，采访尚未开展。";
  await fillAidtV2Field(page, "adoptedGuide", manual);
  await fillAidtV2Field(page, "reflection", "AI被错误echo基础角色阻断并已取消。学生选择人工先改写提纲；不把该fallback标成Agent成功或完整六步链完成。");
  const saved = await saveAidtV2Stage(page, projectId, 2);
  expect(saved.content.draft.fields.guide).toBe(original); expect(saved.content.draft.fields.adoptedGuide).toBe(manual);
  expect(saved.sourceStageRevisions).toEqual(before.sourceStageRevisions);
  await page.getByTestId("aidt-interview-guide-preview-toggle").click();
  await expect(page.getByTestId("aidt-interview-guide-preview").locator("pre")).toHaveText(manual);
  await page.getByTestId("aidt-interview-guide-original").locator("summary").click();
  await expect(page.getByTestId("aidt-interview-guide-original")).toContainText(original);
  await observeAidtNativePrint(page, true); await page.getByTestId("aidt-interview-guide-print").click();
  await expect.poll(async () => (await readAidtNativePrints(page)).length).toBe(1);
  const doc = (await readAidtNativePrints(page))[0]!;
  expect(doc.title).toBe("访谈问题清单 · 学生采纳稿"); expect(doc.text).toContain(manual); expect(doc.text).not.toContain(original);
  expect(doc.printableHtml).toBeTruthy(); const pdfPage = await context.newPage(); let pdfSha256 = "", pdfBytes = 0;
  try {
    await pdfPage.setContent(doc.printableHtml!, { waitUntil: "load" }); await pdfPage.evaluate(() => document.fonts.ready.then(() => undefined));
    const file = info.outputPath("student-manual-interview-guide.pdf"), bytes = await pdfPage.pdf({ path: file, format: "A4", printBackground: true });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-"); expect(bytes.length).toBeGreaterThan(1_000);
    const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
    expect(text.replace(/\s/g, "")).toContain(manual.replace(/\s/g, "")); expect(text).not.toContain(original);
    pdfSha256 = createHash("sha256").update(bytes).digest("hex"); pdfBytes = bytes.length;
    await info.attach("actual-student-manual-interview-guide-pdf", { path: file, contentType: "application/pdf" });
  } finally { await pdfPage.close(); }
  expect(await readAidtV2Stage(page, projectId, 2)).toEqual(saved);
  const receiptAfterResponse = await aidtV2Api(page, contextOperations.receipt.path.replace(":runId", runId)); expect(receiptAfterResponse.status).toBe(200);
  const receiptAfter = contextOperations.receipt.out.parse(receiptAfterResponse.data);
  expect(receiptAfter.snapshotHash).toBe(receiptBefore.snapshotHash); expect(receiptAfter.stageRevisions).toEqual(receiptBefore.stageRevisions);
  const freshContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  try {
    const fresh = await freshContext.newPage(); await loginAidtV2(fresh); await openAidtV2Outcome(fresh, projectId, 2);
    expect(await readAidtV2Stage(fresh, projectId, 2)).toEqual(saved);
    await expect(fresh.getByTestId("aidt-field-adoptedGuide")).toHaveValue(manual);
  } finally { await freshContext.close(); }
  expect(generations).toEqual([]); expect(readFileSync(stateFile)).toEqual(stateBefore);
  await info.attach("s2-manual-fallback-guide-pdf", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    projectId, cancelledRunId: runId, before, saved, pdfSha256, pdfBytes, actualBeforeprint: true,
    pdfMethod: "Chromium PDF from copy of actual product print DOM", nativeSaveDialogAutomated: false,
    aiTaskSucceeded: false, manualFallback: true, phaseStateUnchanged: true, receiptBefore, receiptAfter,
    nativeOrDesignRequests: generations, freshLoginExactReadback: true, teachingAcceptance: "pending-human-review",
  }, null, 2)) });
});

test("no-model S6: independent synthetic feedback file uploads, persists, rereads exact bytes and rejects cross-project/nonmember access", async ({ page, browser }, info) => {
  await loginAidtV2(page); const generations = watchGeneration(page);
  const projectId = await createAidtV2Group(page, "独立测试原件零模型验收"); await openAidtV2Outcome(page, projectId, 6);
  const directory = resolve(process.env.AIDT_V2_FIXTURE_DIR ?? "e2e/fixtures/aidt-v2");
  const original = readFileSync(join(directory, "SYN-TEST-FEEDBACK.txt")), syntheticImage = readFileSync(join(directory, "SYN-A.png"));
  const control = page.getByTestId("aidt-research-material-control").and(page.locator('[aria-label="测试原始材料"]'));
  const uploadReceipts = [];
  for (const filename of ["SYN-TEST-FEEDBACK.txt", "SYN-A.png"]) {
    await control.getByLabel("测试原始材料选择文件", { exact: true }).setInputFiles(join(directory, filename));
    const upload = page.waitForResponse(value => value.request().method() === "POST" && new URL(value.url()).pathname === apiPath(files.operations.uploadArtifact.path.replace(":projectId", projectId)));
    await control.getByRole("button", { name: "保存原始材料", exact: true }).click(); const response = await upload; expect(response.status()).toBe(201);
    const receipt = files.operations.uploadArtifact.out.parse(await response.json()); expect(receipt.runs).toHaveLength(1); uploadReceipts.push(receipt);
    await expect(control.getByRole("status")).toContainText("原件已保存并回读，已加入草稿");
  }
  await fillAidtV2Field(page, "said", "独立软件验收夹具反馈见已上传SYN-TEST-FEEDBACK.txt，非真人测试或真实用户引文。");
  await fillAidtV2Field(page, "reflection", "仅验证测试材料保存与授权读取；PNG为合成示意图，仅测试预览，非测试照片。没有关联原型、不补造认识变化或确认学习完成。");
  const saved = await saveAidtV2Stage(page, projectId, 6);
  const references = Object.entries(saved.content.draft.fields).filter(([key]) => key.startsWith("researchFile:")).map(([, value]) => parseAidtResearchMaterial(value));
  expect(references).toHaveLength(2); const reference = references.find(value => value?.name === "SYN-TEST-FEEDBACK.txt")!;
  const imageReference = references.find(value => value?.name === "SYN-A.png")!; expect(reference).not.toBeNull(); expect(imageReference).not.toBeNull();
  expect(reference.artifactId).toBe(uploadReceipts[0]!.runs[0]!.artifactId); expect(reference.runId).toBe(uploadReceipts[0]!.runs[0]!.ingestionRunId);
  expect(reference.sha256).toBe(createHash("sha256").update(original).digest("hex"));
  const bytes = await aidtV2Bytes(page, aidtResearchContentPath(reference)); expect(bytes.status).toBe(200); expect(Buffer.from(bytes.base64, "base64")).toEqual(original);
  expect(bytes.headers["x-artifact-id"]).toBe(reference.artifactId); expect(bytes.headers["x-artifact-version-id"]).toBe(reference.versionId);
  expect(bytes.headers["x-content-sha256"]).toBe(reference.sha256); expect(bytes.headers["x-upload-submitted-by"]).toBe(saved.updatedBy);
  expect(bytes.headers["x-upload-submitted-at"]).toBe(reference.submittedAt);
  const imageBytes = await aidtV2Bytes(page, aidtResearchContentPath(imageReference)); expect(imageBytes.status).toBe(200);
  expect(Buffer.from(imageBytes.base64, "base64")).toEqual(syntheticImage); expect(imageReference.sha256).toBe(createHash("sha256").update(syntheticImage).digest("hex"));
  const preview = page.getByTestId("aidt-research-material-preview").filter({ has: page.getByText("SYN-A.png", { exact: true }) });
  await expect.poll(() => preview.locator("img").evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  for (const absent of ["questionSnapshot", "prototypeReference", "iterationPrototypeReference", "newVersion", "reflectionConfirmed"]) expect(saved.content.draft.fields[absent] ?? "").toBe("");
  const otherProjectId = await createAidtV2Group(page, "独立测试材料隔离对照");
  const wrongScope = await aidtV2Api(page, aidtResearchContentPath({ ...reference, projectId: otherProjectId })); expect(wrongScope.status).toBe(404);
  const memberContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  const ownerSession = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as { userId: string; currentOrgId: string }, SESSION_STORAGE_KEY);
  let sameOrgMember: unknown;
  try {
    const member = await memberContext.newPage(); await loginAidtV2(member, "member");
    const actual = await aidtV2Api(member, `/identity/me?orgId=${encodeURIComponent(ownerSession.currentOrgId)}`); expect(actual.status).toBe(200);
    const memberIdentity = identity.operations.resolveIdentity.out.parse(actual.data); expect(memberIdentity.org.id).toBe(ownerSession.currentOrgId);
    const memberSession = await member.evaluate(key => JSON.parse(localStorage.getItem(key)!) as { userId: string; currentOrgId: string }, SESSION_STORAGE_KEY);
    expect(memberSession.currentOrgId).toBe(ownerSession.currentOrgId); expect(memberSession.userId).not.toBe(ownerSession.userId);
    expect(memberIdentity.orgRole).toBe("consultant"); sameOrgMember = { userId: memberSession.userId, orgId: memberSession.currentOrgId, orgRole: memberIdentity.orgRole };
    expect((await aidtV2Api(member, `/projects/${projectId}/aidt/stages/6`)).status).toBe(404);
    expect((await aidtV2Api(member, aidtResearchContentPath(reference))).status).toBe(404);
  } finally { await memberContext.close(); }
  const freshContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  try {
    const fresh = await freshContext.newPage(); await loginAidtV2(fresh); await openAidtV2Outcome(fresh, projectId, 6);
    expect(await readAidtV2Stage(fresh, projectId, 6)).toEqual(saved);
    const reread = await aidtV2Bytes(fresh, aidtResearchContentPath(reference)); expect(reread.status).toBe(200); expect(Buffer.from(reread.base64, "base64")).toEqual(original);
    await expect(fresh.getByTestId("aidt-research-original-text")).toContainText("合成");
    const image = fresh.getByTestId("aidt-research-material-preview").filter({ has: fresh.getByText("SYN-A.png", { exact: true }) }).locator("img");
    await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
  } finally { await freshContext.close(); }
  expect(generations).toEqual([]);
  await info.attach("s6-independent-synthetic-test-original", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    projectId, otherProjectId, uploadReceipts, saved, reference, imageReference, downloadedBytes: original.length, imageBytes: syntheticImage.length,
    imageDecodedBeforeAndAfterLogin: true, imageOnlySyntheticDiagramNotTestPhoto: true, sameOrgMember, exactBytesShaVerified: true,
    wrongProjectStatus: wrongScope.status, nonmemberStatuses: [404, 404], freshLoginExactReadback: true,
    nativeOrDesignRequests: generations, noPrototypeWasInvented: true, fullSixStepJourneyProven: false, allInputSynthetic: true,
  }, null, 2)) });
});
