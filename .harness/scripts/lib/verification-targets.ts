/**
 * verification-targets.ts —— 「verification 声称要跑的测试文件，必须真的存在」
 *
 * ## 它堵的洞（#965，PR #961 事后取证，exact head 1115421a）
 *
 * F150–F152 六条权威 verification 命令**全部**指向不存在的测试文件（实现落地时
 * 用了别的路径），`evidence` 全空——而那个 PR 照常合入并关掉三个 issue。
 *
 * 为什么既有的门控没拦住：
 *
 *   · `lint-verification-can-fail.mjs` **故意**不查测试文件是否存在，理由写在它
 *     自己的注释里：「测试文件还没写 = 该 feature 还没实现，这条 verification
 *     应当红，而它确实会红（vitest 收集不到文件 exit 1）」。对 `not_started` 的
 *     feature 这个取舍是对的：清单里先写下将来要建的测试路径是本仓的正常用法。
 *   · 但那句括号里的保证**只对单路径命令成立**。`vitest run` 的路径参数是
 *     **子串过滤器**不是文件名：`vitest run 存在.test.ts 不存在.test.ts` 至少匹配
 *     到一个文件就正常跑完 **exit 0**——声称跑了两个，实际跑了一个，退出码看不出
 *     差别。`verify.ts` 只看退出码，于是「声称的测试文件不存在」可以一路绿到 passing。
 *     （实测见 verification-targets.test.ts ①。）
 *   · `doctor.ts` 查 evidence 的形态、指纹、是否入 main，但从不回头问一句
 *     「这条 passing 当初声称要跑的那些测试文件，今天还在不在」。实测本仓今天
 *     就有 3 个 passing feature 的声称测试文件不存在（F11 / F122 / F166）。
 *
 * ⇒ 判据必须是**独立于退出码**的一句话：一条 verification 命令声称要跑的文件，
 *   必须真的在仓库里。这是「指向物存在性」，不是「命令跑没跑绿」。
 *
 * ## 单一事实源
 *
 * 「一条命令的指向物是哪个操作数」这件事只在 `lint-verification-can-fail.mjs` 的
 * `classify()` 里声明过一次（它按形态登记，每种形态都写清了指向物是什么）。
 * 本文件**复用**它的 `checks` 里的 `test-file` 项，不另起一套命令解析——
 * 同一事实声明在两处，本仓已经漂移过五次（AGENTS.md 硬约束）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error —— .mjs 无类型声明，故意直接引（同 validate-fl.ts 的既有用法）
import { classify, workspacePackages } from "../lint-verification-can-fail.mjs";
import { REPO_ROOT } from "./paths";

/** classify() 返回的存在性检查项；这里只关心 `test-file` 那一种。 */
interface ClassifyCheck {
  type: string;
  pkg?: string;
  cwd?: string;
  path?: string;
}

/** 一条 verification 命令声称要跑的一个指向物（仓库根相对路径）。 */
export interface DeclaredTarget {
  /** 原始 verification 命令，报错时原样回显——不回显命令，人看不出该改哪一条。 */
  readonly command: string;
  /** 仓库根相对路径；可能是文件，也可能是目录（pytest 允许 `pytest tests/golden`）。 */
  readonly path: string;
}

export interface FeatureLike {
  readonly id: string;
  readonly status?: string;
  readonly verification?: readonly string[] | null;
}

/**
 * 从命令的操作数串里挑出「指向物」token。
 *
 * 丢掉标志位（pytest 的 `-q`、`--deselect`，vitest 的 `--config` 之类），
 * 并把 pytest 的 node-id 砍回文件路径（`tests/x.py::test_y` → `tests/x.py`）——
 * node-id 的后半段是函数名，不是路径，拿它去查文件必然假红。
 */
function operandTokens(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/\s+/)
    .filter((t) => t !== "" && !t.startsWith("-"))
    .map((t) => t.split("::")[0] ?? "")
    .filter((t) => t !== "");
}

/**
 * 一条 verification 命令声称要跑的全部指向物。
 *
 * 归类不出形态（`classify` 返回 null）时返回空数组：那是
 * `lint-verification-can-fail` 的「未登记形态」判红职责，不在本门控的边界里，
 * 这里跟着报一遍只会让同一个问题红两次、指向两份修法。
 */
export function declaredTargets(command: string, root: string = REPO_ROOT): DeclaredTarget[] {
  const cmd = String(command).trim();
  const cls = classify(cmd) as { checks?: ClassifyCheck[] } | null;
  if (!cls?.checks) return [];
  const pkgs = workspacePackages(root) as Map<string, { dir: string }>;
  const out: DeclaredTarget[] = [];
  for (const chk of cls.checks) {
    if (chk.type !== "test-file") continue;
    // 指向物路径的基准目录：vitest 形态相对包目录，pytest 形态相对 `cd` 的那个目录。
    const base = chk.pkg !== undefined ? pkgs.get(chk.pkg)?.dir : chk.cwd;
    // 包不存在 / 基准目录未知 ⇒ 已由 lint 的 [包不存在] 判红，这里不重复报。
    if (base === undefined) continue;
    for (const token of operandTokens(chk.path)) {
      out.push({ command: cmd, path: join(base, token) });
    }
  }
  return out;
}

