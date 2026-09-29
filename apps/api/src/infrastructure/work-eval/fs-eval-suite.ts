/**
 * EV02 `pnpm harness eval` 的 IO 侧：读 `evals/work-stack/<ID>/`、定位被测固定版本并算 digest、
 * 加载套件自带 grader、写 `reports/<runId>.json`。编排逻辑在 application/work-eval/eval-runner.ts。
 *
 * 退出码 = contracts `WorkEvalCliExit` 的序号：0 OK / 1 CASE_FAILED_OR_ERROR / 2 SUITE_INVALID /
 * 3 FIXTURE_REAL_DATA_SUSPECTED（4 WRITE_BACK_FAILED 属 EV03 回写，本命令不涉及）。
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { WorkEvalCliExit, validateWorkEvalSuiteBundle, type WorkEvalReport } from "@repo/contracts/work-eval";
import { formatSummary, reportFailed, runLoopbackEval, type EvalGrader } from "../../application/work-eval/eval-runner";
import { scanFixtureForPersonalData } from "../../application/work-eval/fixture-privacy";
import { genericAgentBaselineLoopback, LOOPBACK_SUBJECTS } from "../../application/work-eval/loopback-agents";

export const EXIT = Object.fromEntries(WorkEvalCliExit.options.map((k, i) => [k, i])) as Record<(typeof WorkEvalCliExit.options)[number], number>;

export interface EvalCommandOptions {
  repoRoot: string;
  entity: string;
  /** 默认 `<repoRoot>/evals/work-stack`；测试指向临时副本以免污染仓库。 */
  evalsRoot?: string;
  baseline?: boolean;
  cases?: string[];
  /**
   * `--version <digest>`（UC-2）：钉住被测版本。回环 lane 只能评测工作区当前内容，所以只接受等于当前
   * content digest 的值；不等 → SUITE_INVALID（不会静默改评别的版本）。
   */
  version?: string;
  runId?: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export interface EvalCommandResult {
  exitCode: number;
  report: WorkEvalReport | null;
  reportPath: string | null;
}

const show = (root: string, p: string) => {
  const rel = relative(root, p);
  return !rel || rel.startsWith("..") ? p : rel;
};

const sha256 = (chunks: readonly (string | Buffer)[]) => {
  const h = createHash("sha256");
  for (const c of chunks) h.update(c);
  return `sha256:${h.digest("hex")}`;
};

export function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * 被测固定版本（ADR-118 #9）：优先 `skills/**\/SKILL.md` 中 frontmatter `stableId: <ID>` 的 Skill 包
 * （digest 覆盖包内全部文件）；尚无包时退回实体文档 `requirements/work-stack-v2/skills/<ID>-*.md`。
 */
export function resolveSubjectVersion(repoRoot: string, stableId: string): { digest: string; label: string } | null {
  const skillMd = walk(join(repoRoot, "skills")).find(p => {
    if (!p.endsWith("SKILL.md")) return false;
    const fm = /^---\n([\s\S]*?)\n---/.exec(readFileSync(p, "utf8"))?.[1] ?? "";
    return new RegExp(`stableId:\\s*["']?${stableId}["']?\\s*$`, "m").test(fm);
  });
  if (skillMd) return skillPackageVersion(skillMd);
  const docDir = join(repoRoot, "requirements/work-stack-v2/skills");
  const doc = existsSync(docDir) ? readdirSync(docDir).find(n => n.startsWith(`${stableId}-`) && n.endsWith(".md")) : undefined;
  if (!doc) return null;
  return { digest: sha256([readFileSync(join(docDir, doc))]), label: `entity-doc:${doc}`.slice(0, 64) };
}

