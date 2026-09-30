/**
 * S011 —— 规则 grader（ADR-119：规则 grader 优先，无 llmJudge）。
 * 输入：cases.jsonl 中某条 case 的 `expect.assertions` 与被测输出（实体文档输出契约形状）+ 运行轨迹。
 * 输出：pass|fail 与首条失败原因；抛异常由运行器记为 error（E3），本文件不吞异常。
 * 自包含（不 import 仓内模块），由 EV02 运行器按路径加载。
 * 通用断言（eq/in/exists/absent/empty/nonEmpty/some/none/count/textAbsent/textPresent/fieldAbsent/noWriteToolCalls）
 * 在各套件里各带一份（套件自包含是约定，见 S003 grader 文件头）；领域断言在文件后半段。
 */
export const GRADER_VERSION = "s011-rules-1.0.0";

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

/** 词表单一事实源在 skills 包的 references/ 下（规格 §14）；grader 读取同一份文件，不另抄一份。 */
const LEXICON_DIR = new URL("../../../skills/work-resolution/root-cause-analysis/references/", import.meta.url);
const loadLexicon = (file: string): string[] =>
  readFileSync(new URL(file, LEXICON_DIR), "utf8").split("\n").filter(l => l.startsWith("- ")).map(l => l.slice(2).trim().toLowerCase()).filter(Boolean);
const BLAMELESS = loadLexicon("blameless-lexicon.md");
const VAGUE = loadLexicon("vague-action-lexicon.md");
const hitsLexicon = (text: string, lex: string[]): boolean => lex.some(w => String(text).toLowerCase().includes(w));
const textHasAny = (text: string, words: string[]): boolean => words.some(w => String(text).toLowerCase().includes(String(w).toLowerCase()));

type N = { nodeId: string; kind: string; text: string; hypothesisId?: string; outsideControl?: boolean };
type E = { edgeId: string; from: string; to: string; relation: string; testedBy?: string; evidenceIds: string[] };

/** 规格 §4 步骤 6 的布尔语义：源点发生；非源点 ⇔ 每条 enables 入边起点发生 且（无 causes 入边 或 至少一条 causes 入边起点发生）；outsideControl 恒发生；forcedOff 强制不发生。 */
function evalProblem(nodes: N[], edges: E[], forcedOff?: string): boolean {
  const byId = new Map(nodes.map(n => [n.nodeId, n]));
  const memo = new Map<string, boolean>();
  const ev = (id: string, seen: Set<string>): boolean => {
    if (id === forcedOff) return false;
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return false; // 有环：由 graphValid 判红，这里不递归
    seen.add(id);
    const n = byId.get(id);
    let r: boolean;
    if (!n) r = false;
    else if (n.outsideControl === true) r = true;
    else {
      const inc = edges.filter(e => e.to === id);
      const en = inc.filter(e => e.relation === "enables");
      const ca = inc.filter(e => e.relation === "causes");
      r = en.every(e => ev(e.from, seen)) && (ca.length === 0 || ca.some(e => ev(e.from, seen)));
    }
    seen.delete(id);
    memo.set(id, r);
    return r;
  };
  const problem = nodes.find(n => n.kind === "problem");
  return problem ? ev(problem.nodeId, new Set()) : false;
}

function acyclic(nodes: N[], edges: E[]): boolean {
  const indeg = new Map(nodes.map(n => [n.nodeId, 0]));
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const q = [...indeg.entries()].filter(([, d]) => d === 0).map(([k]) => k);
  let seen = 0;
  while (q.length) { const k = q.pop()!; seen++; for (const e of edges.filter(x => x.from === k)) { indeg.set(e.to, indeg.get(e.to)! - 1); if (indeg.get(e.to) === 0) q.push(e.to); } }
  return seen === nodes.length;
}

function reaches(edges: E[], from: string, to: string): boolean {
  const st = [from]; const seen = new Set<string>();
  while (st.length) { const k = st.pop()!; if (k === to) return true; if (seen.has(k)) continue; seen.add(k); for (const e of edges) if (e.from === k) st.push(e.to); }
  return false;
}

