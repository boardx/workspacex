import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { operations } from "@repo/contracts/aidt-stages";
import { chat, files, project, skills, wave2Runtime } from "@repo/contracts";
import * as designWorkbench from "@repo/contracts/design-workbench";
import { REAL_MODEL_SMOKE } from "./real-model-smoke-fixture";
import { apiPath } from "./support/real-model-api";
import { observeAidtNativePrint, readAidtNativePrints } from "./support/aidt-v2-print-observation";
import { fillAidtV2Field, fillSyntheticAidtIdeas, prepareAidtV2StageCase, studentReviewsAidtV2Stage } from "./support/aidt-v2-stage-cases";
import { existingAidtNativeRun, finishAidtNativeRun } from "./support/aidt-v2-run-ledger";
import { reviewAidtSyntheticIntent } from "./support/aidt-v2-intent-review";
import { SESSION_STORAGE_KEY } from "../components/session/session-provider";
import { aidtResearchContentPath, parseAidtResearchMaterial } from "../features/aidt/lib/aidt-research-materials";
import { V2_SEND_WIRE } from "./chat-v2-send";
import { acceptAidtMemberText } from "./support/aidt-member-text-acceptance";
import {
  aidtV2Api, aidtV2Bytes, askAidtV2Agent, assertAidtV2Target, copySaveInput, createAidtV2Group,
  loginAidtV2, openAidtV2Outcome, readAidtV2Stage, saveAidtV2Stage, sendAidtV2NativeTurn,
} from "./support/aidt-v2-acceptance";

test.beforeAll(() => assertAidtV2Target());

test("FR15: student guess → real native Agent question → student confirmation → shared save and fresh login", async ({ page, browser }, info) => {
  test.setTimeout(REAL_MODEL_SMOKE.runTimeoutMs + 150_000);
  await loginAidtV2(page);
  const projectId = await createAidtV2Group(page, "理由来源与真实追问");
  await openAidtV2Outcome(page, projectId, 1);
  const initial = "合成课堂练习：如何让新同学理解食堂取餐指示？尚无真人访谈。";
  const why = "学生先写的理由：可能影响初来者理解，但影响范围还没有证据。";
  await page.getByLabel("初始问题", { exact: true }).fill(initial);
  await page.getByTestId("aidt-problem-reflection-why").fill(why);
  await page.getByTestId("aidt-problem-source-guess").check();
  await page.getByTestId("aidt-problem-reflection-details").fill("这是验收夹具中的学生猜测，不是观察、访谈原话或已验证结论。");
  await page.getByTestId("aidt-problem-reflection-uncertainty").fill("真实同学是否困惑、在哪个位置困惑，均不知道。");
  const unconfirmed = await saveAidtV2Stage(page, projectId, 1);
  expect(unconfirmed.content.draft.fields.problemReflectionConfirmed ?? "").not.toBe("true");
  const turn = await askAidtV2Agent(page, projectId, 1,
    `合成课堂验收，不是真实访谈。我们学生先提出：${initial} 理由：${why} 来源只是猜测。请以本步引导师身份，只追问一个帮助我们核对问题来源的澄清问题；不要替我们回答、确认、访谈或保存，不生成文件。`);
  expect(turn.assistantText, "真实回复至少提出澄清问题；教学适切性另列人工审阅").toMatch(/[?？]/);
  expect(await readAidtV2Stage(page, projectId, 1)).toEqual(unconfirmed);
  await openAidtV2Outcome(page, projectId, 1);
  await page.getByTestId("aidt-problem-reflection-details").fill("学生回应追问：目前没有观察记录，先邀请新同学描述一次取餐经历；本段仍是合成练习计划。");
  await page.getByTestId("aidt-problem-reflection-confirm").click();
  const confirmed = await saveAidtV2Stage(page, projectId, 1);
  expect(confirmed.content.draft.fields).toMatchObject({ initial, whyWorthStudying: why, problemSources: '["guess"]', problemReflectionConfirmed: "true" });
  expect(confirmed.updatedBy).not.toBe("");
  const context = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  try {
    const fresh = await context.newPage();
    await loginAidtV2(fresh);
    await openAidtV2Outcome(fresh, projectId, 1);
    await expect(fresh.getByLabel("初始问题", { exact: true })).toHaveValue(initial);
    await expect(fresh.getByTestId("aidt-problem-reflection-details")).toHaveValue(confirmed.content.draft.fields.sourceDetails!);
    await expect(fresh.getByTestId("aidt-problem-source-guess")).toBeChecked();
    await expect(fresh.getByTestId("aidt-problem-reflection-status")).toContainText("尚待研究核实");
    expect(await readAidtV2Stage(fresh, projectId, 1)).toEqual(confirmed);
    const history = await aidtV2Api(fresh, `/projects/${projectId}/aidt/stages/1/revisions?limit=5`);
    expect(history.status).toBe(200);
    expect(operations.history.out.parse(history.data).items).toEqual([confirmed, unconfirmed]);
    await info.attach("FR15-real-agent-and-student-owned-save", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      projectId, turn, before: unconfirmed, after: confirmed, freshLoginExactReadback: true,
      teachingQuality: "pending-human-review", realInterviewCollected: false,
    }, null, 2)) });
  } finally { await context.close(); }
});

