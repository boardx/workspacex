/**
 * 访谈大纲草案生成 —— 领域纯函数（F84，uc-6-2 R3 步骤3，AC1 / AC2）。
 *
 * ## 这个文件只证明一件事：AC1 的形状,不是「像不像 AI 写的」
 *
 * `generateOutlineDraft` 是一个**确定性**生成器,不接任何真实模型——契约的
 * `AI_GENERATION_UNAVAILABLE` 因此在本 feature 里恒不可达(没有外部依赖可失败)。
 * 这不是偷懒：R11 把本 UC 切成五个 feature,「大纲编辑器 + 方法论提示」是 F85 的范围,
 * 「诱导性/照抄体检」（`checkQuestionQuality`）是 B 组另一个未实现的 feature。
 * F84 的验收线索（V2/AC2/AC5）只要求「模板结构与对象背景在生成的大纲里可见且可改」
 * 与「AI 已生成 · 待你确认」的服务端状态机——都不需要真的调一次大模型。
 * 接入真实生成模型是留给后续 feature 的替换点,端口形状(`OutlineDraftInput` →
 * `OutlineSectionDraft[]`)现在就稳定,换实现不必换调用方。
 *
 * ## 每段结构固定两层,顺序不可颠倒（I-11）
 *
 * `OutlineSectionDraft.objective` 必须先于 `openers` 被序列化——契约的 `OutlineSection`
 * 顺带把这一条焊进了 zod schema 的 key 顺序,这里的类型定义字段顺序与之一致,
 * 不是巧合。
 */

import type { TemplateFieldInput, TemplateSectionInput } from "./template";

/** 每段至少两条开场问法（AC1）。 */
export const MIN_OPENERS_PER_SECTION = 2;

/** 三步向导第三步的输入——模板结构 + 对象背景 + 三要素上下文（AC2 的三个来源）。 */
export interface OutlineDraftSubjectContext {
  readonly subjectId: string;
  readonly displayName: string;
  readonly roleTitle: string;
  readonly orgName: string | null;
  /** F97 的第六列以外的自由文本背景（`SubjectRecord.backgroundAndQuestions`）。 */
  readonly backgroundAndQuestions: string;
}

export interface OutlineDraftContextThree {
  readonly who: string;
  readonly situation: string;
  readonly decision: string;
}

export interface OutlineDraftInput {
  /** 套用了模板 ⇒ 非空；「从空白开始」（A2）⇒ 空数组。 */
  readonly templateSections: readonly TemplateSectionInput[];
  /** 与 `templateSections` 同源,AC2 断言里连数据字段也要能在大纲侧看见。 */
  readonly templateDataFields: readonly TemplateFieldInput[];
  readonly subjects: readonly OutlineDraftSubjectContext[];
  readonly context: OutlineDraftContextThree;
}

/** 生成出来的一段——先「要问出什么」,后「开场问法」（I-11,顺序即契约）。 */
export interface OutlineSectionDraft {
  readonly objective: string;
  readonly openers: readonly string[];
  readonly minutes: number;
  readonly order: number;
}

function subjectLabel(subjects: readonly OutlineDraftSubjectContext[]): string {
  if (subjects.length === 0) return "本场受访者";
  return subjects.map((s) => `${s.displayName}（${s.roleTitle}${s.orgName !== null ? ` · ${s.orgName}` : ""}）`).join("、");
}

function backgroundHints(subjects: readonly OutlineDraftSubjectContext[]): string {
  const withBackground = subjects.filter((s) => s.backgroundAndQuestions.length > 0);
  if (withBackground.length === 0) return "";
  return withBackground.map((s) => s.backgroundAndQuestions).join("；");
}

/** 数据字段名单——AC2 断言「数据字段在生成的大纲里可见」的最小落点：写进第一段的问法里。 */
function dataFieldHint(dataFields: readonly TemplateFieldInput[]): string {
  if (dataFields.length === 0) return "";
  return `（本场要记录：${dataFields.map((f) => f.name).join("、")}）`;
}

