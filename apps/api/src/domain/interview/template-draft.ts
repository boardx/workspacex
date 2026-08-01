/**
 * 反向抽取草案 —— 领域纯函数（F83，uc-6-1 A3 / R3 步骤5）。
 *
 * ## 这里做什么、不做什么
 *
 * `extractTemplateDraft` 的语义在需求文档里全程标 [设计]（唯一线索是标签页括注
 * 「来自 3 场项目」，原型确认缺失，见 design-signoff.md）。本仓没有受访者片段/转写的
 * 语义抽取基础设施（那是回流成洞察 F93 一束的范围，且尚未实现），若在这里编一套
 * 「读转写猜结构」的 AI 逻辑，就是在替产品做一个 UC 自己都没敢裁的判断。
 *
 * 因此这个版本的抽取算法是**确定性的、非 AI 的**，判断依据是已经存在、已经落盘的
 * 事实：**这几场访谈实际套用过的模板三样东西**（`interview_template_applications`，
 * F82 已建）。这是「从已办访谈沉淀出模板」最保守、最可验证的一种读法——不是唯一
 * 合理的读法，是本次实现选择的那一种，PR 描述里如实报告为判断取舍。
 *
 * O-05（「拒绝 AI 分析的片段不进抽取输入」）在这个粒度上落地成：**若某场访谈的任一
 * 受访者明确拒绝了 `ai_analysis`，这一整场访谈不进入抽取输入**——因为这里没有
 * 片段级别的归属，没法只剔除某个人的片段而保留同场其他人的。这是比 O-05 原文更粗的
 * 粒度，是判断取舍，不是原文本身。
 */
import type { TemplateFieldInput, TemplateSectionInput } from "./template";

/** 某一场来源访谈对抽取贡献的原始素材（已按 O-05 判定过是否可用）。 */
export interface SourceInterviewMaterial {
  readonly interviewId: string;
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
}

export interface TemplateDraftContent {
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
}

/**
 * 合并若干场来源访谈的三样东西为一份草案内容。
 *
 * · 分段按 `name` 去重，保留首次出现的那份内容，`order` 按合并后出现顺序重新编号
 *   （多场访谈各自的 `order` 是各自内部的顺序，合并后不能假装它们是同一个坐标系）。
 * · 数据字段按 `fieldId` 去重，保留首次出现的那份；`required` 不做「任一必填则必填」
 *   的推断——那是在替研究员做决定，保留原样，草案本就等确认时人工核对。
 */
export function mergeTemplateDraftContent(
  materials: readonly SourceInterviewMaterial[],
): TemplateDraftContent {
  const sectionsByName = new Map<string, TemplateSectionInput>();
  const fieldsById = new Map<string, TemplateFieldInput>();

  for (const material of materials) {
    for (const section of material.sections) {
      if (!sectionsByName.has(section.name)) {
        sectionsByName.set(section.name, section);
      }
    }
    for (const field of material.dataFields) {
      if (!fieldsById.has(field.fieldId)) {
        fieldsById.set(field.fieldId, field);
      }
    }
  }

  const sections = Array.from(sectionsByName.values()).map((s, index) => ({
    name: s.name,
    minutes: s.minutes,
    order: index,
  }));

  return {
    sections,
    dataFields: Array.from(fieldsById.values()),
  };
}

/**
 * 确认入库前允许对草案做的编辑。
 *
 * ⚠ `edits` 契约类型是 `string | null`（`confirmTemplateDraft.in.edits`），语义在需求里
 * 未定义具体结构。本实现把它读成一段 **JSON 编码的部分覆盖**：
 * `{ name?, goal?, sections?, dataFields?, tags? }`，逐字段覆盖草案默认值，未出现的键
 * 保留草案原值。这是判断取舍——契约本身没有规定 `edits` 必须是 JSON，PR 描述里如实报告。
 *
 * 解析失败（不是合法 JSON，或不是对象）时**不抛错**、原样返回草案默认内容——
 * 编辑是可选的锦上添花，解析失败不应该挡住「确认入库」这个主流程。
 */
export interface TemplateDraftDefaults {
  readonly name: string;
  readonly goal: string;
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
  readonly tags: readonly string[];
}

export function applyDraftEdits(
  defaults: TemplateDraftDefaults,
  edits: string | null,
): TemplateDraftDefaults {
  if (edits === null) return defaults;

  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(edits);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return defaults;
    parsed = value as Record<string, unknown>;
  } catch {
    return defaults;
  }

  return {
    name: typeof parsed.name === "string" ? parsed.name : defaults.name,
    goal: typeof parsed.goal === "string" ? parsed.goal : defaults.goal,
    sections: Array.isArray(parsed.sections)
      ? (parsed.sections as unknown as readonly TemplateSectionInput[])
      : defaults.sections,
    dataFields: Array.isArray(parsed.dataFields)
      ? (parsed.dataFields as unknown as readonly TemplateFieldInput[])
      : defaults.dataFields,
    tags: Array.isArray(parsed.tags) ? (parsed.tags as readonly string[]) : defaults.tags,
  };
}

/** 草案默认名称——抽取本身不产生「访谈目标」这类叙述性内容，留给研究员在编辑器里补。 */
export function defaultDraftName(sourceInterviewIds: readonly string[]): string {
  return `抽取草案（来自 ${sourceInterviewIds.length} 场访谈）`;
}
