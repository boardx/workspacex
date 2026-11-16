import { expect, type Page } from "@playwright/test";
import * as designWorkbench from "@repo/contracts/design-workbench";
import * as designPrototype from "@repo/contracts/design-prototype";
import { type SharedStageValue } from "@repo/contracts/aidt-stages";
import { parseAidtPrototypeReference } from "../../features/aidt/lib/aidt-prototype-reference";
import { readAidtQuestionSnapshot } from "../../features/aidt/lib/aidt-verification-loop";
import { aidtV2Api, createAidtV2Group, openAidtV2Outcome, readAidtV2Stage, saveAidtV2Stage } from "./aidt-v2-acceptance";

/** All values below are synthetic student inputs, never model/HTTP replacements or real research. */
export async function fillAidtV2Field(page: Page, field: string, value: string) {
  const input = page.getByTestId(`aidt-field-${field}`);
  if (!await input.isVisible()) await page.getByTestId("aidt-more-fields").locator("summary").first().click();
  await input.fill(value);
}

async function seedStudentProblem(page: Page, projectId: string) {
  await openAidtV2Outcome(page, projectId, 1);
  await fillAidtV2Field(page, "initial", "合成课堂前序命题：帮助新同学理解取餐指示，尚无真人研究。");
  await page.getByTestId("aidt-problem-reflection-why").fill("学生合成练习理由：想了解初来者如何理解指示，影响还未核实。");
  await page.getByTestId("aidt-problem-source-guess").check();
  await page.getByTestId("aidt-problem-reflection-details").fill("明确为模拟的学生猜测，没有开展真实观察或访谈。");
  await page.getByTestId("aidt-problem-reflection-confirm").click();
  await saveAidtV2Stage(page, projectId, 1);
}

export async function fillSyntheticAidtIdeas(page: Page) {
  const titles = ["合成点子：纸面分区牌", "合成点子：同伴口头指路", "合成点子：号码牌分区"];
  const descriptions = [
    "合成纸面方案在不同取餐口放置分区牌。计划请新同学指出号码对应的位置，了解指示是否清楚。",
    "合成服务方案由熟悉路线的同伴口头说明方向。计划请新同学复述路线，记录哪里还需要追问。",
    "合成号码牌方案在排队时发放带区域号码的纸牌。计划请新同学对照号码寻找取餐区，比较规则是否容易理解。",
  ];
  for (let index = 0; index < titles.length; index++) {
    await page.getByLabel(`候选${index + 1}名称`, { exact: true }).fill(titles[index]!);
    await page.getByLabel(`候选${index + 1}核心说明`, { exact: true }).fill(descriptions[index]!);
  }
  return titles;
}

