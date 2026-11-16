import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { operations, type SharedStageValue } from "@repo/contracts/aidt-stages";
import { readAidtQuestionSnapshot } from "../features/aidt/lib/aidt-verification-loop";
import { REAL_MODEL_SMOKE } from "./real-model-smoke-fixture";
import { apiPath } from "./support/real-model-api";
import { assertFreshAidtJourney } from "./support/aidt-v2-fresh-journey";
import { reviewAidtSyntheticIntent } from "./support/aidt-v2-intent-review";
import { beginCompletionPhase, completeCompletionPhase, readCompletionState, type CompletionPhase } from "./support/aidt-v2-completion-state";
import { addCompletionIdeaImages, addCompletionResearch, completionIdeaPdfs } from "./support/aidt-v2-completion-materials";
import { fillAidtV2Field, prepareAidtV2StageCase, studentReviewsAidtV2Stage } from "./support/aidt-v2-stage-cases";
import { aidtV2Api, askAidtV2Agent, assertAidtV2Target, createAidtV2Group, loginAidtV2, openAidtV2Outcome,
  readAidtV2Stage, saveAidtV2Stage, sendAidtV2NativeTurn } from "./support/aidt-v2-acceptance";

// Each invocation selects exactly one externally authorized phase. No loop/retry can send a second task.
test.beforeAll(() => { assertAidtV2Target(); assertFreshAidtJourney(); });
async function freshReadback(browser: Browser, projectId: string, stage: SharedStageValue) {
  const context = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  try {
    const page = await context.newPage(); await loginAidtV2(page); await openAidtV2Outcome(page, projectId, stage.stageId);
    expect(await readAidtV2Stage(page, projectId, stage.stageId)).toEqual(stage);
  } finally { await context.close(); }
}
const review = (page: Page, projectId: string) => ({ reviewSyntheticIntent: (runId: string) => reviewAidtSyntheticIntent(page, projectId, runId) });

