import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";

export type AidtIdeaDraft = { id: string; title: string; description: string; image?: string; imageName?: string };
export type AidtUiStageDraft = { fields: Record<string, string>; ideas: AidtIdeaDraft[]; selectedIdeaId: string; selectionReasons?: Record<string, string>; unboundReason?: string };
export type AidtUiDrafts = Record<number, AidtUiStageDraft>;
export type AidtUiField = { id: string; label: string; placeholder: string };
export const AIDT_OUTPUTS: Record<number, { title: string; hint: string; fields: readonly AidtUiField[] }> = {
  1: { title: "工作坊主题命题", hint: "保留活动、讨论与追问回答，由学生重写本组工作坊主题；原始想法仍可回看。", fields: [
    { id: "initial", label: "初始问题", placeholder: "我们最开始关心什么？" },
    { id: "people", label: "具体人群", placeholder: "我们想帮助谁？避免只写‘所有人’。" },
    { id: "scene", label: "发生的场景", placeholder: "在什么时间、地点、活动中？" },
    { id: "focus", label: "本组选择的研究方向", placeholder: "我们选择……，因为……" },
    { id: "assumptions", label: "还没有证据的假设", placeholder: "哪些判断需要去观察或访谈？" },
    { id: "activity", label: "用户活动与希望改善的体验", placeholder: "用户在这个场景里要做什么、希望改善什么？不清楚就标待讨论，不填造答案。" },
    { id: "discussion", label: "小组讨论文字", placeholder: "记录本组实际讨论的内容、分歧与尚未解决的问题。" },
    { id: "followupAnswers", label: "对追问的回答", placeholder: "写下引导师追问以及学生自己的回答，保留还不能回答的部分。" },
    { id: "rewrittenTheme", label: "学生重写的工作坊主题", placeholder: "讨论与追问之后，用本组自己的话重写主题命题，并说明改变了什么。" },
  ] },
  2: { title: "用户研究记录", hint: "学生先写提纲原稿，自主采纳建议形成清单；保留原始材料与学生解释，不设评分。", fields: [
    { id: "goal", label: "想了解的未知问题", placeholder: "我们真正不了解用户的什么？" },
    { id: "guide", label: "访谈 / 观察提纲", placeholder: "学生先写自己的提纲原稿；保留原文，问题尽量开放，不暗示答案。" },
    { id: "adoptedGuide", label: "采纳建议后的问题清单", placeholder: "由学生决定采纳哪些建议，写下修改后的提问清单；原稿不覆盖。" },
    { id: "sources", label: "原始证据与来源", placeholder: "填写原话、材料名称或附件引用；没有材料就留缺口。" },
    { id: "interpretation", label: "学生的解释", placeholder: "我们的理解是什么？它和原始记录有什么区别？" },
    { id: "reflection", label: "研究反思", placeholder: "遗漏、偏见与下一次想追问的内容。" },
  ] },
  3: { title: "用户画像与HMW", hint: "正式产出用户画像与HMW。画像年龄、兴趣、生活方式与行为须有材料支持；未知留空，不另设用户问题必交项。", fields: [
    { id: "personaAge", label: "画像年龄", placeholder: "只填写材料支持的年龄或年龄范围；未知就保留缺口，不推测。" },
    { id: "personaInterests", label: "画像兴趣", placeholder: "依据哪些材料了解其兴趣？记录来源，未知不编造。" },
    { id: "personaLifestyle", label: "画像生活方式", placeholder: "材料呈现了哪些生活习惯与情境？不要把个体经历当成全体事实。" },
    { id: "personaBehavior", label: "画像行为", placeholder: "谁在什么情境做了什么？保留材料引用，与本组解释分开。" },
    { id: "patterns", label: "材料中的模式与矛盾", placeholder: "相似点、差异、反例分别是什么？" },
    { id: "insight", label: "本组洞察", placeholder: "我们认为……，依据是……，仍需验证……" },
    { id: "evidence", label: "证据关联与缺口", placeholder: "逐条写材料或附件引用，不补造原话。" },
    { id: "hmw", label: "我们如何能够……（HMW）", placeholder: "一个具体、可探索的问题。" },
    { id: "decision", label: "团队选择及理由", placeholder: "选定的定义、原因与仍有不同意见的部分。" },
  ] },
  4: { title: "点子描述单", hint: "正式交付至少3份不同点子描述单PDF，每份包含名称、图像和核心说明。草稿可继续编辑，不锁定阶段；填写不代表PDF已导出。", fields: [
    { id: "criteria", label: "本组比较的标准", placeholder: "对用户有帮助、可测试、成本……由本组提出。" },
    { id: "reason", label: "选择理由与不同意见", placeholder: "为什么选这个方向？哪些意见还需要保留？" },
  ] },
  5: { title: "静态粗原型", hint: "正式交付静态粗原型。先说清类型、情境、接触点和操作，再制作与比较方案；参考素材可选，方案数不固定3个。", fields: [
    { id: "idea", label: "选定的点子", placeholder: "填写本组选择的点子名称与来源。" },
    { id: "hypothesis", label: "这次要验证的假设", placeholder: "一个原型先回答一个关键问题。" },
    { id: "type", label: "原型对象与形式", placeholder: "说明原型类型，例如App、小程序、服务流程或传播物；先做静态粗原型。" },
    { id: "situation", label: "使用情境", placeholder: "用户何时、何地、为了解决什么问题接触这个原型？" },
    { id: "touchpoints", label: "用户接触点", placeholder: "用户会接触哪些界面、物件、人员或服务节点？" },
    { id: "operations", label: "用户操作步骤", placeholder: "用户从哪里开始，要看到、选择或操作什么？先描述关键步骤。" },
    { id: "task", label: "用户需要完成的任务", placeholder: "测试者看到原型后要尝试什么？" },
    { id: "requirements", label: "文字、界面与参考图要求", placeholder: "写下必要界面与文案；参考文字、图片可选，不要求必须上传。" },
    { id: "version", label: "已保存原型的引用", placeholder: "在原生工作台保存后，记录实际原型与版本引用。" },
  ] },
  6: { title: "迭代后原型", hint: "正式产出迭代后原型。保留既有原型与被测／新版引用，区分用户实际说、实际做和学生推断；没有真实测试就保留未验证。", fields: [
    { id: "version", label: "被测试的原型版本", placeholder: "填写实际保存的版本或链接。" },
    { id: "questions", label: "测试问题与任务", placeholder: "希望观察到什么？怎样避免诱导？" },
    { id: "feedback", label: "本组记录的测试反馈与材料引用（待核对）", placeholder: "记录本组反馈与材料来源；学生记录不等于真实性核验，没有测试就写尚未验证。" },
    { id: "said", label: "用户实际说了什么", placeholder: "保留实际原话及材料引用；没有记录就留缺口，不由AI补写。" },
    { id: "did", label: "用户实际做了什么", placeholder: "记录实际观察到的操作与行为，以及对应材料。" },
    { id: "inference", label: "学生的推断", placeholder: "我们怎样解释实际说和做？依据是什么，哪些判断仍需验证？" },
    { id: "reflection", label: "反思与解释", placeholder: "区分我们看到的现象和我们的解释。" },
    { id: "next", label: "下一假设与修改方向", placeholder: "下一次要验证什么？为什么需要返回前一步？" },
    { id: "newVersion", label: "迭代后的原型版本", placeholder: "新版保存后记录引用，与反馈和旧版对应。" },
  ] },
};