test("resume S1: explicitly review the original synthetic task card, continue the same paid run, then student saves and reenters", async ({ page, browser }, info) => {
  test.setTimeout(REAL_MODEL_SMOKE.runTimeoutMs + 150_000);
  const runId = process.env.AIDT_V2_RESUME_RUN_ID;
  expect(runId, "必须指定已有真实run，不另发S1消息").toBeTruthy();
  const entry = existingAidtNativeRun(runId!);
  expect(entry.skill).toBe("aidt-understand");
  await loginAidtV2(page);
  const before = await readAidtV2Stage(page, entry.projectId, 1);
  expect(before).not.toBeNull();
  expect(before!.content.draft.fields.problemSources).toBe('["guess"]');
  await page.goto(`/aidt/${entry.projectId}?step=1&tool=chat&thread=${encodeURIComponent(entry.threadId)}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("aidt-step-skill").waitFor({ state: "visible" });
  const messagesPath = `/chat/threads/${entry.threadId}/messages?limit=100`;
  const readMessages = async () => {
    const result = await aidtV2Api(page, messagesPath);
    expect(result.status).toBe(200);
    return chat.operations.listMessages.out.parse(result.data).messages;
  };
  const oldHumanIds = (await readMessages()).filter(message => message.authorKind === "human").map(message => message.id).sort();
  const currentOrgId = await page.evaluate(key => (JSON.parse(localStorage.getItem(key) ?? "null") as { currentOrgId?: string } | null)?.currentOrgId, SESSION_STORAGE_KEY);
  expect(currentOrgId).toBeTruthy();
  const catalogResult = await aidtV2Api(page, `${skills.operations.listSkills.path}?orgId=${encodeURIComponent(currentOrgId!)}&entry=library`);
  expect(catalogResult.status).toBe(200);
  const expectedSkill = skills.operations.listSkills.out.parse(catalogResult.data).items.find(item => item.platformStableName === "aidt-understand");
  expect(expectedSkill).toBeTruthy();
  const mountsResult = await aidtV2Api(page, skills.operations.listThreadDeviations.path.replace(":threadId", entry.threadId));
  expect(mountsResult.status).toBe(200);
  const mounted = skills.operations.listThreadDeviations.out.parse(mountsResult.data).temporary.find(item => item.skillId === expectedSkill!.skillId && item.removedAt === null);
  expect(mounted?.versionId).toBeTruthy();
  const intentChoice = await reviewAidtSyntheticIntent(page, entry.projectId, runId!);
  let finalRun: ReturnType<typeof wave2Runtime.operations.getAgentRun.out.parse> | null = null;
  await expect.poll(async () => {
    const response = await aidtV2Api(page, `/agent-runs/${runId}`);
    expect(response.status).toBe(200);
    finalRun = wave2Runtime.operations.getAgentRun.out.parse(response.data);
    if (["failed", "cancelled"].includes(finalRun.status)) throw new Error(`AIDT_SAME_RUN_${finalRun.status}_${finalRun.error}`);
    if (finalRun.status === "awaiting_tool_permission" && finalRun.pendingApproval?.permissionRequestId !== intentChoice.permissionRequestId) throw new Error("AIDT_ADDITIONAL_TOOL_REVIEW_REQUIRED_NO_AUTOMATIC_APPROVAL");
    return finalRun.status === "succeeded";
  }, { timeout: REAL_MODEL_SMOKE.runTimeoutMs, intervals: [300, 700, 1_000] }).toBe(true);
  const completed = finalRun! as ReturnType<typeof wave2Runtime.operations.getAgentRun.out.parse>;
  expect(completed.runId).toBe(runId);
  expect(completed.threadId).toBe(entry.threadId);
  expect(completed.skillVersionIds).toContain(mounted!.versionId);
  const messages = await readMessages();
  expect(messages.filter(message => message.authorKind === "human").map(message => message.id).sort()).toEqual(oldHumanIds);
  const reply = messages.find(message => message.id === completed.resultMessageId);
  expect(reply).toBeTruthy();
  expect(reply!.authorKind).toBe("agent");
  expect(reply!.agentRunId).toBe(runId);
  expect(reply!.text).toMatch(/[?？]/);
  expect(await readAidtV2Stage(page, entry.projectId, 1)).toEqual(before);
  await openAidtV2Outcome(page, entry.projectId, 1);
  await page.getByTestId("aidt-problem-reflection-details").fill("学生回应真实追问：目前没有观察记录，先取得同意后了解一次取餐经历；仍是合成教学练习。");
  await fillAidtV2Field(page, "followupAnswers", `AI追问（真实消息 ${reply!.id}）：${reply!.text.slice(0, 2500)}\n学生回应：目前没有实地材料，不能将猜测升级为真实原因。`);
  await fillAidtV2Field(page, "rewrittenTheme", "合成学生重写：先了解新同学如何寻找食堂取餐指示，原因尚待研究。");
  await page.getByTestId("aidt-problem-reflection-confirm").click();
  const saved = await saveAidtV2Stage(page, entry.projectId, 1);
  expect(saved.content.draft.fields).toMatchObject({ problemSources: '["guess"]', problemReflectionConfirmed: "true" });
  const freshContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  try {
    const fresh = await freshContext.newPage();
    await loginAidtV2(fresh);
    await openAidtV2Outcome(fresh, entry.projectId, 1);
    await expect(fresh.getByTestId("aidt-problem-reflection-details")).toHaveValue(saved.content.draft.fields.sourceDetails!);
    expect(await readAidtV2Stage(fresh, entry.projectId, 1)).toEqual(saved);
  } finally { await freshContext.close(); }
  finishAidtNativeRun(entry.id, { succeeded: true, runId });
  await info.attach("FR15-original-paid-run-intent-and-student-review", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    projectId: entry.projectId, threadId: entry.threadId, runId, intentChoice, actualReply: reply,
    agentId: completed.agentId, modelProvider: completed.modelProvider, modelId: completed.modelId,
    mountedSkillId: expectedSkill!.skillId, mountedSkillVersionId: mounted!.versionId,
    before, studentReviewed: saved, freshLoginExactReadback: true, newStudentRequestSent: false,
    originalTimeoutPreserved: "attempt-06b", modelActor: process.env.AIDT_V2_ACCOUNT_ROLE,
    studentPermissionsProven: false, teachingQuality: "pending-human-review",
  }, null, 2)) });
});

test("FR16: material-linked surprise retains S2 source revision, then explicit none remains a valid saved student decision", async ({ page }, info) => {
  await loginAidtV2(page);
  const projectId = await createAidtV2Group(page, "材料关联与暂无");
  await openAidtV2Outcome(page, projectId, 2);
  await page.getByTestId("aidt-discovery-add").click();
  await page.getByLabel("发现卡1受访者代号", { exact: true }).fill("合成角色-A");
  await page.getByLabel("发现卡1一句发现", { exact: true }).fill("合成材料中出现反例，不能推广到所有同学。");
  await page.getByLabel("发现卡1具体情况", { exact: true }).fill("测试夹具，未进行真人采访：角色先寻找指示牌，再询问同伴。");
  await page.getByLabel("发现卡1受访者原话", { exact: true }).fill("[模拟原话] 我先找牌子，找不到才问人。");
  await page.getByLabel("发现卡1原始材料与定位", { exact: true }).fill("合成课堂材料 synthetic-interview-A.txt，第2段；不是实访。");
  const materials = await saveAidtV2Stage(page, projectId, 2);
  const card = materials.content.draft.discoveryCards![0]!;
  expect(card.headlineKind).toBe("student-summary");
  await openAidtV2Outcome(page, projectId, 3);
  await page.getByRole("radio", { name: "有意外发现", exact: true }).check();
  await page.getByTestId("aidt-surprise-belief").fill("合成练习的原先猜测：大家都会直接问同伴。");
  await page.getByTestId("aidt-surprise-finding").fill("模拟材料的角色先找指示牌，存在例外；不能当成真实调查结论。");
  await expect(page.getByTestId("aidt-surprise-confirm")).toBeDisabled();
  await page.getByRole("checkbox", { name: `${card.participantCode} · ${card.headline}`, exact: true }).check();
  await page.getByTestId("aidt-surprise-interpretation").fill("学生解释：需要保留反例，还不能证明整体模式。");
  await page.getByTestId("aidt-surprise-confirm").click();
  const found = await saveAidtV2Stage(page, projectId, 3);
  expect(found.content.draft.fields).toMatchObject({ surpriseStatus: "found", surpriseConfirmed: "true", surpriseSourceRevision: String(materials.revision) });
  expect(JSON.parse(found.content.draft.fields.surpriseCardIds!)).toEqual([card.id]);
  expect(found.sourceStageRevisions).toContainEqual({ stageId: 2, revision: materials.revision });
  await page.getByRole("radio", { name: "暂无意外发现", exact: true }).check();
  await page.getByTestId("aidt-surprise-confirm").click();
  const none = await saveAidtV2Stage(page, projectId, 3);
  expect(none.content.draft.fields).toMatchObject({ surpriseStatus: "none", surpriseConfirmed: "true" });
  await page.reload();
  await expect(page.getByRole("radio", { name: "暂无意外发现", exact: true })).toBeChecked();
  await expect(page.getByTestId("aidt-surprise-status")).toContainText("学生确认");
  const history = await aidtV2Api(page, `/projects/${projectId}/aidt/stages/3/revisions?limit=5`);
  expect(history.status).toBe(200);
  expect(operations.history.out.parse(history.data).items).toEqual([none, found]);
  await info.attach("FR16-source-and-history", { contentType: "application/json", body: Buffer.from(JSON.stringify({ projectId, materials, found, none, actualInterview: false }, null, 2)) });
});

test("FR05/FR06/FR07: real text/photo originals → separate discovery interpretation → persisted three-sheet images and isolated print", async ({ page, context, browser }, info) => {
  test.setTimeout(180_000);
  expect(process.env.AIDT_V2_ACCOUNT_ROLE).not.toBe("funded-admin-technical");
  await loginAidtV2(page);
  const projectId = await createAidtV2Group(page, "原始材料与三描述单");
  const fixtureDir = resolve(process.env.AIDT_V2_FIXTURE_DIR ?? "e2e/fixtures/aidt-v2");
  const textBytes = readFileSync(join(fixtureDir, "SYN-A.txt"));
  const photoBytes = readFileSync(join(fixtureDir, "SYN-A.png"));
  const generationRequests: string[] = [], uploadRequests: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "POST") return;
    if (V2_SEND_WIRE.test(path) || /\/pm-designs\/[^/]+\/(chat|variants)$/.test(path)) generationRequests.push(path);
    if (path === apiPath(files.operations.uploadArtifact.path.replace(":projectId", projectId))) uploadRequests.push(path);
  });
  await openAidtV2Outcome(page, projectId, 2);
  const control = (label: string) => page.getByTestId("aidt-research-material-control").and(page.locator(`[aria-label="${label}"]`));
  const upload = async (label: string, filename: string) => {
    const target = control(label);
    await target.getByLabel(`${label}选择文件`, { exact: true }).setInputFiles(join(fixtureDir, filename));
    const accepted = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === apiPath(files.operations.uploadArtifact.path.replace(":projectId", projectId)));
    await target.getByRole("button", { name: "保存原始材料", exact: true }).click();
    const response = await accepted;
    expect(response.status()).toBe(201);
    const receipt = files.operations.uploadArtifact.out.parse(await response.json());
    expect(receipt.runs).toHaveLength(1);
    expect(receipt.runs[0]!.artifactId).toBeTruthy();
    await expect(target.getByRole("status")).toContainText("已加入草稿");
    return receipt;
  };
  await upload("研究原始材料", "SYN-A.txt");
  await expect(page.getByTestId("aidt-research-original-text")).toHaveText(textBytes.toString("utf8"));
  await upload("研究原始材料", "SYN-A.png");
  let materialStage = await saveAidtV2Stage(page, projectId, 2);
  const materials = Object.entries(materialStage.content.draft.fields).filter(([key]) => key.startsWith("researchFile:")).map(([, raw]) => parseAidtResearchMaterial(raw));
  expect(materials.every(Boolean)).toBe(true);
  const textRef = materials.find(reference => reference?.name === "SYN-A.txt")!;
  const photoRef = materials.find(reference => reference?.name === "SYN-A.png")!;
  for (const [reference, original] of [[textRef, textBytes], [photoRef, photoBytes]] as const) {
    expect(reference.projectId).toBe(projectId);
    expect(reference.sha256).toBe(createHash("sha256").update(original).digest("hex"));
    const content = await aidtV2Bytes(page, aidtResearchContentPath(reference));
    expect(content.status).toBe(200);
    expect(Buffer.from(content.base64, "base64")).toEqual(original);
    expect(content.headers["x-content-sha256"]).toBe(reference.sha256);
    expect(content.headers["x-artifact-id"]).toBe(reference.artifactId);
    expect(content.headers["x-artifact-version-id"]).toBe(reference.versionId);
    expect(content.headers["x-upload-submitted-by"]).toBeTruthy();
    expect(Number.isFinite(Date.parse(content.headers["x-upload-submitted-at"]!))).toBe(true);
  }
  const postCount = uploadRequests.length;
  await context.setOffline(true);
  try {
    await control("研究原始材料").getByRole("button", { name: "选择本组已保存原始材料", exact: true }).click();
    await expect(control("研究原始材料").getByRole("alert")).toContainText("读取失败");
  } finally { await context.setOffline(false); }
  await control("研究原始材料").getByRole("button", { name: "选择本组已保存原始材料", exact: true }).click();
  await expect(control("研究原始材料").getByRole("button", { name: "关联原始材料：SYN-A.txt", exact: true })).toBeVisible();
  expect(uploadRequests).toHaveLength(postCount);
  await page.getByTestId("aidt-discovery-add").click();
  await page.getByLabel("发现卡1受访者代号", { exact: true }).fill("模拟角色-A");
  await page.getByLabel("发现卡1一句发现", { exact: true }).fill("学生概括：模拟角色先找牌子，不能当成全体事实。");
  const quote = "[模拟原话]“我先找牌子，再看看自己排在哪儿。”";
  await page.getByLabel("发现卡1受访者原话", { exact: true }).fill(quote);
  await page.getByLabel("发现卡1具体情况", { exact: true }).fill("学生解释：可能不清楚号码与区域关系，仍需真实研究。");
  await page.getByTestId("aidt-discovery-ai-0").fill("模拟AI推测字段：可能存在信息不匹配；字段隔离夹具，不是真实模型推理或原话。");
  for (const [label, filename] of [["发现卡1原始文件", "SYN-A.txt"], ["发现卡1原始照片", "SYN-A.png"]]) {
    await control(label!).getByRole("button", { name: "选择本组已保存原始材料", exact: true }).click();
    await control(label!).getByRole("button", { name: `关联原始材料：${filename}`, exact: true }).click();
    await expect(control(label!).getByRole("status")).toContainText("已加入草稿");
  }
  await page.getByLabel("发现卡1原始材料与定位", { exact: true }).fill("SYN-A.txt 第01段，合成材料，不是真实采访。");
  materialStage = await saveAidtV2Stage(page, projectId, 2);
  const card = materialStage.content.draft.discoveryCards![0]!;
  expect(card.quote).toBe(quote);
  expect(card.context).toContain("学生解释");
  expect(materialStage.content.draft.fields[`discoveryAi:${card.id}`]).toContain("模拟AI推测");
  expect(parseAidtResearchMaterial(materialStage.content.draft.fields[`discoveryFile:${card.id}`])).toMatchObject({ artifactId: textRef.artifactId, versionId: textRef.versionId });
  expect(parseAidtResearchMaterial(materialStage.content.draft.fields[`discoveryPhoto:${card.id}`])).toMatchObject({ artifactId: photoRef.artifactId, versionId: photoRef.versionId });
  const memberContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  try {
    const member = await memberContext.newPage();
    await loginAidtV2(member, "member");
    const deniedStage = await aidtV2Api(member, `/projects/${projectId}/aidt/stages/2`);
    expect(deniedStage.status).toBe(404);
    const deniedOriginal = await aidtV2Api(member, aidtResearchContentPath(textRef));
    expect(deniedOriginal.status).toBe(404);
    expect(JSON.stringify(deniedOriginal.data)).not.toContain("模拟原话");
  } finally { await memberContext.close(); }
  await openAidtV2Outcome(page, projectId, 4);
  const titles = await fillSyntheticAidtIdeas(page);
  const imageFiles = ["I1-分区牌.png", "I2-同伴指路.png", "I3-号码牌.png"];
  for (let index = 0; index < 3; index++) await upload(`候选${index + 1}原始图片`, imageFiles[index]!);
  await page.getByRole("radio", { name: "拟选择候选 1（不是投票）", exact: true }).check();
  const ideasStage = await saveAidtV2Stage(page, projectId, 4);
  for (const [index, idea] of ideasStage.content.draft.ideas.entries()) {
    const reference = parseAidtResearchMaterial(ideasStage.content.draft.fields[`ideaFile:${idea.id}`]);
    expect(reference?.name).toBe(imageFiles[index]);
    expect(reference?.sha256).toBe(createHash("sha256").update(readFileSync(join(fixtureDir, imageFiles[index]!))).digest("hex"));
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("aidt-shared-reload")).toBeEnabled();
  await page.getByRole("checkbox", { name: "本组已比较：这些是不同点子，说明讲清做什么及如何帮助用户。", exact: true }).check();
  await expect(page.getByTestId("aidt-idea-sheets-open")).toBeEnabled();
  await page.getByTestId("aidt-idea-sheets-open").click();
  await expect(page.getByTestId("aidt-idea-sheet")).toHaveCount(3);
  await observeAidtNativePrint(page);
  for (let index = 0; index < 3; index++) {
    await expect(page.getByTestId("aidt-idea-sheet").nth(index)).toContainText(titles[index]!);
    await page.getByRole("button", { name: `打印候选 ${index + 1} 描述单 PDF`, exact: true }).click();
    await expect.poll(async () => (await readAidtNativePrints(page)).length).toBe(index + 1);
    const printed = (await readAidtNativePrints(page))[index]!;
    expect(printed.ideaIds).toEqual([ideasStage.content.draft.ideas[index]!.id]);
    expect(printed.imagesLoaded).toBe(true);
  }
  expect(generationRequests).toEqual([]);
  expect(await readAidtV2Stage(page, projectId, 2)).toEqual(materialStage);
  expect(await readAidtV2Stage(page, projectId, 4)).toEqual(ideasStage);
  await info.attach("FR05-06-07-real-originals-shared-images-and-print", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    projectId, materials, materialStage, ideasStage, actualDownloadedByteReadback: true, nonmemberDenied: true,
    readFailureRetriedWithoutUpload: true, nativeChatOrDesignRequests: generationRequests,
    prints: await readAidtNativePrints(page), actualPdfSaved: false, humanPdfSaveStillRequired: true,
    fixtureDataIsSynthetic: true, realInterviewConducted: false,
  }, null, 2)) });
});

test("shared boundary: real CAS conflict keeps student text, explicit retry succeeds, anonymous read is denied, archive is read-only", async ({ page, context }, info) => {
  expect(process.env.AIDT_V2_ACCOUNT_ROLE, "不能用有余额技术管理员替代普通成员权限验收").not.toBe("funded-admin-technical");
  await loginAidtV2(page);
  const projectId = await createAidtV2Group(page, "并发冲突与归档");
  await openAidtV2Outcome(page, projectId, 1);
  await page.getByLabel("初始问题", { exact: true }).fill("合成并发测试：原始问题V1");
  // A real browser network failure, without route interception or a forged API response.
  await context.setOffline(true);
  try {
    await page.getByTestId("aidt-shared-save").click();
    await expect(page.getByTestId("aidt-shared-save-error")).toBeVisible();
    await expect(page.getByLabel("初始问题", { exact: true })).toHaveValue("合成并发测试：原始问题V1");
  } finally { await context.setOffline(false); }
  expect(await readAidtV2Stage(page, projectId, 1)).toBeNull();
  const v1 = await saveAidtV2Stage(page, projectId, 1);
  const stale = await context.newPage();
  await openAidtV2Outcome(stale, projectId, 1);
  await expect(stale.getByLabel("初始问题", { exact: true })).toHaveValue(v1.content.draft.fields.initial!);
  await page.getByLabel("初始问题", { exact: true }).fill("合成并发测试：先保存的学生问题V2");
  const v2 = await saveAidtV2Stage(page, projectId, 1);
  const localText = "合成并发测试：冲突后保留的学生本地编辑";
  await stale.getByLabel("初始问题", { exact: true }).fill(localText);
  const conflictResponse = stale.waitForResponse(response => new URL(response.url()).pathname === apiPath(`/projects/${projectId}/aidt/stages/1`) && response.request().method() === "PUT");
  await stale.getByTestId("aidt-shared-save").click();
  expect((await conflictResponse).status()).toBe(409);
  await expect(stale.getByTestId("aidt-shared-conflict")).toBeVisible();
  await expect(stale.getByLabel("初始问题", { exact: true })).toHaveValue(localText);
  expect(await readAidtV2Stage(page, projectId, 1)).toEqual(v2);
  await stale.getByTestId("aidt-shared-use-server-base").click();
  const v3 = await saveAidtV2Stage(stale, projectId, 1);
  expect(v3.content.draft.fields.initial).toBe(localText);
  const anonymous = await page.request.get(`${process.env.AIDT_V2_API_ORIGIN}/projects/${projectId}/aidt/stages/1`);
  expect(anonymous.status()).toBe(401);
  expect(await anonymous.text()).not.toContain(localText);
  const archived = await aidtV2Api(page, `/projects/${projectId}/archive`, "POST", { projectId });
  expect(archived.status).toBe(201);
  try {
    await openAidtV2Outcome(page, projectId, 1);
    await expect(page.getByLabel("初始问题", { exact: true })).toBeDisabled();
    await expect(page.getByTestId("aidt-shared-save")).toHaveCount(0);
    const denied = await aidtV2Api(page, `/projects/${projectId}/aidt/stages/1`, "PUT", copySaveInput(v3, { initial: "归档后不可写入的合成canary" }));
    expect(denied.status).toBe(403);
    expect(denied.data).toMatchObject({ reasonCode: "AIDT_STAGE_READONLY" });
    expect(await readAidtV2Stage(page, projectId, 1)).toEqual(v3);
    await info.attach("shared-boundary-actual-responses", { contentType: "application/json", body: Buffer.from(JSON.stringify({ projectId,
      revisions: [v1.revision, v2.revision, v3.revision], conflict: 409, explicitRetry: true, anonymous: anonymous.status(), archivedReadOnly: denied.status,
    }, null, 2)) });
  } finally {
    const restored = await aidtV2Api(page, `/projects/${projectId}/unarchive`, "POST", { projectId });
    expect(restored.status).toBe(201);
    await stale.close();
  }
});

test("FR11 global member text: one stored channel/topic and two drafts remain available across dashboard, all six steps, sources, report and native Design", async ({ page }, info) => {
  test.setTimeout(240_000);
  expect(process.env.AIDT_V2_ACCOUNT_ROLE).not.toBe("funded-admin-technical");
  await loginAidtV2(page);
  const projectId = await createAidtV2Group(page, "全界面成员文字插件");
  const generationRequests: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && (V2_SEND_WIRE.test(path) || /\/pm-designs\/[^/]+\/(chat|variants)$/.test(path))) generationRequests.push(path);
  });
  await openAidtV2Outcome(page, projectId, 6);
  const memberText = await acceptAidtMemberText({ page, projectId, request: (path, method, body) => aidtV2Api(page, path, method, body) });
  const designResult = await aidtV2Api(page, "/pm-designs", "POST", designWorkbench.operations.createProject.in.parse({ name: "合成文字插件验收空设计（不生成）", template: "ui" }));
  expect(designResult.status).toBe(201);
  const design = designWorkbench.operations.createProject.out.parse(designResult.data).project;
  const linked = await aidtV2Api(page, `/projects/${projectId}/resources`, "POST", { projectId, kind: "design", resourceId: design.id });
  expect(linked.status).toBe(201);
  project.operations.linkProjectResource.out.parse(linked.data);
  // Enter the real Design surface through its existing student question gate.
  await openAidtV2Outcome(page, projectId, 5);
  await page.getByRole("textbox", { name: "通过这次制作原型，你最想知道什么？", exact: true }).fill("合成插件验收问题：是否能查看同组讨论？本次不生成原型。");
  await page.getByTestId("aidt-verification-question").locator("summary").click();
  await page.getByRole("textbox", { name: "测试前，你们怎么想？", exact: true }).fill("只验证界面可用性，没有真实用户测试。");
  await page.getByRole("textbox", { name: "目前看法的依据", exact: true }).fill("合成测试操作，不是研究结论。");
  await page.getByRole("textbox", { name: "这个原型能了解什么，还有什么不能验证？", exact: true }).fill("空设计只检查文字插件，不能验证用户行为。");
  await page.getByRole("button", { name: "确认本轮验证问题", exact: true }).click();
  const explicitSetup = await saveAidtV2Stage(page, projectId, 5);
  const beforeWalk = await Promise.all([1, 2, 3, 4, 5, 6].map(step => readAidtV2Stage(page, projectId, step)));
  const scenes = [{ name: "dashboard", path: `/aidt/${projectId}`, ready: "aidt-dashboard" }];
  for (let step = 1; step <= 6; step++) for (const tool of ["chat", "outcome", "context"]) scenes.push({
    name: `step-${step}-${tool}`, path: `/aidt/${projectId}?step=${step}&tool=${tool}`,
    ready: tool === "chat" ? "aidt-step-skill" : "aidt-tool-panel",
  });
  scenes.push({ name: "sources", path: `/aidt/${projectId}?step=2&tool=sources`, ready: "project-evidence" });
  scenes.push({ name: "report", path: `/aidt/${projectId}?step=6&tool=report`, ready: "aidt-report-preview" });
  scenes.push({ name: "native-design", path: `/aidt/${projectId}?step=5&tool=design&resource=${design.id}`, ready: "design-detail" });
  const reached: string[] = [];
  for (const scene of scenes) {
    await page.goto(scene.path, { waitUntil: "domcontentloaded" });
    await page.getByTestId(scene.ready).waitFor({ state: "visible" });
    if (await page.getByTestId("global-member-chat-open").getAttribute("aria-expanded") !== "true") await page.getByTestId("global-member-chat-open").click();
    await expect(page.getByTestId("global-member-chat-panel")).toBeVisible();
    const picker = page.getByTestId("global-member-chat-project");
    if (await picker.inputValue() !== projectId) await picker.selectOption(projectId);
    await expect(picker).toHaveValue(projectId);
    await expect(page.getByTestId("project-member-input")).toBeEnabled();
    await expect(page.getByTestId("project-member-message").and(page.locator(`[data-message-id="${memberText.root.id}"]`))).toHaveCount(1);
    await page.getByTestId("global-member-chat-close").click();
    await expect(page.getByTestId("global-member-chat-panel")).not.toBeVisible();
    reached.push(scene.name);
    console.info(`[aidt-v2] member text visible · ${scene.name}`);
  }
  expect(generationRequests).toEqual([]);
  expect(await Promise.all([1, 2, 3, 4, 5, 6].map(step => readAidtV2Stage(page, projectId, step)))).toEqual(beforeWalk);
  await info.attach("FR11-global-member-text-all-surfaces", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    projectId, reached, memberText, emptyDesignId: design.id, explicitStudentQuestionSetup: explicitSetup, actualDesignGenerated: false,
    nativeGenerationRequests: generationRequests, stageDraftsAutomaticallySaved: false,
    authorizationRoleCoverage: "setup actor; student/nonmember roles verified separately",
  }, null, 2)) });
});

for (const step of [2, 3, 4, 5, 6]) {
  test(`FR03 S${step}: student input → mounted native Skill → durable real question → student decision/save → fresh login`, async ({ page, browser }, info) => {
    test.setTimeout(REAL_MODEL_SMOKE.runTimeoutMs + 180_000);
    await loginAidtV2(page);
    const prepared = await prepareAidtV2StageCase(page, step);
    const turn = await askAidtV2Agent(page, prepared.projectId, step,
      `第${step}步合成课堂验收：请先阅读本组实际已保存的本步及前序学生输入。没有真实访谈或真人测试，不能把模拟材料当证据。只提出一个与当前学生输入相关、帮助我们继续讨论的澄清问题；不要替学生回答、选择、确认、保存，不调用生成原型或文件工具。`,
      process.env.AIDT_V2_REVIEW_SYNTHETIC_INTENT === "1" ? { reviewSyntheticIntent: runId => reviewAidtSyntheticIntent(page, prepared.projectId, runId) } : undefined);
    expect(turn.assistantText).toMatch(/[?？]/);
    expect(await readAidtV2Stage(page, prepared.projectId, step)).toEqual(prepared.before);
    const reviewed = await studentReviewsAidtV2Stage(page, prepared.projectId, step);
    expect(reviewed.revision).toBe(prepared.before.revision + 1);
    expect(reviewed.content.draft).not.toEqual(prepared.before.content.draft);
    if (step === 2) {
      expect(reviewed.content.draft.fields.guide).toBe(prepared.before.content.draft.fields.guide);
      expect(reviewed.content.draft.fields.adoptedGuide).toContain("学生审阅");
    } else if (step === 3) expect(reviewed.content.draft.fields).toMatchObject({ surpriseStatus: "none", surpriseConfirmed: "true" });
    else if (step === 4) {
      expect(reviewed.content.draft.fields.ideaClassificationConfirmed).toBe("true");
      expect(reviewed.content.draft.selectedIdeaId).toBe(reviewed.content.draft.ideas[0]!.id);
    } else if (step === 5) expect(reviewed.content.draft.fields.verificationQuestionConfirmed).toBe("true");
    else {
      expect(reviewed.content.draft.fields).toMatchObject({ understandingChangeStatus: "unchanged", returnStep: "2", reflectionConfirmed: "true" });
      expect(reviewed.content.draft.fields.questionSnapshot).toBe(prepared.before.content.draft.fields.questionSnapshot);
      expect(reviewed.content.draft.fields.newVersion ?? "").toBe(prepared.before.content.draft.fields.newVersion ?? "");
    }
    const freshContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
    try {
      const fresh = await freshContext.newPage();
      await loginAidtV2(fresh);
      await openAidtV2Outcome(fresh, prepared.projectId, step);
      expect(await readAidtV2Stage(fresh, prepared.projectId, step)).toEqual(reviewed);
      if (step === 5) await expect(fresh.getByRole("textbox", { name: "通过这次制作原型，你最想知道什么？", exact: true })).toHaveValue(reviewed.content.draft.fields.verificationQuestion!);
      else if (step === 6) await expect(fresh.getByRole("textbox", { name: "测试后的认识", exact: true })).toHaveValue(reviewed.content.draft.fields.afterTestBelief!);
      else if (step === 4) await expect(fresh.getByRole("radio", { name: "拟选择候选 1（不是投票）", exact: true })).toBeChecked();
      else {
        const key = step === 2 ? "adoptedGuide" : "hmw";
        const input = fresh.getByTestId(`aidt-field-${key}`);
        if (!await input.isVisible()) await fresh.getByTestId("aidt-more-fields").locator("summary").first().click();
        await expect(input).toHaveValue(reviewed.content.draft.fields[key]!);
      }
    } finally { await freshContext.close(); }
    await info.attach(`FR03-S${step}-real-agent-student-decision`, { contentType: "application/json", body: Buffer.from(JSON.stringify({
      projectId: prepared.projectId, step, turn, before: prepared.before, reviewed,
      nativePrototype: prepared.nativePrototype ?? null, freshLoginExactReadback: true,
      realInterview: false, syntheticClassroomInput: true, teachingQuality: "pending-human-review",
    }, null, 2)) });
  });
}

test("FR07/FR17: three distinct sheets and independent multi-label choice reach real native print; local images stay labelled temporary", async ({ page }, info) => {
  await loginAidtV2(page);
  const projectId = await createAidtV2Group(page, "三个描述单与分类");
  await openAidtV2Outcome(page, projectId, 4);
  const names = ["合成点子A：纸面分区牌", "合成点子B：同伴口头指路", "合成点子C：号码牌分区"];
  const descriptions = ["在不同取餐口放置纸面分区牌。学生用示意图讨论能否看懂方向。", "由一位同伴说明取餐路线。学生记录其与独自看牌的理解差异。", "取餐前领取不同区域的号码牌。学生讨论号码和区域关系是否清楚。"];
  const fixtureDir = resolve(process.env.AIDT_V2_FIXTURE_DIR ?? "e2e/fixtures/aidt-v2");
  const localImages = ["I1-分区牌.png", "I2-同伴指路.png", "I3-号码牌.png"];
  for (let n = 1; n <= 3; n++) {
    await page.getByLabel(`候选${n}名称`, { exact: true }).fill(names[n - 1]!);
    await page.getByLabel(`候选${n}核心说明`, { exact: true }).fill(descriptions[n - 1]!);
    await page.getByLabel(`候选${n}参考图`, { exact: true }).setInputFiles(join(fixtureDir, localImages[n - 1]!));
  }
  await page.getByRole("checkbox", { name: `${names[0]} · 最容易实现的`, exact: true }).check();
  await page.getByRole("checkbox", { name: `${names[0]} · 最有趣的`, exact: true }).check();
  await page.getByLabel(`${names[0]} · 分类理由`, { exact: true }).fill("学生看法：容易先做纸面练习，也可能有趣；还不是测试结论。");
  await page.getByRole("button", { name: "确认本组分类", exact: true }).click();
  await page.getByRole("radio", { name: "拟选择候选 2（不是投票）", exact: true }).check();
  const saved = await saveAidtV2Stage(page, projectId, 4);
  const ids = saved.content.draft.ideas.map(idea => idea.id);
  expect(new Set(ids).size).toBe(3);
  expect(saved.content.draft.selectedIdeaId).toBe(ids[1]);
  expect(JSON.parse(saved.content.draft.fields.ideaClassificationTags!)[ids[0]!]).toEqual(["easy", "fun"]);
  expect(saved.content.draft.ideas.every(idea => !idea.imageAttachment && !idea.image)).toBe(true);
  await page.getByRole("checkbox", { name: "本组已比较：这些是不同点子，说明讲清做什么及如何帮助用户。", exact: true }).check();
  await page.getByTestId("aidt-idea-sheets-open").click();
  const preview = page.getByTestId("aidt-idea-sheets-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId("aidt-idea-sheet")).toHaveCount(3);
  await observeAidtNativePrint(page);
  for (let n = 1; n <= 3; n++) {
    const sheet = preview.getByTestId("aidt-idea-sheet").nth(n - 1);
    await expect(sheet).toHaveAttribute("data-idea-id", ids[n - 1]!);
    await expect(sheet).toContainText(names[n - 1]!);
    await expect(sheet).toContainText(descriptions[n - 1]!);
    await expect(sheet).toContainText("未上传");
    await expect.poll(() => sheet.locator("img").evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await page.getByRole("button", { name: `打印候选 ${n} 描述单 PDF`, exact: true }).click();
    await expect.poll(async () => (await readAidtNativePrints(page)).length).toBe(n);
    const observed = (await readAidtNativePrints(page))[n - 1]!;
    expect(observed.ideaIds).toEqual([ids[n - 1]!]);
    expect(observed.text).toContain(descriptions[n - 1]!);
    for (const other of names.filter((_, index) => index !== n - 1)) expect(observed.text).not.toContain(other);
    expect(observed.imagesLoaded, "真实beforeprint时克隆图像须已加载，不能只凭源预览成功").toBe(true);
  }
  await info.attach("FR07-real-print-events-not-file-delivery", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    projectId, ideaIds: ids, prints: await readAidtNativePrints(page), actualPdfSaved: false,
    imagesAreTemporaryLocalFixtures: true, actualUploadedSharedImages: false, humanSavePdfStillRequired: true,
  }, null, 2)) });
});

test("FR10: real summary Skill reads saved sources, student reviews/imports, report persists and Markdown bytes match", async ({ page, browser }, info) => {
  test.setTimeout(REAL_MODEL_SMOKE.runTimeoutMs + 150_000);
  await loginAidtV2(page);
  const projectId = await createAidtV2Group(page, "真实报告与材料缺口");
  await openAidtV2Outcome(page, projectId, 1);
  const source = "合成课堂报告源：取餐指示尚属猜测，尚未真实访谈、测试或得到教师点评。";
  await page.getByLabel("初始问题", { exact: true }).fill(source);
  const stage1 = await saveAidtV2Stage(page, projectId, 1);
  await page.goto(`/aidt/${projectId}?step=6&tool=report`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("aidt-report-reload")).toBeEnabled();
  const manual = "学生人工报告标记：保留本段。材料缺失不得编造。";
  await page.getByLabel("小组报告草稿", { exact: true }).fill(manual);
  await page.getByTestId("aidt-open-summary-chat").click();
  await page.waitForURL(url => url.searchParams.get("summary") === "1" && url.searchParams.get("tool") === "chat");
  await page.getByTestId("aidt-step-skill").waitFor({ state: "visible" });
  await expect(page.getByTestId("aidt-summary-context")).toBeVisible();
  await page.getByRole("button", { name: "读取报告材料", exact: true }).click();
  const materials = page.getByTestId("aidt-summary-materials");
  await expect(materials).toBeVisible();
  await materials.locator("summary").click();
  const packet = JSON.parse(await materials.locator("pre").innerText()) as {
    currentStages: { stageId: number; revision: number; markdown: string }[]; missingStages: number[]; teacherComments: null;
  };
  expect(packet.currentStages).toHaveLength(1);
  expect(packet.currentStages[0]).toMatchObject({ stageId: 1, revision: stage1.revision });
  expect(packet.currentStages[0]!.markdown).toContain(source);
  expect(packet.missingStages).toEqual([2, 3, 4, 5, 6]);
  expect(packet.teacherComments).toBeNull();
  await page.getByTestId("aidt-summary-offer-request").click();
  const composer = page.getByTestId("copilotkit-v2-input");
  await expect(composer).toHaveValue(/请生成本组研究过程报告/);
  expect(await composer.inputValue()).toContain(`第1步 V${stage1.revision}`);
  const requestText = await composer.inputValue();
  const turn = await sendAidtV2NativeTurn(page, projectId, "dt-summarize-project", requestText, "summaryThread",
    process.env.AIDT_V2_REVIEW_SYNTHETIC_INTENT === "1" ? { reviewSyntheticIntent: runId => reviewAidtSyntheticIntent(page, projectId, runId) } : undefined);
  await page.getByTestId("aidt-open-report").click();
  await page.waitForURL(url => url.searchParams.get("tool") === "report" && url.searchParams.get("summaryThread") === turn.threadId);
  await expect(page.getByTestId("aidt-report-reload")).toBeEnabled();
  const report = page.getByLabel("小组报告草稿", { exact: true });
  await expect(report).toHaveValue(manual);
  await page.getByTestId("aidt-summary-import").locator("summary").click();
  await page.getByRole("button", { name: "读取AI总结结果", exact: true }).click();
  const choices = page.getByRole("combobox", { name: "选择要审阅的AI结果", exact: true });
  await expect(choices).toBeVisible();
  await expect(choices).toHaveValue("");
  await choices.selectOption(`message:${turn.assistantMessageId}`);
  await expect(page.getByTestId("aidt-summary-result-preview")).toHaveText(turn.assistantText);
  const apply = page.getByTestId("aidt-summary-import-apply");
  await expect(apply).toBeDisabled();
  expect(await readAidtV2Stage(page, projectId, 6)).toBeNull();
  await page.getByRole("checkbox", { name: "我已核对AI草稿、材料缺口与点评来源", exact: true }).check();
  await apply.click();
  await expect(report).toHaveValue(new RegExp(manual));
  const expected = await report.inputValue();
  expect(expected).toContain(turn.assistantText);
  expect(expected).toContain(turn.assistantMessageId);
  expect(expected).toContain(turn.runId);
  expect(await readAidtV2Stage(page, projectId, 6)).toBeNull();
  const response = page.waitForResponse(value => new URL(value.url()).pathname === apiPath(`/projects/${projectId}/aidt/stages/6`) && value.request().method() === "PUT");
  await page.getByTestId("aidt-report-save").click();
  const received = await response;
  expect(received.status()).toBe(200);
  const saved = operations.save.out.parse(await received.json()).stage;
  expect(saved.content.summaryReport!.markdown).toBe(expected);
  await expect(page.getByTestId("aidt-report-save-state")).toContainText("小组报告已保存");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 Markdown 草稿", exact: true }).click();
  const file = await download;
  const downloadPath = info.outputPath("student-reviewed-report.md");
  await file.saveAs(downloadPath);
  const exported = readFileSync(downloadPath, "utf8");
  expect(exported.startsWith(expected)).toBe(true);
  expect(exported).toContain(`报告保存版本：${saved.revision}`);
  const freshContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  try {
    const fresh = await freshContext.newPage();
    await loginAidtV2(fresh);
    await fresh.goto(`/aidt/${projectId}?step=6&tool=report`, { waitUntil: "domcontentloaded" });
    await expect(fresh.getByTestId("aidt-report-reload")).toBeEnabled();
    await expect(fresh.getByLabel("小组报告草稿", { exact: true })).toHaveValue(expected);
    expect(await readAidtV2Stage(fresh, projectId, 6)).toEqual(saved);
  } finally { await freshContext.close(); }
  await info.attach("FR10-real-summary-review-save-export", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    projectId, turn, packet, reportRevision: saved.revision, actualMarkdownDownload: true,
    actualPdfSaved: false, noTeacherCommentSource: true, contentQuality: "pending-human-review",
  }, null, 2)) });
});
