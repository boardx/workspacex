import type { AidtIdeaDraft, AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";

/** Student labels, independent from the selected idea and any voting mechanism. */
export const AIDT_IDEA_CATEGORIES = [
  { id: "easy", label: "最容易实现的" },
  { id: "breakthrough", label: "最具突破性的" },
  { id: "fun", label: "最有趣的" },
] as const;
export type AidtIdeaCategory = (typeof AIDT_IDEA_CATEGORIES)[number]["id"];
export const AIDT_IDEA_CLASSIFICATION_FIELDS = {
  tags: "ideaClassificationTags",
  reasons: "ideaClassificationReasons",
  confirmed: "ideaClassificationConfirmed",
} as const;
const FIELD_LIMIT = 6000; // Existing shared StageDraft.fields value limit, not a course rule.
const knownCategory = (value: unknown): value is AidtIdeaCategory => AIDT_IDEA_CATEGORIES.some((category) => category.id === value);

export type AidtIdeaClassification = {
  tags: Record<string, AidtIdeaCategory[]>;
  reasons: Record<string, string>;
  confirmed: boolean;
  canConfirm: boolean;
  issues: string[];
};

export function aidtClassifiableIdeas(draft: AidtUiStageDraft): AidtIdeaDraft[] {
  const seen = new Set<string>();
  return draft.ideas.filter((idea) => {
    if (!idea.id || seen.has(idea.id) || !(idea.title.trim() || idea.description.trim() || idea.imageAttachment || idea.imageName?.trim() || idea.image?.trim())) return false;
    seen.add(idea.id); return true;
  });
}

function readRecord(raw: string | undefined, label: string, issues: string[]): Record<string, unknown> {
  if (!raw?.trim()) return {};
  if (raw.length > FIELD_LIMIT) issues.push(`${label}超过共享字段长度，请缩短后保存。`);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* A malformed stored field remains visible as a repairable problem. */ }
  issues.push(`${label}无法读取，请核对后重新整理。`);
  return {};
}

export function readAidtIdeaClassification(draft: AidtUiStageDraft): AidtIdeaClassification {
  const issues: string[] = [], ideas = aidtClassifiableIdeas(draft), ids = new Set(ideas.map((idea) => idea.id));
  const rawTags = readRecord(draft.fields[AIDT_IDEA_CLASSIFICATION_FIELDS.tags], "分类标签", issues);
  const rawReasons = readRecord(draft.fields[AIDT_IDEA_CLASSIFICATION_FIELDS.reasons], "分类理由", issues);
  const tags: Record<string, AidtIdeaCategory[]> = Object.create(null) as Record<string, AidtIdeaCategory[]>;
  const reasons: Record<string, string> = Object.create(null) as Record<string, string>;
  let stale = false;
  for (const [id, value] of Object.entries(rawTags)) {
    if (!ids.has(id)) { stale = true; continue; }
    if (!Array.isArray(value) || value.some((item) => !knownCategory(item))) { issues.push("有分类标签无法识别，请重新选择。"); continue; }
    tags[id] = AIDT_IDEA_CATEGORIES.filter((category) => value.includes(category.id)).map((category) => category.id);
  }
  for (const [id, value] of Object.entries(rawReasons)) {
    if (!ids.has(id)) { stale = true; continue; }
    if (typeof value !== "string") { issues.push("有分类理由无法读取，请重新填写。"); continue; }
    reasons[id] = value;
  }
  if (draft.ideas.filter((idea) => idea.id && ids.has(idea.id)).length > ids.size) issues.push("有点子标识重复，请核对候选后再确认分类。");
  const missingReason = ideas.some((idea) => (tags[idea.id]?.length ?? 0) > 0 && !reasons[idea.id]?.trim());
  const canConfirm = ideas.length > 0 && issues.length === 0 && !missingReason;
  if (stale) issues.push("已移除点子的分类不再显示；再次确认会整理这些旧引用。");
  return {
    tags, reasons, canConfirm,
    confirmed: draft.fields[AIDT_IDEA_CLASSIFICATION_FIELDS.confirmed] === "true" && canConfirm && !stale,
    issues: [...new Set(issues)],
  };
}

