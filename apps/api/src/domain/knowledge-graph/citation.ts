/**
 * S7（#4364）—— 回答下方的引用 chip：这条回答**真的用到了**本轮召回的哪几条记忆。
 *
 * 服务端对账，不信模型：候选只有**这一轮记下的召回集合**（`kg_turn_recalls.items`，执行器召回时写下），
 * 模型在回答里提到的任何别的说法——没被召回的、别人的、已失效的——都不会变成 chip，因为它根本不在候选里。
 * 在候选里、但回答正文没有用到它（模型拿到了却没提）⇒ 也不出 chip：chip 说的是「依据」，不是「看过」。
 *
 * 「用到」的判据是确定的字面覆盖（不调模型、可复算）：把结论原文切成检索单元（汉字二元组 + 英文 / 数字词），
 * 回答里出现的单元占比 ≥ `CITATION_MIN_COVERAGE` 且至少 `CITATION_MIN_UNITS` 个 ⇒ 用到了。
 * 回答照抄、换个说法但关键词还在（「你 9/20 决定主库用 PostgreSQL」对「决定主库用 PostgreSQL」）都算；
 * 只沾一两个常见字的不算。结论太短、切不出两个单元 ⇒ 要求原文整句出现。
 *
 * 这是纯函数：读接口（chip）与纠正率指标（分母 = 被引用的次数）用的是同一个判据，两边算出来的一致。
 */

/** 结论的检索单元里，回答至少要覆盖这个比例才算「用到」。 */
export const CITATION_MIN_COVERAGE = 0.5;
/** 同时至少命中这么多个单元（防「一个常见二元组」凑够比例）。 */
export const CITATION_MIN_UNITS = 2;

/** 几乎每句话都有、不说明「用到了这一条」的二元组（主语 / 代词 / 虚词搭配）。 */
const WEAK_BIGRAMS = new Set([
  "用户", "我们", "我的", "你的", "他们", "她们", "这个", "那个", "一个", "已经", "可以", "需要", "的是", "是一",
]);

const HAN = /\p{Script=Han}/u;

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/** 结论 / 回答切成检索单元：连续汉字切成二元组（单字段落按单字），英文与数字按词。 */
export function citationUnits(text: string): Set<string> {
  const out = new Set<string>();
  const t = normalize(text);
  for (const w of t.match(/[a-z0-9]+(?:[.\-_][a-z0-9]+)*/g) ?? []) {
    if (w.length >= 2 || /\d/.test(w)) out.add(w);
  }
  let run = "";
  const flush = () => {
    const chars = Array.from(run);
    if (chars.length === 1) out.add(chars[0]!);
    for (let i = 0; i + 1 < chars.length; i += 1) out.add(chars[i]! + chars[i + 1]!);
    run = "";
  };
  for (const ch of t) {
    if (HAN.test(ch)) run += ch;
    else if (run !== "") flush();
  }
  if (run !== "") flush();
  return out;
}

/** 这一条结论在这段回答里是否被用到了（见文件头的判据）。 */
export function answerUsesStatement(answer: string, statement: string, answerUnits: Set<string> = citationUnits(answer)): boolean {
  const units = [...citationUnits(statement)].filter((u) => !WEAK_BIGRAMS.has(u));
  if (units.length < CITATION_MIN_UNITS) {
    const s = normalize(statement).replace(/\s+/g, "");
    return s.length > 0 && normalize(answer).replace(/\s+/g, "").includes(s);
  }
  const hit = units.filter((u) => answerUnits.has(u)).length;
  return hit >= CITATION_MIN_UNITS && hit / units.length >= CITATION_MIN_COVERAGE;
}

/**
 * 对账：召回集合（按召回名次）里被回答用到的那些的 id，保持召回名次。
 * 结果恒为 `recalled` 的子集——召回集合之外的东西不可能出现在这里。
 */
export function reconcileCitations(
  answer: string,
  recalled: readonly { readonly claimId: string; readonly statement: string }[],
): string[] {
  if (answer.trim() === "" || recalled.length === 0) return [];
  const answerUnits = citationUnits(answer);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of recalled) {
    if (seen.has(r.claimId)) continue;
    seen.add(r.claimId);
    if (answerUsesStatement(answer, r.statement, answerUnits)) out.push(r.claimId);
  }
  return out;
}

/**
 * 纠正率 = 纠正次数 / 被引用次数（同一口径的时间窗）。没有被引用过 ⇒ null（没有样本不给比例，
 * 同 `skills.getLoopMetrics.satisfactionDelta` 的纪律）。
 */
export function citationCorrectionRate(corrections: number, citedUses: number): number | null {
  if (citedUses <= 0) return null;
  return Math.round((corrections / citedUses) * 10_000) / 10_000;
}
