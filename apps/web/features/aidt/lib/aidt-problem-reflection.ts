import { isAidtProblemControlText } from "@repo/contracts/aidt-stages";
import { readAidtProblemDirections } from "./aidt-problem-directions";
/** Source labels describe student-reported provenance, never proof of a claim. */
export const PROBLEM_SOURCE_OPTIONS = [
  { value: "observation", label: "亲自观察" },
  { value: "complaint", label: "听到抱怨" },
  { value: "guess", label: "我们的猜测" },
] as const;

export type ProblemSource = (typeof PROBLEM_SOURCE_OPTIONS)[number]["value"];

/** Preserve invalid stored data until a student deliberately edits their selection. */
export function readProblemSources(raw: string | undefined): { selected: ProblemSource[]; invalid: boolean } {
  if (!raw) return { selected: [], invalid: false };
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return { selected: [], invalid: true };
    const known = (item: unknown): item is ProblemSource => PROBLEM_SOURCE_OPTIONS.some((option) => option.value === item);
    return { selected: [...new Set(value.filter(known))], invalid: value.some((item) => !known(item)) };
  } catch { return { selected: [], invalid: true }; }
}
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";


/** Shared by the editor and exports so a stale raw flag cannot confirm incomplete material. */
export function problemReflectionMissingFields(draft: AidtUiStageDraft): string[] {
  const fields = draft.fields;
  const sources = readProblemSources(fields.problemSources);
  return [
    (!fields.initial?.trim() || isAidtProblemControlText(fields.initial)) && "原始命题",
    (!fields.whyWorthStudying?.trim() || isAidtProblemControlText(fields.whyWorthStudying)) && "选题理由",
    (!sources.selected.length || sources.invalid) && "问题来源",
    (!fields.sourceDetails?.trim() || isAidtProblemControlText(fields.sourceDetails)) && "来源描述",
  ].filter((label): label is string => Boolean(label));
}

export function isProblemReflectionConfirmed(draft: AidtUiStageDraft): boolean {
  return draft.fields.problemReflectionConfirmed === "true" && problemReflectionMissingFields(draft).length === 0;
}

/** Student-reported provenance remains unverified even when the editor confirms their reflection. */
export function formatAidtProblemReflectionMarkdown(draft: AidtUiStageDraft): string[] {
  const fields = draft.fields;
  const sources = readProblemSources(fields.problemSources);
  const sourceLabels = sources.selected.map((source) => PROBLEM_SOURCE_OPTIONS.find((option) => option.value === source)!.label);
  const missing = problemReflectionMissingFields(draft);
  const directions = readAidtProblemDirections(fields.problemDirections);
  return [
    "### 问题反思记录",
    `原始命题：${fields.initial?.trim() && !isAidtProblemControlText(fields.initial) ? fields.initial.trim() : "待补充"}`,
    `学生重写命题：${fields.rewrittenTheme?.trim() || "待补充"}`,
    `为什么值得研究：${fields.whyWorthStudying?.trim() || "待补充"}`,
    `学生标注的问题来源：${sourceLabels.join("、") || "待补充"}${sources.invalid ? "（来源数据待核对）" : ""}`,
    `来源描述：${fields.sourceDetails?.trim() || "待补充"}`,
    ...(fields.known?.trim() ? [`已知：${fields.known.trim()}`] : []),
    ...(fields.nextAction?.trim() ? [`下一步行动：${fields.nextAction.trim()}`] : []),
    `尚不确定：${fields.sourceUncertainty?.trim() || "尚未填写；不表示没有不确定性"}`,
    ...directions.map(direction => `候选方向：${direction.title}（${direction.source === "group" ? "小组讨论" : "AI 补充，待验证"}${direction.id === fields.problemDirectionId ? "；本轮选择" : ""}）`),
    `反思确认：${isProblemReflectionConfirmed(draft) ? "本组编辑者已确认" : "待学生确认"}${missing.length ? `；待补充：${missing.join("、")}` : ""}`,
    "依据状态：学生记录，尚待研究核实；观察、转述抱怨或猜测均不自动证明命题与原因。",
    "",
  ];
}
