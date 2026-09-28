/**
 * S7（#4364）—— 回答下方的引用 chip：这条回答**真的用到了**本轮召回的哪几条记忆。
 *
 * 服务端对账，不信模型：候选只有**这一轮记下的召回集合**（`kg_turn_recalls.items`，执行器召回时写下），
 * 模型在回答里提到的任何别的说法——没被召回的、别人的、已失效的——都不会变成 chip，因为它根本不在候选里。
 * 在候选里、但回答正文没有用到它（模型拿到了却没提）⇒ 也不出 chip：chip 说的是「依据」，不是「看过」。
 *
 * 「用到」的判据是确定的字面覆盖（不调模型、可复算）：把结论原文切成检索单元（汉字二元组 + 英文 / 数字词），
 * 回答里出现的单元占比 ≥ `CITATION_MIN_COVERAGE` 且至少 `CITATION_MIN_UNITS` 个，数字齐全、否定没被说反 ⇒ 用到了；
 * 召回里有「兄弟」（大部分单元相同）时还要命中自己独有的单元（review F3，见 `reconcileCitations`）。
 * 回答照抄、换个说法但关键词还在（「你 9/20 决定主库用 PostgreSQL」对「决定主库用 PostgreSQL」）都算；
 * 只沾一两个常见字的不算。结论太短、切不出两个单元 ⇒ 要求原文整句出现。
 *
 * 这是纯函数：读接口（chip）与纠正率指标（分母 = 被引用的次数）用的是同一个判据，两边算出来的一致。
 */

/** 结论的检索单元里，回答至少要覆盖这个比例才算「用到」。 */
export const CITATION_MIN_COVERAGE = 0.5;
/** 同时至少命中这么多个单元（防「一个常见二元组」凑够比例）。 */
export const CITATION_MIN_UNITS = 2;
/**
 * 两条召回的结论共享的单元占较短那条的比例到这个值 ⇒ 视为「兄弟」（同一件事的不同说法：9/20 vs 10/1、张三 vs 李四、
 * 用 vs 不用）。兄弟之间，各自必须靠**自己独有**的单元被回答命中才算用到（review F3）。
 */
export const CITATION_SIBLING_OVERLAP = 0.5;

/** 几乎每句话都有、不说明「用到了这一条」的二元组（主语 / 代词 / 虚词搭配）。 */
const WEAK_BIGRAMS = new Set([
  "用户", "我们", "我的", "你的", "他们", "她们", "这个", "那个", "一个", "已经", "可以", "需要", "的是", "是一",
]);

/** 否定字：带它的二元组说的是「不…」，不能被不带它的回答顶替，反之亦然。 */
const NEGATION = new Set(["不", "没", "未", "无", "非", "别", "勿"]);

const HAN = /\p{Script=Han}/u;
const DIGIT = /\d/;

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