export interface TargetScanOptions {
  readonly root?: string;
  /** 存在性判据，可注入——反证套件用它模拟「文件不存在」而不必真的删文件。 */
  readonly exists?: (absPath: string) => boolean;
}

/** 一个 feature 的 verification 里，声称要跑却不存在的指向物（去重，保持首次出现顺序）。 */
export function missingVerificationTargets(
  feature: FeatureLike,
  { root = REPO_ROOT, exists = existsSync }: TargetScanOptions = {},
): DeclaredTarget[] {
  const missing: DeclaredTarget[] = [];
  const seen = new Set<string>();
  for (const cmd of feature.verification ?? []) {
    for (const target of declaredTargets(String(cmd), root)) {
      if (exists(join(root, target.path))) continue;
      const key = `${target.command}\u0000${target.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      missing.push(target);
    }
  }
  return missing;
}

/** 人话化的一条报错正文，verify.ts 与 doctor.ts 共用，不各写一份措辞。 */
export function describeMissingTargets(featureId: string, missing: readonly DeclaredTarget[]): string {
  const lines = missing.map((m) => `    · ${m.path}\n      ⟵ $ ${m.command}`);
  return (
    `${featureId} 的 verification 声称要跑的测试文件不存在（${missing.length} 处）：\n` +
    `${lines.join("\n")}\n` +
    `    声称跑了而文件不在 = 那条命令验的是空气；多路径 vitest 命令在这种情况下\n` +
    `    仍会 exit 0（子串过滤器至少命中一个就算跑过），退出码看不出差别。\n` +
    `    要么把命令改成已提交的真实测试路径，要么把那些测试真的写出来。`
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * 棘轮：存量豁免名单
 *
 * 同 #1136 `feature-evidence-allowlist.json` / #539 `rewrite-coverage-allowlist.json`
 * 的既有模式，理由也一样：裸把存量全判红 = 「上线即全红」= 等于没有门。
 * 今天已存在的缺口快照进名单（仍然通过，但打印「存量豁免，待清理」），
 * **今天之后**新增的一律 FAIL；名单只许变短，陈旧条目会被判红要求删掉。
 * ──────────────────────────────────────────────────────────────────────────── */

/** `<phaseId>/<featureId>` —— 与 feature-evidence-allowlist 同型。 */
export type TargetAllowlistKey = string;

export function targetAllowlistKey(phaseId: string, featureId: string): TargetAllowlistKey {
  return `${phaseId}/${featureId}`;
}

export interface PhaseVerificationTargets {
  readonly phaseId: string;
  readonly features: readonly FeatureLike[];
}

export interface TargetGap {
  readonly key: TargetAllowlistKey;
  readonly phaseId: string;
  readonly featureId: string;
  readonly missing: readonly DeclaredTarget[];
}

export interface TargetRatchetVerdict {
  /** 需要判红的缺口（passing 且指向物缺失，且不在名单里）。 */
  readonly newGaps: readonly TargetGap[];
  /** 在名单里、仍然合法豁免的条目。 */
  readonly grandfathered: readonly TargetAllowlistKey[];
}

/**
 * 主判定：只判 `passing`。
 *
 * 非 passing 的 feature 指向一个将来才会建的测试文件是本仓的正常用法
 * （见 `lint-verification-can-fail.mjs` 里同一取舍的说明），在那里判红会把
 * 「还没实现」误判成「清单写错」。而一条 feature **已经 passing** 还指不着自己
 * 声称跑过的测试文件，只有两种可能：当初就没跑，或者跑完被改名了——两种都是断链。
 */
export function judgeVerificationTargetRatchet(
  phases: readonly PhaseVerificationTargets[],
  allowlist: readonly TargetAllowlistKey[],
  options: TargetScanOptions = {},
): TargetRatchetVerdict {
  const allow = new Set(allowlist);
  const newGaps: TargetGap[] = [];
  const grandfathered: TargetAllowlistKey[] = [];

  for (const { phaseId, features } of phases) {
    for (const f of features) {
      if (f.status !== "passing") continue;
      const missing = missingVerificationTargets(f, options);
      if (missing.length === 0) continue;
      const key = targetAllowlistKey(phaseId, f.id);
      if (allow.has(key)) grandfathered.push(key);
      else newGaps.push({ key, phaseId, featureId: f.id, missing });
    }
  }
  return { newGaps, grandfathered };
}

/**
 * 棘轮体检：名单里已经不需要豁免的条目（指向物补齐了 / 命令改对了 / 不再 passing）
 * 必须删掉，否则它会一直遮住未来的同类回归。
 */
export function staleVerificationTargetEntries(
  phases: readonly PhaseVerificationTargets[],
  allowlist: readonly TargetAllowlistKey[],
  options: TargetScanOptions = {},
): TargetAllowlistKey[] {
  const { newGaps, grandfathered } = judgeVerificationTargetRatchet(phases, allowlist, options);
  const stillNeeded = new Set<TargetAllowlistKey>([...newGaps.map((g) => g.key), ...grandfathered]);
  return allowlist.filter((key) => !stillNeeded.has(key));
}