test("completion S1: separately authorized task, student source decision and same-group starting point", async ({ page, browser }, info) => {
  test.setTimeout(REAL_MODEL_SMOKE.runTimeoutMs + 150_000);
  const fresh = assertFreshAidtJourney(true);
  if (!fresh) {
    expect(process.env.AIDT_V2_S1_SUPPLEMENT_AUTHORIZED).toBe("1");
    expect(process.env.AIDT_V2_SUPPLEMENTAL_S1_LEDGER).toBeTruthy();
  }
  beginCompletionPhase("s1");
  await loginAidtV2(page); const projectId = await createAidtV2Group(page, "同组六步与历史报告");
  await openAidtV2Outcome(page, projectId, 1);
  const initial = "合成课堂练习：如何让新同学理解食堂取餐指示？尚无真人访谈。";
  await page.getByLabel("初始问题", { exact: true }).fill(initial);
  await fillAidtV2Field(page, "people", "合成练习拟关注首次到此食堂的新同学；实际年龄与经验未知。");
  await fillAidtV2Field(page, "scene", "食堂取餐区入口，阅读区域提示并寻找取餐位置的情境；没有实际观察。");
  await fillAidtV2Field(page, "activity", "希望了解寻找取餐区与理解分区牌的过程；困惑是否实际存在仍待讨论。");
  await page.getByTestId("aidt-problem-reflection-why").fill("学生先写的理由：可能影响初来者理解，但范围尚未核实。");
  await page.getByTestId("aidt-problem-source-guess").check();
  await page.getByTestId("aidt-problem-reflection-details").fill("合成课堂中的学生猜测，没有观察或访谈原话。");
  await page.getByTestId("aidt-problem-reflection-uncertainty").fill("困惑是否存在、发生在哪里，都还不知道。");
  const before = await saveAidtV2Stage(page, projectId, 1);
  expect(before.content.draft.fields.problemReflectionConfirmed ?? "").not.toBe("true");
  const turn = await askAidtV2Agent(page, projectId, 1,
    "本组正在第1步提出问题。学生输入与来源已保存，均为合成课堂猜测。请先核对本步已保存材料，只追问一个帮助学生澄清问题来源的问题；不替学生确认、保存或声称已采访，不生成原型或文件。", review(page, projectId));
  await info.attach("completion-s1-actual-agent-turn", { contentType: "application/json", body: Buffer.from(JSON.stringify(turn, null, 2)) });
  expect(turn.assistantText).toMatch(/[?？]/);
  expect(await readAidtV2Stage(page, projectId, 1)).toEqual(before);
  await openAidtV2Outcome(page, projectId, 1);
  await fillAidtV2Field(page, "followupAnswers", `引导师实际回复：${turn.assistantText}\n学生合成回答：我们没有观察或访谈资料，不能判断困惑是否普遍；先征求同意，请对方讲述一次具体经历，再核对原先猜测。`);
  await fillAidtV2Field(page, "discussion", "合成学生讨论记录：一条方向关注静态指示的理解，另一条关注排队流程。当前没有证据比较，先研究前者；后者保留待讨论，不代表真实多人共识。");
  await fillAidtV2Field(page, "focus", "学生选择先研究新同学怎样理解取餐区域提示，因为可先听取一次具体经历；没有认定指示牌就是问题成因。");
  await fillAidtV2Field(page, "assumptions", "新同学可能不理解提示只是猜测；是否困惑、具体原因与人群差异都需要真实研究。");
  await fillAidtV2Field(page, "rewrittenTheme", "学生重写：了解首次到此食堂的新同学在寻找取餐区域时如何理解提示、何处需要澄清。由泛泛改善指示聚焦为理解过程，仍是待研究主题，不是HMW或已证实洞察。");
  await page.getByTestId("aidt-problem-reflection-details").fill("学生审阅后决定：先征求同意，再请新同学描述一次经历。当前只有合成计划，不能称已观察。");
  await page.getByTestId("aidt-problem-reflection-confirm").click();
  const after = await saveAidtV2Stage(page, projectId, 1);
  expect(after.revision).toBe(before.revision + 1); expect(after.content.draft.fields.problemReflectionConfirmed).toBe("true");
  expect(after.content.draft.fields.initial).toBe(initial);
  expect(after.content.draft.fields.rewrittenTheme).toContain("学生重写");
  expect(after.content.draft.fields.followupAnswers).toContain(turn.assistantText);
  await freshReadback(browser, projectId, after);
  const evidence = { projectId, turn, before, after, freshLoginExactReadback: true, synthetic: true,
    modelActor: process.env.AIDT_V2_ACCOUNT_ROLE, ordinaryStudentModelPermissionProven: false, teachingQuality: "pending-human-review" };
  completeCompletionPhase("s1", projectId, evidence);
  await info.attach("completion-s1", { contentType: "application/json", body: Buffer.from(JSON.stringify(evidence, null, 2)) });
});

