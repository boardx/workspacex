/**
 * Workflow 产出页的显示层清洗：模型输出里的调试前缀、证据引用的内部编码不上屏。
 * 原文仍在「技术详情」里可查。
 */

import { workSkillDisplayName } from "@/lib/work-skill-display-copy";

const REVISION_SUFFIX = /\s*\((revise|revised|revision)\)\s*$/i;
const DEBUG_PREFIX = /^(\s*\[[A-Za-z0-9_-]+\]\s*)+/;

/** 去掉 `[loopback] ` 一类调试前缀，把 `(revise)` 换成中文；清完为空则用 fallback。 */
export function humaniseOutputText(text: string, fallback = ""): string {
  let t = humaniseSkillRefs(text.replace(DEBUG_PREFIX, ""));
  const revised = REVISION_SUFFIX.test(t);
  t = t.replace(REVISION_SUFFIX, "").trim();
  if (t.length === 0) return fallback;
  return revised ? `${t}（修订版）` : t;
}

const SOURCE_KIND: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(doc|document|file)$/i, "文档"],
  [/^(kb|knowledge|note)$/i, "知识库"],
  [/^(msg|message|chat|thread)$/i, "对话"],
  [/^(url|http|https|web)$/i, "网页"],
  [/^(meeting|transcript)$/i, "会议记录"],
  [/^(loopback|stub|fixture|demo)$/i, "演示数据"],
];

/** 证据引用 → 可读来源标签（`loopback:frame` → `演示数据`），不暴露内部编码。 */
export function evidenceSourceLabel(ref: string): string {
  const idx = ref.indexOf(":");
  const scheme = idx > 0 ? ref.slice(0, idx) : "";
  for (const [re, label] of SOURCE_KIND) if (re.test(scheme)) return label;
  return "引用材料";
}

const SKILL_REF = /\b(S\d{3})@[0-9A-Za-z.+-]*[0-9A-Za-z]/g;
const REQUIREMENT_FROM = /^requirement from (.+)$/i;

function skillName(stableId: string): string {
  return `「${workSkillDisplayName(stableId) ?? "内置技能"}」`;
}

/** `requirement from S067@1.0.0` → `来自「PRD / 需求规格撰写」技能的需求`；其余 `S0xx@ver` 换中文名。 */
export function humaniseSkillRefs(text: string): string {
  const withNames = text.replace(SKILL_REF, (_m, id: string) => skillName(id));
  const m = REQUIREMENT_FROM.exec(withNames.trim());
  return m ? `来自${m[1]}技能的需求` : withNames;
}

const SNAKE_ID = /^[A-Za-z0-9]+(_[A-Za-z0-9]+)+$/;

/** 指标名：`loopback_metric` 一类内部编号 → 可读名；原编号留给技术详情。 */
export function humaniseMetricName(name: string, fallback = "指标"): string {
  const t = name.replace(DEBUG_PREFIX, "").trim();
  if (!SNAKE_ID.test(t)) return humaniseOutputText(t, fallback);
  if (/(^|_)(loopback|stub|fixture|demo)(_|$)/i.test(t)) return "演示指标";
  return t.split("_").join(" ");
}

/** 指标名是否被改写过（被改写的原编号应进技术详情）。 */
export function isInternalMetricId(name: string): boolean {
  return SNAKE_ID.test(name.replace(DEBUG_PREFIX, "").trim());
}
