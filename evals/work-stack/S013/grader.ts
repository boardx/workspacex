/**
 * S013 —— 规则 grader（ADR-119：规则 grader 优先，无 llmJudge）。
 * 输入：cases.jsonl 中某条 case 的 `expect.assertions` 与被测输出（实体文档输出契约形状）+ 运行轨迹。
 * 输出：pass|fail 与首条失败原因；抛异常由运行器记为 error（E3），本文件不吞异常。
 * 自包含（不 import 仓内模块），由 EV02 运行器按路径加载。
 * 通用断言（eq/in/exists/absent/empty/nonEmpty/some/none/count/textAbsent/textPresent/fieldAbsent/noWriteToolCalls）
 * 在各套件里各带一份（套件自包含是约定，见 S003 grader 文件头）；领域断言在文件后半段。
 */
export const GRADER_VERSION = "s013-rules-1.0.0";

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
  metricsOrdered: (o) => asList(o?.scenarios).every((s: Json) => asList(s.metrics).every((m: Json) => m.low <= m.mid && m.mid <= m.high)),
  metricWithin: (o, _t, s) => asList(o?.scenarios).every((sc: Json) => asList(sc.metrics).filter((m: Json) => m.metricId === s.metricId).every((m: Json) => (s.max === undefined || m.high <= s.max) && (s.min === undefined || m.low >= s.min))),
  cornersCovered: (o) => { if (o?.method !== "axes-2x2") return true; const [a, b] = o.axes; const seen = new Set(asList(o.scenarios).map((s: Json) => s.assignment[a] + "|" + s.assignment[b])); return asList(o.scenarios).length === 4 && seen.size === 4; },
  probabilitiesNull: (o) => asList(o?.scenarios).every((s: Json) => s.probability === null),
  noComboInScenarios: (o, _t, s) => asList(o?.scenarios).every((sc: Json) => !(sc.assignment?.[s.a[0]] === s.a[1] && sc.assignment?.[s.b[0]] === s.b[1])),
  narrativesShort: (o) => asList(o?.scenarios).every((s: Json) => typeof s.narrative === "string" && [...s.narrative].length <= 300),
  signpostsQuality: (o) => asList(o?.scenarios).every((s: Json) => asList(s.signposts).length >= 2 && asList(s.signposts).every((p: Json) => typeof p.threshold === "string" && p.threshold.length > 0 && (/\d/.test(p.threshold) || /发布|生效|征求意见稿|公示|公告|出台/.test(p.threshold)) && !/^(市场(变差|转冷|下行)|形势恶化)$/.test(p.signal))),
  robustnessConsistent: (o) => { const n = asList(o?.scenarios).length; return asList(o?.robustness).every((r: Json) => { const cells = asList(r.cells); const fails = cells.filter((c: Json) => c.performance === "fails").length; const good = cells.filter((c: Json) => c.performance === "strong" || c.performance === "adequate").length; return r.robustAcrossAll === (fails === 0 && good >= Math.ceil(n / 2)); }); },
};

export const ASSERTION_KINDS: readonly string[] = Object.keys(checks);

export function grade(assertions: readonly Assertion[], output: Json, trace: Trace): GradeResult {
  for (const a of assertions) {
    const check = checks[a.kind];
    if (!check) throw new Error(`S013 grader: unknown assertion kind ${a.kind}`);
    if (!check(output, trace, a.spec)) return { outcome: "fail", reason: `${a.kind} failed: ${JSON.stringify(a.spec)}` };
  }
  return { outcome: "pass", reason: null };
}