for (const step of [2, 3, 4, 5, 6]) {
  test(`completion S${step}: same-group saved inputs → actual native dispatch → student revision → new login`, async ({ page, browser, context }, info) => {
    test.setTimeout(REAL_MODEL_SMOKE.runTimeoutMs + 180_000);
    const phase = `s${step}` as CompletionPhase;
    const state = beginCompletionPhase(phase), projectId = state.projectId!;
    await loginAidtV2(page);
    const previous = await readAidtV2Stage(page, projectId, step - 1); expect(previous).not.toBeNull();
    const beforeEarlier = await Promise.all(Array.from({ length: step - 1 }, (_, index) => readAidtV2Stage(page, projectId, index + 1)));
    const continuingUnsentS2 = step === 2 && (state.phases.s2?.continuations?.length ?? 0) > 0;
    if (continuingUnsentS2) await openAidtV2Outcome(page, projectId, 2);
    const prepared = continuingUnsentS2
      ? { projectId, before: (await readAidtV2Stage(page, projectId, 2))!, nativePrototype: undefined }
      : await prepareAidtV2StageCase(page, step, projectId);
    if (continuingUnsentS2) {
      const expected = { goal: "学生先提出未知问题：新同学怎样找到取餐口？目前没有真人访谈。",
        guide: "合成提纲原稿：你能说说上一次如何找取餐口吗？哪些地方还不清楚？",
        interpretation: "学生先说明：这是一份模拟提纲，还不是用户事实或AI结论。" };
      expect(prepared.before.content.draft.fields).toMatchObject(expected);
      expect(prepared.before.sourceStageRevisions).toEqual([{ stageId: 1, revision: previous!.revision }]);
      for (const [field, value] of Object.entries(expected)) {
        const input = page.getByTestId(`aidt-field-${field}`);
        if (!await input.isVisible()) await page.getByTestId("aidt-more-fields").locator("summary").first().click();
        await expect(input).toHaveValue(value);
      }
    }
    let before = prepared.before;
    const first = state.phases.s1?.evidence as { after: SharedStageValue };
    expect(before.updatedBy, "所有模型阶段使用同一实际技术actor，不切换身份补绿").toBe(first.after.updatedBy);
    if (step === 2) before = await addCompletionResearch(page, projectId);
    if (step === 4) before = await addCompletionIdeaImages(page, projectId);
    expect(await Promise.all(Array.from({ length: step - 1 }, (_, index) => readAidtV2Stage(page, projectId, index + 1))), "准备本步不能重写前步学生决定").toEqual(beforeEarlier);
    expect(before.sourceStageRevisions).toContainEqual({ stageId: step - 1,
      revision: step === 6 ? readAidtQuestionSnapshot(before.content.draft)!.sourceStageRevision : previous!.revision });
    const turn = await askAidtV2Agent(page, projectId, step,
      `本组正在第${step}步，前序与本步学生输入已真实保存。全部材料明确为合成课堂练习，没有真人访谈或测试。请阅读本阶段与承接来源，只提出一个有助学生继续讨论的澄清问题；不替学生作选择、确认或保存，不调用原型或文件生成工具。`, review(page, projectId));
    await info.attach(`completion-s${step}-actual-agent-turn`, { contentType: "application/json", body: Buffer.from(JSON.stringify(turn, null, 2)) });
    expect(turn.assistantText).toMatch(/[?？]/); expect(await readAidtV2Stage(page, projectId, step)).toEqual(before);
    const after = await studentReviewsAidtV2Stage(page, projectId, step);
    expect(after.revision).toBe(before.revision + 1); expect(after.content.draft).not.toEqual(before.content.draft);
    expect(after.sourceStageRevisions).toEqual(before.sourceStageRevisions);
    if (step === 2) {
      expect(after.content.draft.fields.guide).toBe(before.content.draft.fields.guide);
      expect(after.content.draft.fields.adoptedGuide).toContain("学生审阅");
      expect(after.content.draft.discoveryCards).toEqual(before.content.draft.discoveryCards);
    }
    if (step === 3) expect(after.content.draft.fields).toMatchObject({ surpriseStatus: "none", surpriseConfirmed: "true" });
    if (step === 3) {
      expect(before.content.draft.fields.personaBehavior).toContain("合成画像初稿");
      expect(after.content.draft.fields.personaBehavior).toContain("学生审阅后的合成画像");
      expect(after.content.draft.fields.evidence).toContain(`S2 V${previous!.revision}`);
      for (const unknown of ["personaAge", "personaInterests", "personaLifestyle"]) expect(after.content.draft.fields[unknown] ?? "").toBe("");
    }
    if (step === 5) expect(after.content.draft.fields.verificationQuestionConfirmed).toBe("true");
    if (step === 6) {
      expect(after.content.draft.fields).toMatchObject({ understandingChangeStatus: "unchanged", returnStep: "2", reflectionConfirmed: "true" });
      expect(after.content.draft.fields.questionSnapshot).toBe(before.content.draft.fields.questionSnapshot);
      expect(after.content.draft.fields.newVersion ?? "").toBe(before.content.draft.fields.newVersion ?? "");
      expect(readAidtQuestionSnapshot(after.content.draft)?.prototypeVersionId).toBe(prepared.nativePrototype?.versionId);
    }
    const pdfs = step === 4 ? await completionIdeaPdfs(page, context, projectId, info) : null;
    await freshReadback(browser, projectId, after);
    const evidence = { projectId, step, turn, before, after, nativePrototype: prepared.nativePrototype ?? null,
      pdfs, studentSaved: true, freshLoginExactReadback: true, synthetic: true, ordinaryStudentModelPermissionProven: false, teachingQuality: "pending-human-review" };
    completeCompletionPhase(phase, projectId, evidence);
    await info.attach(`completion-s${step}`, { contentType: "application/json", body: Buffer.from(JSON.stringify(evidence, null, 2)) });
  });
}

