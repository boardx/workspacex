/**
 * Phase 18 F16 —— 矛盾判定（uc-18-6 D / uc-18-1 A3，契约 `KgConflictPrompt`）。
 *
 * 纯函数：只回答「这条新说法和那条你确认过的，是不是同一件事说了不同的数」。
 * 候选怎么取（本会话 / 本人个人空间、只看人确认过的）在数据库函数 `kg_conflict_candidates` 里，
 * 落不落表（两条转 contested、开提醒）由 `kg_open_conflicts` 复核后执行。
 *
 * ## 判定规则（R3 D1「同一对实体 … 同一指标、不同数值」的保守实现）
 *
 * 一对（新结论 N，已确认结论 O）算冲突，当且仅当**全部**成立：
 *   1. 类型相同，且是 fact / decision（待办、风险、假设本来就允许并存）；
 *   2. 说的是同一组人和事：两边 `about` 实体名（归一后）集合相同且非空；
 *   3. 同一个指标：去掉实体名与数值后，两句至少共享一个词（中文按相邻两字、拉丁按整词）；
 *   4. 不同的数值：两句都带数值，且**各自**都有对方没有的数值（「9/29 上线」对「改到 10/1」）——
 *      只是多补了一个数（「9/29 上线，预计 3 天」）不算改口。
 * 宁可漏，不可误（R4 A1 同一原则）：任何一条拿不准就不算冲突。
 *
 * 为什么不交给模型判：抽取模型一次只看这一条消息和前几句上文，看不到你几天前确认过什么；
 * 这一步要确定、可复现、可测——同样的两句话永远得到同样的结论。
 */
import { normalizeName } from "./extraction";

export type ConflictClaimKind = "fact" | "hypothesis" | "decision" | "todo" | "risk";

/** 刚从这条消息抽出来、还没人看过的结论。 */
export interface FreshClaim {
  readonly id: string;
  readonly kind: ConflictClaimKind;
  readonly statement: string;
  readonly confidence: number;
  /** 它涉及的实体名（原样，判定时归一）。 */
  readonly about: readonly string[];
}

/** 人确认过的结论（本会话，或本人个人空间）。 */
export interface ConfirmedClaim {
  readonly id: string;
  readonly kind: ConflictClaimKind;
  readonly statement: string;
  readonly about: readonly string[];
  readonly scope: "chat_session" | "personal";
  /** 确认 / 最近一次变动的时间（ISO）；越近的越重要。 */
  readonly confirmedAt: string;
}

export interface ConflictPair {
  readonly newerClaimId: string;
  readonly olderClaimId: string;
}

const COMPARABLE_KINDS: ReadonlySet<ConflictClaimKind> = new Set(["fact", "decision"]);

/** 数值：阿拉伯数字串，可带 / . : - 分隔（日期、版本、时间、小数）。先 NFKC，全角数字也认。 */
const NUMBER_RE = /\d+(?:[./:-]\d+)*/g;

/** 归一（NFKC、小写）并去掉实体名：「v2」里的 2 不是数值，「项目 A」里的 A 不是指标词。长名字先去。 */
function withoutNames(statement: string, entityNames: readonly string[]): string {
  let text = statement.normalize("NFKC").toLowerCase();
  for (const n of [...entityNames].map(normalizeName).filter((n) => n.length > 0).sort((a, b) => b.length - a.length)) {
    text = text.split(n).join(" ");
  }
  return text;
}

/**
 * 数值归一：每段去掉前导零，「10/01」=「10/1」、「09.29」=「9.29」、「09:05」=「9:5」。
 * 例外：小数点后的那段不动——「1.05」和「1.5」是两个数。用点写的日期（「09.29」）只去整数部分的零，
 * 「09.29」=「9.29」；小数点后的尾零不去（「9.29」对「9.290」仍算两个数：按日期读它们不等，这种写法也少见）。
 */
export function normalizeNumber(token: string): string {
  // 按分隔符切开（保留分隔符）：[段, 分隔符, 段, …]
  const parts = token.split(/([/.:-])/);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;               // 分隔符原样
    if (i > 0 && parts[i - 1] === ".") return part;  // 小数部分不去零
    return part.replace(/^0+(?=\d)/, "");
  }).join("");
}

export function numberTokens(statement: string, entityNames: readonly string[] = []): Set<string> {
  return new Set((withoutNames(statement, entityNames).match(NUMBER_RE) ?? []).map(normalizeNumber));
}

/**
 * 「指标」词：去掉实体名与数值之后剩下的词。中文连续段取相邻两字（单字太泛：「到」「是」），
 * 拉丁连续段取整词（≥ 2 个字母）。
 */
export function topicTerms(statement: string, entityNames: readonly string[]): Set<string> {
  const text = withoutNames(statement, entityNames).replace(NUMBER_RE, " ");
  const terms = new Set<string>();
  for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
    for (let i = 0; i + 1 < run.length; i += 1) terms.add(run.slice(i, i + 2));
  }
  for (const word of text.match(/[a-z]{2,}/g) ?? []) terms.add(word);
  return terms;
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));
const aboutKey = (names: readonly string[]) => new Set(names.map(normalizeName).filter((n) => n.length > 0));

/** 单对判定（见文件头四条）。 */
export function isConflict(fresh: FreshClaim, confirmed: ConfirmedClaim): boolean {
  if (fresh.kind !== confirmed.kind || !COMPARABLE_KINDS.has(fresh.kind)) return false;
  const a = aboutKey(fresh.about);
  const b = aboutKey(confirmed.about);
  if (a.size === 0 || !sameSet(a, b)) return false;
  const names = [...fresh.about, ...confirmed.about];
  const ta = topicTerms(fresh.statement, names);
  const tb = topicTerms(confirmed.statement, names);
  if (![...ta].some((t) => tb.has(t))) return false;
  const na = numberTokens(fresh.statement, names);
  const nb = numberTokens(confirmed.statement, names);
  if (na.size === 0 || nb.size === 0) return false;
  return [...na].some((x) => !nb.has(x)) && [...nb].some((x) => !na.has(x));
}

/**
 * 这一批新结论里的全部冲突对，按重要性排好：本会话里确认的先于个人空间的（就在眼前的更要紧），
 * 同层里确认得越近越先，再按新结论的把握度。第一对就是这一轮那张主动卡（R4 E3：只出一张，其余进面板）。
 */
export function findConflicts(fresh: readonly FreshClaim[], confirmed: readonly ConfirmedClaim[]): ConflictPair[] {
  const hits: { pair: ConflictPair; scope: number; at: number; conf: number }[] = [];
  for (const f of fresh) {
    for (const c of confirmed) {
      if (f.id === c.id || !isConflict(f, c)) continue;
      hits.push({
        pair: { newerClaimId: f.id, olderClaimId: c.id },
        scope: c.scope === "chat_session" ? 0 : 1,
        at: Date.parse(c.confirmedAt) || 0,
        conf: f.confidence,
      });
    }
  }
  hits.sort((x, y) => x.scope - y.scope || y.at - x.at || y.conf - x.conf
    || x.pair.newerClaimId.localeCompare(y.pair.newerClaimId) || x.pair.olderClaimId.localeCompare(y.pair.olderClaimId));
  return hits.map((h) => h.pair);
}
