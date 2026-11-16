import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { agentRole, agentRuntime, chat, skills, wave2Runtime } from "@repo/contracts";
import { operations as contextOperations } from "@repo/contracts/aidt-run-context";
import { operations as stageOperations } from "@repo/contracts/aidt-stages";
import { SESSION_STORAGE_KEY } from "../components/session/session-provider";
import { REAL_MODEL_SMOKE } from "./real-model-smoke-fixture";
import { additionalS2RunLedger } from "./support/aidt-v2-s2-supplement-ledger";
import { validateS2EmptyThreadReuse, validateS2SupplementPreflight } from "./support/aidt-v2-s2-supplement-preflight";
import { beginSupplementalS2Attempt, completeSupplementalS2Attempt, readCompletionState } from "./support/aidt-v2-completion-state";
import { fillAidtV2Field } from "./support/aidt-v2-stage-cases";
import { reviewAidtSyntheticIntent } from "./support/aidt-v2-intent-review";
import { aidtV2Api, assertAidtV2Target, loginAidtV2, openAidtV2Outcome, readAidtV2Stage, saveAidtV2Stage, sendAidtV2NativeTurn } from "./support/aidt-v2-acceptance";

// Explicit independent lane. Listing is safe; no environment, journal reservation, or browser is started by discovery.
test.beforeAll(() => {
  expect(process.env.AIDT_V2_S2_SUPPLEMENT_AUTHORIZED).toBe("approved-additional-s2-once");
  expect(process.env.AIDT_V2_S2_SUPPLEMENT_ENTRY_ENABLED).toBe("1");
  assertAidtV2Target(); additionalS2RunLedger(); // Validate gates/path only; reserve happens at the one SDK send.
});

