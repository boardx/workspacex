// verify-risk.ts — 验证风险分档（ADR-106 batch-1/6，#1274；判据于 #1332 重做）。
//
// ⚠ 2026-08-15（#1332）判据整体重做，原因是原实现**在真实数据上基本失效**：
// 它读 feature 的静态元数据（`area` + `verification` 命令字符串）做子串匹配，
// 但真实 feature 的 verification 长这样——
//     F01 kernel-auth -> ['pnpm --filter api run typecheck', ...]
// 永远不含 "migration" / "contracts/" 字样。实测对全部 304 个真实 feature 跑一遍，
// 7 个 marker 里 4 个**零命中**（含 `migration`，而仓库有 122 个真实 migration 文件），
// 唯一大量命中的 `auth` 全靠 `area` 字段（且子串会误伤 `requirement-author`）。
// 后果双向错：真改 migration/契约的改动漏放行走 quick；area=kernel-auth 的一行
// 注释改动永远跑最贵的 release。
//
// 现在的判据：**这次改动实际碰了哪些文件**（相对 origin/main 分支点的 diff，含
// 未提交与未跟踪文件），对路径做 glob 匹配。风险是"改动"的属性，不是"feature"的
// 属性——同一次改动里的所有 feature 因此得到同一个档位，这是刻意的。
//
// fail-closed：拿不到改动清单（不在 git 里 / 解析不到 base）一律判 high_risk。
// 不确定就按最贵的验证走，不是相反。
import { sh } from "./sh";
import type { VerificationConfig } from "./config";

export type RiskLevel = "small" | "standard" | "high_risk";

/**
 * 把 glob 转成 RegExp。只支持两种通配，语义明确、可审计：
 *   `**` → 任意字符（可跨 `/`）
 *   `*`  → 任意字符但不跨 `/`
 * 其余字符全部按字面转义——避免 `.` 之类被当成正则元字符，那正是原实现"子串匹配"
 * 一类的隐式行为，出问题时没人看得出来。
 */
export function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

export function matchesAnyPattern(path: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(path));
}

export interface ChangedFiles {
  /** 相对 base 的改动路径（含未提交、未跟踪）。null = 拿不到（fail-closed 用）。 */
  paths: string[] | null;
  /** 拿不到时的原因，用于日志——不让"判成 high_risk"看起来像正常判定。 */
  reason?: string;
}

/**
 * 收集本次改动涉及的文件：`git diff --name-only <base>`（覆盖已提交 + 未提交）
 * 再并上未跟踪文件（`git ls-files --others --exclude-standard`）。
 *
 * 未跟踪文件必须算进来——**新增**一个 migration 文件时它就是未跟踪状态，漏掉它
 * 等于对"新增高风险文件"这个最典型的场景视而不见。
 */
export function collectChangedFiles(repoRoot?: string): ChangedFiles {
  const base = sh("git merge-base origin/main HEAD", repoRoot);
  if (base.code !== 0 || !base.stdout.trim()) {
    return { paths: null, reason: "解析不到与 origin/main 的 merge-base（未 fetch？分支不基于 main？）" };
  }
  const baseSha = base.stdout.trim();
  const diff = sh(`git diff --name-only ${baseSha}`, repoRoot);
  if (diff.code !== 0) {
    return { paths: null, reason: `git diff 失败：${diff.stderr.trim()}` };
  }
  const untracked = sh("git ls-files --others --exclude-standard", repoRoot);
  const all = [
    ...diff.stdout.split("\n"),
    ...(untracked.code === 0 ? untracked.stdout.split("\n") : []),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  return { paths: [...new Set(all)].sort() };
}

export interface RiskDecision {
  level: RiskLevel;
  /** 触发 high_risk 的具体文件与命中的 pattern，写进证据日志，便于事后审计。 */
  matched: Array<{ path: string; pattern: string }>;
  /** fail-closed 时的说明；正常判定时为 undefined。 */
  failClosedReason?: string;
}

export function classifyRisk(changed: ChangedFiles, cfg: VerificationConfig): RiskDecision {
  if (changed.paths === null) {
    return { level: "high_risk", matched: [], failClosedReason: changed.reason ?? "改动清单不可得" };
  }
  const matched: Array<{ path: string; pattern: string }> = [];
  for (const path of changed.paths) {
    for (const pattern of cfg.high_risk_paths) {
      if (globToRegExp(pattern).test(path)) {
        matched.push({ path, pattern });
        break;
      }
    }
  }
  if (matched.length > 0) return { level: "high_risk", matched };

  const fallback = cfg.default_profile;
  if (fallback === "small" || fallback === "standard" || fallback === "high_risk") {
    return { level: fallback, matched: [] };
  }
  // 配置非法：宁可报错也不要悄悄退化成某个随意的默认档。
  throw new Error(`harness.config.yaml 的 verification.default_profile 非法: "${fallback}"`);
}

export interface ResolvedProfile {
  level: RiskLevel;
  cmd: string;
  matched: Array<{ path: string; pattern: string }>;
  failClosedReason?: string;
}

export function resolveVerifyProfile(
  changed: ChangedFiles,
  cfg: VerificationConfig,
): ResolvedProfile {
  const decision = classifyRisk(changed, cfg);
  const cmd = cfg.profiles[decision.level];
  if (!cmd) {
    throw new Error(`harness.config.yaml 的 verification.profiles 缺少 "${decision.level}" 档的命令`);
  }
  return { ...decision, cmd };
}
