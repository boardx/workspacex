// evidence-integration.ts — 「passing 的实现是否已经在 main 上」的**单一判据**（完成定义第 6 条）。
//
// 背景（#1557）：这条判据此前只活在 doctor.ts 的 checkMergedToMain 里，而 sync-github.ts
// 关 issue 的判据只有 `status === "passing"`——本地 verify 一转 passing，issue 就被关掉，
// 完全不看实现有没有合进 main。两次真实发生（#1487–#1489 背后没有任何 PR；#1553–#1555
// 在 PR 开出来之前就被关了），且 #526 定的「不自动重开」让它永远不会自纠。
// 同一个事实（实现在不在 main 上）两处各判一套，正是 AGENTS.md 点名的漂移模式，
// 所以把判据抽到这里，doctor 与 sync 共用，不再各自诠释。
//
// 判据本身沿用 doctor 的定义：**证据日志（verify --sprint 落盘的 <Fxx>.verify.log）
// 最后一次被改动的那个 commit，是 origin/main 的祖先。** 用证据日志而不是任意代码文件，
// 因为它是 verify 门控写出来的，必然与那次通过对应。
import { join, relative } from "node:path";
import { REPO_ROOT, sprintDir } from "./paths";
import { sh } from "./sh";
import type { Feature } from "./types";

/** 证据日志相对仓库根的路径；feature 没有 sprint 时无法定位（--sprint 门控覆盖不到它）。 */
export function evidenceLogRelPath(phaseId: string, f: Pick<Feature, "id" | "sprint">): string | null {
  if (!f.sprint) return null;
  return relative(REPO_ROOT, join(sprintDir(phaseId, f.sprint), "evidence", `${f.id}.verify.log`));
}

/** 证据日志最后一次被改动的 commit；不在 git 历史里（从未 commit / 只在磁盘上）返回 null。 */
export function evidenceLogCommit(rel: string, repoRoot = REPO_ROOT): string | null {
  const r = sh(`git log -1 --format=%H -- ${JSON.stringify(rel)}`, repoRoot);
  const out = r.stdout.trim();
  return r.code === 0 && /^[0-9a-f]{40}$/.test(out) ? out : null;
}

/** commit 是否已在 main 的血统里（`git merge-base --is-ancestor`）。
 *  拿不到 mainRef（没 fetch / 浅克隆）时 git 非 0 ⇒ false：fail-closed，宁可少关一个 issue。 */
export function isCommitOnMain(commit: string, repoRoot = REPO_ROOT, mainRef = "origin/main"): boolean {
  return sh(`git merge-base --is-ancestor ${JSON.stringify(commit)} ${JSON.stringify(mainRef)}`, repoRoot).code === 0;
}

/**
 * doctor 用的判定：实现已在 main 上 ⇒ 已集成。
 * pull_request 事件是唯一的合并前例外：actions/checkout 检出的是 GitHub 合成的 merge ref，
 * 证据 commit 是那个 HEAD 的祖先就算数。push / 本地一律只认 main。
 */
export function isEvidenceCommitIntegrated(
  commit: string,
  repoRoot = REPO_ROOT,
  eventName = process.env.GITHUB_EVENT_NAME,
  mainRef = "origin/main",
  checkedOutRef = "HEAD",
): boolean {
  if (isCommitOnMain(commit, repoRoot, mainRef)) return true;
  return eventName === "pull_request" && isCommitOnMain(commit, repoRoot, checkedOutRef);
}

/** 一个 feature 的集成事实，供 sync 的 close 决策与 doctor 的反向检查消费。 */
export type IntegrationFacts =
  | { kind: "on-main"; commit: string; rel: string }
  | { kind: "not-on-main"; commit: string; rel: string }
  | { kind: "uncommitted"; rel: string }
  | { kind: "no-sprint" };

/** 只认 main（不含 pull_request 例外）：sync 关 issue 是「已合入」的事后动作，没有合并前时点。 */
export function evidenceIntegration(
  phaseId: string,
  f: Pick<Feature, "id" | "sprint">,
  repoRoot = REPO_ROOT,
  mainRef = "origin/main",
): IntegrationFacts {
  const rel = evidenceLogRelPath(phaseId, f);
  if (rel === null) return { kind: "no-sprint" };
  const commit = evidenceLogCommit(rel, repoRoot);
  if (commit === null) return { kind: "uncommitted", rel };
  return isCommitOnMain(commit, repoRoot, mainRef)
    ? { kind: "on-main", commit, rel }
    : { kind: "not-on-main", commit, rel };
}

/** 给人看的一句话：为什么这条 feature 还不能算「已合入 main」。 */
export function describeNotIntegrated(facts: Exclude<IntegrationFacts, { kind: "on-main" }>): string {
  switch (facts.kind) {
    case "no-sprint":
      return "feature 没有 sprint 归属，证据日志无法定位";
    case "uncommitted":
      return `证据日志 ${facts.rel} 不在 git 历史里（verify 落盘了但从未 commit）`;
    case "not-on-main":
      return `证据日志所在 commit ${facts.commit.slice(0, 8)} 还不在 origin/main 的血统里（先 git fetch origin main 排除本地过期；仍不在就是 PR 尚未合入）`;
  }
}
