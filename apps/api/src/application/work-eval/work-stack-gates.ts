/**
 * EV03 `lint-work-stack-gates` 的判定（04-eval-gates R3.5–3.6；E1/E2/E4/E7/E8；契约束 work-eval UC-3）。
 * 纯函数：不碰文件系统。实体发现、manifest 解析、套件/报告读取、digest 计算在
 * `infrastructure/work-eval/fs-work-stack-gates.ts`。
 *
 * 判定口径：
 * - G0 身份：manifest（`metadata.work`）可解析；stableId 在包间唯一、在 WORK-STACK-320-LIST.md 中、
 *   恰有一份实体文档；`evalSuiteId` 与套件 `suite.json.stableId` 都等于 stableId。
 * - G1 溯源/许可：每条 provenance 有 repo/path/commit/license，copied=true 必带 notice；
 *   fair-code/未声明许可证只允许 reference-only 且未复制。
 * - G2 schema：input/outputSchema 是合法 JSON Schema；每个 case 的 input 满足 inputSchema、
 *   outputSample 满足 outputSchema；夹具引用存在（E2）。
 * - G3 权限/注入：dependencies 全部已登记（ADR-120）；套件含权限拒绝 + 注入 case（E7）；最近报告中二者 pass。
 * - G4 功能：取最新非 partial、lane=loopback、digest = 当前版本的报告，确定性 case 全 pass；
 *   无套件/套件非法 → NO_SUITE（不得 not_applicable，E1）；有报告但 digest 不等/无报告 → REPORT_STALE（E4）。
 * - G5：`decideG5`（EV05 才据此改通道；这里只为产出完整 WorkGateStatus）。
 * Workflow/Agent（A1）：G1/G3/G5 = not_applicable（NOT_REQUIRED_FOR_KIND）。
 */
import Ajv from "ajv";
import {
  decideG5,
  PHASE1_GATES,
  suiteCoverageGaps,
  WorkGateStatus,
  type WorkEvalCase,
  type WorkEvalReport,
  type WorkEvalSuite,
} from "@repo/contracts/work-eval";
import { WorkSkillManifest, WorkSkillProvenance } from "@repo/contracts/work-skill-meta";
import { z } from "zod";
import {
  REFERENCE_ONLY_LICENSES,
  REGISTERED_CAPABILITY_CATEGORIES,
  WORK_STACK_GATES_SCRIPT_VERSION,
} from "../../domain/work-eval/gate-policy";

type GateId = (typeof PHASE1_GATES)[number];
export type GateOutcome = "pass" | "fail" | "not_applicable";
export interface GateResult {
  gate: GateId;
  outcome: GateOutcome;
  reasonCode: z.infer<typeof WorkGateStatus>["gates"][number]["reasonCode"];
  reason: string;
}

export type GateSuiteState =
  | { state: "missing" }
  | { state: "invalid"; issues: string[] }
  | {
      state: "ok";
      suite: WorkEvalSuite;
      cases: WorkEvalCase[];
      /** 相对 fixtures/ 的 posix 路径 */
      fixtureFiles: readonly string[];
      hasCalibrationDir: boolean;
    };

export interface GateSubject {
  stableId: string;
  kind: "skill" | "workflow" | "agent";
  /** 声明 metadata.work 的文件（仓库相对路径），用于报错定位。 */
  sourcePath: string;
  /** frontmatter `metadata.work` 原值；解析失败时为 undefined 并给 manifestError。 */
  manifest: unknown;
  manifestError: string | null;
  /** 被测当前版本 content digest（与 `harness eval` 同一算法）；无法定位时 null。 */
  versionDigest: string | null;
  identity: {
    inList: boolean;
    entityDocs: readonly string[];
    /** 其他同样声明该 stableId 的包路径（唯一性） */
    duplicatePackages: readonly string[];
  };
  suite: GateSuiteState;
  /** 已通过 `WorkEvalReport` 校验的报告（仓库相对路径） */
  reports: readonly { path: string; report: WorkEvalReport }[];
}