/** O1 + O2 */
function graphValidity(o: Json): boolean {
  const { nodes, edges } = o.causalGraph as { nodes: N[]; edges: E[] };
  const problems = nodes.filter(n => n.kind === "problem");
  if (problems.length !== 1 || edges.some(e => e.from === problems[0]!.nodeId)) return false;
  const ids = new Set(nodes.map(n => n.nodeId));
  if (edges.some(e => !ids.has(e.from) || !ids.has(e.to))) return false;
  if (!acyclic(nodes, edges)) return false;
  return nodes.every(n => n.kind === "problem" || reaches(edges, n.nodeId, problems[0]!.nodeId));
}

/** C：满足 (a)(b)(c) 且 kind ∈ {control-gap, systemic-cause} 的节点。 */
function candidateSet(o: Json, personNames: string[] = []): N[] {
  const { nodes, edges } = o.causalGraph as { nodes: N[]; edges: E[] };
  return nodes.filter(n => ["control-gap", "systemic-cause"].includes(n.kind) && n.outsideControl !== true
    && !evalProblem(nodes, edges, n.nodeId) && !hitsLexicon(n.text, BLAMELESS) && !textHasAny(n.text, personNames.filter(Boolean)));
}

/** (d)：N 后代子图里的全部边逐边 testedBy 指向 supported 假设、证据非空且不全是 recollection 事件 / quote-mismatch 证据；N 自身假设 supported。 */
function verified(o: Json, n: N): boolean {
  const { edges } = o.causalGraph as { nodes: N[]; edges: E[] };
  const hyp = new Map((o.hypotheses as Json[]).map(h => [h.hypothesisId, h]));
  const recollect = new Set((o.timeline as Json[]).filter(t => t.basis === "recollection").map(t => t.eventId));
  const mismatch = new Set((o.evidenceWarnings as Json[]).filter(w => w.code === "quote-mismatch").map(w => w.evidenceId));
  const own = n.hypothesisId ? hyp.get(n.hypothesisId) : undefined;
  if (!own || own.status !== "supported") return false;
  const pathEdges = edges.filter(e => e.from === n.nodeId || reaches(edges, n.nodeId, e.from));
  return pathEdges.every(e => !!e.testedBy && hyp.get(e.testedBy)?.status === "supported" && e.evidenceIds.length > 0 && !e.evidenceIds.every(id => recollect.has(id) || mismatch.has(id)));
}

/** §7.2 判定表 + 封顶；返回 { status, caps }。 */
function recomputeStatus(o: Json, flags: { jurisdiction?: string; regimeFlags?: { casualtyOrStatutoryGrade?: boolean; medicalDeviceCapa?: boolean } } = {}): { status: string; caps: string[] } {
  const C = candidateSet(o);
  const F = C.filter(n => verified(o, n));
  const hyps = o.hypotheses as Json[];
  const graphHyps = new Set((o.causalGraph.nodes as N[]).map(n => n.hypothesisId).filter(Boolean));
  const cAnchors = new Set(C.flatMap(n => (hyps.find(h => h.hypothesisId === n.hypothesisId)?.anchoredTo ?? []) as string[]));
  const relevant = hyps.filter(h => graphHyps.has(h.hypothesisId) || (h.anchoredTo as string[]).some(a => cAnchors.has(a)));
  const types = new Map((o.rootCauses as Json[]).map(r => [r.nodeId, r.type]));
  const cTypes = new Set(C.map(n => types.get(n.nodeId)));
  let base: string;
  if (C.length === 0) base = "inconclusive";
  else if (F.length !== C.length) base = "provisional";
  else if (relevant.some(h => ["untested", "testing", "inconclusive"].includes(h.status))) base = "provisional";
  else if (["incident", "process-deviation"].includes(o.profile) && !(cTypes.has("occurrence") && cTypes.has("escape"))) base = "provisional";
  else base = "confirmed";
  const caps: string[] = [];
  if (flags.jurisdiction === "CN" && flags.regimeFlags?.casualtyOrStatutoryGrade) caps.push("cn-casualty");
  if (flags.regimeFlags?.medicalDeviceCapa && (o.correctiveActionCandidates as Json[]).some(c => C.some(n => n.nodeId === c.forRootCause) && c.verificationSignal === null)) caps.push("medical-device-no-signal");
  const status = base === "confirmed" && caps.length > 0 ? "provisional" : base;
  return { status, caps };
}

