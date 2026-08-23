#!/usr/bin/env -S pnpm exec tsx
/**
 * F13（issue #1875）R3-步骤2：从历史 git log 尽力回填可识别的 rev-uiux 评审记录。
 *
 * 做法（R4-E1 明确要求）：
 *   - 只在 commit subject 命中评审关键词（"uiux"/"fidelity"/"保真度"/"rev-uiux"/"评分"/
 *     "score("/"D1".."D10" 等）时才考虑这条 commit。
 *   - 命中后尝试用一组启发式正则解析出「总分/满分/评审对象/issue 号」。解析成功记
 *     backfill_status="parsed"；解析不出结构化字段的，记 backfill_status="unresolved"，
 *     notes 里原样保留 commit subject，不猜不编。
 *   - 幂等：用 dedupeKey 跳过已经在日志里的记录，重复跑不会堆出重复行。
 *
 * 用法：
 *   pnpm exec tsx .harness/scripts/uiux-review-log-backfill.ts            # 执行回填
 *   pnpm exec tsx .harness/scripts/uiux-review-log-backfill.ts --dry-run  # 只打印，不写盘
 */
import { execFileSync } from "node:child_process";
import { appendEntries, dedupeKey, readEntries, UIUX_REVIEW_LOG_PATH, type UiuxReviewLogEntry } from "./uiux-review-log";

const KEYWORDS = ["uiux", "fidelity", "保真度", "rev-uiux", "评分", "score(", "十维", "十项"];

interface RawCommit {
  sha: string;
  date: string;
  subject: string;
}

function collectCandidateCommits(): RawCommit[] {
  const grepArgs = KEYWORDS.flatMap((k) => ["--grep", k, "-i"]).filter((_, i, arr) => arr[i] !== "-i" || true);
  // git log --all -i --grep=k1 --grep=k2 ... (OR semantics by default across --grep flags)
  const args = ["log", "--all", "--pretty=format:%H%x1f%ad%x1f%s", "--date=short", "-i"];
  for (const k of KEYWORDS) args.push(`--grep=${k}`);
  const out = execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const [sha, date, subject] = line.split("\x1f");
      return { sha, date, subject };
    });
}

