import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isEvidenceCommitIntegrated,
  judgeClosedIssueDrift,
  judgeDuplicateFeatureIds,
  judgeEvidenceIdMismatch,
  judgePlaceholderIdSurvived,
} from "./doctor";
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

// ── #1094 编号完整性门 ──────────────────────────────────────────────────────
// 这三条是 coord-main 裁决里「机械门」那一半。撞号此前完全没有机械检查：
// 2026-08-12 那次是人工核对发现的，而人工核对不可复制。
describe("judgeDuplicateFeatureIds (#1094 ①：同 phase 内不得重复 id)", () => {
  it("没有重复 → null", () => {
    expect(judgeDuplicateFeatureIds(["F01", "F02", "F1681"])).toBeNull();
  });

  it("🔴 两条 feature 共用一个号 → 点名那个号", () => {
    const msg = judgeDuplicateFeatureIds(["F164", "F168", "F168", "F172"]);
    expect(msg).toContain("F168");
    expect(msg).not.toContain("F164");
  });

  it("🔴 live 与 archive 撞号同样要报（归档只是搬家，号还占着）", () => {
    // 调用方传的是 loadFeatureList 合并后的 id 序列 —— archive 在前、live 在后
    expect(judgeDuplicateFeatureIds(["F07" /* archive */, "F03", "F07" /* live 重新发了一次 */])).toContain("F07");
  });
});

describe("judgeEvidenceIdMismatch (#1094 ②：evidence 文件名必须与条目 id 一致)", () => {
  it("文件名与 id 一致 → null", () => {
    expect(
      judgeEvidenceIdMismatch({ id: "F172", evidence: "evidence/F172.verify.log @ 2026-08-14T01:32:18.798Z" }),
    ).toBeNull();
  });

  it("🔴 撞号后只改了一半：条目已改叫 F172，evidence 还指着 F168", () => {
    const msg = judgeEvidenceIdMismatch({ id: "F172", evidence: "evidence/F168.verify.log @ 2026-08-14T01:32:18.798Z" });
    expect(msg).toContain("F172");
    expect(msg).toContain("F168");
  });

  it("空 evidence / 非标准形态不归本条管（由 checkPassingEvidence 的棘轮门判）", () => {
    expect(judgeEvidenceIdMismatch({ id: "F01", evidence: "" })).toBeNull();
    expect(judgeEvidenceIdMismatch({ id: "F01", evidence: "跑过了，都绿" })).toBeNull();
    expect(judgeEvidenceIdMismatch({ id: "F01", evidence: "2026-08-14T01:32:18.798Z" })).toBeNull();
  });
});

describe("judgePlaceholderIdSurvived (#1094 ③：占位 id 不得活过 claim)", () => {
  it("🔴 in_progress / passing 还带着占位 id = 绕过了取号那一步", () => {
    expect(judgePlaceholderIdSurvived({ id: "F-TBD-room-invite", status: "in_progress" })).toContain("F-TBD-room-invite");
    expect(judgePlaceholderIdSurvived({ id: "F-TBD-room-invite", status: "passing" })).not.toBeNull();
  });

  it("还没开工的占位条目是正常形态，不报", () => {
    expect(judgePlaceholderIdSurvived({ id: "F-TBD-room-invite", status: "not_started" })).toBeNull();
    expect(judgePlaceholderIdSurvived({ id: "F-TBD-room-invite", status: "blocked" })).toBeNull();
  });

  it("正式编号一律不报", () => {
    expect(judgePlaceholderIdSurvived({ id: "F172", status: "in_progress" })).toBeNull();
  });
});
