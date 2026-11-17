import { isAidtRemediation } from "./support/aidt-v2-remediation-criteria";
import { createHash } from "node:crypto";
import { readAidtQuestionSnapshot } from "../features/aidt/lib/aidt-verification-loop";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { chat, planPermissions, wave2Runtime } from "@repo/contracts";
import { operations as contextOperations, AidtContextSelector } from "@repo/contracts/aidt-run-context";
import * as designWorkbench from "@repo/contracts/design-workbench";
import * as designPrototype from "@repo/contracts/design-prototype";
import { operations as stageOperations } from "@repo/contracts/aidt-stages";
import { REAL_MODEL_SMOKE } from "./real-model-smoke-fixture";
import { apiPath } from "./support/real-model-api";
import { assertFreshAidtJourney } from "./support/aidt-v2-fresh-journey";
import { completeCompletionPhase, readCompletionState } from "./support/aidt-v2-completion-state";
import { completionGuidePdf } from "./support/aidt-v2-completion-materials";
import { existingAidtNativeRun, finishAidtNativeRun } from "./support/aidt-v2-run-ledger";
import { expectedAidtV2StageSelector, validateAidtV2Receipt } from "./support/aidt-v2-wire-metadata";
import { fillAidtV2Field } from "./support/aidt-v2-stage-cases";
import { aidtV2Api, assertAidtV2Target, loginAidtV2, openAidtV2Outcome, readAidtV2Stage, saveAidtV2Stage } from "./support/aidt-v2-acceptance";

