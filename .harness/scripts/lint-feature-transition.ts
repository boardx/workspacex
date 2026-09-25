// lint-feature-transition.ts —— #400 的迁移门执行器。
//
//   pnpm harness lint-feature-transition --base <ref> [--head <ref>] [--repo <dir>] [--json]
//
// 判定逻辑全在 lib/feature-transition.ts（纯函数，可单测）；本文件只做三件事：
// ① 从两个 ref 里把 feature 清单和证据日志读出来（`git show`，不切工作树、不写一个字节）；
// ② 把"哪些文件在这次改动里变过"作为读日志的过滤器——只判迁移，不审全树；
// ③ 打印 + 决定退出码。
//
// ⚠ 为什么必须给两个 ref，而不是像其余 lint 那样扫当前树：本门要抓的两类破坏
// （手改 passing 指向旧日志 / 改写日志正文重算指纹）在最终树上都是自洽的，
// 只有 base→head 的差分里才有破绽。详见 lib/feature-transition.ts 头注。
import { sh } from "./lib/sh";
import { log, die } from "./lib/log";
import { req, type Args } from "./lib/args";
import { REPO_ROOT } from "./lib/paths";
import {
  judgeFeatureTransitions,
  type CommitOracle,
  type FeatureSnapshot,
  type PhaseDiff,
} from "./lib/feature-transition";

const VERIFY_LOG_RE = /\.verify\.log$/;

/** `phases/<phaseDir>/feature_list.json` 或同目录的 `feature_list.archive.json`。 */
const FEATURE_LIST_RE = /^phases\/([^/]+)\/feature_list(\.archive)?\.json$/;

interface RawFeature {
  id?: unknown;
  status?: unknown;
  owner?: unknown;
  evidence?: unknown;
  sprint?: unknown;
}

type Git = (cmd: string) => { code: number; out: string };

function gitIn(repoRoot: string): Git {
  return (cmd) => {
    const r = sh(`git ${cmd}`, repoRoot);
    return { code: r.code, out: r.stdout };
  };
}

