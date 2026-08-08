// review-decision-stale-gate.test.ts — H3A-037 的反证。纯函数，喂构造的
// "已经解析好的 git 事实"（同 workflow-event-append-only-gate.test.ts 对
// checkAppendOnly 的 fixture 风格：判定逻辑本身不需要真实 git 子进程，
// 真实 git IO 的反证在 review-decision-doctor.test.ts 里对 doctor 层的
// git 事实解析函数单独做）。
import { describe, expect, it } from "vitest";
import { checkReviewDecisionStale, type ReviewDecisionHeadFact } from "./review-decision-stale-gate";
import { REVIEW_DECISION_TEMPLATE_ID, type ReviewDecision } from "./review-decision-model";

function reviewDecision(overrides: Partial<ReviewDecision> = {}): ReviewDecision {
  return {
    template_id: REVIEW_DECISION_TEMPLATE_ID,
    template_version: 1,
    instance_id: "RVW-pr000-abcdef1",
    task_id: "TSK-658-canvas-01",
    reviewer: "canvas-verifier",
    producer: "coord-canvas",
    exact_sha: "abcdef123456",
    decision: "approve",
    evidence_refs: ["EVD-canvas-unit-0042"],
    findings: [],
    sourceFile: ".harness/reviews/RVW-pr000-abcdef1.yaml",
    ...overrides,
  };
}

function fact(overrides: Partial<ReviewDecisionHeadFact> = {}): ReviewDecisionHeadFact {
  return {
    reviewDecision: reviewDecision(),
    resolvedHeadSha: null,
    exactShaExists: false,
    exactShaIsAncestorOfHead: null,
    ...overrides,
  };
}

describe("checkReviewDecisionStale (H3A-037)", () => {
  it("resolvedHeadSha 为 null（今天的真实状态：无 task_id→ref 映射机制）→ WARN UNKNOWN，不是 FAIL", () => {
    const findings = checkReviewDecisionStale([fact()]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A037-REF-UNRESOLVED");
    expect(findings[0]!.severity).toBe("WARN");
  });

  it("干净通过：head 就是 exact_sha 本身（没有新 commit）→ 无 finding", () => {
    const findings = checkReviewDecisionStale([
      fact({
        reviewDecision: reviewDecision({ exact_sha: "abc123" }),
        resolvedHeadSha: "abc123",
        exactShaExists: true,
        exactShaIsAncestorOfHead: true, // 一个 commit 是自己的祖先，git merge-base --is-ancestor 对相等 SHA 返回 true
      }),
    ]);
    expect(findings).toEqual([]);
  });

  it("stale：head 领先于 exact_sha（有新 commit）→ FAIL H3A037-STALE-HEAD-ADVANCED", () => {
    const findings = checkReviewDecisionStale([
      fact({
        reviewDecision: reviewDecision({ exact_sha: "abc111" }),
        resolvedHeadSha: "def222",
        exactShaExists: true,
        exactShaIsAncestorOfHead: true,
      }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A037-STALE-HEAD-ADVANCED");
    expect(findings[0]!.severity).toBe("FAIL");
  });

  it("stale：exact_sha 在当前历史里不可达（被 rewrite/force-push）→ FAIL H3A037-EXACT-SHA-UNREACHABLE", () => {
    const findings = checkReviewDecisionStale([
      fact({
        reviewDecision: reviewDecision({ exact_sha: "ghost000" }),
        resolvedHeadSha: "def222",
        exactShaExists: false,
        exactShaIsAncestorOfHead: null,
      }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A037-EXACT-SHA-UNREACHABLE");
    expect(findings[0]!.severity).toBe("FAIL");
  });

  it("stale：exact_sha 存在但不是 head 的祖先（历史分叉）→ FAIL H3A037-STALE-HISTORY-DIVERGED", () => {
    const findings = checkReviewDecisionStale([
      fact({
        reviewDecision: reviewDecision({ exact_sha: "sidebranch1" }),
        resolvedHeadSha: "mainhead2",
        exactShaExists: true,
        exactShaIsAncestorOfHead: false,
      }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A037-STALE-HISTORY-DIVERGED");
    expect(findings[0]!.severity).toBe("FAIL");
  });

  it("累积上报：多份实例分别产生各自的 finding，不 fail-fast", () => {
    const findings = checkReviewDecisionStale([
      fact({ reviewDecision: reviewDecision({ instance_id: "RVW-a", exact_sha: "a1" }), resolvedHeadSha: "a1", exactShaExists: true, exactShaIsAncestorOfHead: true }),
      fact({ reviewDecision: reviewDecision({ instance_id: "RVW-b", exact_sha: "b1" }), resolvedHeadSha: "b2", exactShaExists: true, exactShaIsAncestorOfHead: true }),
      fact({ reviewDecision: reviewDecision({ instance_id: "RVW-c" }) }),
    ]);
    expect(findings).toHaveLength(2); // RVW-a 干净通过（不产生 finding），RVW-b stale，RVW-c UNKNOWN
    expect(findings.map((f) => f.code).sort()).toEqual(["H3A037-REF-UNRESOLVED", "H3A037-STALE-HEAD-ADVANCED"]);
  });

  it("空输入 → 空输出（今天 0 份真实实例时的真实调用形状）", () => {
    expect(checkReviewDecisionStale([])).toEqual([]);
  });
});