test("completion SUM: full same-group history → real summary → reviewed report → exact export bytes and fresh login", async ({ page, browser }, info) => {
  test.setTimeout(REAL_MODEL_SMOKE.runTimeoutMs + 180_000);
  const state = beginCompletionPhase("sum"), projectId = state.projectId!;
  await loginAidtV2(page);
  const stages = await Promise.all([1, 2, 3, 4, 5, 6].map(id => readAidtV2Stage(page, projectId, id)));
  expect(stages.every(Boolean)).toBe(true);
  const history = await aidtV2Api(page, `/projects/${projectId}/aidt/stages/6/revisions?limit=10`); expect(history.status).toBe(200);
  const oldS6 = operations.history.out.parse(history.data).items.find(row => row.revision < stages[5]!.revision && row.content.draft.fields.reflectionConfirmed === "true" && row.content.draft.fields.returnStep === "2");
  expect(oldS6, "总结唯一请求前必须有真实旧S6学生反思，不用只有S1的缺口组补绿").toBeTruthy();
  await page.goto(`/aidt/${projectId}?step=6&tool=report`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("aidt-report-reload")).toBeEnabled();
  const manual = "学生人工报告：保留本段。此组全部访谈、反馈与图像均为合成课堂夹具，尚无真实研究或教师点评。";
  await page.getByLabel("小组报告草稿", { exact: true }).fill(manual);
  const manualSavedResponse = page.waitForResponse(value => value.request().method() === "PUT" && new URL(value.url()).pathname === apiPath(`/projects/${projectId}/aidt/stages/6`));
  await page.getByTestId("aidt-report-save").click(); const manualResponse = await manualSavedResponse; expect(manualResponse.status()).toBe(200);
  const manualSaved = operations.save.out.parse(await manualResponse.json()).stage;
  expect(manualSaved.content.summaryReport!.markdown).toBe(manual);
  expect(await readAidtV2Stage(page, projectId, 6)).toEqual(manualSaved);
  const originalReportRefs = manualSaved.content.summaryReport!.sourceStageRevisions;
  stages[5] = manualSaved;
  await page.getByTestId("aidt-open-summary-chat").click();
  await page.waitForURL(url => url.searchParams.get("summary") === "1" && url.searchParams.get("tool") === "chat");
  await page.getByTestId("aidt-step-skill").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "读取报告材料", exact: true }).click();
  const materials = page.getByTestId("aidt-summary-materials"); await expect(materials).toBeVisible();
  await materials.locator("summary").first().click();
  const packet = JSON.parse(await materials.locator("pre").innerText()) as { currentStages: { stageId: number; revision: number }[];
    historyRevisions: { stageId: number; revision: number }[]; missingStages: number[]; teacherComments: null };
  expect(packet.currentStages).toEqual(stages.map(row => expect.objectContaining({ stageId: row!.stageId, revision: row!.revision })));
  expect(packet.missingStages).toEqual([]); expect(packet.teacherComments).toBeNull();
  expect(packet.historyRevisions).toContainEqual({ stageId: 6, revision: oldS6!.revision });
  await page.getByTestId("aidt-summary-offer-request").click();
  await expect(page.getByTestId("copilotkit-v2-input")).toHaveValue(/请生成本组研究过程报告/);
  const prompt = "请依据本组已选择的六步保存稿与旧反思生成研究过程报告草稿。全部为合成课堂练习，没有真实访谈、测试或教师点评，不得补造；区分猜测、学生选择、AI建议及材料缺口，不替学生确认或保存。";
  const turn = await sendAidtV2NativeTurn(page, projectId, "dt-summarize-project", prompt, "summaryThread", review(page, projectId));
  expect(turn.selectorCoordinates.purpose).toBe("summary");
  expect(turn.sourceReceipt.historyRevisions).toContainEqual({ stageId: 6, revision: oldS6!.revision });
  await page.getByTestId("aidt-open-report").click();
  await page.waitForURL(url => url.searchParams.get("tool") === "report" && url.searchParams.get("summaryThread") === turn.threadId);
  await expect(page.getByTestId("aidt-report-reload")).toBeEnabled();
  const report = page.getByLabel("小组报告草稿", { exact: true }); await expect(report).toHaveValue(manual);
  await page.getByTestId("aidt-summary-import").locator("summary").first().click();
  await page.getByRole("button", { name: "读取AI总结结果", exact: true }).click();
  const choices = page.getByRole("combobox", { name: "选择要审阅的AI结果", exact: true }); await expect(choices).toHaveValue("");
  await choices.selectOption(`message:${turn.assistantMessageId}`);
  await expect(page.getByTestId("aidt-summary-result-preview")).toHaveText(turn.assistantText);
  const apply = page.getByTestId("aidt-summary-import-apply"); await expect(apply).toBeDisabled();
  expect(await readAidtV2Stage(page, projectId, 6)).toEqual(stages[5]);
  await page.getByRole("checkbox", { name: "我已核对AI草稿、材料缺口与点评来源", exact: true }).check(); await apply.click();
  await expect(report).toHaveValue(new RegExp(manual)); const expected = await report.inputValue();
  expect(expected).toContain(turn.assistantText); expect(expected).toContain(turn.assistantMessageId); expect(expected).toContain(turn.runId);
  expect(await readAidtV2Stage(page, projectId, 6)).toEqual(stages[5]);
  const savedResponse = page.waitForResponse(value => value.request().method() === "PUT" && new URL(value.url()).pathname === apiPath(`/projects/${projectId}/aidt/stages/6`));
  await page.getByTestId("aidt-report-save").click(); const response = await savedResponse; expect(response.status()).toBe(200);
  const saved = operations.save.out.parse(await response.json()).stage;
  expect(saved.content.summaryReport!.markdown).toBe(expected);
  expect(saved.content.summaryReport!.sourceStageRevisions, "AI章节追加不得把原人工正文的冻结来源重绑到新heads").toEqual(originalReportRefs);
  expect(saved.content.draft).toEqual(stages[5]!.content.draft);
  await expect(page.getByTestId("aidt-report-save-state")).toContainText("小组报告已保存");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "下载 Markdown 草稿", exact: true }).click();
  const output = info.outputPath("student-reviewed-full-report.md"); await (await download).saveAs(output);
  const refs = saved.content.summaryReport!.sourceStageRevisions;
  const exportExpected = [expected, "", "## 保存与来源版本", `报告保存版本：${saved.revision}；保存者：${saved.updatedBy}；保存时间：${saved.updatedAt}`,
    ...(refs.length ? refs.map(ref => `- 第 ${ref.stageId} 步：版本 ${ref.revision}`) : ["尚未关联已保存的阶段版本；正文不因此成为已验证研究事实。"]), ""].join("\n");
  const bytes = readFileSync(output); expect(bytes).toEqual(Buffer.from(exportExpected));
  const freshContext = await browser.newContext({ baseURL: REAL_MODEL_SMOKE.baseUrl });
  try {
    const fresh = await freshContext.newPage(); await loginAidtV2(fresh);
    await fresh.goto(`/aidt/${projectId}?step=6&tool=report`, { waitUntil: "domcontentloaded" });
    await expect(fresh.getByTestId("aidt-report-reload")).toBeEnabled(); await expect(fresh.getByLabel("小组报告草稿", { exact: true })).toHaveValue(expected);
    expect(await readAidtV2Stage(fresh, projectId, 6)).toEqual(saved);
  } finally { await freshContext.close(); }
  const evidence = { projectId, packet, oldS6, turn, saved, actualMarkdownBytes: bytes.length, markdownSha256: createHash("sha256").update(bytes).digest("hex"),
    freshLoginExactReadback: true, realTeacherCommentSource: false, synthetic: true, ordinaryStudentModelPermissionProven: false, teachingQuality: "pending-human-review" };
  completeCompletionPhase("sum", projectId, evidence);
  await info.attach("completion-full-report", { contentType: "application/json", body: Buffer.from(JSON.stringify(evidence, null, 2)) });
});