/**
 * 由「模板某一段」派生出的一段大纲：段名带入 `objective`,给两条引用对象背景的开场问法。
 * 每一段都能看见是**从模板哪一段带入的**（AC2「模板带入的分段…在生成的大纲里可见且可改」）。
 */
function fromTemplateSection(
  section: TemplateSectionInput,
  who: string,
  hint: string,
  dataFieldSuffix: string,
): OutlineSectionDraft {
  return {
    objective: `围绕「${section.name}」,还原${who}的真实经历${dataFieldSuffix}`,
    openers: [
      `关于「${section.name}」,能说说你最近一次的真实经历吗？`,
      hint.length > 0
        ? `你提到${hint.length > 40 ? `${hint.slice(0, 40)}…` : hint},能展开讲讲吗？`
        : `在「${section.name}」这件事上,谁参与了决定？`,
    ],
    minutes: section.minutes,
    order: section.order,
  };
}

/** 「从空白开始」（A2）——只按上下文三要素生成一段起手式。 */
function fromContextOnly(who: string, ctx: OutlineDraftContextThree): OutlineSectionDraft {
  return {
    objective: `确认${who}在「${ctx.situation}」中要做的决定「${ctx.decision}」的真实处境`,
    openers: [
      `能说说你最近一次遇到「${ctx.situation}」时,实际发生了什么吗？`,
      `围绕「${ctx.decision}」,当时谁参与了讨论？`,
    ],
    minutes: 20,
    order: 0,
  };
}

/**
 * 一段是否满足 AC1「有目标 且 至少两条开场问法」（F85，大纲编辑器）。
 *
 * ⚠ 空白字符串不算数——`"   "` 当目标或问法都等于没写,和「质量提示计数」
 *   （`countIncompleteSections`）共用同一条 trim 纪律,否则质量提示会漏掉
 *   看起来「有内容」实则全是空格的段落。
 */
export function isSectionComplete(section: {
  readonly objective: string;
  readonly openers: readonly string[];
}): boolean {
  const hasObjective = section.objective.trim().length > 0;
  const openerCount = section.openers.filter((o) => o.trim().length > 0).length;
  return hasObjective && openerCount >= MIN_OPENERS_PER_SECTION;
}

/**
 * 质量提示计数——「N 段还需你改问法」，与实际缺项数一致（uc-6-2 R3 步骤6 / V1）。
 *
 * ⚠ 这条断言的反证：若实现只统计「目标为空」而漏掉「开场问法不足两条」，
 *   对一份「每段都有目标、但某段只有一条问法」的大纲，这里会算出 0，
 *   而 `isSectionComplete` 对同一段会判 false——两者必须永远同步，
 *   所以这里直接复用 `isSectionComplete`，不重写一遍判定逻辑。
 */
export function countIncompleteSections(
  sections: readonly { readonly objective: string; readonly openers: readonly string[] }[],
): number {
  return sections.filter((s) => !isSectionComplete(s)).length;
}

/** 大纲合计时长（[原型] 头部「合计 55 分钟」的来源）。 */
export function totalOutlineMinutes(sections: readonly { readonly minutes: number }[]): number {
  return sections.reduce((sum, s) => sum + s.minutes, 0);
}

/**
 * 生成大纲草案——AC1（每段目标 + ≥2 开场问法,目标在前）与 AC2
 * （模板分段/数据字段 + 对象背景可见）同时满足。
 */
export function generateOutlineDraft(input: OutlineDraftInput): OutlineSectionDraft[] {
  const who = subjectLabel(input.subjects);
  const hint = backgroundHints(input.subjects);
  const dataFieldSuffix = dataFieldHint(input.templateDataFields);

  if (input.templateSections.length === 0) {
    return [fromContextOnly(who, input.context)];
  }
  return input.templateSections
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((section) => fromTemplateSection(section, who, hint, dataFieldSuffix));
}
