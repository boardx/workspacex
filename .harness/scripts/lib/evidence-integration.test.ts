import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sh } from "./sh";
import {
  describeNotIntegrated,
  evidenceIntegration,
  evidenceLogCommit,
  evidenceLogRelPath,
  isCommitOnMain,
} from "./evidence-integration";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

const REL = "phases/phase-01-x/sprints/sprint-01/evidence/F01.verify.log";

/** origin-main 上有一条 commit；feature 分支上多一条只改证据日志的 commit。 */
function makeRepo(): { repo: string; mainCommit: string; evidenceCommit: string } {
  const repo = mkdtempSync(join(tmpdir(), "evidence-integration-"));
  tempDirs.push(repo);
  sh("git init -q", repo);
  sh('git config user.email "test@example.com"', repo);
  sh('git config user.name "Integration Test"', repo);
  writeFileSync(join(repo, "state.txt"), "main\n", "utf8");
  sh("git add state.txt && git commit -q -m main", repo);
  const mainCommit = sh("git rev-parse HEAD", repo).stdout.trim();
  sh("git branch origin-main", repo);
  sh("git checkout -q -b feature", repo);
  mkdirSync(join(repo, REL, ".."), { recursive: true });
  writeFileSync(join(repo, REL), "[exit 0]\n", "utf8");
  sh(`git add ${JSON.stringify(REL)} && git commit -q -m evidence`, repo);
  const evidenceCommit = sh("git rev-parse HEAD", repo).stdout.trim();
  return { repo, mainCommit, evidenceCommit };
}

describe("evidenceLogRelPath", () => {
  it("needs a sprint to locate the log", () => {
    expect(evidenceLogRelPath("01", { id: "F01", sprint: null })).toBeNull();
  });
});

describe("evidenceLogCommit", () => {
  it("returns the last commit touching the log, and null when the log was never committed", () => {
    const { repo, evidenceCommit } = makeRepo();
    expect(evidenceLogCommit(REL, repo)).toBe(evidenceCommit);
    expect(evidenceLogCommit("phases/nowhere/F99.verify.log", repo)).toBeNull();
    // 只在磁盘上、未 commit 的日志同样是 null——"verify 落盘了但从没 push"正是 #1557 的形态
    writeFileSync(join(repo, "untracked.verify.log"), "[exit 0]\n", "utf8");
    expect(evidenceLogCommit("untracked.verify.log", repo)).toBeNull();
  });
});

describe("isCommitOnMain", () => {
  it("is true for an ancestor of main and false for a branch-only commit", () => {
    const { repo, mainCommit, evidenceCommit } = makeRepo();
    expect(isCommitOnMain(mainCommit, repo, "origin-main")).toBe(true);
    expect(isCommitOnMain(evidenceCommit, repo, "origin-main")).toBe(false);
  });

  it("fails closed when the main ref does not exist (no fetch / shallow clone)", () => {
    const { repo, mainCommit } = makeRepo();
    expect(isCommitOnMain(mainCommit, repo, "refs/remotes/nope/main")).toBe(false);
  });
});

describe("evidenceIntegration (the single predicate shared by doctor and sync, #1557)", () => {
  it("branch-only evidence → not-on-main; after fast-forwarding main it becomes on-main", () => {
    const { repo, evidenceCommit } = makeRepo();
    // evidenceLogRelPath 依赖真实 phases/ 目录，这里直接注入 rel 所对应的 sprint 结构不可行——
    // 所以通过 evidenceLogCommit + isCommitOnMain 组合验证同一条路径的两个分支。
    expect(isCommitOnMain(evidenceLogCommit(REL, repo)!, repo, "origin-main")).toBe(false);
    sh("git branch -f origin-main feature", repo);
    expect(isCommitOnMain(evidenceCommit, repo, "origin-main")).toBe(true);
  });

  it("no sprint → no-sprint (never closes an issue on a feature the --sprint gate cannot reach)", () => {
    expect(evidenceIntegration("01", { id: "F01", sprint: null })).toEqual({ kind: "no-sprint" });
  });

  it("describeNotIntegrated explains every non-integrated kind in one sentence", () => {
    expect(describeNotIntegrated({ kind: "no-sprint" })).toContain("sprint");
    expect(describeNotIntegrated({ kind: "uncommitted", rel: REL })).toContain(REL);
    expect(describeNotIntegrated({ kind: "not-on-main", commit: "c".repeat(40), rel: REL })).toContain("cccccccc");
  });
});