export interface GateJudgement {
  stableId: string;
  sourcePath: string;
  gates: GateResult[];
  /** G0–G4 是否有 fail（官方实体 → 退出码非 0） */
  failedG0toG4: boolean;
  /** 能产出合法 WorkGateStatus 时给出（需要 sha256 digest） */
  status: WorkGateStatus | null;
  /** R3.6：本该产出 WorkGateStatus 却产不出时的原因（门脚本据此报错并退出非 0，不许静默丢弃）。 */
  statusError: string | null;
}

const pass = (gate: GateId, reason = "ok"): GateResult => ({ gate, outcome: "pass", reasonCode: "OK", reason });
const fail = (gate: GateId, reasonCode: GateResult["reasonCode"], reason: string): GateResult => ({
  gate,
  outcome: "fail",
  reasonCode,
  reason: reason.length > 2000 ? `${reason.slice(0, 1997)}...` : reason,
});
const na = (gate: GateId): GateResult => ({ gate, outcome: "not_applicable", reasonCode: "NOT_REQUIRED_FOR_KIND", reason: "not required for this entity kind (A1)" });

const IdentityManifest = WorkSkillManifest.omit({ provenance: true }).extend({
  provenance: z.array(z.unknown()).min(1), // 逐条细节交给 G1（缺 license 应判 G1，而非 G0）
});
/**
 * Workflow/Agent（A1）：本阶段只判 G0/G2/G4，契约层尚无它们的 `metadata.work` manifest，
 * 因此只取门判定真正要读的最小身份面（stableId、evalSuiteId、input/outputSchema），其余字段放行。
 */
const NonSkillIdentityManifest = z
  .object({
    stableId: z.string().regex(/^[WD]\d{3}$/),
    evalSuiteId: z.string().min(1),
    inputSchema: z.record(z.unknown()),
    outputSchema: z.record(z.unknown()),
  })
  .passthrough();
type GateManifest = Pick<z.infer<typeof IdentityManifest>, "stableId" | "evalSuiteId" | "inputSchema" | "outputSchema"> &
  Partial<Pick<z.infer<typeof IdentityManifest>, "provenance" | "dependencies">>;

function newAjv() {
  return new Ajv({ strict: false, allErrors: true });
}

function ajvErrors(errors: { instancePath: string; message?: string }[] | null | undefined): string {
  return (errors ?? []).map(e => `${e.instancePath || "(root)"} ${e.message ?? "invalid"}`).join("; ");
}

function judgeG0(s: GateSubject, manifest: GateManifest | null, manifestIssue: string | null): GateResult {
  if (!manifest) return fail("G0", "MANIFEST_UNPARSEABLE", `${s.sourcePath} metadata.work: ${manifestIssue ?? "missing"}`);
  const problems: string[] = [];
  const expectedKind = ({ S: "skill", W: "workflow", D: "agent" } as const)[s.stableId[0] as "S" | "W" | "D"];
  if (expectedKind && expectedKind !== s.kind) problems.push(`${s.stableId} is a ${expectedKind} id but is declared by a ${s.kind} package ${s.sourcePath}`);
  if (manifest.stableId !== s.stableId) problems.push(`metadata.work.stableId ${manifest.stableId} ≠ ${s.stableId}`);
  if (s.identity.duplicatePackages.length > 0) problems.push(`stableId ${s.stableId} also declared by ${s.identity.duplicatePackages.join(", ")}`);
  if (!s.identity.inList) problems.push(`${s.stableId} not in WORK-STACK-320-LIST.md`);
  if (s.identity.entityDocs.length !== 1) problems.push(`expected exactly one entity doc ${s.stableId}-*.md, found ${s.identity.entityDocs.length}`);
  if (manifest.evalSuiteId !== s.stableId) problems.push(`evalSuiteId ${manifest.evalSuiteId} ≠ stableId ${s.stableId}`);
  if (s.suite.state === "ok" && s.suite.suite.stableId !== s.stableId) problems.push(`suite.json.stableId ${s.suite.suite.stableId} ≠ ${s.stableId}`);
  return problems.length ? fail("G0", "STABLE_ID_MISMATCH", problems.join("; ")) : pass("G0", `stableId ${s.stableId} unique, listed, 1 entity doc`);
}

