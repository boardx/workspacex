/**
 * S154 执行计划 —— 规则 grader（EV01；ADR-119 规则 grader 优先，无 llmJudge）。
 * 输入：cases.jsonl 中某条 case 的 `expect.assertions`、被测输出（见
 * requirements/work-stack-v2/skills/S154-execution-plan.md §6；抛错码的 case 输出为 { error: { code } }）与运行轨迹。
 * 输出：pass|fail 与首条失败原因；未知断言种类抛异常，由运行器记为 error（E3），本文件不吞异常。
 * 自包含（不 import 仓内模块）。
 */
export const GRADER_VERSION = "s154-rules-1.0.0";

export type Assertion = { kind: string; spec: unknown };
export type GradeResult = { outcome: "pass" | "fail"; reason: string | null };
export type Trace = { toolCalls: { name: string; kind: "read" | "write" }[] };
type Out = Record<string, any>;

/** 点路径取值；`*` 展开数组（或对象的全部值）。返回叶子值列表，路径不存在得 [undefined]。 */
function resolve(o: unknown, path: string): unknown[] {
  let cur: unknown[] = [o];
  for (const seg of path.split(".")) {
    const next: unknown[] = [];
    for (const c of cur) {
      if (seg === "*") {
        if (Array.isArray(c)) next.push(...c);
        else if (c && typeof c === "object") next.push(...Object.values(c));
        else next.push(undefined);
      } else next.push(c && typeof c === "object" ? (c as Out)[seg] : undefined);
    }
    cur = next;
  }
  return cur;
}
const eq = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
const matches = (item: unknown, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => resolve(item, k).every((x) => eq(x, v)));

const checks: Record<string, (o: Out, t: Trace, spec: any) => boolean> = {
  pathEquals: (o, _t, s) => { const v = resolve(o, s.path); return v.length > 0 && v.every((x) => eq(x, s.value)); },
  pathNotEquals: (o, _t, s) => resolve(o, s.path).every((x) => !eq(x, s.value)),
  pathIn: (o, _t, s) => { const v = resolve(o, s.path); return v.length > 0 && v.every((x) => (s.values as unknown[]).some((y) => eq(x, y))); },
  pathPresent: (o, _t, s) => resolve(o, s.path).every((x) => x !== undefined && x !== null),
  pathAbsent: (o, _t, s) => resolve(o, s.path).every((x) => x === undefined),
  pathNull: (o, _t, s) => resolve(o, s.path).every((x) => x === null),
  pathNonEmpty: (o, _t, s) => resolve(o, s.path).every((x) => (Array.isArray(x) ? x.length > 0 : typeof x === "string" ? x.length > 0 : x !== undefined && x !== null)),
  pathEmpty: (o, _t, s) => resolve(o, s.path).every((x) => x === undefined || x === null || (Array.isArray(x) && x.length === 0) || x === ""),
  arrayIncludes: (o, _t, s) => resolve(o, s.path).some((x) => Array.isArray(x) && x.some((y) => eq(y, s.value))),
  arrayExcludes: (o, _t, s) => resolve(o, s.path).every((x) => !Array.isArray(x) || x.every((y) => !eq(y, s.value))),
  arrayLenLte: (o, _t, s) => resolve(o, s.path).every((x) => Array.isArray(x) && x.length <= s.n),
  arrayLenGte: (o, _t, s) => resolve(o, s.path).every((x) => Array.isArray(x) && x.length >= s.n),
  anyItem: (o, _t, s) => resolve(o, s.path).flatMap((x) => (Array.isArray(x) ? x : [])).some((i) => matches(i, s.where)),
  noItem: (o, _t, s) => resolve(o, s.path).flatMap((x) => (Array.isArray(x) ? x : [])).every((i) => !matches(i, s.where)),
  allItems: (o, _t, s) => resolve(o, s.path).flatMap((x) => (Array.isArray(x) ? x : [])).every((i) => matches(i, s.where)),
  textPresent: (o, _t, s: string) => JSON.stringify(o).includes(s),
  textAbsent: (o, _t, s: string) => !JSON.stringify(o).includes(s),
  errorCode: (o, _t, s: string) => o.error?.code === s,
  noError: (o) => o.error === undefined,
  noWriteToolCalls: (_o, t) => t.toolCalls.every((c) => c.kind !== "write"),
  forbiddenFields: (o, _t, s: string[]) => s.every((f) => !(f in o)),
  invariant: (o, _t, s: string) => {
    const f = INVARIANTS[s];
    if (!f) throw new Error("S154 grader: unknown invariant " + s);
    return f(o);
  },
};

/** S154 输出契约（§6）不变量的机检实现；case 通过 { kind: "invariant", spec: <name> } 引用。 */
const INVARIANTS: Record<string, (o: Out) => boolean> = {
  statusProposed: (o) => o.status === "proposed",
  orphansNotCandidates: (o) => (o.steps ?? []).filter((s: any) => s.traceTo.length === 0).every((s: any) => (o.coverage.orphanSteps ?? []).includes(s.stepId) && !(o.candidateShapes ?? []).some((c: any) => c.sourceRefs.some((r: any) => r.id === s.stepId))),
  candidateShapesRoleOnly: (o) => (o.candidateShapes ?? []).every((c: any) => c.sourceRefs.every((r: any) => r.kind === "s154-step") && Object.keys(c.ownerHint).every((k) => k === "role")),
  criticalPathOnlyEstimated: (o) => { const ok = new Set((o.steps ?? []).filter((s: any) => s.estimate !== "not-estimated").map((s: any) => s.stepId)); return [...(o.criticalPath?.atLowEstimate ?? []), ...(o.criticalPath?.atHighEstimate ?? [])].every((id: string) => ok.has(id)); },
  fixedMilestoneHasSource: (o) => (o.milestones ?? []).every((m: any) => m.dateKind !== "fixed" || (typeof m.dateSource === "string" && m.dateSource.length > 0)),
  dependenciesAcyclic: (o) => { const g = new Map<string, string[]>((o.steps ?? []).map((s: any) => [s.stepId, s.predecessors.map((p: any) => p.stepId)])); const seen = new Map<string, number>(); const visit = (id: string): boolean => { if (seen.get(id) === 1) return false; if (seen.get(id) === 2) return true; seen.set(id, 1); for (const p of g.get(id) ?? []) if (!visit(p)) return false; seen.set(id, 2); return true; }; return [...g.keys()].every(visit); },
  everyStepTracesOrIsOrphan: (o) => (o.steps ?? []).every((s: any) => s.traceTo.length > 0 || (o.coverage.orphanSteps ?? []).includes(s.stepId)),
};

export const ASSERTION_KINDS: readonly string[] = Object.keys(checks);
export const INVARIANT_NAMES: readonly string[] = Object.keys(INVARIANTS);

export function grade(assertions: readonly Assertion[], output: Out, trace: Trace = { toolCalls: [] }): GradeResult {
  for (const a of assertions) {
    const check = checks[a.kind];
    if (!check) throw new Error("S154 grader: unknown assertion kind " + a.kind);
    let ok: boolean;
    try {
      ok = check(output, trace, a.spec);
    } catch (error) {
      // 输出结构不符合契约导致断言无法求值 ⇒ 判 fail（不是 grader 缺陷）；未知断言种类仍在上面抛出。
      return { outcome: "fail", reason: a.kind + " not evaluable: " + (error instanceof Error ? error.message : String(error)) };
    }
    if (!ok) return { outcome: "fail", reason: a.kind + " failed: " + JSON.stringify(a.spec) };
  }
  return { outcome: "pass", reason: null };
}
