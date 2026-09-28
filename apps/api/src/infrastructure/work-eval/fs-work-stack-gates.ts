/**
 * EV03 `pnpm run lint:work-stack-gates [--entity <ID>] [--json]` 的 IO 侧（04-eval-gates R3.5–3.6）。
 *
 * 发现：`skills/**\/SKILL.md` 中 frontmatter 带 `metadata.work` 的包 = 被判实体（仓内包均为官方实体）。
 * 为每个实体收集 G0 身份材料（WORK-STACK-320-LIST.md、实体文档、包间重复）、当前版本 digest
 * （与 `harness eval` 同算法：`skillPackageVersion`）、套件与报告，交给
 * `application/work-eval/work-stack-gates.ts` 判定，打印逐门结果并产出 `WorkGateStatus`。
 *
 * 退出码：任一实体 G0–G4 fail → 1；参数错误 → 2；否则 0。G5 不影响退出码（EV05 才据此改通道）。
 * 回写（`--write-back`）属 EV04，本命令不接受。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { validateWorkEvalSuiteBundle, WorkEvalReport, type WorkGateStatus } from "@repo/contracts/work-eval";
import {
  formatGateJudgement,
  judgeWorkStackGates,
  type GateJudgement,
  type GateSubject,
  type GateSuiteState,
} from "../../application/work-eval/work-stack-gates";
import { readReferencedFixtures, skillPackageVersion, walk } from "./fs-eval-suite";

export interface WorkStackGatesOptions {
  repoRoot: string;
  /** 默认 `<repoRoot>/evals/work-stack` */
  evalsRoot?: string;
  entity?: string;
  json?: boolean;
  now?: Date;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export interface WorkStackGatesResult {
  exitCode: number;
  judgements: GateJudgement[];
  statuses: WorkGateStatus[];
}

const posix = (p: string) => p.split(sep).join("/");
const ENTITY_DOC_DIRS = { S: "skills", W: "workflows", D: "digital-humans" } as const;

interface Discovered {
  skillMd: string;
  stableId: string;
  manifest: unknown;
  manifestError: string | null;
}

function frontmatter(text: string): string | null {
  return /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? null;
}

