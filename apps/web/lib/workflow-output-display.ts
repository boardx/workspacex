/**
 * Workflow 产出页的显示层清洗：模型输出里的调试前缀、证据引用的内部编码不上屏。
 * 原文仍在「技术详情」里可查。
 */

const REVISION_SUFFIX = /\s*\((revise|revised|revision)\)\s*$/i;
const DEBUG_PREFIX = /^(\s*\[[A-Za-z0-9_-]+\]\s*)+/;

/** 去掉 `[loopback] ` 一类调试前缀，把 `(revise)` 换成中文；清完为空则用 fallback。 */
export function humaniseOutputText(text: string, fallback = ""): string {
  let t = text.replace(DEBUG_PREFIX, "");
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