export function emptyAidtUiDrafts(): AidtUiDrafts {
  return Object.fromEntries(AIDT_STEPS.map((s) => [s.id, { fields: {}, selectedIdeaId: "", ideas: s.id === 4 ? [1, 2, 3].map((n) => ({ id: `draft-${n}`, title: "", description: "" })) : [] }]));
}
export function aidtUiStageMarkdown(stageNumber: number, draft: AidtUiStageDraft): string {
  const step = AIDT_STEPS.find((s) => s.id === stageNumber)!;
  const lines = [`## ${stageNumber}. ${step.title}`, "", "状态：本页界面草稿，尚未保存到小组。", ""];
  for (const field of AIDT_OUTPUTS[stageNumber]!.fields) lines.push(`### ${field.label}`, draft.fields[field.id]?.trim() || "待补充", "");
  if (stageNumber === 4) for (const [index, idea] of draft.ideas.entries()) lines.push(`### 候选 ${index + 1}：${idea.title.trim() || "待命名"}${draft.selectedIdeaId === idea.id ? "（拟选择）" : ""}`, idea.description.trim() || "核心说明待补充。", idea.imageName ? `参考图：${idea.imageName}（仅本页预览，原图请通过聊天附件上传）` : "图像待补充。", "");
  return lines.join("\n");
}
/** Current student-authored work, without manufacturing values for empty fields. */
export function aidtUiStageSummary(stageNumber: number, draft: AidtUiStageDraft): string {
  const lines = AIDT_OUTPUTS[stageNumber]!.fields.flatMap((field) => draft.fields[field.id]?.trim() ? [`${field.label}：${draft.fields[field.id]}`] : []);
  if (stageNumber === 4) for (const [index, idea] of draft.ideas.entries()) {
    if (!idea.title.trim() && !idea.description.trim() && !idea.imageName) continue;
    lines.push(`候选 ${index + 1}${draft.selectedIdeaId === idea.id ? "（拟选，非投票）" : ""}：${idea.title || "待命名"}`, idea.description, idea.imageName ? `参考图：${idea.imageName}（仅本页）` : "参考图尚缺");
  }
  return lines.filter(Boolean).join("\n");
}
export function aidtUiReportMarkdown(drafts: AidtUiDrafts): string {
  return ["# 小组研究报告 · UI 审阅稿", "", "本稿仅包含本页填写的未保存草稿，不代表系统全部已保存资料。提交前请核对原始证据、来源与版本；缺少的内容保留缺口，不虚构采访、测试、教师点评或投票。", "", ...AIDT_STEPS.map((s) => aidtUiStageMarkdown(s.id, drafts[s.id]!)), "## 教师点评", "待教师提供并经授权保存。", "", "## 后续建议", "由本组审阅后填写下一假设与行动。", ""].join("\n");
}