function judgeG1(provenance: readonly unknown[]): GateResult {
  const problems: string[] = [];
  const disallowed: string[] = [];
  provenance.forEach((raw, i) => {
    const p = WorkSkillProvenance.safeParse(raw);
    if (!p.success) {
      problems.push(...p.error.issues.map(e => `provenance.${i}.${e.path.join(".") || "(root)"}: ${e.message}`));
      return;
    }
    if (REFERENCE_ONLY_LICENSES.has(p.data.license.toLowerCase()) && (p.data.copied || p.data.strategy !== "reference-only")) {
      disallowed.push(`provenance.${i} ${p.data.repo}: license ${p.data.license} is reference-only (strategy=${p.data.strategy}, copied=${p.data.copied})`);
    }
  });
  if (problems.length) return fail("G1", "PROVENANCE_LICENSE_MISSING", problems.join("; "));
  if (disallowed.length) return fail("G1", "LICENSE_DISALLOWED", disallowed.join("; "));
  return pass("G1", `${provenance.length} provenance entries complete, licenses allowed`);
}

function judgeG2(s: GateSubject, manifest: GateManifest): GateResult {
  const ajv = newAjv();
  const problems: string[] = [];
  const compile = (name: "inputSchema" | "outputSchema") => {
    try {
      return ajv.compile(manifest[name]);
    } catch (e) {
      problems.push(`${name} is not a valid JSON Schema: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
  const input = compile("inputSchema");
  const output = compile("outputSchema");
  if (s.suite.state === "ok") {
    const fixtures = new Set(s.suite.fixtureFiles);
    for (const c of s.suite.cases) {
      if (input && !input(c.input)) problems.push(`case ${c.id} input: ${ajvErrors(input.errors)}`);
      if (output && c.expect.outputSample !== undefined && !output(c.expect.outputSample)) problems.push(`case ${c.id} outputSample: ${ajvErrors(output.errors)}`);
      for (const ref of c.fixtureRefs) if (!fixtures.has(ref)) problems.push(`case ${c.id} fixture ${ref} not found (E2)`);
    }
  }
  if (problems.length) return fail("G2", "SCHEMA_INVALID", problems.join("; "));
  const n = s.suite.state === "ok" ? s.suite.cases.length : 0;
  return pass("G2", `schemas valid; ${n} case inputs/outputs conform`);
}

/** 最新可作 G4/G5 证据的报告：非 partial、lane=loopback、stableId 匹配，按 finishedAt 取最新。 */
function latestEvidence(s: GateSubject) {
  const eligible = s.reports
    .filter(r => !r.report.partial && r.report.lane === "loopback" && r.report.stableId === s.stableId)
    .sort((a, b) => b.report.finishedAt.localeCompare(a.report.finishedAt));
  const latest = eligible[0] ?? null;
  const current = latest && s.versionDigest !== null && latest.report.subjectVersionDigest === s.versionDigest ? latest : null;
  return { latest, current };
}

function judgeG3(s: GateSubject, manifest: z.infer<typeof IdentityManifest>, current: ReturnType<typeof latestEvidence>["current"]): GateResult {
  const deps = [...manifest.dependencies.required, ...manifest.dependencies.optional];
  const unregistered = deps.filter(d => !REGISTERED_CAPABILITY_CATEGORIES.has(d));
  if (unregistered.length) return fail("G3", "CAPABILITY_UNREGISTERED", `dependencies not registered (ADR-120): ${unregistered.join(", ")}`);
  if (s.suite.state !== "ok") return fail("G3", "INJECTION_OR_DENIAL_CASE_MISSING", "no valid suite: permission-denial / prompt-injection coverage cannot be shown (E7)");
  const gaps = suiteCoverageGaps(s.suite.cases);
  if (gaps.length) return fail("G3", "INJECTION_OR_DENIAL_CASE_MISSING", `suite lacks ${gaps.join(" and ")} case (E7 coverage insufficient)`);
  if (!current) return fail("G3", "INJECTION_OR_DENIAL_CASE_FAILED", "no loopback report for the current version digest shows the denial/injection cases passing");
  const outcomes = new Map(current.report.subject.results.map(r => [r.caseId, r.outcome]));
  const guarded = s.suite.cases.filter(c => c.tags.includes("permission-denial") || c.tags.includes("prompt-injection"));
  const bad = guarded.filter(c => outcomes.get(c.id) !== "pass");
  if (bad.length) return fail("G3", "INJECTION_OR_DENIAL_CASE_FAILED", `denial/injection cases not passing in ${current.path}: ${bad.map(c => `${c.id}=${outcomes.get(c.id) ?? "missing"}`).join(", ")}`);
  return pass("G3", `${deps.length} categories registered; denial/injection cases ${guarded.map(c => c.id).join(",")} pass`);
}

function judgeG4(s: GateSubject, ev: ReturnType<typeof latestEvidence>): GateResult {
  if (s.suite.state === "missing") return fail("G4", "NO_SUITE", `evals/work-stack/${s.stableId}/suite.json not found (E1)`);
  if (s.suite.state === "invalid") return fail("G4", "NO_SUITE", `suite invalid (E1): ${s.suite.issues.join("; ")}`);
  if (s.suite.suite.llmJudge && !s.suite.hasCalibrationDir) return fail("G4", "LLM_JUDGE_UNCALIBRATED", "llmJudge declared without calibration samples (E8)");
  if (!ev.current) {
    const why = ev.latest
      ? `latest report ${ev.latest.path} is for ${ev.latest.report.subjectVersionDigest}, current version is ${s.versionDigest ?? "unknown"} (report stale, E4)`
      : "no complete loopback report for the current version (no report = not passed)";
    return fail("G4", "REPORT_STALE", why);
  }
  const outcomes = new Map(ev.current.report.subject.results.map(r => [r.caseId, r.outcome]));
  const det = s.suite.cases.filter(c => c.deterministic);
  const bad = det.filter(c => outcomes.get(c.id) !== "pass");
  if (bad.length) return fail("G4", "CASE_FAILED", `deterministic cases not passing in ${ev.current.path}: ${bad.map(c => `${c.id}=${outcomes.get(c.id) ?? "missing"}`).join(", ")}`);
  return pass("G4", `${det.length}/${det.length} deterministic cases pass in ${ev.current.path}`);
}

export function judgeWorkStackGates(s: GateSubject, now: Date = new Date()): GateJudgement {
  let manifest: GateManifest | null = null;
  let skillManifest: z.infer<typeof IdentityManifest> | null = null;
  let manifestIssue = s.manifestError;
  if (manifestIssue === null) {
    const parsed = s.kind === "skill" ? IdentityManifest.safeParse(s.manifest) : NonSkillIdentityManifest.safeParse(s.manifest);
    if (parsed.success) {
      manifest = parsed.data as GateManifest;
      if (s.kind === "skill") skillManifest = parsed.data as z.infer<typeof IdentityManifest>;
    }
    else manifestIssue = parsed.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  }
  const ev = latestEvidence(s);
  const isSkill = s.kind === "skill";
  const prior = (gate: GateId) => fail(gate, "PRIOR_GATE_FAILED", "metadata.work unparseable (G0)");

  const g0 = judgeG0(s, manifest, manifestIssue);
  const g1 = !isSkill ? na("G1") : skillManifest ? judgeG1(skillManifest.provenance) : prior("G1");
  const g2 = manifest ? judgeG2(s, manifest) : prior("G2");
  const g3 = !isSkill ? na("G3") : skillManifest ? judgeG3(s, skillManifest, ev.current) : prior("G3");
  const g4 = judgeG4(s, ev);
  const before = [g0, g1, g2, g3, g4];
  const failedG0toG4 = before.some(g => g.outcome === "fail");

  let g5: GateResult;
  let subjectPassed: number | null = null;
  let baselinePassed: number | null = null;
  let deterministicTotal: number | null = null;
  if (!isSkill) g5 = na("G5");
  else {
    const det = s.suite.state === "ok" ? s.suite.cases.filter(c => c.deterministic).map(c => c.id) : [];
    const detSet = new Set(det);
    const report = ev.current?.report ?? null;
    if (report) {
      subjectPassed = report.subject.results.filter(r => detSet.has(r.caseId) && r.outcome === "pass").length;
      baselinePassed = report.baseline ? report.baseline.results.filter(r => detSet.has(r.caseId) && r.outcome === "pass").length : null;
      deterministicTotal = det.length;
    }
    const mustPass = s.suite.state === "ok" ? s.suite.suite.mustPassCaseIds : [];
    const subjectOutcomes = new Map((report?.subject.results ?? []).map(r => [r.caseId, r.outcome]));
    const suiteHasBaseline = s.suite.state === "ok" && s.suite.suite.baseline !== null;
    const d = decideG5({
      priorGatesPassed: !failedG0toG4,
      subjectPassed: subjectPassed ?? 0,
      baselinePassed: suiteHasBaseline ? baselinePassed : null,
      mustPassAllPassed: mustPass.every(id => subjectOutcomes.get(id) === "pass"),
    });
    g5 = d.outcome === "pass"
      ? pass("G5", `subject ${subjectPassed}/${deterministicTotal} > baseline ${baselinePassed}/${deterministicTotal}; must-pass ${mustPass.join(",")} pass`)
      : fail("G5", d.reasonCode, g5Reason(d.reasonCode, subjectPassed, baselinePassed));
  }
  const gates = [...before, g5];

  let status: WorkGateStatus | null = null;
  let statusError: string | null = null;
  if (s.versionDigest === null) statusError = "no version digest for the subject: WorkGateStatus cannot be produced (R3.6)";
  else {
    const parsed = WorkGateStatus.safeParse({
      stableId: s.stableId,
      subjectVersionDigest: s.versionDigest,
      gates,
      evidenceReportPath: ev.current?.path ?? null,
      subjectPassed,
      baselinePassed,
      deterministicTotal,
      decidedAt: now.toISOString(),
      scriptVersion: WORK_STACK_GATES_SCRIPT_VERSION,
    });
    if (parsed.success) status = parsed.data;
    else statusError = `WorkGateStatus invalid (R3.6): ${parsed.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`;
  }
  return { stableId: s.stableId, sourcePath: s.sourcePath, gates, failedG0toG4, status, statusError };
}

/**
 * 套件存在但没有任何包声明该 stableId（R3.5 / E1 的反方向）：不是「0 个实体、静默通过」，而是 G0 fail。
 * 其余门无从判定 → PRIOR_GATE_FAILED；没有被测版本，故不产 WorkGateStatus（也不算 statusError）。
 */
export function judgeOrphanSuite(stableId: string, suitePath: string): GateJudgement {
  const g0 = fail("G0", "STABLE_ID_MISMATCH", `${suitePath} exists but no SKILL.md/WORKFLOW.md/AGENT.md declares metadata.work.stableId=${stableId} (orphan suite)`);
  const rest = (["G1", "G2", "G3", "G4", "G5"] as const).map(g => fail(g, "PRIOR_GATE_FAILED", "no package for this stableId (G0)"));
  return { stableId, sourcePath: suitePath, gates: [g0, ...rest], failedG0toG4: true, status: null, statusError: null };
}

function g5Reason(code: GateResult["reasonCode"], subject: number | null, baseline: number | null): string {
  switch (code) {
    case "PRIOR_GATE_FAILED": return "G0–G4 not all passed";
    case "NO_BASELINE": return "no baseline result (E5)";
    case "MUST_PASS_CASE_FAILED": return "a must-pass case did not pass (E6)";
    case "NOT_BETTER_THAN_BASELINE": return `subject ${subject ?? 0} ≤ baseline ${baseline ?? 0} (E6: a tie fails)`;
    default: return code;
  }
}

/** 一行一门的人读输出。 */
export function formatGateJudgement(j: GateJudgement): string[] {
  return [
    `${j.stableId} (${j.sourcePath})`,
    ...j.gates.map(g => `  ${g.gate} ${g.outcome.padEnd(14)} ${g.reasonCode}  ${g.reason}`),
  ];
}