/** O1–O15 逐项检查，返回违反的不变量编号。 */
function invariantViolations(o: Json, flags: Json = {}): string[] {
  const bad: string[] = [];
  const { nodes, edges } = o.causalGraph as { nodes: N[]; edges: E[] };
  if (!graphValidity(o)) bad.push("O1/O2");
  const hyp = new Map((o.hypotheses as Json[]).map(h => [h.hypothesisId, h]));
  if (edges.some(e => e.testedBy && hyp.get(e.testedBy)?.status === "refuted")) bad.push("O3a");
  const C = candidateSet(o);
  if (o.status === "confirmed" && !C.every(n => verified(o, n))) bad.push("O3b");
  const byId = new Map(nodes.map(n => [n.nodeId, n]));
  const rootIds = (o.rootCauses as Json[]).map(r => r.nodeId);
  if (rootIds.some(id => !["control-gap", "systemic-cause"].includes(byId.get(id)?.kind ?? ""))) bad.push("O4");
  if (rootIds.some(id => hitsLexicon(byId.get(id)?.text ?? "", BLAMELESS))) bad.push("O5");
  for (const c of o.correctiveActionCandidates as Json[]) for (const eid of c.cutsEdgeIds as string[]) {
    const e = edges.find(x => x.edgeId === eid); const root = c.forRootCause as string;
    if (!e || !(e.from === root || reaches(edges, root, e.from))) bad.push("O6");
  }
  if ((o.rootCauses as Json[]).some(r => r.type === "escape" && !r.missedDetectionPoint)) bad.push("O7");
  const ts = (o.timeline as Json[]).map(t => t.atUtc);
  if (ts.some((t, i) => i > 0 && ts[i - 1] > t)) bad.push("O8a");
  const recollect = new Set((o.timeline as Json[]).filter(t => t.basis === "recollection").map(t => t.eventId));
  if (edges.some(e => e.evidenceIds.length > 0 && e.evidenceIds.every(id => recollect.has(id)))) bad.push("O8b");
  if ((o.hypotheses as Json[]).some(h => h.test?.method === "reproduction" && h.test.performedBy !== "human")) bad.push("O9");
  if (o.effectiveAudience !== "analysis-team" && o.personIndex !== undefined) bad.push("O10a");
  if (["direct-call-member", "unresolved"].includes(o.audienceSource) && o.effectiveAudience === "analysis-team") bad.push("O10b");
  const re = recomputeStatus(o, flags);
  if (re.status !== o.status || JSON.stringify([...re.caps].sort()) !== JSON.stringify([...(o.statusCaps ?? [])].sort())) bad.push("O11");
  const cIds = C.map(n => n.nodeId).sort();
  if (JSON.stringify(cIds) !== JSON.stringify([...rootIds].sort()) || (o.contributingFactors as string[]).some(id => cIds.includes(id))) bad.push("O12");
  if (!evalProblem(nodes, edges)) bad.push("O13");
  const graphHyps = new Set(nodes.map(n => n.hypothesisId).filter(Boolean));
  const cAnchors = new Set(C.flatMap(n => (hyp.get(n.hypothesisId ?? "")?.anchoredTo ?? []) as string[]));
  for (const h of o.hypotheses as Json[]) {
    const related = graphHyps.has(h.hypothesisId) || (h.anchoredTo as string[]).some(a => cAnchors.has(a));
    if (!related && h.status !== "refuted" && h.status !== "supported" && !(o.openQuestions as string[]).some(q => q.startsWith(h.hypothesisId))) bad.push("O14");
  }
  for (const c of o.correctiveActionCandidates as Json[]) if (hitsLexicon(c.text, VAGUE) && c.verificationSignal === null && !(o.openQuestions as string[]).some(q => q.startsWith(c.candidateId))) bad.push("O15");
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
  graphValid: (o) => graphValidity(o),
  invariants: (o, _t, s) => invariantViolations(o, s ?? {}).length === 0,
  statusMatches: (o, _t, s) => { const r = recomputeStatus(o, s ?? {}); return r.status === o.status && JSON.stringify([...r.caps].sort()) === JSON.stringify([...(o.statusCaps ?? [])].sort()); },
  notConfirmed: (o) => o.status !== "confirmed",
  /** 存在节点：每个词组至少命中一个词（大小写不敏感子串）；可选 kinds / outsideControl / rootCause / rootCauseType。 */
  nodeMatch: (o, _t, s) => {
    const rootIds = new Map((o.rootCauses as Json[]).map(r => [r.nodeId, r.type]));
    return (o.causalGraph.nodes as N[]).some(n => (s.allOf as string[][]).every(g => textHasAny(n.text, g))
      && (s.kinds === undefined || s.kinds.includes(n.kind))
      && (s.outsideControl === undefined || (n.outsideControl === true) === s.outsideControl)
      && (s.rootCause === undefined || rootIds.has(n.nodeId) === s.rootCause)
      && (s.rootCauseType === undefined || rootIds.get(n.nodeId) === s.rootCauseType));
  },
  isNotMatch: (o, _t, s: string[]) => asList(o?.problemStatement?.isNot).some((x: Json) => textHasAny(x.text, s)),
  hypothesisMatch: (o, _t, s) => asList(o?.hypotheses).some((h: Json) => textHasAny(h.text, s.words) && (s.status === undefined || h.status === s.status) && (s.statusNot === undefined || h.status !== s.statusNot)),
  hypothesisAnchoredToDistinction: (o, _t, s) => asList(o?.hypotheses).some((h: Json) => asList(h.anchoredTo).some((a: string) => asList(o.distinctions).some((d: Json) => d.id === a && textHasAny(d.text, s.words)))),
  hypothesisReproductionByHuman: (o) => asList(o?.hypotheses).some((h: Json) => h.test?.method === "reproduction" && h.test.performedBy === "human" && h.status === "inconclusive"),
  rootCausesBlameless: (o) => asList(o?.rootCauses).every((r: Json) => !hitsLexicon(o.causalGraph.nodes.find((n: N) => n.nodeId === r.nodeId)?.text ?? "", BLAMELESS)),
  rootCausesAvoid: (o, _t, s: string[]) => asList(o?.rootCauses).every((r: Json) => !textHasAny(o.causalGraph.nodes.find((n: N) => n.nodeId === r.nodeId)?.text ?? "", s)),
  escapeRootCause: (o, _t, s: string[]) => asList(o?.rootCauses).some((r: Json) => r.type === "escape" && textHasAny(r.missedDetectionPoint ?? "", s)),
  openQuestionMatch: (o, _t, s: string[]) => asList(o?.openQuestions).some((q: string) => textHasAny(q, s)),
  customerSummaryClean: (o, _t, s: string[]) => typeof o?.customerFacingSummary === "string" && !textHasAny(o.customerFacingSummary, s),
  vagueActionsHandled: (o) => asList(o?.correctiveActionCandidates).every((c: Json) => !(hitsLexicon(c.text, VAGUE) && c.verificationSignal === null) || asList(o.openQuestions).some((q: string) => q.startsWith(c.candidateId))),
  /** E4：两个独立必要条件各命中一组词，都有到同一下游节点的边、至少一条 enables，且各自强制置否后 Eval=false。 */
  twoIndependentRoots: (o, _t, s) => {
    const { nodes, edges } = o.causalGraph as { nodes: N[]; edges: E[] };
    const pick = (w: string[]) => nodes.find(n => textHasAny(n.text, w));
    const a = pick(s.a), b = pick(s.b);
    if (!a || !b || a.nodeId === b.nodeId) return false;
    const common = edges.filter(e => e.from === a.nodeId).some(ea => edges.some(eb => eb.from === b.nodeId && eb.to === ea.to));
    const anyEnables = edges.some(e => (e.from === a.nodeId || e.from === b.nodeId) && e.relation === "enables");
    return common && anyEnables && !evalProblem(nodes, edges, a.nodeId) && !evalProblem(nodes, edges, b.nodeId);
  },
};

export const ASSERTION_KINDS: readonly string[] = Object.keys(checks);

export function grade(assertions: readonly Assertion[], output: Json, trace: Trace): GradeResult {
  for (const a of assertions) {
    const check = checks[a.kind];
    if (!check) throw new Error(`S011 grader: unknown assertion kind ${a.kind}`);
    if (!check(output, trace, a.spec)) return { outcome: "fail", reason: `${a.kind} failed: ${JSON.stringify(a.spec)}` };
  }
  return { outcome: "pass", reason: null };
}