test("same-run S2 plan continuation: review current scratch todos once, preserve original interruption, student saves and exports", async ({ page, browser }, info) => {
  test.setTimeout(210_000); assertAidtV2Target(); expect(assertFreshAidtJourney()).toBe(true);
  expect(process.env.AIDT_V2_ALLOW_CURRENT_S2_PLAN_ONCE).toBe("reviewed-write-todos-once");
  const proof = JSON.parse(readFileSync(process.env.AIDT_V2_S2_PLAN_REVIEW_PROOF!, "utf8")) as { runId: string; toolName: string; permissionRequestId: string; storedArgsDigest: string; recoveredArgsDigest: string };
  expect(proof.toolName).toBe("write_todos"); expect(proof.storedArgsDigest).toBe(proof.recoveredArgsDigest);
  const entry = existingAidtNativeRun(proof.runId), state = readCompletionState();
  expect(entry.skill).toBe("aidt-empathize"); expect(entry.status).toBe("failed-or-interrupted"); expect(state.projectId).toBe(entry.projectId); expect(state.phases.s2?.status).toBe("attempting");
  const originalJournal = JSON.parse(readFileSync(process.env.AIDT_V2_RUN_LEDGER!, "utf8")) as { entries: unknown[] };
  await loginAidtV2(page);
  const stages = await Promise.all([1, 2, 3, 4, 5, 6].map(id => readAidtV2Stage(page, entry.projectId, id))), before = stages[1]!;
  const selector = expectedAidtV2StageSelector(entry.projectId, 2, stages);
  const runResponse = await aidtV2Api(page, `/agent-runs/${proof.runId}`); expect(runResponse.status).toBe(200);
  const pending = wave2Runtime.operations.getAgentRun.out.parse(runResponse.data);
  expect(pending.status).toBe("awaiting_tool_permission"); expect(pending.threadId).toBe(entry.threadId);
  expect(pending.pendingApproval).toMatchObject({ toolName: "write_todos", permissionRequestId: proof.permissionRequestId });
  const expectedArgs = { todos: [{ content: "阅读第2步与承接来源材料，理解当前进度与已知缺口", status: "completed" }, { content: "提出一个澄清问题，帮助学生继续讨论共情方式", status: "completed" }] };
  expect(JSON.parse(pending.pendingApproval!.argsSummary!)).toEqual(expectedArgs);
  const messagesPath = `/chat/threads/${entry.threadId}/messages?limit=100`;
  const messages = async () => { const result = await aidtV2Api(page, messagesPath); expect(result.status).toBe(200); return chat.operations.listMessages.out.parse(result.data).messages; };
  const humansBefore = (await messages()).filter(row => row.authorKind === "human");
  const receiptPath = contextOperations.receipt.path.replace(":runId", proof.runId);
  const firstReceipt = await aidtV2Api(page, receiptPath); expect(firstReceipt.status).toBe(200);
  const initialReceipt = validateAidtV2Receipt(firstReceipt.data, { selector, runId: proof.runId, skillVersionId: pending.skillVersionIds[0]! });
  await page.goto(`/aidt/${entry.projectId}?step=2&tool=chat&thread=${entry.threadId}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("aidt-step-skill").waitFor({ state: "visible" });
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "审批高风险操作", exact: true }) });
  await expect(dialog).toBeVisible(); await expect(dialog.getByText("调用工具 write_todos", { exact: true })).toBeVisible();
  expect(JSON.parse(await dialog.locator("code").innerText())).toEqual(expectedArgs);
  const path = planPermissions.operations.decidePermissionRequest.path.replace(":runId", proof.runId).replace(":permissionRequestId", proof.permissionRequestId);
  const decisionResponse = page.waitForResponse(value => value.request().method() === "POST" && new URL(value.url()).pathname === apiPath(path));
  await dialog.getByRole("button", { name: "仅本次允许", exact: true }).click();
  const decision = await decisionResponse; expect(decision.status()).toBe(200); expect(decision.request().postDataJSON()).toEqual({ decision: "once" });
  let completed = pending;
  await expect.poll(async () => {
    const result = await aidtV2Api(page, `/agent-runs/${proof.runId}`); expect(result.status).toBe(200); completed = wave2Runtime.operations.getAgentRun.out.parse(result.data);
    if (["failed", "cancelled", "paused"].includes(completed.status)) throw new Error(`SAME_RUN_${completed.status}_${completed.error}`);
    if (completed.status === "awaiting_tool_permission" && completed.pendingApproval?.permissionRequestId !== proof.permissionRequestId) throw new Error("ADDITIONAL_PERMISSION_REQUIRES_SEPARATE_REVIEW");
    return completed.status === "succeeded";
  }, { timeout: 120_000, intervals: [300, 700, 1_000] }).toBe(true);
  expect(completed.runId).toBe(proof.runId); expect(completed.threadId).toBe(entry.threadId); expect(completed.skillVersionIds).toEqual(pending.skillVersionIds);
  const actualMessages = await messages(); expect(actualMessages.filter(row => row.authorKind === "human")).toEqual(humansBefore);
  const reply = actualMessages.find(row => row.id === completed.resultMessageId)!;
  expect(reply).toMatchObject({ authorKind: "agent", agentRunId: proof.runId }); expect(reply.text.trim()).toBeTruthy();
  const receiptResult = await aidtV2Api(page, receiptPath); expect(receiptResult.status).toBe(200);
  const receipt = validateAidtV2Receipt(receiptResult.data, { selector, runId: proof.runId, skillVersionId: pending.skillVersionIds[0]!, snapshotHash: initialReceipt.snapshotHash,
    originalDispatchAttemptId: initialReceipt.application.attemptId! });
  const panel = page.getByTestId("aidt-run-context-receipt"); await expect(panel).toBeVisible();
  const uiGet = page.waitForResponse(value => value.request().method() === "GET" && new URL(value.url()).pathname === apiPath(receiptPath));
  await panel.locator("summary").first().click(); expect((await uiGet).status()).toBe(200); await expect(panel).toContainText("已沿用原材料续跑");
  expect(await readAidtV2Stage(page, entry.projectId, 2)).toEqual(before);
  await openAidtV2Outcome(page, entry.projectId, 2);
  await fillAidtV2Field(page, "adoptedGuide", "学生审阅本次真实追问后的合成提纲：请讲一次具体取餐经历；先听完整经过，再追问看到了什么。保留原稿与反例，不声称开展了真人访谈。");
  await fillAidtV2Field(page, "reflection", `引导师实际回复：${reply.text}\n学生回答与决定：尚无真人资料；先听具体经历，保留原稿和反例。内部todo确认不是学生研究结论或阶段保存。`);
  const saved = await saveAidtV2Stage(page, entry.projectId, 2);
  expect(saved.revision).toBe(before.revision + 1); expect(saved.sourceStageRevisions).toEqual(before.sourceStageRevisions); expect(saved.content.draft.fields.guide).toBe(before.content.draft.fields.guide);
  expect(saved.content.draft.discoveryCards).toEqual(before.content.draft.discoveryCards);
  const freshContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl }); let guidePdf: unknown;
  try {
    const fresh = await freshContext.newPage(); await loginAidtV2(fresh); await openAidtV2Outcome(fresh, entry.projectId, 2);
    expect(await readAidtV2Stage(fresh, entry.projectId, 2)).toEqual(saved);
    try { guidePdf = await completionGuidePdf(fresh, freshContext, entry.projectId, info); }
    catch (error) { guidePdf = { status: "failed", error: String(error), blockedLaterPhases: false }; }
  } finally { await freshContext.close(); }
  const journalAfter = JSON.parse(readFileSync(process.env.AIDT_V2_RUN_LEDGER!, "utf8")) as { entries: unknown[] };
  expect(journalAfter.entries.length).toBe(originalJournal.entries.length);
  finishAidtNativeRun(entry.id, { succeeded: true, runId: proof.runId });
  const turn = { runId: proof.runId, threadId: entry.threadId, assistantMessageId: reply.id, assistantText: reply.text, studentInput: humansBefore.at(-1)!.text,
    agentId: completed.agentId, agentVersionId: completed.agentVersionId, modelProvider: completed.modelProvider, skillVersionIds: completed.skillVersionIds, selectorCoordinates: selector, sourceReceipt: receipt };
  const evidence = { projectId: entry.projectId, turn, before, after: saved, guidePdf, synthetic: true, freshLoginExactReadback: true,
    originalTestInterruption: "s2-attempt-01: unexpected write_todos permission; preserved", decision: "once", permissionRequestId: proof.permissionRequestId,
    expectedArgs, initialReceipt, newStudentRequestSent: false, newLedgerReservation: false, teachingQuality: "pending-independent-review", ordinaryStudentModelPermissionProven: false };
  completeCompletionPhase("s2", entry.projectId, evidence);
  await info.attach("s2-same-run-plan-continuation", { contentType: "application/json", body: Buffer.from(JSON.stringify(evidence, null, 2)) });
});

test("manual S5 fallback: cancelled native retained, student confirms synthetic question through real UI for independent Design", async ({ page, browser }, info) => {
  test.setTimeout(90_000); assertAidtV2Target(); expect(assertFreshAidtJourney()).toBe(true);
  expect(isAidtRemediation(), "严格原生主链禁止任何人工桥接").toBe(false);
  expect(process.env.AIDT_V2_ALLOW_MANUAL_S5_FALLBACK).toBe("student-after-cancelled-native");
  const failedRunId = process.env.AIDT_V2_MANUAL_S5_RUN_ID!, entry = existingAidtNativeRun(failedRunId), state = readCompletionState();
  expect(entry.skill).toBe("aidt-prototype"); expect(entry.status).toBe("failed-or-interrupted"); expect(state.phases.s5?.status).toBe("attempting"); expect(state.projectId).toBe(entry.projectId);
  const stateBytes = readFileSync(process.env.AIDT_V2_COMPLETION_STATE!), generationRequests: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && /copilotkit|\/pm-designs\/[^/]+\/(?:chat|variants)/.test(new URL(request.url()).pathname)) generationRequests.push(new URL(request.url()).pathname); });
  await loginAidtV2(page);
  const run = await aidtV2Api(page, `/agent-runs/${failedRunId}`); expect(run.status).toBe(200); expect(wave2Runtime.operations.getAgentRun.out.parse(run.data).status).toBe("cancelled");
  const before = (await readAidtV2Stage(page, entry.projectId, 5))!;
  await openAidtV2Outcome(page, entry.projectId, 5);
  await page.getByRole("textbox", { name: "通过这次制作原型，你最想知道什么？", exact: true }).fill("合成学生人工确认的问题：新同学能否说出纸面分区牌指向哪里？尚无真实测试。");
  const questionDetails = page.getByTestId("aidt-verification-question"); if (!await page.getByRole("textbox", { name: "测试前，你们怎么想？", exact: true }).isVisible()) await questionDetails.locator("summary").click();
  await page.getByRole("textbox", { name: "测试前，你们怎么想？", exact: true }).fill("学生人工先前猜测：也许能理解，尚无真实测试；引导师本轮已停止，这不是其成功输出。");
  await page.getByRole("textbox", { name: "目前看法的依据", exact: true }).fill("仅本组合成讨论与选中描述单，不能称为真实用户证据。人工继续，不把取消的Agent任务写成成功。");
  await page.getByRole("textbox", { name: "这个原型能了解什么，还有什么不能验证？", exact: true }).fill("静态草案仅用于讨论指示理解，不能证明实际效率、行为改变或支付意愿。");
  await fillAidtV2Field(page, "type", "学生人工确认：一页静态纸面界面草案，用于合成练习。");
  await fillAidtV2Field(page, "touchpoints", "标题、分区颜色、箭头和简短指示文案；全部属于拟议静态触点。");
  await fillAidtV2Field(page, "operations", "先读标题，再沿箭头找到分区并说出方向；静态画面不冒充实际点击功能。");
  await fillAidtV2Field(page, "hypothesis", "本轮引导师因耗时被正常取消。问题、先前看法和原型说明由合成学生人工确认，不等于Agent任务通过或研究结论。");
  await page.getByRole("button", { name: "确认本轮验证问题", exact: true }).click();
  const saved = await saveAidtV2Stage(page, entry.projectId, 5);
  expect(saved.revision).toBe(before.revision + 1); expect(saved.content.draft.fields.verificationQuestionConfirmed).toBe("true"); expect(saved.sourceStageRevisions).toEqual(before.sourceStageRevisions);
  expect(saved.content.draft.fields.prototypeReference ?? "").toBe(before.content.draft.fields.prototypeReference ?? "");
  const freshContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  try { const fresh = await freshContext.newPage(); await loginAidtV2(fresh); await openAidtV2Outcome(fresh, entry.projectId, 5); expect(await readAidtV2Stage(fresh, entry.projectId, 5)).toEqual(saved); }
  finally { await freshContext.close(); }
  expect(generationRequests).toEqual([]); expect(readFileSync(process.env.AIDT_V2_COMPLETION_STATE!)).toEqual(stateBytes);
  await info.attach("s5-manual-student-fallback", { contentType: "application/json", body: Buffer.from(JSON.stringify({ projectId: entry.projectId, failedRunId, actualRunStatus: "cancelled", modelTaskPassed: false,
    manualStudentFallback: true, before, after: saved, studentSaved: true, freshLoginExactReadback: true, sourceRefs: saved.sourceStageRevisions,
    originalPhasePreserved: "attempting", newStudentRequestSent: false, generationRequests, synthetic: true, ordinaryStudentModelPermissionProven: false }, null, 2)) });
});

test("same-run S6 plan continuation: review current scratch todos once, preserve original interruption, student saves and exports", async ({ page, browser }, info) => {
  test.setTimeout(210_000); assertAidtV2Target(); expect(assertFreshAidtJourney()).toBe(true);
  expect(process.env.AIDT_V2_ALLOW_CURRENT_S6_PLAN_ONCE).toBe("reviewed-write-todos-once");
  const proof = JSON.parse(readFileSync(process.env.AIDT_V2_S6_PLAN_REVIEW_PROOF!, "utf8")) as { runId: string; toolName: string; permissionRequestId: string; argsDigest: string };
  expect(proof.toolName).toBe("write_todos");
  const entry = existingAidtNativeRun(proof.runId), state = readCompletionState();
  expect(entry.skill).toBe("aidt-iterate"); expect(entry.status).toBe("failed-or-interrupted"); expect(state.projectId).toBe(entry.projectId); expect(state.phases.s6?.status).toBe("attempting");
  const originalJournal = JSON.parse(readFileSync(process.env.AIDT_V2_RUN_LEDGER!, "utf8")) as { entries: unknown[] };
  await loginAidtV2(page);
  const stages = await Promise.all([1, 2, 3, 4, 5, 6].map(id => readAidtV2Stage(page, entry.projectId, id))), before = stages[5]!;
  const selector = expectedAidtV2StageSelector(entry.projectId, 6, stages);
  const runResponse = await aidtV2Api(page, `/agent-runs/${proof.runId}`); expect(runResponse.status).toBe(200);
  const pending = wave2Runtime.operations.getAgentRun.out.parse(runResponse.data);
  expect(pending.status).toBe("awaiting_tool_permission"); expect(pending.threadId).toBe(entry.threadId);
  expect(pending.pendingApproval).toMatchObject({ toolName: "write_todos", permissionRequestId: proof.permissionRequestId });
  const expectedArgs = JSON.parse(pending.pendingApproval!.argsSummary!) as { todos: { content: string; status: string }[] };
  expect(Object.keys(expectedArgs)).toEqual(["todos"]); expect(expectedArgs.todos).toHaveLength(2);
  for (const todo of expectedArgs.todos) { expect(Object.keys(todo).sort()).toEqual(["content", "status"]); expect(["completed", "in_progress"]).toContain(todo.status); }
  const canonical = { todos: expectedArgs.todos.map(todo => ({ content: todo.content, status: todo.status })) };
  expect(createHash("sha256").update(JSON.stringify(canonical)).digest("hex")).toBe(proof.argsDigest);
  const messagesPath = `/chat/threads/${entry.threadId}/messages?limit=100`;
  const messages = async () => { const result = await aidtV2Api(page, messagesPath); expect(result.status).toBe(200); return chat.operations.listMessages.out.parse(result.data).messages; };
  const humansBefore = (await messages()).filter(row => row.authorKind === "human");
  const receiptPath = contextOperations.receipt.path.replace(":runId", proof.runId);
  const firstReceipt = await aidtV2Api(page, receiptPath); expect(firstReceipt.status).toBe(200);
  const initialReceipt = validateAidtV2Receipt(firstReceipt.data, { selector, runId: proof.runId, skillVersionId: pending.skillVersionIds[0]! });
  await page.goto(`/aidt/${entry.projectId}?step=6&tool=chat&thread=${entry.threadId}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("aidt-step-skill").waitFor({ state: "visible" });
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "审批高风险操作", exact: true }) });
  await expect(dialog).toBeVisible(); await expect(dialog.getByText("调用工具 write_todos", { exact: true })).toBeVisible();
  expect(JSON.parse(await dialog.locator("code").innerText())).toEqual(expectedArgs);
  const path = planPermissions.operations.decidePermissionRequest.path.replace(":runId", proof.runId).replace(":permissionRequestId", proof.permissionRequestId);
  const decisionResponse = page.waitForResponse(value => value.request().method() === "POST" && new URL(value.url()).pathname === apiPath(path));
  await dialog.getByRole("button", { name: "仅本次允许", exact: true }).click();
  const decision = await decisionResponse; expect(decision.status()).toBe(200); expect(decision.request().postDataJSON()).toEqual({ decision: "once" });
  let completed = pending;
  await expect.poll(async () => {
    const result = await aidtV2Api(page, `/agent-runs/${proof.runId}`); expect(result.status).toBe(200); completed = wave2Runtime.operations.getAgentRun.out.parse(result.data);
    if (["failed", "cancelled", "paused"].includes(completed.status)) throw new Error(`SAME_RUN_${completed.status}_${completed.error}`);
    if (completed.status === "awaiting_tool_permission" && completed.pendingApproval?.permissionRequestId !== proof.permissionRequestId) throw new Error("ADDITIONAL_PERMISSION_REQUIRES_SEPARATE_REVIEW");
    return completed.status === "succeeded";
  }, { timeout: 90_000, intervals: [300, 700, 1_000] }).toBe(true);
  expect(completed.runId).toBe(proof.runId); expect(completed.threadId).toBe(entry.threadId); expect(completed.skillVersionIds).toEqual(pending.skillVersionIds);
  const actualMessages = await messages(); expect(actualMessages.filter(row => row.authorKind === "human")).toEqual(humansBefore);
  const reply = actualMessages.find(row => row.id === completed.resultMessageId)!;
  expect(reply).toMatchObject({ authorKind: "agent", agentRunId: proof.runId }); expect(reply.text.trim()).toBeTruthy();
  const receiptResult = await aidtV2Api(page, receiptPath); expect(receiptResult.status).toBe(200);
  const receipt = validateAidtV2Receipt(receiptResult.data, { selector, runId: proof.runId, skillVersionId: pending.skillVersionIds[0]!, snapshotHash: initialReceipt.snapshotHash,
    originalDispatchAttemptId: initialReceipt.application.attemptId! });
  const panel = page.getByTestId("aidt-run-context-receipt"); await expect(panel).toBeVisible();
  const uiGet = page.waitForResponse(value => value.request().method() === "GET" && new URL(value.url()).pathname === apiPath(receiptPath));
  await panel.locator("summary").first().click(); expect((await uiGet).status()).toBe(200); await expect(panel).toContainText("已沿用原材料续跑");
  expect(await readAidtV2Stage(page, entry.projectId, 6)).toEqual(before);
  await openAidtV2Outcome(page, entry.projectId, 6);
  const frozen = readAidtQuestionSnapshot(before.content.draft)!; expect(frozen.prototypeVersionId).toBeTruthy();
  await page.getByRole("combobox", { name: "测试之后，对这个问题的认识有什么变化？", exact: true }).selectOption("unchanged");
  await page.getByRole("textbox", { name: "测试后的认识", exact: true }).fill("对真实用户能否理解的认识暂未改变，仍未知。静态检查发现本V1信息不足，没有号码分区映射，按钮无交互；这不是用户行为证据。");
  const staticEvidence = `静态检查（非真人测试）：被审V1 ${frozen.prototypeVersionId} 无号码分区映射；按钮无交互。SYN-TEST-FEEDBACK.txt仅通用合成示例，不是本V1实测，不能将模板F1/F2当本版本反馈；没有真人记录。`;
  await page.getByRole("textbox", { name: "支持判断的测试材料", exact: true }).fill(staticEvidence);
  await fillAidtV2Field(page, "feedback", "本轮只有实际V1静态检查，尚未真人测试。通用合成TXT/PNG仅预览和讨论，不是本V1用户反馈。");
  await fillAidtV2Field(page, "reflection", `引导师实际回复：${reply.text}\n学生纠正材料适用性：${staticEvidence}`);
  await page.getByRole("combobox", { name: "如果继续改进，优先从哪一步重新入手？", exact: true }).selectOption("2");
  await page.getByRole("textbox", { name: "为什么从这里重新入手？", exact: true }).fill("学生选择先补真实使用情境与资料；当前只有静态检查，不把通用合成模板当实测，不因AI建议强制先做新版。");
  await page.getByRole("textbox", { name: "下一步具体做什么？", exact: true }).fill("先取得同意再收集真实取餐情境。另为后续静态练习拟补一组明确标为合成的号码分区示意，例如设计内容‘示例2→B分区’，不是既有映射或测试发现；仅在小组另行选择返回5并确认后才制作V2。");
  await page.getByRole("button", { name: "确认本轮学习记录", exact: true }).click();
  const saved = await saveAidtV2Stage(page, entry.projectId, 6);
  expect(saved.revision).toBe(before.revision + 1); expect(saved.sourceStageRevisions).toEqual(before.sourceStageRevisions);
  expect(saved.content.draft.fields.questionSnapshot).toBe(before.content.draft.fields.questionSnapshot);
  expect(saved.content.draft.fields).toMatchObject({ understandingChangeStatus: "unchanged", returnStep: "2", reflectionConfirmed: "true" });
  const freshContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  try {
    const fresh = await freshContext.newPage(); await loginAidtV2(fresh); await openAidtV2Outcome(fresh, entry.projectId, 6);
    expect(await readAidtV2Stage(fresh, entry.projectId, 6)).toEqual(saved);
    await expect(fresh.getByRole("textbox", { name: "支持判断的测试材料", exact: true })).toHaveValue(staticEvidence);
  } finally { await freshContext.close(); }
  const journalAfter = JSON.parse(readFileSync(process.env.AIDT_V2_RUN_LEDGER!, "utf8")) as { entries: unknown[] };
  expect(journalAfter.entries.length).toBe(originalJournal.entries.length);
  finishAidtNativeRun(entry.id, { succeeded: true, runId: proof.runId });
  const turn = { runId: proof.runId, threadId: entry.threadId, assistantMessageId: reply.id, assistantText: reply.text, studentInput: humansBefore.at(-1)!.text,
    agentId: completed.agentId, agentVersionId: completed.agentVersionId, modelProvider: completed.modelProvider, skillVersionIds: completed.skillVersionIds, selectorCoordinates: selector, sourceReceipt: receipt };
  const evidence = { projectId: entry.projectId, turn, before, after: saved, staticEvidence, synthetic: true, freshLoginExactReadback: true,
    originalTestInterruption: "s6-attempt-01: unexpected write_todos permission; preserved", decision: "once", permissionRequestId: proof.permissionRequestId,
    expectedArgs, initialReceipt, newStudentRequestSent: false, newLedgerReservation: false, teachingQuality: "pending-independent-review", ordinaryStudentModelPermissionProven: false };
  completeCompletionPhase("s6", entry.projectId, evidence);
  await info.attach("s6-same-run-plan-continuation", { contentType: "application/json", body: Buffer.from(JSON.stringify(evidence, null, 2)) });
});

