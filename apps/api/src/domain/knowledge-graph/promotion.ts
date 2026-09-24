/**
 * Phase 18 F11 —— 晋升时的去重判断（uc-18-4 R3-2 / R3-4），纯函数。
 *
 * 本阶段没有嵌入（F05 不在 MVP），「同义」用字面判断：
 *   - 归一后全文相同 ⇒ duplicate：自动把新证据合并到已有的那条（不打扰用户）；
 *   - 词元重合度（Jaccard）≥ 0.6 ⇒ similar：交给用户选「合并」还是「并存」（needs_choice）；
 *   - 否则 ⇒ 新建。
 */
import { normalizeName } from "./extraction";
import { lexicalTokens } from "./recall";

export interface PersonalClaimRef {
  readonly id: string;
  readonly statement: string;
}

export type DedupVerdict =
  | { readonly kind: "new" }
  | { readonly kind: "duplicate"; readonly existingId: string }
  | { readonly kind: "similar"; readonly existingId: string };

export const SIMILAR_THRESHOLD = 0.6;

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function dedupAgainstPersonal(statement: string, personal: readonly PersonalClaimRef[]): DedupVerdict {
  const norm = normalizeName(statement);
  const same = personal.find((p) => normalizeName(p.statement) === norm);
  if (same !== undefined) return { kind: "duplicate", existingId: same.id };
  const tokens = lexicalTokens(statement);
  let best: { id: string; score: number } | null = null;
  for (const p of personal) {
    const s = jaccard(tokens, lexicalTokens(p.statement));
    if (s >= SIMILAR_THRESHOLD && (best === null || s > best.score)) best = { id: p.id, score: s };
  }
  return best === null ? { kind: "new" } : { kind: "similar", existingId: best.id };
}
