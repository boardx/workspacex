/**
 * 发起输入 → 「目标摘录」：取第一条有意义的文本字段（优先常见的目标类键，其次任意字符串值），
 * 在子句边界处截断到 MAX 字内。无文本输入返回 null。列表与详情投影共用这一份。
 */
const PREFERRED_KEYS = ["goal", "objective", "problem", "topic", "title", "subject", "name", "prompt", "description", "query"];
const MAX = 80;

export function goalFromTriggerInput(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rec = input as Record<string, unknown>;
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  let found: string | null = null;
  for (const k of PREFERRED_KEYS) {
    found = text(rec[k]);
    if (found) break;
  }
  if (!found) {
    for (const v of Object.values(rec)) {
      found = text(v);
      if (found) break;
    }
  }
  return found ? excerpt(found) : null;
}

function excerpt(raw: string): string {
  const oneLine = raw.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? raw;
  if (oneLine.length <= MAX) return oneLine;
  const head = oneLine.slice(0, MAX);
  const cut = Math.max(head.lastIndexOf("，"), head.lastIndexOf("；"), head.lastIndexOf("。"), head.lastIndexOf("、"), head.lastIndexOf(","), head.lastIndexOf(";"), head.lastIndexOf(" "));
  return `${cut >= MAX / 2 ? head.slice(0, cut) : head}…`;
}
