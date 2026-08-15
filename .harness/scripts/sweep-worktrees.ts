// sweep-worktrees.ts — 巡检 .claude/worktrees/ 下有未提交改动、或有已提交但未推送
// 到 origin 的 commit 的 worker worktree。
// 修的是这个漏洞：worker session 被打断（额度耗尽/被停止）后，工作留在本地没有
// commit/push/开 PR，且完成通知只显示 "stopped" 无 completion record —— 过去全靠人工
// 偶然去翻 worktree 才发现。coordinator 每次唤醒应先跑这个，而不是等人工发现。
//
// ⚠ 2026-08-15 补的第二种检测（原脚本只查 `git status --porcelain`）：实测抓到两个
// 后台 agent（#852/#853）——git status 干净（改动早已 commit）、但那些 commit 从未
// push 到 origin，分支在 GitHub 上根本不存在，issue 停在 OPEN，没人发现。旧脚本对
// 这种情况完全沉默——它只看"有没有未 commit 的改动"，不看"commit 了但没推"。
// 这一类往往更危险：dirty 改动至少本地 `git status` 一眼能看见；commit 过的东西
// 看起来"完成了"，实际上只完成了一半（commit ≠ 可见——可见要等 push + PR）。
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { WORKTREES_DIR } from "./lib/paths";
import { sh } from "./lib/sh";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

interface WorktreeStatus {
  name: string;
  branch: string;
  changedFiles: number;
  lastEditMinutesAgo: number | null;
}

interface UnpushedStatus {
  name: string;
  branch: string;
  unpushedCommits: number;
  branchExistsOnOrigin: boolean;
  headSubject: string;
}

/**
 * 已提交但未推送的 commit 数。branch 在 origin 上不存在时，用跟 origin/main 的
 * merge-base 兜底数——分支从未推过时 `origin/<branch>` 这个 ref 根本不存在，
 * 不能拿它当基准。用 `git ls-remote` 而不是本地缓存的 remote-tracking ref，
 * 因为本地 ref 可能是几天前 fetch 的陈旧状态，会把"其实已经推了"误判成"没推"。
 */
function unpushedCommits(dir: string, branch: string): UnpushedStatus | null {
  if (branch === "(detached)" || branch === "") return null;
  const lsRemote = sh(`git ls-remote origin "refs/heads/${branch}"`, dir);
  if (lsRemote.code !== 0) return null; // 网络/仓库不可达，跳过而不是误报
  const remoteSha = lsRemote.stdout.trim().split(/\s+/)[0] || null;

  const headR = sh("git rev-parse HEAD", dir);
  if (headR.code !== 0) return null;
  const headSha = headR.stdout.trim();

  let countR;
  if (remoteSha) {
    if (remoteSha === headSha) return null; // 已经同步，没有未推送内容
    countR = sh(`git rev-list --count ${remoteSha}..HEAD`, dir);
  } else {
    // 分支在 origin 上完全不存在——用跟 main 的 merge-base 兜底，数的是「这个分支
    // 独有、main 没有」的 commit 数，不是全部历史。
    const mergeBaseR = sh("git merge-base HEAD origin/main", dir);
    if (mergeBaseR.code !== 0) return null;
    countR = sh(`git rev-list --count ${mergeBaseR.stdout.trim()}..HEAD`, dir);
  }
  if (countR.code !== 0) return null;
  const count = Number(countR.stdout.trim());
  if (!Number.isFinite(count) || count <= 0) return null;

  const subjectR = sh("git log -1 --format=%s", dir);
  return {
    name: "", // 由调用方填
    branch,
    unpushedCommits: count,
    branchExistsOnOrigin: remoteSha !== null,
    headSubject: subjectR.code === 0 ? subjectR.stdout.trim() : "",
  };
}

