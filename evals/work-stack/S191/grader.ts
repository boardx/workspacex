/**
 * S191 —— 规则 grader（EV01；ADR-119 规则 grader 优先，无 llmJudge）。
 * 输入：cases.jsonl 中某条 case 的 `expect.assertions` 与被测输出（成功体见 manifest.outputSchema，
 * 类型化错误以 `{ error: { code } }` 返回）+ 运行轨迹中的工具调用。
 * 输出：pass|fail 与首条失败原因；未知断言种类抛异常，由运行器记为 error（E3）。
 * 自包含（不 import 仓内模块），由 EV02 运行器按路径加载。
 *
 * 路径语法：`a.b[*].c`，`[*]` 展开数组；`eq`/`in` 对展开后的全部值成立（且至少一个值），`some` 任一成立。
 * 期望值是对象时按「子集」匹配（期望的键都相等即可）。
 */
export const GRADER_VERSION = "s191-rules-1.0.0";

export type Trace = { toolCalls: { name: string; kind: "read" | "write" }[] };
export type Assertion = { kind: string; spec: unknown };
export type GradeResult = { outcome: "pass" | "fail"; reason: string | null };
type Out = Record<string, unknown>;

function resolvePath(root: unknown, path: string): unknown[] {
  let cur: unknown[] = [root];
  for (const seg of path.split(".")) {
    const wild = seg.endsWith("[*]");
    const key = wild ? seg.slice(0, -3) : seg;
    cur = cur.flatMap(v => {
      const next = key === "" ? v : v !== null && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
      return wild ? (Array.isArray(next) ? next : []) : [next];
    });
  }
  return cur.filter(v => v !== undefined);
}
function same(a: unknown, b: unknown): boolean {
  if (b !== null && typeof b === "object" && !Array.isArray(b)) {
    return a !== null && typeof a === "object" && !Array.isArray(a) && Object.entries(b as Record<string, unknown>).every(([k, v]) => same((a as Record<string, unknown>)[k], v));
  }
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((v, i) => same(a[i], v));
  return a === b;
}
const contains = (x: unknown, v: unknown): boolean =>
  Array.isArray(x) ? x.some(y => same(y, v)) : typeof x === "string" && typeof v === "string" ? x.includes(v) : false;
const text = (o: Out) => JSON.stringify(o);
type PV = { path: string; value: unknown };
type PN = { path: string; n: number };

const checks: Record<string, (o: Out, t: Trace, s: any) => boolean> = {
  errorCode: (o, _t, s: string) => (o.error as { code?: string } | undefined)?.code === s,
  noError: o => o.error === undefined,
  eq: (o, _t, s: PV) => { const v = resolvePath(o, s.path); return v.length > 0 && v.every(x => same(x, s.value)); },
  some: (o, _t, s: PV) => resolvePath(o, s.path).some(x => same(x, s.value)),
  in: (o, _t, s: { path: string; values: unknown[] }) => { const v = resolvePath(o, s.path); return v.length > 0 && v.every(x => s.values.some(y => same(x, y))); },
  includes: (o, _t, s: PV) => resolvePath(o, s.path).some(x => contains(x, s.value)),
  notIncludes: (o, _t, s: PV) => !resolvePath(o, s.path).some(x => contains(x, s.value)),
  present: (o, _t, s: string) => resolvePath(o, s).length > 0,
  absent: (o, _t, s: string) => resolvePath(o, s).length === 0,
  gte: (o, _t, s: PV) => { const v = resolvePath(o, s.path); return v.length > 0 && v.every(x => typeof x === "number" && x >= (s.value as number)); },
  lte: (o, _t, s: PV) => { const v = resolvePath(o, s.path); return v.length > 0 && v.every(x => typeof x === "number" && x <= (s.value as number)); },
  lengthGte: (o, _t, s: PN) => resolvePath(o, s.path).some(x => (Array.isArray(x) || typeof x === "string") && x.length >= s.n),
  lengthEq: (o, _t, s: PN) => resolvePath(o, s.path).some(x => (Array.isArray(x) || typeof x === "string") && x.length === s.n),
  matches: (o, _t, s: { path: string; pattern: string }) => { const v = resolvePath(o, s.path); return v.length > 0 && v.every(x => typeof x === "string" && new RegExp(s.pattern, "u").test(x)); },
  notMatches: (o, _t, s: { path: string; pattern: string }) => resolvePath(o, s.path).every(x => typeof x !== "string" || !new RegExp(s.pattern, "u").test(x)),
  before: (o, _t, s: PV) => { const v = resolvePath(o, s.path); return v.length > 0 && v.every(x => typeof x === "string" && x < (s.value as string)); },
  subtreeAbsent: (o, _t, s: { path: string; text: string }) => !resolvePath(o, s.path).some(x => JSON.stringify(x).includes(s.text)),
  first: (o, _t, s: PV) => { const v = resolvePath(o, s.path); return v.length > 0 && same(v[0], s.value); },
  textAbsent: (o, _t, s: string) => !text(o).includes(s),
  textPresent: (o, _t, s: string) => text(o).includes(s),
  noWriteToolCalls: (_o, t) => t.toolCalls.every(c => c.kind !== "write"),
  allContentOriginated: o => resolvePath(o, "proposals[*]").every(p => (p as { contentOriginated?: boolean }).contentOriginated === true),
};

export const ASSERTION_KINDS: readonly string[] = Object.keys(checks);

export function grade(assertions: readonly Assertion[], output: Out, trace: Trace): GradeResult {
  for (const a of assertions) {
    const check = checks[a.kind];
    if (!check) throw new Error(`S191 grader: unknown assertion kind ${a.kind}`);
    if (!check(output, trace, a.spec)) return { outcome: "fail", reason: `${a.kind} failed: ${JSON.stringify(a.spec)}` };
  }
  return { outcome: "pass", reason: null };
}
