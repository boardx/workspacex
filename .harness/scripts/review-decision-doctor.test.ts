// review-decision-doctor.test.ts — H3A-037 的真实 git IO 反证。
//
// `resolveGitFactsGivenHead` 是 doctor 层唯一含真实 git 子进程调用的函数
// （`git cat-file -e` + `git merge-base --is-ancestor`）。这里用一次性临时
// git 仓库（mkdtemp，测试结束 rmSync 清理）构造提交序列反证——绝不对本仓库
// 真实 git 历史做任何写操作，同任务书要求"不要在测试里污染本仓库的真实
// git 历史"、同 workflow-event-doctor.test.ts 对
// `countContentChangeCommitsAfterFirst` 的反证先例。
//
// `resolveHeadShaForTaskId` 今天恒定返回 `null`（H3A-037 的设计缺口，见
// review-decision-doctor.ts 文件头注释）——这里只反证"它确实恒定返回 null"
// 这一个事实，不是"忘了测"；核心的 git 领先判断逻辑（head 是否领先于
// exact_sha）用真实临时仓库反证，不是只靠 fixture 单测替代（同任务书第 5
// 条要求：能安全反证的部分做真实反证）。
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sh } from "./lib/sh";
import { resolveHeadShaForTaskId, resolveGitFactsGivenHead } from "./review-decision-doctor";

const tempDirs: string[] = [];

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "h3a037-stale-gate-"));
  tempDirs.push(dir);
  sh("git init -q", dir);
  sh('git config user.email "test@example.com"', dir);
  sh('git config user.name "H3A-037 Test"', dir);
  return dir;
}

function commitFile(repo: string, relPath: string, content: string, message: string): string {
  writeFileSync(join(repo, relPath), content, "utf8");
  const addResult = sh(`git add ${JSON.stringify(relPath)}`, repo);
  expect(addResult.code).toBe(0);
  const commitResult = sh(`git commit -q -m ${JSON.stringify(message)}`, repo);
  expect(commitResult.code).toBe(0);
  return sh("git rev-parse HEAD", repo).stdout.trim();
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveHeadShaForTaskId (H3A-037，设计缺口)", () => {
  it("恒定返回 null——本仓库今天没有 task_id→ref 的机械映射机制", () => {
    expect(resolveHeadShaForTaskId("TSK-658-canvas-01")).toBeNull();
    expect(resolveHeadShaForTaskId("anything-else")).toBeNull();
  });
});

describe("resolveGitFactsGivenHead (H3A-037，真实 git IO)", () => {
  it("head 就是 exact_sha 本身（没有新 commit）→ exists=true, isAncestor=true（fresh）", () => {
    const repo = makeTempRepo();
    const sha = commitFile(repo, "file.txt", "v1\n", "initial commit");
    const facts = resolveGitFactsGivenHead(sha, sha, repo);
    expect(facts.exactShaExists).toBe(true);
    expect(facts.exactShaIsAncestorOfHead).toBe(true);
  });

  it("head 领先于 exact_sha（审完之后又有新 commit）→ isAncestor=true（stale：head advanced）", () => {
    const repo = makeTempRepo();
    const reviewedSha = commitFile(repo, "file.txt", "v1\n", "commit reviewed at this SHA");
    commitFile(repo, "file.txt", "v2\n", "new commit after review");
    const headSha = sh("git rev-parse HEAD", repo).stdout.trim();
    const facts = resolveGitFactsGivenHead(reviewedSha, headSha, repo);
    expect(facts.exactShaExists).toBe(true);
    expect(facts.exactShaIsAncestorOfHead).toBe(true); // 领先=祖先关系仍成立，但 sha!==head，doctor 层判 STALE-HEAD-ADVANCED
  });

  it("exact_sha 在当前历史里不可达（伪造/被 rewrite）→ exists=false, isAncestor=null", () => {
    const repo = makeTempRepo();
    const headSha = commitFile(repo, "file.txt", "v1\n", "initial commit");
    const facts = resolveGitFactsGivenHead("0000000000000000000000000000000000ffff", headSha, repo);
    expect(facts.exactShaExists).toBe(false);
    expect(facts.exactShaIsAncestorOfHead).toBeNull();
  });

  it("exact_sha 存在但不是 head 的祖先（历史分叉：两条独立分支各自提交）→ isAncestor=false", () => {
    const repo = makeTempRepo();
    commitFile(repo, "base.txt", "base\n", "base commit");
    sh("git checkout -q -b side-branch", repo);
    const sideSha = commitFile(repo, "side.txt", "side\n", "side branch commit");
    sh("git checkout -q -", repo); // 切回原分支
    const mainSha = commitFile(repo, "main.txt", "main\n", "main branch commit, diverged from side");
    const facts = resolveGitFactsGivenHead(sideSha, mainSha, repo);
    expect(facts.exactShaExists).toBe(true);
    expect(facts.exactShaIsAncestorOfHead).toBe(false);
  });
});
