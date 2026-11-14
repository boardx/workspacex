import { isAidtModuleEnabled } from "@/features/aidt/lib/aidt-module-config";

/** A special project profile stored through the existing project-tags contract.
 * This is presentation metadata, not a third ProjectKind or a new permission model.
 */
export const AIDT_PROJECT_TAG = "workspacex:aidt";
export const AIDT_PROJECT_LABEL = "AIDT · 设计思维项目";
export function isAidtProject(project: { kind: string; tags: readonly string[] } | null | undefined): boolean {
  return project?.kind === "general" && (project.tags ?? []).includes(AIDT_PROJECT_TAG);
}
/** Shared entry routing, including Home's recent work and current project links. */
export function projectWorkspaceHref(project: { id: string; kind: string; tags: readonly string[] }): string {
  return isAidtModuleEnabled() && isAidtProject(project) ? aidtHref(project.id) : `/projects/${encodeURIComponent(project.id)}`;
}
/** Presentation guidance only: no completion or assessment state is inferred. */
export const AIDT_STEPS = [
  { id: 1, skill: "aidt-understand", title: "理解与提出问题", summary: "从原始命题和小组讨论出发，选择一个研究方向。", task: "先写自己的原始命题、人、场景与希望改善的体验；不清楚的保留待讨论。回答追问后，由学生重写本轮主题。", outcome: "原命题与学生重写的工作坊主题对照；保留讨论分歧与假设。本步主题不是第三步HMW或已证实的洞察。", prompt: "先检查学生原始命题，缺用户、场景或活动时追问并允许待讨论，不编答案。按是什么、包含什么、意味着什么拆解；区分学生已有方向与AI补充方向，保留分歧。等待回答和学生选择，由学生重写并确认一个主题，不直接提供解决方案，不把本步主题混为HMW或研究结论。" },
  { id: 2, skill: "aidt-empathize", title: "共情用户", summary: "先拟访谈问题，再把每位受访者整理成一张发现卡。", task: "承接本轮主题，先提交学生访谈问题初稿，再修订清单。取得适当授权后开展真实采访；回来先由学生发现，一位受访者一张卡。", outcome: "学生采纳的访谈清单与PDF、定性质量反馈、照片＋headline＋具体情况的人物发现卡；不是画像或共情地图。缺图缺引文明确标缺失。", prompt: "先等待学生访谈问题初稿，再指出封闭、诱导或空泛处并说明原因，学生采纳后才形成清单。按受访者整理真实录音、转写和照片，提示校对；发现卡前先请学生提交自己的发现与原话。一位受访者一张卡，headline优先有出处原话，学生概括须标记不是引文；照片缺失不造图。只给定性反馈，不默认访谈分数，不编造采访或心理动机。" },
  { id: 3, skill: "aidt-define", title: "综合与定义", summary: "把证据连成洞察，形成用户画像（persona）和“我们如何能够”（HMW）。", task: "先挑选真实证据并说明联系，再讨论 persona 与‘我们如何能够…’问题。", outcome: "证据 → 用户画像（persona）→ 我们如何能够（HMW）；标注来源、缺口和待验证假设。", prompt: "先请学生选取真实证据，再协助归纳 persona 和 HMW。没有证据时明确不足，不能生成虚构用户画像当事实。给出选项，等待人选择。" },
  { id: 4, skill: "aidt-ideate", title: "创意发散", summary: "先头脑风暴，再选择不同点子形成描述单。", task: "围绕选定HMW先提出自己的点子，必要时选择类比、反转或SCAMPER再想一轮。至少整理三个不同点子的描述单，再由学生选择进入原型的方向。", outcome: "至少三份不同点子的描述单：名称、图像、2–3句核心说明，可导出PDF；保留进入原型的选择，投票规则待确认。", prompt: "先等待学生头脑风暴；提供鼓励式追问与可选方法，不以否定评分压缩发散。至少整理三个不同点子的描述单，每案名称、图像、2–3句说明；缺图或PDF失败保留缺失，不声称文件成功，不以同一点子的排版变化凑数。学生投票或选择后明确进入原型的点子，不替学生决定。" },
  { id: 5, skill: "aidt-prototype", title: "制作原型", summary: "明确要验证什么，比较方向后制作静态方案。", task: "先明确原型目标与类型，比较不同方向，再进入 Design Workbench 制作静态方案。", outcome: "原型目标、类型、方向比较、选择理由及真实版本；优先静态图和简单界面。", prompt: "先问原型要验证的假设和类型，提出可比较的静态方案方向，数量规则待确认，等学生选定后再协助原型。关联设计不代表研究证据已收集或原型已验收。" },
  { id: 6, skill: "aidt-iterate", title: "测试与迭代", summary: "测试明确的原型，由反馈和学生反思推动新版。", task: "先写原型测试问题，再记录真实对象说了什么、做了什么及材料来源。学生反思后选择修改，保留被测旧版。", outcome: "经改进的测试问题、反馈与反思、关联旧版及修改依据的新原型；新版默认待复测，不等同测试通过。", prompt: "先确认被测原型并等待学生测试问题初稿；没有真实测试材料时标待测试。区分实际陈述、行为和学生推断，先请学生反思，再由学生选择修改。保留旧版与反馈引用，协助迭代新原型，明确新版待复测，不以AI模拟替代真实测试或声称已验证。" },
] as const;
export type AidtStep = (typeof AIDT_STEPS)[number];
export function aidtStep(sub: string | null): AidtStep | null {
  return AIDT_STEPS.find((step) => sub === `aidt-${step.id}`) ?? null;
}
export function aidtHref(projectId: string, step?: number, params?: { tool?: string; resource?: string; thread?: string | null }): string {
  const q = new URLSearchParams();
  if (step) q.set("step", String(step));
  for (const [key, value] of Object.entries(params ?? {})) if (value) q.set(key, value);
  return `/aidt/${encodeURIComponent(projectId)}${q.size ? `?${q}` : ""}`;
}
export const AIDT_TEACHING_RULES = "学生先输入和讨论；AI 通过提问、质疑和选项协助；人做决策。真实研究证据不可合成，AI 生成内容必须标为草稿或假设。不要声称小组已确认或步骤已完成。";