test("supplemental S2: new native thread and canonical base preserve the original failed task", async ({ page, browser }, info) => {
  test.setTimeout(REAL_MODEL_SMOKE.runTimeoutMs + 150_000);
  const state = readCompletionState(), projectId = state.projectId!, originalRunId = process.env.AIDT_V2_CANCELLED_S2_RUN_ID!;
  expect(state.phases.s1?.status).toBe("completed"); expect(state.phases.s2?.status).toBe("attempting"); expect(state.phases.s2?.supplementalS2).toBeUndefined();
  expect(projectId).toBe(process.env.AIDT_V2_S2_SUPPLEMENT_PROJECT_ID);
  const oldBudgetPath = process.env.AIDT_V2_RUN_LEDGER!, s1BudgetPath = process.env.AIDT_V2_SUPPLEMENTAL_S1_LEDGER!;
  const oldBudgetBytes = readFileSync(oldBudgetPath), s1BudgetBytes = readFileSync(s1BudgetPath);
  const oldEntry = (JSON.parse(oldBudgetBytes.toString()) as { entries: { runId: string; skill: string; projectId: string; status: string }[] }).entries.find(entry => entry.runId === originalRunId);
  expect(oldEntry).toMatchObject({ skill: "aidt-empathize", projectId, status: "failed-or-interrupted" });
  await loginAidtV2(page);
  const actor = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as { currentOrgId: string; userId: string }, SESSION_STORAGE_KEY);
  const oldRunResponse = await aidtV2Api(page, `/agent-runs/${originalRunId}`); expect(oldRunResponse.status).toBe(200);
  const oldRun = wave2Runtime.operations.getAgentRun.out.parse(oldRunResponse.data); expect(oldRun.status).toBe("cancelled");
  const receiptPath = contextOperations.receipt.path.replace(":runId", originalRunId);
  const oldReceiptResponse = await aidtV2Api(page, receiptPath); expect(oldReceiptResponse.status).toBe(200);
  const oldReceipt = contextOperations.receipt.out.parse(oldReceiptResponse.data);
  const oldThreadResponse = await aidtV2Api(page, `/chat/threads/${oldRun.threadId}?projectId=${encodeURIComponent(projectId)}`); expect(oldThreadResponse.status).toBe(200);
  const oldThread = chat.operations.getThread.out.parse(oldThreadResponse.data);
  expect(oldThread.thread.projectId).toBe(projectId); expect(oldThread.thread.visibilityScope).toBe("plenary");
  const oldMessagesPath = `/chat/threads/${oldRun.threadId}/messages?limit=100`;
  const oldMessages = await aidtV2Api(page, oldMessagesPath); expect(oldMessages.status).toBe(200);
  const proofPath = process.env.AIDT_V2_S2_CANONICAL_PREFLIGHT!, fixturePath = process.env.AIDT_V2_S2_REVIEWED_FIXTURE!;
  expect(proofPath).toBeTruthy(); expect(fixturePath).toBeTruthy();
  const proof = validateS2SupplementPreflight(JSON.parse(readFileSync(proofPath, "utf8")), JSON.parse(readFileSync(fixturePath, "utf8")), {
    orgId: actor.currentOrgId, userId: actor.userId, projectId, oldRunId: originalRunId, agentId: oldRun.agentId, oldAgentVersionId: oldRun.agentVersionId,
  });
  expect(String(proof.apiOwner.pid)).toBe(process.env.AIDT_V2_API_OWNER_PID); expect(proof.apiOwner.startTicks).toBe(process.env.AIDT_V2_API_OWNER_START_TICKS);
  // Existing capability graph exposes the published pointer, NOT instructions. Digest is A1 read-only audit evidence above.
  const graphResponse = await aidtV2Api(page, `/agents/${oldRun.agentId}`); expect(graphResponse.status).toBe(200);
  const graph = agentRuntime.operations.getAgentCapabilityGraph.out.parse(graphResponse.data);
  expect(graph.publishedVersionId).toBe(proof.publishedAgentVersionId); expect(graph.unresolvedSkillVersionIds ?? []).toEqual([]);
  const catalogResponse = await aidtV2Api(page, `${skills.operations.listSkills.path}?orgId=${encodeURIComponent(actor.currentOrgId)}&entry=library`); expect(catalogResponse.status).toBe(200);
  const skill = skills.operations.listSkills.out.parse(catalogResponse.data).items.find(item => item.platformStableName === "aidt-empathize" && item.status === "已启用");
  expect(skill).toBeTruthy();
  const oldMountResponse = await aidtV2Api(page, `/threads/${oldRun.threadId}/skill-deviations?projectId=${encodeURIComponent(projectId)}`); expect(oldMountResponse.status).toBe(200);
  const oldMount = skills.operations.listThreadDeviations.out.parse(oldMountResponse.data).temporary.find(item => item.skillId === skill!.skillId && item.removedAt === null);
  expect(oldMount?.versionId).toBe(oldReceipt.skillVersionId);
  // Existing mount API selects catalog's immutable current version. Do not silently upgrade approved old pins.
  expect(skill!.currentVersionId).toBe(oldMount!.versionId);
  const before = (await readAidtV2Stage(page, projectId, 2))!;
  expect(before.content.draft.fields.guide).toBeTruthy(); expect(before.content.draft.fields.adoptedGuide).toContain("人工");
  const reuseProofPath = process.env.AIDT_V2_S2_SUPPLEMENT_REUSE_EMPTY_THREAD_PROOF;
  let newThreadId: string, reuseProofHash: string | null = null;
  if (reuseProofPath) {
    // Fresh paid-owner preflight above is still mandatory; this records the earlier closed-window zero-send audit.
    expect(existsSync(process.env.AIDT_V2_SUPPLEMENTAL_S2_LEDGER!)).toBe(false);
    const reuseBytes = readFileSync(reuseProofPath);
    const reuse = validateS2EmptyThreadReuse(JSON.parse(reuseBytes.toString()), {
      orgId: actor.currentOrgId, projectId, oldThreadId: oldRun.threadId, skillId: skill!.skillId, skillVersionId: oldMount!.versionId,
      legacyHash: createHash("sha256").update(oldBudgetBytes).digest("hex"), s1Hash: createHash("sha256").update(s1BudgetBytes).digest("hex"),
    });
    newThreadId = reuse.newThread.id; reuseProofHash = createHash("sha256").update(reuseBytes).digest("hex");
  } else {
    const createInput = chat.operations.mutateThread.in.parse({ op: "create", projectId, threadId: null, groupId: oldThread.thread.groupId,
      title: `[AIDT 2] 合成课堂补测 · ${randomUUID().slice(0, 8)}`, visibilityScope: oldThread.thread.visibilityScope, expectedVersion: null, reason: null });
    const createdResponse = await aidtV2Api(page, chat.operations.mutateThread.path, "POST", createInput); expect(createdResponse.status).toBe(200);
    newThreadId = chat.operations.mutateThread.out.parse(createdResponse.data).threadId;
  }
  expect(newThreadId).not.toBe(oldRun.threadId);
  const mountReadPath = `/threads/${newThreadId}/skill-deviations?projectId=${encodeURIComponent(projectId)}`;
  const newThreadResponse = await aidtV2Api(page, `/chat/threads/${newThreadId}?projectId=${encodeURIComponent(projectId)}`); expect(newThreadResponse.status).toBe(200);
  const newThread = chat.operations.getThread.out.parse(newThreadResponse.data);
  expect(newThread.thread).toMatchObject({ id: newThreadId, projectId, groupId: oldThread.thread.groupId,
    visibilityScope: oldThread.thread.visibilityScope, createdBy: actor.userId, archived: false });
  expect(newThread.capabilities).toContain("composer.send");
  if (!reuseProofPath) {
    const emptyMountResponse = await aidtV2Api(page, mountReadPath); expect(emptyMountResponse.status).toBe(200);
    const emptyMounts = skills.operations.listThreadDeviations.out.parse(emptyMountResponse.data); expect(emptyMounts.temporary.filter(item => item.removedAt === null)).toEqual([]);
    const mountedResponse = await aidtV2Api(page, `/threads/${newThreadId}/skill-mounts?projectId=${encodeURIComponent(projectId)}`, "POST",
      skills.operations.mountSkillToThread.in.parse({ threadId: newThreadId, skillIds: [skill!.skillId], expectedVersion: emptyMounts.version }));
    expect(mountedResponse.status).toBe(201); skills.operations.mountSkillToThread.out.parse(mountedResponse.data);
  }
  const newMountResponse = await aidtV2Api(page, mountReadPath); expect(newMountResponse.status).toBe(200);
  const newMounts = skills.operations.listThreadDeviations.out.parse(newMountResponse.data).temporary.filter(item => item.removedAt === null);
  expect(newMounts).toEqual([expect.objectContaining({ skillId: skill!.skillId, versionId: oldMount!.versionId })]);
  const newMessagesPath = `/chat/threads/${newThreadId}/messages?limit=100`;
  const emptyMessages = await aidtV2Api(page, newMessagesPath); expect(emptyMessages.status).toBe(200); expect(chat.operations.listMessages.out.parse(emptyMessages.data).messages).toEqual([]);
  await page.goto(`/aidt/${projectId}?step=2&tool=chat&thread=${encodeURIComponent(newThreadId)}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("aidt-step-skill").waitFor({ state: "visible" });
  const picker = page.getByTestId("chat-task-workbench-capability-picker"); await expect(picker).toBeEnabled();
  const directoryResponse = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname.endsWith(agentRole.operations.listAgentDirectory.path));
  await picker.click();
  const directory = await directoryResponse; expect(directory.status()).toBe(200);
  agentRole.operations.listAgentDirectory.out.parse(await directory.json());
  await expect(page.getByTestId("chat-task-workbench-capability-popover")).toHaveAttribute("data-layout", "popover");
  // Directory hydration can rebuild the listing; select only after its response has rendered.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const defaultOption = page.locator(`[data-testid="chat-task-workbench-capability-card"][data-agent-id="${oldRun.agentId}"]`);
  await expect(defaultOption).toBeVisible(); await expect(defaultOption).toBeEnabled(); await defaultOption.click();
  await expect(picker).toHaveAttribute("data-auto-match", "false");
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  beginSupplementalS2Attempt(projectId, originalRunId, newThreadId);
  await info.attach("supplemental-s2-pre-send-facts", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    projectId, originalRunId, oldThreadId: oldRun.threadId, newThreadId, approvedSkillVersionId: oldMount!.versionId,
    preflight: proof, reuseProofHash, instructionsDigestSource: "A1 constrained read-only audit, not ordinary API", graphPublishedVersionId: graph.publishedVersionId,
    oldPhase: state.phases.s2, checkpointIsolationBrowserFacts: "new normal project thread with zero messages; remote checkpoint requires owner audit",
  }, null, 2)) });
  const prompt = "本组第2步合成课堂补测：此前任务因测试基础角色错误而取消，学生人工修订的清单与材料已经保存。请内部核对本组已保存来源，不逐项回显；只输出一句核心澄清问句，不追加分支或活动时长，等待学生回答。不替学生确认、保存、访谈或生成文件。全部材料仍为合成练习，没有真实访谈证据。";
  const turn = await sendAidtV2NativeTurn(page, projectId, "aidt-empathize", prompt, "thread", { reviewSyntheticIntent: runId => reviewAidtSyntheticIntent(page, projectId, runId) });
  await info.attach("supplemental-s2-actual-turn", { contentType: "application/json", body: Buffer.from(JSON.stringify(turn, null, 2)) });
  expect(turn.agentId).toBe(oldRun.agentId); expect(turn.agentVersionId).toBe(proof.publishedAgentVersionId); expect(turn.threadId).toBe(newThreadId);
  expect(turn.skillVersionIds).toEqual([oldMount!.versionId]); expect(turn.runId).not.toBe(originalRunId); expect(turn.assistantText).toMatch(/[?？]/);
  expect(await readAidtV2Stage(page, projectId, 2)).toEqual(before);
  await openAidtV2Outcome(page, projectId, 2);
  const revisedGuide = "学生审阅本次真实追问后自行修订（合成练习，仍无真实访谈）：\n请讲述一次寻找陌生取餐区域的具体经历。你当时先留意什么，哪里还需要澄清？保留例外，不要求对方支持我们的猜测。";
  await fillAidtV2Field(page, "adoptedGuide", revisedGuide);
  await fillAidtV2Field(page, "reflection", `此前echo基础任务已取消，人工fallback原稿保留为历史V${before.revision}。本次引导师实际回复：${turn.assistantText}\n学生回应与选择：仍不知道真实用户怎样理解，保留开放提问及反例，不把合成原话当证据；清单由学生自己修订。`);
  const saved = await saveAidtV2Stage(page, projectId, 2);
  expect(saved.revision).toBe(before.revision + 1); expect(saved.content.draft.fields.guide).toBe(before.content.draft.fields.guide);
  expect(saved.content.draft.discoveryCards).toEqual(before.content.draft.discoveryCards); expect(saved.sourceStageRevisions).toEqual(before.sourceStageRevisions);
  const historyResponse = await aidtV2Api(page, `/projects/${projectId}/aidt/stages/2/revisions?beforeRevision=${before.revision + 1}&limit=1`); expect(historyResponse.status).toBe(200);
  expect(stageOperations.history.out.parse(historyResponse.data).items[0]).toEqual(before);
  const freshContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  try {
    const fresh = await freshContext.newPage(); await loginAidtV2(fresh); await openAidtV2Outcome(fresh, projectId, 2);
    expect(await readAidtV2Stage(fresh, projectId, 2)).toEqual(saved); await expect(fresh.getByTestId("aidt-field-adoptedGuide")).toHaveValue(revisedGuide);
    const oldAfter = await aidtV2Api(fresh, `/agent-runs/${originalRunId}`); expect(oldAfter.status).toBe(200); expect(wave2Runtime.operations.getAgentRun.out.parse(oldAfter.data)).toEqual(oldRun);
    const receiptAfter = await aidtV2Api(fresh, receiptPath); expect(receiptAfter.status).toBe(200); expect(contextOperations.receipt.out.parse(receiptAfter.data)).toEqual(oldReceipt);
    const messagesAfter = await aidtV2Api(fresh, oldMessagesPath); expect(messagesAfter.status).toBe(200); expect(chat.operations.listMessages.out.parse(messagesAfter.data)).toEqual(chat.operations.listMessages.out.parse(oldMessages.data));
  } finally { await freshContext.close(); }
  expect(readFileSync(oldBudgetPath)).toEqual(oldBudgetBytes); expect(readFileSync(s1BudgetPath)).toEqual(s1BudgetBytes);
  const evidence = { actualRunSucceeded: true as const, sourceReceiptVerified: true as const, studentSaved: true as const, freshLoginExactReadback: true as const,
    projectId, originalRunId, oldThreadId: oldRun.threadId, newThreadId, turn, before, saved, cancelledHistoryUnchanged: true,
    originalSevenSha256: createHash("sha256").update(oldBudgetBytes).digest("hex"), s1SupplementSha256: createHash("sha256").update(s1BudgetBytes).digest("hex"),
    teachingQuality: "pending-independent-human-review", singleQuestionMarkCount: (turn.assistantText.match(/[?？]/g) ?? []).length,
    remoteCheckpointRequiresIndependentOwnerAudit: true, ordinaryStudentPaidPermissionProven: false };
  completeSupplementalS2Attempt(projectId, turn.runId, evidence);
  await info.attach("supplemental-s2-completed-original-failure-retained", { contentType: "application/json", body: Buffer.from(JSON.stringify(evidence, null, 2)) });
});