/** 一个 Skill 包（SKILL.md 所在目录）的 content digest；`harness eval` 与门脚本共用同一算法（E4 比对）。 */
export function skillPackageVersion(skillMd: string): { digest: string; label: string } {
  const dir = join(skillMd, "..");
  const files = walk(dir).sort();
  const fm = /^---\n([\s\S]*?)\n---/.exec(readFileSync(skillMd, "utf8"))?.[1] ?? "";
  const version = /^\s*version:\s*["']?([\w.+-]+)/m.exec(fm)?.[1] ?? "unversioned";
  return { digest: sha256(files.flatMap(f => [relative(dir, f), "\0", readFileSync(f), "\0"])), label: `skill@${version}`.slice(0, 64) };
}

export function newRunId(stableId: string, now = new Date()): string {
  return `${stableId}-${now.toISOString().replace(/[-:.]/g, "").slice(0, 15)}-${randomBytes(3).toString("hex")}`;
}

export async function runEvalCommand(opts: EvalCommandOptions): Promise<EvalCommandResult> {
  const out = opts.out ?? (l => process.stdout.write(`${l}\n`));
  const err = opts.err ?? (l => process.stderr.write(`${l}\n`));
  const none = (exitCode: number): EvalCommandResult => ({ exitCode, report: null, reportPath: null });
  const suiteDir = join(opts.evalsRoot ?? join(opts.repoRoot, "evals/work-stack"), opts.entity);

  if (!existsSync(join(suiteDir, "suite.json"))) {
    err(`SUITE_INVALID ${show(opts.repoRoot, suiteDir)}/suite.json (file): suite not found`);
    return none(EXIT.SUITE_INVALID);
  }
  const fixturesDir = join(suiteDir, "fixtures");
  // 递归收集（子目录夹具同样进 E11 扫描与 fixturesDigest），名字用相对 fixtures/ 的 posix 路径，与 fixtureRefs 同形。
  const fixtureFiles = walk(fixturesDir).map(p => relative(fixturesDir, p).split(sep).join("/")).sort();
  let suiteJson: unknown;
  try {
    suiteJson = JSON.parse(readFileSync(join(suiteDir, "suite.json"), "utf8"));
  } catch {
    err("SUITE_INVALID suite.json (root): invalid JSON");
    return none(EXIT.SUITE_INVALID);
  }
  const bundle = validateWorkEvalSuiteBundle({
    dirName: opts.entity,
    suiteJson,
    casesJsonl: existsSync(join(suiteDir, "cases.jsonl")) ? readFileSync(join(suiteDir, "cases.jsonl"), "utf8") : "",
    // 注意：这里刻意屏蔽了 EV01 的「夹具缺失」校验（validate-work-eval-suite 仍会对缺失夹具失败，
    // 见 tests/work-eval/eval-runner.test.ts 的 EV01 钉子测试）；
    // 缺失的夹具引用按 E2 降级为该 case error，而不是整套件无效——这里把全部引用视作存在，运行时再判。
    fixtureFiles: [...fixtureFiles, ...readReferencedFixtures(suiteDir)],
    hasGrader: existsSync(join(suiteDir, "grader.ts")),
    hasCalibrationDir: existsSync(join(suiteDir, "calibration")),
  });
  if (!bundle.ok) {
    for (const i of bundle.issues) err(`SUITE_INVALID ${i.file} ${i.path}: ${i.message}`);
    return none(EXIT.SUITE_INVALID);
  }

  // E11：先扫夹具，命中疑似真实个人数据就拒绝运行，不产生报告。
  const fixtures = new Map<string, unknown>();
  const texts: string[] = [];
  const invalidFixtures = new Set<string>();
  const findings = [];
  for (const f of fixtureFiles) {
    const text = readFileSync(join(fixturesDir, f), "utf8");
    findings.push(...scanFixtureForPersonalData(`fixtures/${f}`, text));
    texts.push(f, "\0", text, "\0");
    try {
      fixtures.set(f, JSON.parse(text));
    } catch {
      invalidFixtures.add(f); // 引用它的 case 记 error，原因为 invalid JSON（不是 not found）
    }
  }
  if (findings.length > 0) {
    for (const f of findings) err(`FIXTURE_REAL_DATA_SUSPECTED ${f.file}: ${f.kind} ${f.match}`);
    err("eval refused: fixtures must be synthetic (04-eval-gates E11)");
    return none(EXIT.FIXTURE_REAL_DATA_SUSPECTED);
  }

  const subject = LOOPBACK_SUBJECTS[opts.entity];
  if (!subject) {
    err(`SUITE_INVALID ${opts.entity}: no loopback subject registered for this entity`);
    return none(EXIT.SUITE_INVALID);
  }
  const version = resolveSubjectVersion(opts.repoRoot, opts.entity);
  if (!version) {
    err(`SUITE_INVALID ${opts.entity}: cannot locate a pinned subject version (no SKILL.md / entity doc)`);
    return none(EXIT.SUITE_INVALID);
  }
  if (opts.version !== undefined && opts.version !== version.digest) {
    err(`SUITE_INVALID --version ${opts.version}: loopback eval can only run the current working-tree version (${version.digest}, ${version.label})`);
    return none(EXIT.SUITE_INVALID);
  }
  if (opts.baseline && !bundle.suite.baseline) {
    err(`SUITE_INVALID suite.json baseline: --baseline requested but suite declares no baseline (E5)`);
    return none(EXIT.SUITE_INVALID);
  }

  const graderMod = (await import(pathToFileURL(join(suiteDir, "grader.ts")).href)) as {
    GRADER_VERSION?: string;
    grade?: EvalGrader["grade"];
  };
  if (typeof graderMod.grade !== "function" || graderMod.GRADER_VERSION !== bundle.suite.graderVersion) {
    err(`SUITE_INVALID grader.ts GRADER_VERSION: must export grade() and GRADER_VERSION = suite.graderVersion (${bundle.suite.graderVersion})`);
    return none(EXIT.SUITE_INVALID);
  }

  let report: WorkEvalReport;
  try {
    report = await runLoopbackEval({
      suite: bundle.suite,
      cases: bundle.cases,
      fixtures,
      invalidFixtures,
      grader: { version: graderMod.GRADER_VERSION, grade: graderMod.grade },
      subject,
      baseline: opts.baseline ? genericAgentBaselineLoopback : null,
      subjectVersionDigest: version.digest,
      // digest 只覆盖 Skill 包/实体文档；回环行为由 policyVersion 决定（ADR-118 #9 的已知限制：内容改了、
      // 回环策略没改时 digest 变而行为不变）。把 policyVersion 写进 label，让报告可追溯到实际跑的策略。
      subjectVersionLabel: `${version.label}|lb:${subject.policyVersion}`.slice(0, 64),
      fixturesDigest: sha256(texts),
      caseFilter: opts.cases,
      runId: opts.runId ?? newRunId(opts.entity),
    });
  } catch (e) {
    err(`SUITE_INVALID ${e instanceof Error ? e.message : String(e)}`);
    return none(EXIT.SUITE_INVALID);
  }
  const reportsDir = join(suiteDir, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `${report.runId}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  out(formatSummary(report));
  out(`  report ${show(opts.repoRoot, reportPath)}`);
  return { exitCode: reportFailed(report) ? EXIT.CASE_FAILED_OR_ERROR : EXIT.OK, report, reportPath };
}

/** cases.jsonl 引用了但磁盘上不存在的夹具名（交给运行器记 case error，E2）。 */
export function readReferencedFixtures(suiteDir: string): string[] {
  const p = join(suiteDir, "cases.jsonl");
  if (!existsSync(p)) return [];
  const refs = new Set<string>();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    try {
      const j = JSON.parse(line) as { fixtureRefs?: unknown };
      if (Array.isArray(j.fixtureRefs)) for (const r of j.fixtureRefs) if (typeof r === "string") refs.add(r);
    } catch {
      /* 行级格式错误由 validateWorkEvalSuiteBundle 报 */
    }
  }
  return [...refs];
}

export interface ParsedEvalArgs {
  entity?: string;
  baseline: boolean;
  cases: string[];
  evalsRoot?: string;
  version?: string;
  /** EV05：`--all-skills` 批量评测全部 Skill（与 --entity/--case/--version 互斥）。 */
  allSkills: boolean;
  /** EV05：`--write-back` 把门状态回写目录（仅 --all-skills）。 */
  writeBack: boolean;
  /** 不认识的参数；调用方须以 SUITE_INVALID 拒绝，而不是静默忽略。 */
  unknown: string[];
}

export function parseEvalArgs(argv: readonly string[]): ParsedEvalArgs {
  const r: ParsedEvalArgs = { baseline: false, cases: [], allSkills: false, writeBack: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--entity") r.entity = argv[++i];
    else if (a === "--baseline") r.baseline = true;
    else if (a === "--all-skills") r.allSkills = true;
    else if (a === "--write-back") r.writeBack = true;
    else if (a === "--case") r.cases.push(...(argv[++i] ?? "").split(",").filter(Boolean));
    else if (a === "--evals-root") r.evalsRoot = argv[++i];
    else if (a === "--version") r.version = argv[++i] ?? "";
    else r.unknown.push(a ?? "");
  }
  return r;
}