function writeClassification(draft: AidtUiStageDraft, tags: Record<string, AidtIdeaCategory[]>, reasons: Record<string, string>, confirmed = false): AidtUiStageDraft {
  return { ...draft, fields: {
    ...draft.fields,
    [AIDT_IDEA_CLASSIFICATION_FIELDS.tags]: JSON.stringify(tags),
    [AIDT_IDEA_CLASSIFICATION_FIELDS.reasons]: JSON.stringify(reasons),
    [AIDT_IDEA_CLASSIFICATION_FIELDS.confirmed]: confirmed ? "true" : "",
  } };
}

export function setAidtIdeaCategory(draft: AidtUiStageDraft, ideaId: string, category: AidtIdeaCategory, checked: boolean): AidtUiStageDraft {
  if (!knownCategory(category) || !aidtClassifiableIdeas(draft).some((idea) => idea.id === ideaId)) return draft;
  const current = readAidtIdeaClassification(draft), selected = new Set(current.tags[ideaId] ?? []);
  if (checked) selected.add(category); else selected.delete(category);
  return writeClassification(draft, { ...current.tags, [ideaId]: AIDT_IDEA_CATEGORIES.filter((item) => selected.has(item.id)).map((item) => item.id) }, current.reasons);
}

export function setAidtIdeaClassificationReason(draft: AidtUiStageDraft, ideaId: string, reason: string): AidtUiStageDraft {
  if (!aidtClassifiableIdeas(draft).some((idea) => idea.id === ideaId)) return draft;
  const current = readAidtIdeaClassification(draft);
  return writeClassification(draft, current.tags, { ...current.reasons, [ideaId]: reason });
}

export function confirmAidtIdeaClassification(draft: AidtUiStageDraft): AidtUiStageDraft {
  const current = readAidtIdeaClassification(draft);
  return current.canConfirm ? writeClassification(draft, current.tags, current.reasons, true) : draft;
}

/** Call whenever an idea is added, removed, renamed or edited outside the classifier. */
export function invalidateAidtIdeaClassification(draft: AidtUiStageDraft): AidtUiStageDraft {
  return { ...draft, fields: { ...draft.fields, [AIDT_IDEA_CLASSIFICATION_FIELDS.confirmed]: "" } };
}

/** Explicit repair action; valid active labels/reasons survive, unknown data is not guessed. */
export function repairAidtIdeaClassification(draft: AidtUiStageDraft): AidtUiStageDraft {
  const current = readAidtIdeaClassification(draft);
  return writeClassification(draft, current.tags, current.reasons);
}

export function aidtIdeaClassificationFor(draft: AidtUiStageDraft, ideaId: string): { labels: string[]; reason: string; confirmed: boolean } {
  const current = readAidtIdeaClassification(draft);
  return { labels: AIDT_IDEA_CATEGORIES.filter((category) => current.tags[ideaId]?.includes(category.id)).map((category) => category.label), reason: current.reasons[ideaId] ?? "", confirmed: current.confirmed };
}

export function aidtIdeaClassificationLines(draft: AidtUiStageDraft): string[] {
  const current = readAidtIdeaClassification(draft), ideas = aidtClassifiableIdeas(draft);
  return [
    `学生点子分类：${current.confirmed ? "学生已确认本页记录" : "待学生确认"}；分类与投票、共享保存分别核对。`,
    ...ideas.map((idea, index) => {
      const labels = AIDT_IDEA_CATEGORIES.filter((category) => current.tags[idea.id]?.includes(category.id)).map((category) => category.label);
      return `${idea.title.trim() || `未命名点子${index + 1}`}：${labels.join("、") || "暂未分类"}；学生分类理由：${current.reasons[idea.id]?.trim() || "尚未填写"}`;
    }),
    ...current.issues.map((issue) => `分类待核对：${issue}`),
  ];
}