function extractIssueRef(subject: string): string | null {
  const m = subject.match(/#(\d+)/);
  return m ? `#${m[1]}` : null;
}

function extractScopeTarget(subject: string): string {
  const m = subject.match(/^\w+\(([\w.-]+)\):/);
  return m ? m[1] : "unclassified";
}

/**
 * 启发式提分：按从最具体到最泛化的顺序尝试。返回 null 表示这条命中了关键词，
 * 但格式不足以可靠解析出总分——按 R4-E1 应该标 unresolved，不能硬凑。
 */
function extractScore(subject: string): { total: number; scale: number; target: string } | null {
  let m = subject.match(/V-([A-Z])\s*=\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
  if (m) return { total: Number(m[2]), scale: Number(m[3]), target: `core-loop:V-${m[1]}` };

  m = subject.match(/track\s*([A-Z])[^=]*=\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+)/i);
  if (m) return { total: Number(m[2]), scale: Number(m[3]), target: `core-loop:track-${m[1].toUpperCase()}` };

  m = subject.match(/([A-Za-z一-龥]+)\s*组\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
  if (m) return { total: Number(m[2]), scale: Number(m[3]), target: `chat:${m[1]}组` };

  // 通用兜底：subject 里同时出现「评分类关键词」+「X/Y」形态，且关键词紧邻分数
  // （避免匹配「10 分制，10/10 才能发」这类门槛陈述——那不是一次评审结果）。
  const scoreVerbs = ["重评", "独立评分", "首次评分", "登记", "复核确认", "判回", "基线", "确认"];
  const hasVerb = scoreVerbs.some((v) => subject.includes(v));
  if (hasVerb) {
    m = subject.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
    if (m) return { total: Number(m[1]), scale: Number(m[2]), target: extractScopeTarget(subject) };
  }

  return null;
}

export function buildEntriesFromGitLog(commits: RawCommit[]): UiuxReviewLogEntry[] {
  return commits.map((c): UiuxReviewLogEntry => {
    const issueRef = extractIssueRef(c.subject);
    const score = extractScore(c.subject);
    const prRef = c.subject.match(/\(#(\d+)\)\s*$/)?.[1];

    if (!score) {
      return {
        review_target: extractScopeTarget(c.subject),
        review_date: c.date,
        rubric: "unknown",
        dimensions: null,
        total_score: NaN as unknown as number, // 占位，unresolved 记录不应被下游当真分使用
        scale: 10,
        deductions: null,
        issue_ref: issueRef,
        pr_ref: prRef ? `#${prRef}` : null,
        commit_sha: c.sha,
        source: "git-log-backfill",
        backfill_status: "unresolved",
        notes: `命中评审关键词但无法可靠解析出总分。原始 commit subject: "${c.subject}"`,
      };
    }

    return {
      review_target: score.target,
      review_date: c.date,
      rubric: "unknown",
      dimensions: null, // commit subject 级别拿不到十维明细，如实留空，不编造
      total_score: score.total,
      scale: score.scale,
      deductions: null,
      issue_ref: issueRef,
      pr_ref: prRef ? `#${prRef}` : null,
      commit_sha: c.sha,
      source: "git-log-backfill",
      backfill_status: "parsed",
      notes: `回填自 commit subject: "${c.subject}"`,
    };
  });
}

/**
 * unresolved 记录里 total_score 用 NaN 占位是为了不让下游统计脚本误把它当成真分数
 * （NaN 传进任何算术都会显式变成 NaN，不会被平均值悄悄吃掉）；写盘前换成 0 并在
 * schema 里用 backfill_status=unresolved 标注「这不是真分数」，schema 校验只要求
 * total_score 是数字、在 [0, scale] 区间，0 满足这个约束。
 */
function finalizeForWrite(entries: UiuxReviewLogEntry[]): UiuxReviewLogEntry[] {
  return entries.map((e) => (Number.isNaN(e.total_score) ? { ...e, total_score: 0 } : e));
}

/**
 * `git log --all` 会同时命中「squash 合并进 main 的那个 commit」和「PR 里被 squash 掉的原始
 * commit」（分支引用还在的话）——同一次评审因此可能出现两条一模一样的记录，只是 sha 不同。
 * 按「评审对象 + 日期 + 总分 + 满分」这个内容级 key 去重，优先保留带 pr_ref 的那条
 * （squash 到 main 的那条更接近“权威落盘”版本），避免同一次评审在统计里被算两次。
 */
export function dedupeByContent(entries: UiuxReviewLogEntry[]): UiuxReviewLogEntry[] {
  const byContent = new Map<string, UiuxReviewLogEntry>();
  const passthrough: UiuxReviewLogEntry[] = [];
  for (const e of entries) {
    // 只对 parsed 记录做内容级去重——unresolved 记录的 total_score 是占位值（0），
    // 拿它去重会把「不同 commit、都解析不出分数」的两条不同记录错误地合并成一条，
    // 丢掉本该如实保留的「未能回填」痕迹。
    if (e.backfill_status !== "parsed") {
      passthrough.push(e);
      continue;
    }
    const key = [e.review_target, e.review_date, e.total_score, e.scale].join("|");
    const prev = byContent.get(key);
    if (!prev || (!prev.pr_ref && e.pr_ref)) {
      byContent.set(key, e);
    }
  }
  return [...byContent.values(), ...passthrough];
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const commits = collectCandidateCommits();
  const candidates = dedupeByContent(finalizeForWrite(buildEntriesFromGitLog(commits)));

  const existing = readEntries(UIUX_REVIEW_LOG_PATH);
  const existingKeys = new Set(existing.map(dedupeKey));
  const fresh = candidates.filter((e) => !existingKeys.has(dedupeKey(e)));

  const parsed = fresh.filter((e) => e.backfill_status === "parsed").length;
  const unresolved = fresh.filter((e) => e.backfill_status === "unresolved").length;

  console.log(`候选 commit：${commits.length} 条`);
  console.log(`新增记录：${fresh.length} 条（parsed=${parsed}, unresolved=${unresolved}）`);
  console.log(`已存在（跳过）：${candidates.length - fresh.length} 条`);

  if (dryRun) {
    console.log("--dry-run：不写盘。");
    return;
  }
  if (fresh.length === 0) {
    console.log("没有新记录需要写入。");
    return;
  }
  appendEntries(fresh, UIUX_REVIEW_LOG_PATH);
  console.log(`已追加到 ${UIUX_REVIEW_LOG_PATH}`);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
