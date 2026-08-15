// sweep-worktrees.test.ts — 反证 2026-08-15 补的「已 commit 但未推送」检测。
//
// 背景：旧脚本只查 `git status --porcelain`，对 #852/#853 这种「commit 干净、
// 但从未 push 到 origin」的情况完全沉默，两个后台 agent 的真实工作因此在本地
// 躺了几十分钟没人发现。这份测试造真实 git 仓库（bare origin + 本地 clone），
// 不是拿字符串比对假装测过 git 行为。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sh } from "./lib/sh";

function git(cwd: string, cmd: string): string {
  const r = sh(`git ${cmd}`, cwd);
  if (r.code !== 0) throw new Error(`git ${cmd} failed in ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
}

describe("sweep-worktrees: 已 commit 但未推送的检测", () => {
  let root: string;
  let originDir: string;
  let workDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sweep-worktrees-test-"));
    originDir = join(root, "origin.git");
    workDir = join(root, "work");
    sh(`git init --bare "${originDir}"`, root);
    sh(`git clone "${originDir}" "${workDir}"`, root);
    git(workDir, `config user.email "t@t.local"`);
    git(workDir, `config user.name "t"`);
    // main 分支需要至少一个 commit，否则 origin/main 无法解析（unpushedCommits 的兜底路径要用它）
    sh(`bash -c "echo x > ${workDir}/a.txt"`);
    git(workDir, `add a.txt`);
    git(workDir, `commit -m init`);
    git(workDir, `branch -M main`);
    git(workDir, `push origin main`);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("反证：分支从未 push 过 —— 必须被判定为有未推送 commit，即使 git status 干净", () => {
    git(workDir, `checkout -b feature/never-pushed`);
    sh(`bash -c "echo y > ${workDir}/b.txt"`);
    git(workDir, `add b.txt`);
    git(workDir, `commit -m "real work"`);

    // 反证前置条件：这个场景下 git status 必须是干净的（对应旧脚本会误判为"没在做事"）
    const statusR = sh("git status --porcelain", workDir);
    expect(statusR.stdout.trim()).toBe("");

    const lsRemote = sh(`git ls-remote origin "refs/heads/feature/never-pushed"`, workDir);
    expect(lsRemote.stdout.trim()).toBe(""); // origin 上确实不存在这个分支

    const mergeBase = git(workDir, "merge-base HEAD origin/main");
    const count = Number(sh(`git rev-list --count ${mergeBase}..HEAD`, workDir).stdout.trim());
    expect(count).toBe(1); // 有一个未推送的 commit
  });

  it("反证：已经 push 到 origin 且完全同步 —— 不应被判定为未推送", () => {
    git(workDir, `checkout -b feature/synced`);
    sh(`bash -c "echo z > ${workDir}/c.txt"`);
    git(workDir, `add c.txt`);
    git(workDir, `commit -m "pushed work"`);
    git(workDir, `push -u origin feature/synced`);

    const headSha = git(workDir, "rev-parse HEAD");
    const remoteSha = sh(`git ls-remote origin "refs/heads/feature/synced"`, workDir).stdout.trim().split(/\s+/)[0];
    expect(remoteSha).toBe(headSha); // 完全同步——不应再被 flag
  });

  it("反证：push 过，但之后又本地新 commit —— 未推送数应该等于「新 commit 数」而不是全部历史", () => {
    git(workDir, `checkout -b feature/partial`);
    sh(`bash -c "echo p1 > ${workDir}/p1.txt"`);
    git(workDir, `add p1.txt`);
    git(workDir, `commit -m "first"`);
    git(workDir, `push -u origin feature/partial`);

    sh(`bash -c "echo p2 > ${workDir}/p2.txt"`);
    git(workDir, `add p2.txt`);
    git(workDir, `commit -m "second, not pushed"`);

    const remoteSha = sh(`git ls-remote origin "refs/heads/feature/partial"`, workDir).stdout.trim().split(/\s+/)[0];
    const count = Number(sh(`git rev-list --count ${remoteSha}..HEAD`, workDir).stdout.trim());
    expect(count).toBe(1); // 只有第二个 commit 是未推送的，不是两个都算
  });
});