/** ref 下某个路径的内容；不存在返回 null（`git show` 对缺失路径退非 0）。 */
function showFile(git: Git, ref: string, path: string): string | null {
  // 路径用引号包住：仓库里出现带空格的目录名时仍然安全。
  const r = git(`show ${ref}:"${path}"`);
  return r.code === 0 ? r.out : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** 一个 ref 下、一个 phase 目录的 live + archive 合并视图（与 features.ts 的 loadFeatureList 同序）。 */
function readPhaseFeatures(git: Git, ref: string, phaseDir: string): RawFeature[] {
  const out: RawFeature[] = [];
  for (const name of ["feature_list.archive.json", "feature_list.json"]) {
    const body = showFile(git, ref, `phases/${phaseDir}/${name}`);
    if (body === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      die(`${ref}:phases/${phaseDir}/${name} 不是合法 JSON，无法判定迁移`);
    }
    const features = (parsed as { features?: unknown }).features;
    if (!Array.isArray(features)) die(`${ref}:phases/${phaseDir}/${name} 结构非法：features 不是数组`);
    out.push(...(features as RawFeature[]));
  }
  return out;
}

/** 该 ref 下存在 feature_list 的全部 phase 目录名。 */
function phaseDirsAt(git: Git, ref: string): Set<string> {
  const r = git(`ls-tree -r --name-only ${ref} -- phases`);
  if (r.code !== 0) die(`读不到 ${ref} 的 phases/ 目录树——ref 不可达？`);
  const dirs = new Set<string>();
  for (const line of r.out.split("\n")) {
    const m = FEATURE_LIST_RE.exec(line.trim());
    if (m) dirs.add(m[1]!);
  }
  return dirs;
}

/** 某个 ref 下全部 `*.verify.log` 的 路径 → blob OID。一次 ls-tree 拿全，不读内容。 */
function evidenceBlobsAt(git: Git, ref: string): Map<string, string> {
  const r = git(`ls-tree -r ${ref} -- phases`);
  if (r.code !== 0) die(`读不到 ${ref} 的 phases/ 目录树——ref 不可达？`);
  const out = new Map<string, string>();
  for (const line of r.out.split("\n")) {
    // 每行形如 `<mode> blob <oid>\t<path>`
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const path = line.slice(tab + 1).trim();
    if (!VERIFY_LOG_RE.test(path)) continue;
    const oid = line.slice(0, tab).trim().split(/\s+/)[2];
    if (oid) out.set(path, oid);
  }
  return out;
}

/** evidence 指针指向的日志在仓库里的真实路径；指针非标准或没有 sprint 时返回 null。 */
function evidenceLogPath(phaseDir: string, f: RawFeature): string | null {
  const id = str(f.id);
  const sprint = str(f.sprint);
  const evidence = str(f.evidence);
  if (!id || !sprint || !evidence) return null;
  if (!evidence.startsWith(`evidence/${id}.verify.log @ `)) return null;
  return `phases/${phaseDir}/sprints/sprint-${sprint}/evidence/${id}.verify.log`;
}

export function lintFeatureTransition(args: Args): void {
  const baseRef = req(args, "base");
  const headRef = args.opts["head"] ?? "HEAD";
  const asJson = args.flags["json"] === true;
  // --repo 只给反证套件用（把门指向临时 fixture 仓库）；日常一律默认本仓。
  const git = gitIn(args.opts["repo"] ?? REPO_ROOT);

  const baseSha = git(`rev-parse --verify ${baseRef}^{commit}`);
  const headSha = git(`rev-parse --verify ${headRef}^{commit}`);
  if (baseSha.code !== 0) die(`--base ${baseRef} 解析不到 commit（浅克隆取不到 base？CI 里请用 fetch-depth: 0）`);
  if (headSha.code !== 0) die(`--head ${headRef} 解析不到 commit`);
  const base = baseSha.out.trim();
  const head = headSha.out.trim();

  // 本次改动碰过的文件。它只用来省掉"给几百条没动过的 passing feature 各跑两次
  // git show"——判定本身不依赖它（没动过的 feature 在判定里也会被 changed() 跳过）。
  const diff = git(`diff --name-only ${base} ${head}`);
  if (diff.code !== 0) die(`git diff ${base}..${head} 失败——两个 ref 之间没有共同历史？`);
  const touched = new Set(diff.out.split("\n").map((s) => s.trim()).filter(Boolean));

  const oracle: CommitOracle = {
    exists: (sha) => git(`cat-file -e ${sha}^{commit}`).code === 0,
    isAncestorOfHead: (sha) => git(`merge-base --is-ancestor ${sha} ${head}`).code === 0,
  };

  const blobs = { base: evidenceBlobsAt(git, base), head: evidenceBlobsAt(git, head) };
  // blob OID → 路径列表。逐字节相同的两份日志落进同一个桶——"复制品"判定的全部依据。
  const headEvidenceBlobs = new Map<string, string[]>();
  for (const [path, oid] of blobs.head) {
    const list = headEvidenceBlobs.get(oid);
    if (list) list.push(path);
    else headEvidenceBlobs.set(oid, [path]);
  }

  const phaseDirs = new Set([...phaseDirsAt(git, base), ...phaseDirsAt(git, head)]);
  const diffs: PhaseDiff[] = [];

  for (const phaseDir of [...phaseDirs].sort()) {
    const sides: Record<"base" | "head", FeatureSnapshot[]> = { base: [], head: [] };
    for (const side of ["base", "head"] as const) {
      const ref = side === "base" ? base : head;
      for (const raw of readPhaseFeatures(git, ref, phaseDir)) {
        const id = str(raw.id);
        if (!id) continue; // 结构坏掉的条目交给 validate-fl / doctor，这道门不越界
        const logPath = evidenceLogPath(phaseDir, raw);
        // 日志只在它可能影响判定时才读：指针存在、且该日志在本次改动里变过。
        // 两侧都没变的日志内容必然相同，传 null 不改变 changed() 的结论。
        const evidenceLog = logPath && touched.has(logPath) ? showFile(git, ref, logPath) : null;
        sides[side].push({
          id,
          status: str(raw.status) ?? "",
          owner: str(raw.owner),
          evidence: str(raw.evidence),
          sprint: str(raw.sprint),
          evidenceLog,
          logPath,
          evidenceBlob: logPath ? blobs[side].get(logPath) ?? null : null,
        });
      }
    }
    diffs.push({ phaseDir, base: sides.base, head: sides.head });
  }

  const verdict = judgeFeatureTransitions({ phases: diffs, headEvidenceBlobs }, oracle);

  if (asJson) {
    console.log(JSON.stringify({ base, head, ...verdict }, null, 2));
  } else {
    log.step(`feature 迁移门：${base.slice(0, 12)} → ${head.slice(0, 12)}（${phaseDirs.size} 个 phase 目录）`);
    for (const n of verdict.notes) log.warn(`${n.phaseDir}/${n.featureId}: ${n.message}`);
    for (const f of verdict.findings) log.err(`[${f.rule}] ${f.phaseDir}/${f.featureId}: ${f.message}`);
    if (verdict.findings.length === 0) {
      log.ok(
        verdict.examined === 0
          ? "本次改动没有 feature 状态迁移，无需判定"
          : `${verdict.examined} 条 feature 迁移的出处均成立`
      );
    }
  }

  if (verdict.findings.length > 0) process.exit(1);
}
