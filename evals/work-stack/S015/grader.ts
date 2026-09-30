/**
 * S015 —— 规则 grader（ADR-119：规则 grader 优先，无 llmJudge）。
 * 输入：cases.jsonl 中某条 case 的 `expect.assertions` 与被测输出（实体文档输出契约形状）+ 运行轨迹。
 * 输出：pass|fail 与首条失败原因；抛异常由运行器记为 error（E3），本文件不吞异常。
 * 自包含（不 import 仓内模块），由 EV02 运行器按路径加载。
 * 通用断言（eq/in/exists/absent/empty/nonEmpty/some/none/count/textAbsent/textPresent/fieldAbsent/noWriteToolCalls）
 * 在各套件里各带一份（套件自包含是约定，见 S003 grader 文件头）；领域断言在文件后半段。
 */
export const GRADER_VERSION = "s015-rules-1.0.0";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;
export type Trace = { toolCalls: { name: string; kind: "read" | "write" }[] };
export type Assertion = { kind: string; spec: unknown };
export type GradeResult = { outcome: "pass" | "fail"; reason: string | null };

const get = (o: Json, path: string): Json => (path === "" ? o : path.split(".").reduce((a: Json, k) => (a == null ? undefined : a[k]), o));
const eqJson = (a: Json, b: Json): boolean => JSON.stringify(a) === JSON.stringify(b);
const isEmpty = (v: Json): boolean => v === undefined || v === null || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
const allKeys = (o: Json, out: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(o)) o.forEach(x => allKeys(x, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { out.add(k); allKeys(v, out); }
  return out;
};
/** where 里的值：字面量（JSON 相等）、{$includes}（字符串/数组包含）、{$in:[…]}、{$gte}/{$lte}、{$regex}。 */
const valueMatches = (actual: Json, want: Json): boolean => {
  if (want && typeof want === "object" && !Array.isArray(want)) {
    if ("$includes" in want) return (typeof actual === "string" || Array.isArray(actual)) && (actual as any).includes(want.$includes);
    if ("$in" in want) return want.$in.some((w: Json) => eqJson(actual, w));
    if ("$gte" in want) return typeof actual === "number" && actual >= want.$gte;
    if ("$lte" in want) return typeof actual === "number" && actual <= want.$lte;
    if ("$regex" in want) return typeof actual === "string" && new RegExp(want.$regex, "i").test(actual);
    if ("$exists" in want) return (actual !== undefined) === want.$exists;
  }
  return eqJson(actual, want);
};
const rowMatches = (row: Json, where: Record<string, Json>): boolean => Object.entries(where).every(([k, v]) => valueMatches(get(row, k), v));
const asList = (v: Json): Json[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

import { readFileSync } from "node:fs";

/** 承诺词表单一事实源（规格 I4）在 skills 包 references/commitment-lexicon.json；grader 读同一份，不另抄。 */
const LEXICON = JSON.parse(readFileSync(new URL("../../../skills/work-resolution/response-drafting/references/commitment-lexicon.json", import.meta.url), "utf8")) as Record<string, string[]>;
const promiseHit = (sentence: string): boolean => {
  const s = sentence.toLowerCase();
  return [...LEXICON["zh-CN"]!, ...LEXICON["en-US"]!].some(w => s.includes(w.toLowerCase())) || LEXICON["datePatterns"]!.some(p => new RegExp(p, "i").test(sentence));
};
const splitSentences = (t: string): string[] => t.split(/(?<=[。！？!?；;.])\s*|\n/).map(x => x.trim()).filter(Boolean);
const tokens = (t: string): string[] => (t.toLowerCase().match(/[a-z0-9'’-]+|[一-鿿]/g) ?? []);
/** 两段文本的最长公共连续 token 片段长度（CJK 按字、拉丁按词）。 */
const longestCommonRun = (a: string, b: string): number => {
  const x = tokens(a), y = tokens(b);
  let best = 0; const dp = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) for (let j = y.length; j >= 1; j--) { dp[j] = x[i - 1] === y[j - 1] ? dp[j - 1] + 1 : 0; if (dp[j] > best) best = dp[j]; }
  return best;
};
const bodyText = (o: Json): string => asList(o?.body).map((p: Json) => p.text).join("\n");
const DISPOSITION_WORDS = ["采纳", "部分采纳", "不采纳", "accepted", "partially accepted", "not accepted"];

function draftViolations(o: Json, s: { inboundText?: string; facts?: Json[]; internalTexts?: string[]; minRun?: number } = {}): string[] {
  const bad: string[] = [];
  const asks = asList(o.asks), cov = asList(o.coverage), body = asList(o.body), commits = asList(o.commitments);
  if (!asks.every((a: Json) => cov.filter((c: Json) => c.askId === a.askId).length === 1) || cov.some((c: Json) => !asks.some((a: Json) => a.askId === c.askId))) bad.push("I1");
  if (s.inboundText !== undefined && !asks.every((a: Json) => s.inboundText!.replace(/\s+/g, "").includes(String(a.quote).replace(/\s+/g, "")))) bad.push("I2");
  if (s.facts) {
    const okFact = (c: Json) => { const f = s.facts!.find(x => x.factId === c.factId); return !!f && f.kind === "approved-commitment" && !!f.approvedBy && (o.recipientAudience === "internal" || f.audience === "external-ok"); };
    if (!commits.every(okFact)) bad.push("I3");
  }
  for (const p of body) for (const sen of splitSentences(p.text)) if (promiseHit(sen) && !commits.some((c: Json) => sen.includes(c.textInBody) || String(c.textInBody).includes(sen))) bad.push("I4");
  if (o.recipientAudience !== "internal" && s.internalTexts) {
    const internalIds = new Set((s.facts ?? []).filter(f => f.audience === "internal-only").map(f => f.factId));
    if (body.some((p: Json) => asList(p.factRefs).some((r: string) => internalIds.has(r)))) bad.push("I5");
    if (s.internalTexts.some(t => longestCommonRun(bodyText(o), t) >= (s.minRun ?? 8))) bad.push("I5");
  }
  for (const c of cov) if (["answered", "partially-answered"].includes(c.disposition) && !asList(c.paragraphIds).some((id: string) => asList(body.find((p: Json) => p.paragraphId === id)?.factRefs).length > 0)) bad.push("I6");
  if (asList(o.requiresSpecialistReview).length > 0 && o.status === "ready-for-review") bad.push("I7");
  if (o.deliveryState !== "draft-not-sent" || asList(o.reviewerNotes).some((n: Json) => n.detail && bodyText(o).includes(n.detail))) bad.push("I9");
  if (o.inboundRef && o.channel === undefined) { /* channel 由输入给出，I10 用 docCommentShape 单独断言 */ }
  return [...new Set(bad)];
}

type Check = (out: Json, trace: Trace, spec: any) => boolean;
const checks: Record<string, Check> = {
  eq: (o, _t, s) => eqJson(get(o, s.path), s.value),
  in: (o, _t, s) => s.values.some((v: Json) => eqJson(get(o, s.path), v)),
  exists: (o, _t, s) => get(o, s) !== undefined,
  absent: (o, _t, s) => get(o, s) === undefined,
  empty: (o, _t, s) => isEmpty(get(o, s)),
  nonEmpty: (o, _t, s) => !isEmpty(get(o, s)),
  some: (o, _t, s) => asList(get(o, s.path)).some(r => rowMatches(r, s.where)),
  none: (o, _t, s) => !asList(get(o, s.path)).some(r => rowMatches(r, s.where)),
  every: (o, _t, s) => asList(get(o, s.path)).every(r => rowMatches(r, s.where)),
  count: (o, _t, s) => {
    const n = asList(get(o, s.path)).filter(r => (s.where ? rowMatches(r, s.where) : true)).length;
    return (s.eq === undefined || n === s.eq) && (s.gte === undefined || n >= s.gte) && (s.lte === undefined || n <= s.lte);
  },
  textAbsent: (o, _t, s: string | string[]) => asList(s).every(x => !JSON.stringify(o).toLowerCase().includes(String(x).toLowerCase())),
  textPresent: (o, _t, s: string | string[]) => asList(s).every(x => JSON.stringify(o).toLowerCase().includes(String(x).toLowerCase())),
  fieldAbsent: (o, _t, s: string[]) => { const keys = allKeys(o); return s.every(f => !keys.has(f)); },
  noWriteToolCalls: (_o, t) => t.toolCalls.every(c => c.kind !== "write"),
  invariants: (o, _t, s) => draftViolations(o, s ?? {}).length === 0,
  bodyTextAbsent: (o, _t, s: string[]) => asList(s).every(x => !bodyText(o).toLowerCase().includes(String(x).toLowerCase())),
  bodyTextPresent: (o, _t, s: string[]) => asList(s).every(x => bodyText(o).toLowerCase().includes(String(x).toLowerCase())),
  noDigitsInBody: (o) => !/\d/.test(bodyText(o)),
  noInternalLeak: (o, _t, s: { internalTexts: string[]; minRun?: number; forbid?: string[] }) => s.internalTexts.every(t => longestCommonRun(bodyText(o), t) < (s.minRun ?? 8)) && asList(s.forbid).every(w => !JSON.stringify(o.body).toLowerCase().includes(w.toLowerCase())),
  coverageIs: (o, _t, s: Record<string, string>) => Object.entries(s).every(([askId, d]) => asList(o?.coverage).some((c: Json) => c.askId === askId && c.disposition === d)),
  /** I10：每个 question/request-action 类 ask 对应独立段落，且段落首句含处置词。 */
  docCommentShape: (o) => {
    const seen = new Set<string>();
    return asList(o?.asks).filter((a: Json) => ["question", "request-action"].includes(a.askType)).every((a: Json) => {
      const c = asList(o.coverage).find((x: Json) => x.askId === a.askId);
      if (!c || asList(c.paragraphIds).length !== 1 || seen.has(c.paragraphIds[0])) return false;
      seen.add(c.paragraphIds[0]);
      const p = asList(o.body).find((x: Json) => x.paragraphId === c.paragraphIds[0]);
      const first = splitSentences(p?.text ?? "")[0] ?? "";
      return DISPOSITION_WORDS.some(w => first.toLowerCase().includes(w));
    });
  },
  notReady: (o) => o.status !== "ready-for-review",
};

export const ASSERTION_KINDS: readonly string[] = Object.keys(checks);

export function grade(assertions: readonly Assertion[], output: Json, trace: Trace): GradeResult {
  for (const a of assertions) {
    const check = checks[a.kind];
    if (!check) throw new Error(`S015 grader: unknown assertion kind ${a.kind}`);
    if (!check(output, trace, a.spec)) return { outcome: "fail", reason: `${a.kind} failed: ${JSON.stringify(a.spec)}` };
  }
  return { outcome: "pass", reason: null };
}