function maxMtimeMinutesAgo(dir: string, changedPaths: string[]): number | null {
  let latest = 0;
  for (const rel of changedPaths) {
    const p = join(dir, rel);
    try {
      const st = statSync(p);
      if (st.mtimeMs > latest) latest = st.mtimeMs;
    } catch {
      // 文件已删除等情况，跳过
    }
  }
  if (latest === 0) return null;
  return (Date.now() - latest) / 60000;
}

export function sweepWorktrees(args: Args): void {
  const thresholdMinutes = args.opts["threshold-minutes"] ? Number(args.opts["threshold-minutes"]) : 60;

  if (!existsSync(WORKTREES_DIR)) {
    log.info("没有 .claude/worktrees/ 目录，无需巡检。");
    return;
  }

  const entries = readdirSync(WORKTREES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  if (entries.length === 0) {
    log.info("没有活跃的 worktree。");
    return;
  }

  const dirty: WorktreeStatus[] = [];
  const unpushed: UnpushedStatus[] = [];

  for (const entry of entries) {
    const dir = join(WORKTREES_DIR, entry.name);
    const statusR = sh("git status --porcelain", dir);
    if (statusR.code !== 0) continue; // 不是有效 git worktree，跳过
    const lines = statusR.stdout.split("\n").filter(Boolean);

    const branchR = sh("git branch --show-current", dir);
    const branch = branchR.stdout.trim() || "(detached)";

    if (lines.length > 0) {
      const changedPaths = lines.map((l) => l.slice(3).trim().replace(/^"|"$/g, ""));
      const ageMin = maxMtimeMinutesAgo(dir, changedPaths);
      dirty.push({ name: entry.name, branch, changedFiles: lines.length, lastEditMinutesAgo: ageMin });
    }

    // 第二种检测独立于第一种跑——git status 干净不代表没有未推送的 commit。
    const u = unpushedCommits(dir, branch);
    if (u) unpushed.push({ ...u, name: entry.name });
  }

  if (dirty.length === 0 && unpushed.length === 0) {
    log.info(`巡检了 ${entries.length} 个 worktree，全部干净（无未提交改动、无未推送 commit）。`);
    return;
  }

  if (dirty.length > 0) {
    log.info(`发现 ${dirty.length} 个 worktree 有未提交改动：`);
    for (const d of dirty) {
      const ageStr = d.lastEditMinutesAgo == null ? "未知" : `${d.lastEditMinutesAgo.toFixed(0)} 分钟前`;
      const stale = d.lastEditMinutesAgo != null && d.lastEditMinutesAgo > thresholdMinutes;
      const flag = stale ? " ⚠ STALE — 建议 resume 该 agent 或人工检查" : "";
      log.info(`  - ${d.name}（branch=${d.branch}, ${d.changedFiles} 个文件改动, 最后编辑 ${ageStr}）${flag}`);
    }
    const staleCount = dirty.filter(
      (d) => d.lastEditMinutesAgo != null && d.lastEditMinutesAgo > thresholdMinutes
    ).length;
    if (staleCount > 0) {
      log.warn(`${staleCount} 个 worktree 超过 ${thresholdMinutes} 分钟无新编辑仍有未提交改动，建议逐个 resume 对应 agent 确认状态。`);
    }
  }

  if (unpushed.length > 0) {
    log.warn(
      `发现 ${unpushed.length} 个 worktree 有已 commit 但从未推到 origin 的改动——` +
      `这类 git status 是干净的，容易被误判为"没在做事"，实际是真实完成的工作卡在本地看不见：`,
    );
    for (const u of unpushed) {
      const branchState = u.branchExistsOnOrigin ? "origin 上有该分支但落后" : "origin 上不存在该分支";
      log.info(
        `  - ${u.name}（branch=${u.branch}, ${branchState}, ${u.unpushedCommits} 个未推送 commit, ` +
        `HEAD="${u.headSubject}"） ⚠ 建议：rebase 到最新 main、独立复核后 push + 开 PR，不要默认信任旧 commit`,
      );
    }
  }
}