export async function prepareAidtV2StageCase(page: Page, step: number) {
  const projectId = step === 6 ? process.env.AIDT_V2_PROTOTYPE_PROJECT_ID : await createAidtV2Group(page, `第${step}步真实引导师`);
  expect(projectId, "S6必须使用A5实际生成且学生选定的原型小组，不能用手填引用补绿").toBeTruthy();
  if (step !== 6) await seedStudentProblem(page, projectId!);
  if (step === 3) {
    await openAidtV2Outcome(page, projectId!, 2);
    await page.getByTestId("aidt-discovery-add").click();
    await page.getByLabel("发现卡1受访者代号", { exact: true }).fill("模拟角色-A");
    await page.getByLabel("发现卡1一句发现", { exact: true }).fill("合成角色先看指示牌，保留例外。");
    await page.getByLabel("发现卡1受访者原话", { exact: true }).fill("[模拟原话]我先找牌子，找不到再问人。");
    await page.getByLabel("发现卡1原始材料与定位", { exact: true }).fill("SYN-A.txt第2段（合成夹具，不是真人访谈）。");
    await saveAidtV2Stage(page, projectId!, 2);
  }
  if (step === 4) {
    await openAidtV2Outcome(page, projectId!, 3);
    await page.getByRole("radio", { name: "暂无意外发现", exact: true }).check();
    await page.getByTestId("aidt-surprise-confirm").click();
    await fillAidtV2Field(page, "hmw", "合成练习HMW：我们如何帮助新同学理解取餐区域？没有真实研究支持。");
    await saveAidtV2Stage(page, projectId!, 3);
  }
  if (step === 5) {
    await openAidtV2Outcome(page, projectId!, 4);
    await fillSyntheticAidtIdeas(page);
    await page.getByRole("radio", { name: "拟选择候选 1（不是投票）", exact: true }).check();
    await fillAidtV2Field(page, "reason", "学生合成选择：先讨论纸面分区牌；图片与PDF仍待另项真实验收。");
    await saveAidtV2Stage(page, projectId!, 4);
  }
  await openAidtV2Outcome(page, projectId!, step);
  let nativePrototype: { designId: string; versionId: string } | undefined;
  if (step === 2) {
    await fillAidtV2Field(page, "goal", "学生先提出未知问题：新同学怎样找到取餐口？目前没有真人访谈。");
    await fillAidtV2Field(page, "guide", "合成提纲原稿：你能说说上一次如何找取餐口吗？哪些地方还不清楚？");
    await fillAidtV2Field(page, "interpretation", "学生先说明：这是一份模拟提纲，还不是用户事实或AI结论。");
  } else if (step === 3) {
    await page.getByRole("radio", { name: "暂无意外发现", exact: true }).check();
    await fillAidtV2Field(page, "patterns", "学生先判断：现有合成材料不足以推出真实人群模式，不编造画像年龄。");
  } else if (step === 4) {
    await fillSyntheticAidtIdeas(page);
    await fillAidtV2Field(page, "criteria", "学生先提出比较标准：能否帮助理解、能否做低成本练习；只是合成练习。");
  } else if (step === 5) {
    await expect(page.getByRole("button", { name: "打开原生 Design Workbench", exact: true })).toBeDisabled();
    await page.getByRole("textbox", { name: "通过这次制作原型，你最想知道什么？", exact: true }).fill("合成验证问题：新同学能否说出纸面分区牌指向哪里？");
    await page.getByTestId("aidt-verification-question").locator("summary").click();
    await page.getByRole("textbox", { name: "测试前，你们怎么想？", exact: true }).fill("学生先前猜测：也许能理解，尚无真实测试。");
    await page.getByRole("textbox", { name: "目前看法的依据", exact: true }).fill("仅学生合成讨论，不是用户研究证据。");
    await page.getByRole("textbox", { name: "这个原型能了解什么，还有什么不能验证？", exact: true }).fill("只能讨论静态理解，不能证明时间节省或支付意愿。");
    await fillAidtV2Field(page, "type", "静态纸面界面草案，生成前仍须学生确认主问题。");
  } else if (step === 6) {
    const source = await readAidtV2Stage(page, projectId!, 5);
    expect(source).not.toBeNull();
    const prior = await readAidtV2Stage(page, projectId!, 6);
    const bound = prior ? readAidtQuestionSnapshot(prior.content.draft) : null;
    const selected = parseAidtPrototypeReference(source!.content.draft.fields.prototypeReference);
    nativePrototype = bound?.prototypeDesignId && bound.prototypeVersionId
      ? { designId: bound.prototypeDesignId, versionId: bound.prototypeVersionId }
      : selected ? { designId: selected.designId, versionId: selected.versionId } : undefined;
    expect(nativePrototype, "必须有真实原型version IDs").toBeTruthy();
    const actual = await aidtV2Api(page, `/pm-designs/${nativePrototype!.designId}/versions/${nativePrototype!.versionId}`);
    expect(actual.status).toBe(200);
    // Native service projects this known canonical links field in addition to its version.
    const nativeVersion = designWorkbench.PrototypeVersion.extend({ links: designPrototype.PrototypeLink.array().array().optional() }).strict();
    expect(designWorkbench.operations.getPrototypeVersion.out.extend({ version: nativeVersion }).parse(actual.data).version.prototype.some(node => node !== null)).toBe(true);
    if (!bound) await page.getByRole("button", { name: "带入本轮验证问题", exact: true }).click();
    await page.getByRole("combobox", { name: "测试之后，对这个问题的认识有什么变化？", exact: true }).selectOption("insufficient");
    await page.getByRole("textbox", { name: "测试后的认识", exact: true }).fill("学生先判断：只有合成练习反馈，不能断言真实用户已经理解。");
    await page.getByRole("textbox", { name: "支持判断的测试材料", exact: true }).fill("SYN-TEST-FEEDBACK.txt合成反馈，明确不是实访或真实操作证据。");
    await page.getByRole("textbox", { name: "仍不确定的地方", exact: true }).fill("仍缺真实测试者的理解过程、反例及授权记录。");
  }
  const before = await saveAidtV2Stage(page, projectId!, step);
  return { projectId: projectId!, before, nativePrototype };
}

export async function studentReviewsAidtV2Stage(page: Page, projectId: string, step: number): Promise<SharedStageValue> {
  await openAidtV2Outcome(page, projectId, step);
  if (step === 2) {
    await fillAidtV2Field(page, "adoptedGuide", "学生审阅后的合成提纲：请讲一次具体取餐经历；先听完整经过，再追问看到了什么。保留原稿。");
  } else if (step === 3) {
    await page.getByTestId("aidt-surprise-confirm").click();
    await fillAidtV2Field(page, "hmw", "学生选择的合成HMW：如何让新同学理解取餐分区？明确需要真实研究验证。");
  } else if (step === 4) {
    const name = "合成点子：纸面分区牌";
    await page.getByRole("checkbox", { name: `${name} · 最容易实现的`, exact: true }).check();
    await page.getByRole("checkbox", { name: `${name} · 最有趣的`, exact: true }).check();
    await page.getByLabel(`${name} · 分类理由`, { exact: true }).fill("学生审阅后保留两种分类，未要求类别等量；选择还需真实测试。");
    await page.getByRole("button", { name: "确认本组分类", exact: true }).click();
    await page.getByRole("radio", { name: "拟选择候选 1（不是投票）", exact: true }).check();
  } else if (step === 5) {
    await page.getByRole("button", { name: "确认本轮验证问题", exact: true }).click();
  } else {
    await page.getByRole("combobox", { name: "测试之后，对这个问题的认识有什么变化？", exact: true }).selectOption("unchanged");
    await page.getByRole("textbox", { name: "测试后的认识", exact: true }).fill("学生审阅决定：暂未改变，仍保留原猜测；合成反馈不能证明实际用户行为。");
    await page.getByRole("combobox", { name: "如果继续改进，优先从哪一步重新入手？", exact: true }).selectOption("2");
    await page.getByRole("textbox", { name: "为什么从这里重新入手？", exact: true }).fill("学生自己选择先补充真实研究；不因AI建议先做新版原型。");
    await page.getByRole("textbox", { name: "下一步具体做什么？", exact: true }).fill("取得同意后观察一次取餐经历，保留旧原型与未解问题。");
    await page.getByRole("button", { name: "确认本轮学习记录", exact: true }).click();
  }
  return saveAidtV2Stage(page, projectId, step);
}
