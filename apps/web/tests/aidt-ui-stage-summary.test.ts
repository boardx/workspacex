import { expect, it } from "vitest";
import { AIDT_OUTPUTS, aidtUiStageSummary, emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";

it("leaves all six empty stages empty, including a selected but unwritten candidate", () => {
  const drafts = emptyAidtUiDrafts();
  drafts[4]!.selectedIdeaId = drafts[4]!.ideas[0]!.id;
  for (const stageNumber of [1, 2, 3, 4, 5, 6]) expect(aidtUiStageSummary(stageNumber, drafts[stageNumber]!)).toBe("");
});

it("keeps authored text and uncertainty without filling missing sources, versions or test results", () => {
  const draft = emptyAidtUiDrafts()[6]!;
  draft.fields = { feedback: "尚未实际测试，以下是本组疑问", reflection: "  还不能判断\n需要真实材料  ", version: " \n ", unknown: "不是本阶段成果" };
  expect(aidtUiStageSummary(6, draft)).toBe("本组记录的测试反馈与材料引用（待核对）：尚未实际测试，以下是本组疑问\n反思与解释：  还不能判断\n需要真实材料  ");
});

it("distinguishes a proposed idea from a vote and omits untouched candidate templates", () => {
  const draft = emptyAidtUiDrafts()[4]!;
  draft.ideas[1] = { id: "authored", title: "预约方案", description: "让学生提前看座位", imageName: "学生参考.png" };
  draft.selectedIdeaId = "authored";
  const summary = aidtUiStageSummary(4, draft);
  expect(summary).toContain("候选 2（拟选，非投票）：预约方案");
  expect(summary).toContain("让学生提前看座位");
  expect(summary).toContain("参考图：学生参考.png（仅本页）");
  expect(summary).not.toContain("候选 1");
  expect(summary).not.toContain("候选 3");
  expect(summary).not.toContain("待命名");
  expect(draft.ideas[0]).toEqual({ id: "draft-1", title: "", description: "" });
});

it("preserves the original first-step fields alongside the student-rewritten workshop theme", () => {
  expect(AIDT_OUTPUTS[1]!.fields.filter((f) => ["initial", "people", "scene", "focus", "assumptions"].includes(f.id)).map(({ id, label }) => [id, label])).toEqual([
    ["initial", "初始问题"], ["people", "具体人群"], ["scene", "发生的场景"], ["focus", "本组选择的研究方向"], ["assumptions", "还没有证据的假设"],
  ]);
  const draft = emptyAidtUiDrafts()[1]!;
  draft.fields = { initial: "原想法", activity: "选择新品时更有把握", discussion: "我们意见不同", followupAnswers: "回答为什么", rewrittenTheme: "讨论后重写主题" };
  const summary = aidtUiStageSummary(1, draft);
  for (const text of ["初始问题：原想法", "用户活动与希望改善的体验：选择新品时更有把握", "小组讨论文字：我们意见不同", "对追问的回答：回答为什么", "学生重写的工作坊主题：讨论后重写主题"]) expect(summary).toContain(text);
});

it("keeps the original outline and adopted questions separate without assigning a score", () => {
  const draft = emptyAidtUiDrafts()[2]!;
  draft.fields = { guide: "原稿：你喜欢排队吗？", adoptedGuide: "请讲一次最近排队的经历", sources: "观察记录A", interpretation: "这是学生解释" };
  const summary = aidtUiStageSummary(2, draft);
  for (const text of ["访谈 / 观察提纲：原稿：你喜欢排队吗？", "采纳建议后的问题清单：请讲一次最近排队的经历", "原始证据与来源：观察记录A", "学生的解释：这是学生解释"]) expect(summary).toContain(text);
  expect(summary).not.toMatch(/评分|分数/);
});

it("does not fill unknown persona demographics from the available behavior", () => {
  const draft = emptyAidtUiDrafts()[3]!;
  draft.fields = { personaAge: "", personaInterests: "", personaLifestyle: "", personaBehavior: "记录A：到馆后先找座位", hmw: "如何帮助用户找到座位" };
  expect(aidtUiStageSummary(3, draft)).toBe("画像行为：记录A：到馆后先找座位\n我们如何能够……（HMW）：如何帮助用户找到座位");
});

it("retains prototype context and links without generating a saved version", () => {
  const draft = emptyAidtUiDrafts()[5]!;
  draft.fields = { type: "服务流程图", situation: "到馆后", touchpoints: "入口提示牌", operations: "查看可用座位", version: "学生已有原型链接" };
  const summary = aidtUiStageSummary(5, draft);
  for (const text of ["原型对象与形式：服务流程图", "使用情境：到馆后", "用户接触点：入口提示牌", "用户操作步骤：查看可用座位", "已保存原型的引用：学生已有原型链接"]) expect(summary).toContain(text);
  expect(summary).not.toContain("已生成");
});

it("separates what users said and did from student inference and preserves existing prototype references", () => {
  const draft = emptyAidtUiDrafts()[6]!;
  draft.fields = { version: "既有V1引用", said: "原话：没看到按钮", did: "停在入口页面", inference: "可能是入口不明显，待验证", newVersion: "新版V2引用" };
  const summary = aidtUiStageSummary(6, draft);
  for (const text of ["被测试的原型版本：既有V1引用", "用户实际说了什么：原话：没看到按钮", "用户实际做了什么：停在入口页面", "学生的推断：可能是入口不明显，待验证", "迭代后的原型版本：新版V2引用"]) expect(summary).toContain(text);
  expect(summary).not.toContain("真实反馈与材料引用");
});