function hanRuns(t: string): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  for (const ch of t) {
    if (HAN.test(ch)) run.push(ch);
    else if (run.length > 0) { runs.push(run); run = []; }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * 结论 / 回答切成检索单元：连续汉字切成二元组，英文与数字按词（数字一律保留，哪怕只有一位）。
 * **单个汉字不算单元**（review F3：「月」「日」「万」这类单字几乎句句都有，只会把不同的两句凑成「用到了」）。
 */
export function citationUnits(text: string): Set<string> {
  const out = new Set<string>();
  const t = normalize(text);
  for (const w of t.match(/[a-z0-9]+(?:[.\-_][a-z0-9]+)*/g) ?? []) {
    if (w.length >= 2 || DIGIT.test(w)) out.add(w);
  }
  for (const chars of hanRuns(t)) {
    for (let i = 0; i + 1 < chars.length; i += 1) out.add(chars[i]! + chars[i + 1]!);
  }
  return out;
}

const contentUnits = (statement: string): string[] => [...citationUnits(statement)].filter((u) => !WEAK_BIGRAMS.has(u));
const isNegationUnit = (u: string): boolean => Array.from(u).some((c) => NEGATION.has(c));

/**
 * 回答把这条结论的意思反过来了：结论里相邻的两个字 ab，回答里是「a 否定字 b」而没有 ab（「决定用」→「决定不用」）。
 */
function negatedInAnswer(statement: string, answerText: string): boolean {
  for (const chars of hanRuns(normalize(statement))) {
    for (let i = 0; i + 1 < chars.length; i += 1) {
      const [a, b] = [chars[i]!, chars[i + 1]!];
      if (NEGATION.has(a) || NEGATION.has(b)) continue;
      if (answerText.includes(a + b)) continue;
      for (const n of NEGATION) if (answerText.includes(a + n + b)) return true;
    }
  }
  return false;
}

/**
 * 这一条结论在这段回答里是否被用到了（不看兄弟，见 `reconcileCitations`）：
 * - 覆盖：单元命中 ≥ `CITATION_MIN_UNITS` 且占比 ≥ `CITATION_MIN_COVERAGE`；切不出两个单元 ⇒ 要求原句整句出现；
 * - 数字：结论里的每个数都要在回答里（「50万」不能由「80万」顶替）；
 * - 否定：结论带否定（「不用」）⇒ 回答里要有这个否定；结论不带 ⇒ 回答不能把它说反（「决定不用」）。
 */
export function answerUsesStatement(answer: string, statement: string, answerUnits: Set<string> = citationUnits(answer)): boolean {
  const units = contentUnits(statement);
  const answerText = normalize(answer).replace(/\s+/g, "");
  if (units.length < CITATION_MIN_UNITS) {
    const s = normalize(statement).replace(/\s+/g, "");
    return s.length > 0 && answerText.includes(s);
  }
  const hit = units.filter((u) => answerUnits.has(u)).length;
  if (hit < CITATION_MIN_UNITS || hit / units.length < CITATION_MIN_COVERAGE) return false;
  if (units.some((u) => DIGIT.test(u) && !answerUnits.has(u))) return false;
  const neg = units.filter(isNegationUnit);
  if (neg.length > 0 && !neg.some((u) => answerUnits.has(u))) return false;
  if (neg.length === 0 && negatedInAnswer(statement, answerText)) return false;
  return true;
}

/**
 * 对账：召回集合（按召回名次）里被回答用到的那些的 id，保持召回名次。
 * 结果恒为 `recalled` 的子集——召回集合之外的东西不可能出现在这里。
 *
 * 兄弟（review F3）：召回里两条共享大部分单元（`CITATION_SIBLING_OVERLAP`）时，光凭共享的那部分分不出回答用的是哪条——
 * 「发布日期是9月20日」与「发布日期是10月1日」、「负责人是张三」与「负责人是李四」、「决定用MySQL」与「决定不用MySQL」。
 * 这时每一条还得有**只属于它自己**的单元（数字、名字、否定……）出现在回答里；自己没有独有单元（被兄弟完全包含）⇒ 要求整句出现。
 */
export function reconcileCitations(
  answer: string,
  recalled: readonly { readonly claimId: string; readonly statement: string }[],
): string[] {
  if (answer.trim() === "" || recalled.length === 0) return [];
  const answerUnits = citationUnits(answer);
  const answerText = normalize(answer).replace(/\s+/g, "");
  const unique = recalled.filter((r, i) => recalled.findIndex((x) => x.claimId === r.claimId) === i);
  const unitsOf = new Map(unique.map((r) => [r.claimId, new Set(contentUnits(r.statement))]));
  const out: string[] = [];
  for (const r of unique) {
    if (!answerUsesStatement(answer, r.statement, answerUnits)) continue;
    const mine = unitsOf.get(r.claimId)!;
    const siblings = unique.filter((o) => {
      if (o.claimId === r.claimId) return false;
      const theirs = unitsOf.get(o.claimId)!;
      const shared = [...mine].filter((u) => theirs.has(u)).length;
      const smaller = Math.min(mine.size, theirs.size);
      return smaller > 0 && shared / smaller >= CITATION_SIBLING_OVERLAP;
    });
    if (siblings.length > 0) {
      const others = new Set(siblings.flatMap((o) => [...unitsOf.get(o.claimId)!]));
      const own = [...mine].filter((u) => !others.has(u));
      const ok = own.length > 0
        ? own.some((u) => answerUnits.has(u))
        : answerText.includes(normalize(r.statement).replace(/\s+/g, ""));
      if (!ok) continue;
    }
    out.push(r.claimId);
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