/** 找出所有声明了 `metadata.work` 的 SKILL.md（YAML 解析失败但看得出写了 work: 的也算，交 G0 判红）。 */
export function discoverWorkSkillPackages(repoRoot: string): Discovered[] {
  const found: Discovered[] = [];
  for (const p of walk(join(repoRoot, "skills")).filter(f => f.endsWith("SKILL.md")).sort()) {
    const fm = frontmatter(readFileSync(p, "utf8"));
    if (fm === null) continue;
    let doc: unknown;
    try {
      doc = parseYaml(fm);
    } catch (e) {
      if (/^metadata:\s*$[\s\S]*^\s+work:/m.test(fm)) {
        const id = /stableId:\s*["']?([SWD]\d{3})/.exec(fm)?.[1] ?? "UNKNOWN";
        found.push({ skillMd: p, stableId: id, manifest: undefined, manifestError: `frontmatter YAML unparseable: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` });
      }
      continue;
    }
    const meta = (doc as { metadata?: unknown } | null)?.metadata;
    if (!meta || typeof meta !== "object" || !("work" in meta)) continue;
    const work = (meta as { work: unknown }).work;
    const id = work && typeof work === "object" && typeof (work as { stableId?: unknown }).stableId === "string" ? (work as { stableId: string }).stableId : "UNKNOWN";
    found.push({ skillMd: p, stableId: id, manifest: work, manifestError: null });
  }
  return found;
}

function listedIds(repoRoot: string): Set<string> {
  const p = join(repoRoot, "requirements/work-stack-v2/WORK-STACK-320-LIST.md");
  if (!existsSync(p)) return new Set();
  return new Set([...readFileSync(p, "utf8").matchAll(/\|\s*([SWD]\d{3})\s*\|/g)].map(m => m[1]!));
}

function entityDocs(repoRoot: string, stableId: string): string[] {
  const sub = ENTITY_DOC_DIRS[stableId[0] as keyof typeof ENTITY_DOC_DIRS];
  if (!sub) return [];
  const dir = join(repoRoot, "requirements/work-stack-v2", sub);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(n => n.startsWith(`${stableId}-`) && n.endsWith(".md")).map(n => `requirements/work-stack-v2/${sub}/${n}`);
}

function loadSuite(suiteDir: string, stableId: string): GateSuiteState {
  if (!existsSync(join(suiteDir, "suite.json"))) return { state: "missing" };
  let suiteJson: unknown;
  try {
    suiteJson = JSON.parse(readFileSync(join(suiteDir, "suite.json"), "utf8"));
  } catch {
    return { state: "invalid", issues: ["suite.json (root): invalid JSON"] };
  }
  const fixturesDir = join(suiteDir, "fixtures");
  const fixtureFiles = walk(fixturesDir).map(p => posix(relative(fixturesDir, p))).sort();
  const bundle = validateWorkEvalSuiteBundle({
    dirName: stableId,
    suiteJson,
    casesJsonl: existsSync(join(suiteDir, "cases.jsonl")) ? readFileSync(join(suiteDir, "cases.jsonl"), "utf8") : "",
    // 缺失的夹具引用由 G2 判（E2），不让它把整个套件判成「无套件」。
    fixtureFiles: [...fixtureFiles, ...readReferencedFixtures(suiteDir)],
    hasGrader: existsSync(join(suiteDir, "grader.ts")),
    hasCalibrationDir: existsSync(join(suiteDir, "calibration")),
  });
  if (!bundle.ok) return { state: "invalid", issues: bundle.issues.map(i => `${i.file} ${i.path}: ${i.message}`) };
  return { state: "ok", suite: bundle.suite, cases: bundle.cases, fixtureFiles, hasCalibrationDir: existsSync(join(suiteDir, "calibration")) };
}

function loadReports(repoRoot: string, suiteDir: string, warn: (l: string) => void): GateSubject["reports"] {
  const dir = join(suiteDir, "reports");
  if (!existsSync(dir)) return [];
  const out: { path: string; report: WorkEvalReport }[] = [];
  for (const n of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
    const p = join(dir, n);
    const rel = posix(relative(repoRoot, p));
    try {
      const parsed = WorkEvalReport.safeParse(JSON.parse(readFileSync(p, "utf8")));
      if (parsed.success) out.push({ path: rel.startsWith("..") ? `evals/work-stack/${posix(relative(join(suiteDir, ".."), p))}` : rel, report: parsed.data });
      else warn(`  ignored report ${rel}: not a WorkEvalReport`);
    } catch {
      warn(`  ignored report ${rel}: invalid JSON`);
    }
  }
  return out;
}

export function collectGateSubjects(repoRoot: string, evalsRoot = join(repoRoot, "evals/work-stack"), warn: (l: string) => void = () => {}): GateSubject[] {
  const packages = discoverWorkSkillPackages(repoRoot);
  const listed = listedIds(repoRoot);
  return packages.map(pkg => {
    const suiteDir = join(evalsRoot, pkg.stableId);
    return {
      stableId: pkg.stableId,
      kind: "skill" as const,
      sourcePath: posix(relative(repoRoot, pkg.skillMd)),
      manifest: pkg.manifest,
      manifestError: pkg.manifestError,
      versionDigest: skillPackageVersion(pkg.skillMd).digest,
      identity: {
        inList: listed.has(pkg.stableId),
        entityDocs: entityDocs(repoRoot, pkg.stableId),
        duplicatePackages: packages.filter(o => o !== pkg && o.stableId === pkg.stableId).map(o => posix(relative(repoRoot, o.skillMd))),
      },
      suite: /^[SWD]\d{3}$/.test(pkg.stableId) ? loadSuite(suiteDir, pkg.stableId) : { state: "missing" as const },
      reports: /^[SWD]\d{3}$/.test(pkg.stableId) ? loadReports(repoRoot, suiteDir, warn) : [],
    };
  });
}

export function runWorkStackGates(opts: WorkStackGatesOptions): WorkStackGatesResult {
  const out = opts.out ?? (l => process.stdout.write(`${l}\n`));
  const err = opts.err ?? (l => process.stderr.write(`${l}\n`));
  let subjects = collectGateSubjects(opts.repoRoot, opts.evalsRoot, err);
  if (opts.entity) {
    subjects = subjects.filter(s => s.stableId === opts.entity);
    if (subjects.length === 0) {
      err(`✗ ${opts.entity}: no SKILL.md with metadata.work declares this stableId (G0 fail: entity not found)`);
      return { exitCode: 1, judgements: [], statuses: [] };
    }
  }
  const judgements = subjects.map(s => judgeWorkStackGates(s, opts.now));
  const statuses = judgements.flatMap(j => (j.status ? [j.status] : []));
  if (opts.json) out(JSON.stringify({ statuses, judgements: judgements.map(j => ({ stableId: j.stableId, sourcePath: j.sourcePath, gates: j.gates })) }, null, 2));
  else for (const j of judgements) for (const l of formatGateJudgement(j)) out(l);
  const failed = judgements.filter(j => j.failedG0toG4);
  if (failed.length) {
    err(`✗ work-stack gates: G0–G4 failed for ${failed.map(j => j.stableId).join(", ")}`);
    return { exitCode: 1, judgements, statuses };
  }
  if (!opts.json) out(`✓ work-stack gates: ${judgements.length} entities with metadata.work, G0–G4 all pass`);
  return { exitCode: 0, judgements, statuses };
}

export function parseGateArgs(argv: readonly string[]): { entity?: string; json: boolean; unknown: string[] } {
  const r: { entity?: string; json: boolean; unknown: string[] } = { json: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--entity") r.entity = argv[++i];
    else if (a === "--json") r.json = true;
    else if (a === "--") continue;
    else r.unknown.push(a ?? "");
  }
  return r;
}