test("same-run SUM plan continuation: review current scratch todos once, preserve original interruption, student saves and exports", async ({ page, browser }, info) => {
  test.setTimeout(210_000); assertAidtV2Target(); expect(assertFreshAidtJourney()).toBe(true);
  expect(process.env.AIDT_V2_ALLOW_CURRENT_SUM_PLAN_ONCE).toBe("reviewed-write-todos-once");
  const proof = JSON.parse(readFileSync(process.env.AIDT_V2_SUM_PLAN_REVIEW_PROOF!, "utf8")) as { runId: string; toolName: string; permissionRequestId: string; argsDigest: string };
  expect(proof.toolName).toBe("write_todos");
  const entry = existingAidtNativeRun(proof.runId), state = readCompletionState();
  expect(entry.skill).toBe("dt-summarize-project"); expect(entry.status).toBe("failed-or-interrupted"); expect(state.projectId).toBe(entry.projectId); expect(state.phases.sum?.status).toBe("attempting");
  const originalJournal = JSON.parse(readFileSync(process.env.AIDT_V2_RUN_LEDGER!, "utf8")) as { entries: unknown[] };
  await loginAidtV2(page);
  const before = (await readAidtV2Stage(page, entry.projectId, 6))!;
  const initialResults = JSON.parse(readFileSync(process.env.AIDT_V2_SUM_FIRST_RESULTS!, "utf8"));
  let firstWire: { selectorCoordinates: unknown } | undefined;
  const findWire = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const row = value as { attachments?: { name: string; body?: string }[] };
    for (const attachment of row.attachments ?? []) if (attachment.name === "native-wire-shape-dt-summarize-project" && attachment.body) firstWire = JSON.parse(Buffer.from(attachment.body, "base64").toString());
    for (const child of Object.values(value)) { if (Array.isArray(child)) child.forEach(findWire); else if (child && typeof child === "object") findWire(child); }
  };
  findWire(initialResults); expect(firstWire).toBeTruthy();
  const selector = AidtContextSelector.parse(firstWire!.selectorCoordinates); expect(selector.purpose).toBe("summary");
  const manual = before.content.summaryReport!.markdown, originalReportRefs = before.content.summaryReport!.sourceStageRevisions;
  expect(manual).toContain("第5步引导师任务已取消");
  const runResponse = await aidtV2Api(page, `/agent-runs/${proof.runId}`); expect(runResponse.status).toBe(200);
  const pending = wave2Runtime.operations.getAgentRun.out.parse(runResponse.data);
  expect(pending.status).toBe("awaiting_tool_permission"); expect(pending.threadId).toBe(entry.threadId);
  expect(pending.pendingApproval).toMatchObject({ toolName: "write_todos", permissionRequestId: proof.permissionRequestId });
  const expectedArgs = JSON.parse(pending.pendingApproval!.argsSummary!) as { todos: { content: string; status: string }[] };
  expect(Object.keys(expectedArgs)).toEqual(["todos"]); expect(expectedArgs.todos).toHaveLength(2);
  for (const todo of expectedArgs.todos) { expect(Object.keys(todo).sort()).toEqual(["content", "status"]); expect(["completed", "in_progress"]).toContain(todo.status); }
  const canonical = { todos: expectedArgs.todos.map(todo => ({ content: todo.content, status: todo.status })) };
  expect(createHash("sha256").update(JSON.stringify(canonical)).digest("hex")).toBe(proof.argsDigest);
  const messagesPath = `/chat/threads/${entry.threadId}/messages?limit=100`;
  const messages = async () => { const result = await aidtV2Api(page, messagesPath); expect(result.status).toBe(200); return chat.operations.listMessages.out.parse(result.data).messages; };
  const humansBefore = (await messages()).filter(row => row.authorKind === "human");
  const receiptPath = contextOperations.receipt.path.replace(":runId", proof.runId);
  const firstReceipt = await aidtV2Api(page, receiptPath); expect(firstReceipt.status).toBe(200);
  const initialReceipt = validateAidtV2Receipt(firstReceipt.data, { selector, runId: proof.runId, skillVersionId: pending.skillVersionIds[0]! });
  await page.goto(`/aidt/${entry.projectId}?step=6&tool=chat&summary=1&summaryThread=${entry.threadId}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("aidt-step-skill").waitFor({ state: "visible" });
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "审批高风险操作", exact: true }) });
  await expect(dialog).toBeVisible(); await expect(dialog.getByText("调用工具 write_todos", { exact: true })).toBeVisible();
  expect(JSON.parse(await dialog.locator("code").innerText())).toEqual(expectedArgs);
  const path = planPermissions.operations.decidePermissionRequest.path.replace(":runId", proof.runId).replace(":permissionRequestId", proof.permissionRequestId);
  const decisionResponse = page.waitForResponse(value => value.request().method() === "POST" && new URL(value.url()).pathname === apiPath(path));
  await dialog.getByRole("button", { name: "仅本次允许", exact: true }).click();
  const decision = await decisionResponse; expect(decision.status()).toBe(200); expect(decision.request().postDataJSON()).toEqual({ decision: "once" });
  let completed = pending;
  await expect.poll(async () => {
    const result = await aidtV2Api(page, `/agent-runs/${proof.runId}`); expect(result.status).toBe(200); completed = wave2Runtime.operations.getAgentRun.out.parse(result.data);
    if (["failed", "cancelled", "paused"].includes(completed.status)) throw new Error(`SAME_RUN_${completed.status}_${completed.error}`);
    if (completed.status === "awaiting_tool_permission" && completed.pendingApproval?.permissionRequestId !== proof.permissionRequestId) throw new Error("ADDITIONAL_PERMISSION_REQUIRES_SEPARATE_REVIEW");
    return completed.status === "succeeded";
  }, { timeout: 90_000, intervals: [300, 700, 1_000] }).toBe(true);
  expect(completed.runId).toBe(proof.runId); expect(completed.threadId).toBe(entry.threadId); expect(completed.skillVersionIds).toEqual(pending.skillVersionIds);
  const actualMessages = await messages(); expect(actualMessages.filter(row => row.authorKind === "human")).toEqual(humansBefore);
  const reply = actualMessages.find(row => row.id === completed.resultMessageId)!;
  expect(reply).toMatchObject({ authorKind: "agent", agentRunId: proof.runId }); expect(reply.text.trim()).toBeTruthy();
  const receiptResult = await aidtV2Api(page, receiptPath); expect(receiptResult.status).toBe(200);
  const receipt = validateAidtV2Receipt(receiptResult.data, { selector, runId: proof.runId, skillVersionId: pending.skillVersionIds[0]!, snapshotHash: initialReceipt.snapshotHash,
    originalDispatchAttemptId: initialReceipt.application.attemptId! });
  const panel = page.getByTestId("aidt-run-context-receipt"); await expect(panel).toBeVisible();
  const uiGet = page.waitForResponse(value => value.request().method() === "GET" && new URL(value.url()).pathname === apiPath(receiptPath));
  await panel.locator("summary").first().click(); expect((await uiGet).status()).toBe(200); await expect(panel).toContainText("已沿用原材料续跑");
  expect(await readAidtV2Stage(page, entry.projectId, 6)).toEqual(before);
  await page.getByTestId("aidt-open-report").click();
  await page.waitForURL(url => url.searchParams.get("tool") === "report" && url.searchParams.get("summaryThread") === entry.threadId);
  await expect(page.getByTestId("aidt-report-reload")).toBeEnabled();
  const report = page.getByLabel("小组报告草稿", { exact: true }); await expect(report).toHaveValue(manual);
  await page.getByTestId("aidt-summary-import").locator("summary").first().click();
  await page.getByRole("button", { name: "读取AI总结结果", exact: true }).click();
  const choices = page.getByRole("combobox", { name: "选择要审阅的AI结果", exact: true });
  const candidates = actualMessages.filter(row => row.authorKind === "agent" && row.agentRunId === proof.runId && row.text.trim()).sort((a, b) => b.text.length - a.text.length);
  const contentMessage = candidates.find(row => row.text.length > 300 && /问题|证据|原型|报告/.test(row.text));
  const artifacts = choices.locator('option[value^="artifact:"]');
  const artifactOption = !contentMessage && await artifacts.count() > 0 ? await artifacts.first().getAttribute("value") : null;
  expect(Boolean(contentMessage || artifactOption), "必须选择实际报告草稿正文或实际artifact，不能把链接通知当完整报告").toBe(true);
  const selectedValue = contentMessage ? `message:${contentMessage.id}` : artifactOption!;
  await choices.selectOption(selectedValue);
  const preview = page.getByTestId("aidt-summary-result-preview"); await expect(preview).toBeVisible();
  const selectedText = await preview.innerText(); expect(selectedText.length).toBeGreaterThan(300);
  if (contentMessage) expect(selectedText).toBe(contentMessage.text);
  const apply = page.getByTestId("aidt-summary-import-apply"); await expect(apply).toBeDisabled();
  expect(await readAidtV2Stage(page, entry.projectId, 6)).toEqual(before);
  await page.getByRole("checkbox", { name: "我已核对AI草稿、材料缺口与点评来源", exact: true }).check(); await apply.click();
  const expected = await report.inputValue(); expect(expected).toContain(manual); expect(expected).toContain(selectedText); expect(expected).toContain(proof.runId);
  const saveResponse = page.waitForResponse(value => value.request().method() === "PUT" && new URL(value.url()).pathname === apiPath(`/projects/${entry.projectId}/aidt/stages/6`));
  await page.getByTestId("aidt-report-save").click(); const savedResponse = await saveResponse; expect(savedResponse.status()).toBe(200);
  const saved = stageOperations.save.out.parse(await savedResponse.json()).stage;
  expect(saved.content.summaryReport!.markdown).toBe(expected); expect(saved.content.summaryReport!.sourceStageRevisions).toEqual(originalReportRefs);
  expect(saved.content.draft).toEqual(before.content.draft);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "下载 Markdown 草稿", exact: true }).click();
  const exportFile = info.outputPath("student-reviewed-full-report.md"); await (await download).saveAs(exportFile);
  const footer = [expected, "", "## 保存与来源版本", `报告保存版本：${saved.revision}；保存者：${saved.updatedBy}；保存时间：${saved.updatedAt}`,
    ...(originalReportRefs.length ? originalReportRefs.map(ref => `- 第 ${ref.stageId} 步：版本 ${ref.revision}`) : ["尚未关联已保存的阶段版本；正文不因此成为已验证研究事实。"]), ""].join("\n");
  const bytes = readFileSync(exportFile); expect(bytes).toEqual(Buffer.from(footer));
  await info.attach("actual-student-reviewed-full-report", { path: exportFile, contentType: "text/markdown" });
  const freshContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  try { const fresh = await freshContext.newPage(); await loginAidtV2(fresh); await fresh.goto(`/aidt/${entry.projectId}?step=6&tool=report`, { waitUntil: "domcontentloaded" });
    await expect(fresh.getByTestId("aidt-report-reload")).toBeEnabled(); await expect(fresh.getByLabel("小组报告草稿", { exact: true })).toHaveValue(expected); expect(await readAidtV2Stage(fresh, entry.projectId, 6)).toEqual(saved);
  } finally { await freshContext.close(); }
  const journalAfter = JSON.parse(readFileSync(process.env.AIDT_V2_RUN_LEDGER!, "utf8")) as { entries: unknown[] };
  expect(journalAfter.entries.length).toBe(originalJournal.entries.length);
  finishAidtNativeRun(entry.id, { succeeded: true, runId: proof.runId });
  const turn = { runId: proof.runId, threadId: entry.threadId, assistantMessageId: reply.id, assistantText: reply.text, studentInput: humansBefore.at(-1)!.text,
    agentId: completed.agentId, agentVersionId: completed.agentVersionId, modelProvider: completed.modelProvider, skillVersionIds: completed.skillVersionIds, selectorCoordinates: selector, sourceReceipt: receipt };
  const evidence = { projectId: entry.projectId, turn, before, after: saved, selectedValue, selectedText, actualMarkdownBytes: bytes.length, markdownSha256: createHash("sha256").update(bytes).digest("hex"), synthetic: true, freshLoginExactReadback: true,
    originalTestInterruption: "sum-attempt-01: unexpected write_todos permission; preserved", decision: "once", permissionRequestId: proof.permissionRequestId,
    expectedArgs, initialReceipt, newStudentRequestSent: false, newLedgerReservation: false, teachingQuality: "pending-independent-review", ordinaryStudentModelPermissionProven: false };
  completeCompletionPhase("sum", entry.projectId, evidence);
  await info.attach("sum-same-run-plan-continuation", { contentType: "application/json", body: Buffer.from(JSON.stringify(evidence, null, 2)) });
});


test("no-model final report correction: student verifies truncated scope and immutable V2 history, saves and reenters", async ({ page, browser }, info) => {
  test.setTimeout(90_000); assertAidtV2Target(); expect(assertFreshAidtJourney()).toBe(true);
  expect(process.env.AIDT_V2_ALLOW_REPORT_CORRECTION).toBe("student-check-original-saved-sources");
  const original = JSON.parse(readFileSync(process.env.AIDT_V2_SUM_CORRECTION_EVIDENCE!, "utf8"));
  const projectId = original.projectId as string, originalExport = readFileSync(process.env.AIDT_V2_ORIGINAL_REPORT_EXPORT!);
  const journalBefore = readFileSync(process.env.AIDT_V2_RUN_LEDGER!), stateBefore = readFileSync(process.env.AIDT_V2_COMPLETION_STATE!);
  const generationRequests: string[] = []; page.on("request", request => { if (request.method() === "POST" && /copilotkit|\/pm-designs\/[^/]+\/(?:chat|variants)/.test(new URL(request.url()).pathname)) generationRequests.push(new URL(request.url()).pathname); });
  await loginAidtV2(page);
  const before = (await readAidtV2Stage(page, projectId, 6))!; expect(before).toEqual(original.after);
  const receiptResult = await aidtV2Api(page, contextOperations.receipt.path.replace(":runId", original.turn.runId)); expect(receiptResult.status).toBe(200);
  const receipt = contextOperations.receipt.out.parse(receiptResult.data); expect(receipt.truncated).toBe(true);
  const history = await aidtV2Api(page, `/projects/${projectId}/aidt/stages/6/revisions?beforeRevision=7&limit=3`); expect(history.status).toBe(200);
  const rows = stageOperations.history.out.parse(history.data).items;
  const old4 = rows.find(row => row.revision === 4)!, next5 = rows.find(row => row.revision === 5)!, linked6 = rows.find(row => row.revision === 6)!;
  expect(old4.content.draft.fields).toMatchObject({ returnStep: "2", reflectionConfirmed: "true" }); expect(next5.content.draft.fields.returnStep).toBe("5");
  const frozen = readAidtQuestionSnapshot(linked6.content.draft)!; expect(frozen.sourceStageRevision).toBe(3);
  const produced = JSON.parse(linked6.content.draft.fields.iterationPrototypeReference!) as { designId: string; versionId: string; seq: number; source: string };
  expect(produced.seq).toBe(2); expect(produced.source).toBe("model");
  const actualVersion = await aidtV2Api(page, `/pm-designs/${produced.designId}/versions/${produced.versionId}`); expect(actualVersion.status).toBe(200);
  const nativeVersion = designWorkbench.PrototypeVersion.extend({ links: designPrototype.PrototypeLink.array().array().optional() }).strict();
  const verifiedVersion = designWorkbench.operations.getPrototypeVersion.out.extend({ version: nativeVersion }).parse(actualVersion.data).version;
  expect(verifiedVersion.id).toBe(produced.versionId); expect(verifiedVersion.seq).toBe(2); expect(verifiedVersion.source).toBe("model");
  const s5 = (await readAidtV2Stage(page, projectId, 5))!; expect(s5.revision).toBe(4);
  const old5Result = await aidtV2Api(page, `/projects/${projectId}/aidt/stages/5/revisions?beforeRevision=4&limit=1`); expect(old5Result.status).toBe(200);
  const old5 = stageOperations.history.out.parse(old5Result.data).items[0]!; expect(old5.revision).toBe(3);
  expect(old5.content.draft.fields.verificationQuestion).toBe(frozen.question); expect(s5.content.draft.fields.verificationQuestion).not.toBe(frozen.question);
  const omissions = receipt.omissions.map(item => JSON.stringify(item)).join("；");
  const correction = ["## 学生核对补充：读取范围与版本更正（本节以实际保存记录为准）", "",
    "上方AI草稿关于材料完整性的说法不能视为已核实。本节是学生另行逐版读取实际保存资料后的补充，不声称模型已完整看见或理解这些版本。",
    `服务器本次来源回执 truncated=true。当前坐标：${receipt.stageRevisions.map(ref => `S${ref.stageId}V${ref.revision}`).join("、")}；选中历史坐标：${receipt.historyRevisions.map(ref => `S${ref.stageId}V${ref.revision}`).join("、")}。`,
    `截断和缺口回执：${omissions}。选中坐标不等于全文被读取；原始文件字节未自动读入、个人产物未纳入、教师点评没有来源，历史仅为本次分页读取范围。不能据此称完整研究、完整历史或已验证教学。`, "",
    `实际V1：${frozen.prototypeVersionId}，冻结问题来自S5V3：“${frozen.question}”。S6V4真实保存了return2，S6V5另行选择return5，S6V6关联新的V2且保留旧问题snapshot。保存修订并非自动等于新的独立学习轮次。`,
    `实际V2：${produced.versionId}，seq=2/source=model；已真实保存并关联。这一版新增明确合成的“示例2→B分区”，属于新设计内容，非既有测试反馈；按钮仍为静态占位，不能称可跳转或已验证有效，仍待真人测试。`,
    `当前S5V4的新问题：“${s5.content.draft.fields.verificationQuestion}”，不覆盖S6旧轮冻结的S5V3问题，也不能被追认成旧V1测试任务。旧S6V4的return2与原snapshot均保留。`, "",
    "SYN-TEST-FEEDBACK.txt的F1/F2是通用合成示例，不能当作本V1的实测。第5步引导师已取消，问题由合成学生人工确认；独立Design生成和后续学习不把该引导师失败洗成成功。没有真人访谈、真人测试或教师点评，本报告仍需真实学生与教师另行审阅。",
  ].join("\n");
  const expected = `${before.content.summaryReport!.markdown}\n\n${correction}\n`;
  await page.goto(`/aidt/${projectId}?step=6&tool=report`, { waitUntil: "domcontentloaded" }); await expect(page.getByTestId("aidt-report-reload")).toBeEnabled();
  const editor = page.getByLabel("小组报告草稿", { exact: true }); await expect(editor).toHaveValue(before.content.summaryReport!.markdown); await editor.fill(expected);
  const saveResponse = page.waitForResponse(value => value.request().method() === "PUT" && new URL(value.url()).pathname === apiPath(`/projects/${projectId}/aidt/stages/6`));
  await page.getByTestId("aidt-report-save").click(); const response = await saveResponse; expect(response.status()).toBe(200); const saved = stageOperations.save.out.parse(await response.json()).stage;
  expect(saved.revision).toBe(before.revision + 1); expect(saved.content.draft).toEqual(before.content.draft); expect(saved.content.summaryReport!.sourceStageRevisions).toEqual(before.content.summaryReport!.sourceStageRevisions);
  expect(saved.content.summaryReport!.markdown).toBe(expected);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "下载 Markdown 草稿", exact: true }).click(); const file = info.outputPath("student-corrected-final-report.md"); await (await download).saveAs(file);
  const refs = saved.content.summaryReport!.sourceStageRevisions, footer = [expected, "", "## 保存与来源版本", `报告保存版本：${saved.revision}；保存者：${saved.updatedBy}；保存时间：${saved.updatedAt}`,
    ...(refs.length ? refs.map(ref => `- 第 ${ref.stageId} 步：版本 ${ref.revision}`) : ["尚未关联已保存的阶段版本；正文不因此成为已验证研究事实。"]), ""].join("\n");
  const bytes = readFileSync(file); expect(bytes).toEqual(Buffer.from(footer));
  const freshContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  try { const fresh = await freshContext.newPage(); await loginAidtV2(fresh); await fresh.goto(`/aidt/${projectId}?step=6&tool=report`, { waitUntil: "domcontentloaded" }); await expect(fresh.getByTestId("aidt-report-reload")).toBeEnabled(); await expect(fresh.getByLabel("小组报告草稿", { exact: true })).toHaveValue(expected); expect(await readAidtV2Stage(fresh, projectId, 6)).toEqual(saved);
    const oldReport = await aidtV2Api(fresh, `/projects/${projectId}/aidt/stages/6/revisions?beforeRevision=${saved.revision}&limit=1`); expect(oldReport.status).toBe(200); expect(stageOperations.history.out.parse(oldReport.data).items[0]).toEqual(before);
  } finally { await freshContext.close(); }
  expect(generationRequests).toEqual([]); expect(readFileSync(process.env.AIDT_V2_RUN_LEDGER!)).toEqual(journalBefore); expect(readFileSync(process.env.AIDT_V2_COMPLETION_STATE!)).toEqual(stateBefore); expect(readFileSync(process.env.AIDT_V2_ORIGINAL_REPORT_EXPORT!)).toEqual(originalExport);
  await info.attach("student-corrected-final-report", { path: file, contentType: "text/markdown" });
  await info.attach("no-model-report-student-correction", { contentType: "application/json", body: Buffer.from(JSON.stringify({ projectId, before, after: saved, receipt, sourceOld4: old4, sourceReturn5: next5, sourceLinked6: linked6, sourceOld5: old5, sourceCurrent5: s5, actualV2: verifiedVersion, correction, actualMarkdownBytes: bytes.length, markdownSha256: createHash("sha256").update(bytes).digest("hex"), freshLoginExactReadback: true, originalV8AndExportPreserved: true, reportRefsUnchanged: true, generationRequests, studentCorrectionNotAiOutput: true, synthetic: true }, null, 2)) });
});
