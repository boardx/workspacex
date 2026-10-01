/**
 * EV02 回环评测运行器（04-eval-gates R3.3–3.4；A2/A3；E2/E3/E11）。纯编排，不碰文件系统：
 * 套件加载、grader 加载、报告落盘由 `infrastructure/work-eval/fs-eval-suite.ts` 负责。
 *
 * 语义：
 * - 逐 case 用回环 Agent + 夹具工具桩跑被测「固定版本」，grader 给 pass/fail；
 * - grader 抛异常、Agent 抛异常、超时（suite.caseTimeoutMs）、夹具缺失/非法 JSON、case.input 不满足被测 inputSchema → `error`，永不计作 pass（E2/E3）；
 * - `--baseline`：同一批 case 用通用 Agent + suite.baseline.tools 再跑一遍，并列写进报告；
 * - `--case`：只跑指定 case，报告 `partial=true`（A2，不能作 G4/G5 证据）。
 */
import { WorkEvalReport, type WorkEvalCase, type WorkEvalSuite } from "@repo/contracts/work-eval";
import { FixtureToolbox, mergeFixtures, type ToolTrace } from "./fixture-tools";
import type { LoopbackAgent, LoopbackCaseInput } from "./loopback-agents";

export type CaseOutcome = "pass" | "fail" | "error";
export interface CaseResult {
  caseId: string;
  outcome: CaseOutcome;
  reason: string | null;
  durationMs: number;
}
export interface RunSide {
  results: CaseResult[];
  passed: number;
  total: number;
}

export interface EvalGrader {
  version: string;
  grade(assertions: readonly { kind: string; spec?: unknown }[], output: never, trace: ToolTrace):
    | { outcome: "pass" | "fail"; reason: string | null }
    | Promise<{ outcome: "pass" | "fail"; reason: string | null }>;
}

export interface EvalRunInput {
  suite: WorkEvalSuite;
  cases: readonly WorkEvalCase[];
  /** fixture 文件名 → 已解析 JSON；缺失的引用 → 该 case error（E2）。 */
  fixtures: ReadonlyMap<string, unknown>;
  /** 文件存在但不是合法 JSON 的夹具名 → 引用它的 case error，原因写明 invalid JSON（不是 not found）。 */
  invalidFixtures?: ReadonlySet<string>;
  grader: EvalGrader;
  subject: LoopbackAgent;
  baseline: LoopbackAgent | null;
  subjectVersionDigest: string;
  subjectVersionLabel: string;
  fixturesDigest: string;
  caseFilter?: readonly string[];
  runId: string;
  now?: () => Date;
}

const truncate = (s: string) => (s.length > 2000 ? `${s.slice(0, 1997)}...` : s);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`case timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function runCase(c: WorkEvalCase, input: EvalRunInput, agent: LoopbackAgent, tools: readonly string[]): Promise<CaseResult> {
  const started = Date.now();
  const done = (outcome: CaseOutcome, reason: string | null): CaseResult => ({
    caseId: c.id,
    outcome,
    reason: reason === null ? null : truncate(reason),
    durationMs: Math.max(0, Date.now() - started),
  });
  const inputSchema = input.subject.inputSchema;
  if (inputSchema) {
    const parsed = inputSchema.safeParse(c.input);
    if (!parsed.success) {
      const detail = parsed.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      return done("error", `input does not satisfy inputSchema: ${detail}`);
    }
  }
  const missing = c.fixtureRefs.filter(ref => !input.fixtures.has(ref));
  const invalid = missing.filter(ref => input.invalidFixtures?.has(ref));
  if (invalid.length > 0) return done("error", `fixture invalid JSON: ${invalid.map(m => `fixtures/${m}`).join(", ")}`);
  if (missing.length > 0) return done("error", `fixture not found: ${missing.map(m => `fixtures/${m}`).join(", ")}`);
  try {
    const toolbox = new FixtureToolbox(mergeFixtures(c.fixtureRefs.map(ref => input.fixtures.get(ref))), tools);
    const graded = await withTimeout(
      (async () => {
        const output = await agent.run(c.input as LoopbackCaseInput, toolbox);
        return await input.grader.grade(c.expect.assertions, output as never, toolbox.trace);
      })(),
      input.suite.caseTimeoutMs,
    );
    if (graded.outcome !== "pass" && graded.outcome !== "fail") return done("error", `grader returned invalid outcome ${String(graded.outcome)}`);
    return done(graded.outcome, graded.reason);
  } catch (err) {
    return done("error", err instanceof Error ? err.message : String(err));
  }
}

async function runSide(cases: readonly WorkEvalCase[], input: EvalRunInput, agent: LoopbackAgent, tools: readonly string[]): Promise<RunSide> {
  const results: CaseResult[] = [];
  for (const c of cases) results.push(await runCase(c, input, agent, tools));
  return { results, passed: results.filter(r => r.outcome === "pass").length, total: results.length };
}

export async function runLoopbackEval(input: EvalRunInput): Promise<WorkEvalReport> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const filter = input.caseFilter && input.caseFilter.length > 0 ? new Set(input.caseFilter) : null;
  const cases = filter ? input.cases.filter(c => filter.has(c.id)) : [...input.cases];
  if (filter) {
    const unknown = [...filter].filter(id => !input.cases.some(c => c.id === id));
    if (unknown.length > 0) throw new Error(`unknown case id(s): ${unknown.join(", ")}`);
  }
  const subject = await runSide(cases, input, input.subject, input.suite.toolsUnderTest);
  let baseline: RunSide | null = null;
  if (input.baseline) {
    if (!input.suite.baseline) throw new Error("suite.json declares no baseline (E5)");
    baseline = await runSide(cases, input, input.baseline, input.suite.baseline.tools);
  }
  return WorkEvalReport.parse({
    schemaVersion: 1,
    runId: input.runId,
    stableId: input.suite.stableId,
    subjectVersionDigest: input.subjectVersionDigest,
    subjectVersionLabel: input.subjectVersionLabel,
    fixturesDigest: input.fixturesDigest,
    graderVersion: input.grader.version,
    lane: "loopback",
    partial: filter !== null,
    subject,
    baseline,
    startedAt,
    finishedAt: now().toISOString(),
  });
}

export function reportFailed(report: WorkEvalReport): boolean {
  return report.subject.results.some(r => r.outcome !== "pass");
}

export function formatSummary(report: WorkEvalReport): string {
  const lines = [
    `eval ${report.stableId} run ${report.runId} (${report.lane}${report.partial ? ", partial" : ""})`,
    `  subject ${report.subjectVersionLabel} ${report.subjectVersionDigest}`,
    `  grader ${report.graderVersion}  fixtures ${report.fixturesDigest}`,
  ];
  const base = new Map(report.baseline?.results.map(r => [r.caseId, r]) ?? []);
  for (const r of report.subject.results) {
    const b = base.get(r.caseId);
    lines.push(`  ${r.caseId.padEnd(6)} subject=${r.outcome.padEnd(5)}${b ? ` baseline=${b.outcome.padEnd(5)}` : ""}${r.reason ? `  ${r.reason}` : ""}`);
  }
  lines.push(`  subject ${report.subject.passed}/${report.subject.total} pass`);
  if (report.baseline) lines.push(`  baseline ${report.baseline.passed}/${report.baseline.total} pass`);
  return lines.join("\n");
}
