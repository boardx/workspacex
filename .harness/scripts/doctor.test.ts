import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEvidenceCommitIntegrated, judgeClosedIssueDrift } from "./doctor";
import { sh } from "./lib/sh";

const tempDirs: string[] = [];

function makeRepo(): { repo: string; main: string; evidence: string; merge: string } {
  const repo = mkdtempSync(join(tmpdir(), "doctor-pr-merge-ref-"));
  tempDirs.push(repo);
  sh("git init -q", repo);
  sh('git config user.email "test@example.com"', repo);
  sh('git config user.name "Doctor Test"', repo);
  writeFileSync(join(repo, "state.txt"), "main\n", "utf8");
  sh("git add state.txt && git commit -q -m main", repo);
  const main = sh("git rev-parse HEAD", repo).stdout.trim();
  sh("git branch origin-main", repo);
  sh("git checkout -q -b feature", repo);
  writeFileSync(join(repo, "evidence.txt"), "verified\n", "utf8");
  sh("git add evidence.txt && git commit -q -m evidence", repo);
  const evidence = sh("git rev-parse HEAD", repo).stdout.trim();
  sh("git checkout -q -b pr-merge origin-main", repo);
  sh("git merge -q --no-ff feature -m merge-ref", repo);
  const merge = sh("git rev-parse HEAD", repo).stdout.trim();
  return { repo, main, evidence, merge };
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("isEvidenceCommitIntegrated", () => {
  it("pull_request CI accepts evidence contained by the checked-out merge ref", () => {
    const { repo, evidence } = makeRepo();
    expect(isEvidenceCommitIntegrated(evidence, repo, "pull_request", "origin-main", "HEAD")).toBe(true);
  });

  it("push and local runs still require evidence to be on origin/main", () => {
    const { repo, evidence } = makeRepo();
    expect(isEvidenceCommitIntegrated(evidence, repo, "push", "origin-main", "HEAD")).toBe(false);
    expect(isEvidenceCommitIntegrated(evidence, repo, "workflow_dispatch", "origin-main", "HEAD")).toBe(false);
  });
});

describe("judgeClosedIssueDrift (#1557 反向检查：issue 已关、feature 未 passing)", () => {
  it("flags a CLOSED issue whose feature is still in_progress", () => {
    const msg = judgeClosedIssueDrift({ id: "F34", status: "in_progress" }, { number: 87, state: "CLOSED", stateReason: "COMPLETED" });
    expect(msg).toContain("F34");
    expect(msg).toContain("#87");
    expect(msg).toContain("in_progress");
  });

  it("is silent for passing features, open issues, missing issues, and NOT_PLANNED closures", () => {
    expect(judgeClosedIssueDrift({ id: "F1", status: "passing" }, { number: 1, state: "CLOSED", stateReason: "COMPLETED" })).toBeNull();
    expect(judgeClosedIssueDrift({ id: "F1", status: "in_progress" }, { number: 1, state: "OPEN" })).toBeNull();
    expect(judgeClosedIssueDrift({ id: "F1", status: "in_progress" }, undefined)).toBeNull();
    expect(judgeClosedIssueDrift({ id: "F1", status: "not_started" }, { number: 1, state: "CLOSED", stateReason: "NOT_PLANNED" })).toBeNull();
  });

  it("treats a missing stateReason (older gh) as a completed closure, i.e. still drift", () => {
    expect(judgeClosedIssueDrift({ id: "F1", status: "blocked" }, { number: 1, state: "CLOSED" })).not.toBeNull();
  });
});
