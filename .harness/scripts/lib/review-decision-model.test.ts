// review-decision-model.test.ts — H3A-036 的反证。纯函数，喂构造的输入。
import { describe, expect, it } from "vitest";
import { validateReviewDecision, looksLikeReviewDecision, REVIEW_DECISION_TEMPLATE_ID } from "./review-decision-model";

function validReview(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...overrides,
  };
}

describe("validateReviewDecision (H3A-036)", () => {
  it("合法实例（Proposal §10.5 示例形状）→ 通过", () => {
    const result = validateReviewDecision(validReview(), "test.yaml");
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.value?.instance_id).toBe("RVW-pr000-abcdef1");
    expect(result.value?.decision).toBe("approve");
  });

  it("template_id 不对 → 拒绝", () => {
    const result = validateReviewDecision(validReview({ template_id: "TPL-OTHER-001" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("template_id"))).toBe(true);
  });

  it("template_version 不是 ≥1 的整数 → 拒绝", () => {
    const result = validateReviewDecision(validReview({ template_version: 0 }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("template_version"))).toBe(true);
  });

  it("instance_id 缺失 → 拒绝", () => {
    const result = validateReviewDecision(validReview({ instance_id: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("instance_id"))).toBe(true);
  });

  it("task_id 缺失 → 拒绝", () => {
    const result = validateReviewDecision(validReview({ task_id: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("task_id"))).toBe(true);
  });

  it("reviewer 缺失 → 拒绝（完成契约要求 reviewer 完整）", () => {
    const result = validateReviewDecision(validReview({ reviewer: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("reviewer"))).toBe(true);
  });

  it("producer 缺失 → 拒绝（完成契约要求 producer 完整）", () => {
    const result = validateReviewDecision(validReview({ producer: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("producer"))).toBe(true);
  });

  it("reviewer === producer（同 actor 自产自签）→ 拒绝", () => {
    const result = validateReviewDecision(
      validReview({ reviewer: "coord-canvas", producer: "coord-canvas" }),
      "test.yaml",
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("reviewer 和 producer 相同"))).toBe(true);
  });

  it("reviewer/producer 都缺失时不重复报 dual-identity（各自的非空校验已经覆盖）", () => {
    const result = validateReviewDecision(validReview({ reviewer: "", producer: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("reviewer 和 producer 相同"))).toBe(false);
  });

  it("exact_sha 缺失 → 拒绝（revision 是完成契约要求的三要素之一）", () => {
    const result = validateReviewDecision(validReview({ exact_sha: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("exact_sha"))).toBe(true);
  });

  it("decision 不在枚举内 → 拒绝", () => {
    const result = validateReviewDecision(validReview({ decision: "maybe" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("decision"))).toBe(true);
  });

  it("decision = request_changes（推断枚举值）→ 通过", () => {
    const result = validateReviewDecision(validReview({ decision: "request_changes" }), "test.yaml");
    expect(result.ok).toBe(true);
  });

  it("decision = reject（推断枚举值）→ 通过", () => {
    const result = validateReviewDecision(validReview({ decision: "reject" }), "test.yaml");
    expect(result.ok).toBe(true);
  });

  it("evidence_refs 为空数组 → 拒绝（完成契约要求 evidence 完整，空 evidence 不算完整）", () => {
    const result = validateReviewDecision(validReview({ evidence_refs: [] }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("evidence_refs"))).toBe(true);
  });

  it("evidence_refs 缺失 → 拒绝", () => {
    const result = validateReviewDecision(validReview({ evidence_refs: undefined }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("evidence_refs"))).toBe(true);
  });

  it("evidence_refs 元素不是字符串 → 拒绝", () => {
    const result = validateReviewDecision(validReview({ evidence_refs: [123] }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("evidence_refs"))).toBe(true);
  });

  it("findings 缺失 → 拒绝（字段本身必须存在）", () => {
    const result = validateReviewDecision(validReview({ findings: undefined }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("findings"))).toBe(true);
  });

  it("findings 不是数组 → 拒绝", () => {
    const result = validateReviewDecision(validReview({ findings: "not-an-array" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("findings"))).toBe(true);
  });

  it("raw 不是对象 → 拒绝", () => {
    const result = validateReviewDecision("not-an-object", "test.yaml");
    expect(result.ok).toBe(false);
  });

  it("raw 是数组 → 拒绝", () => {
    const result = validateReviewDecision([1, 2, 3], "test.yaml");
    expect(result.ok).toBe(false);
  });

  it("累积上报：多个字段同时非法时全部列出，不 fail-fast", () => {
    const result = validateReviewDecision(
      validReview({ reviewer: "", producer: "", exact_sha: "", evidence_refs: [] }),
      "test.yaml",
    );
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(4);
  });
});

describe("looksLikeReviewDecision (H3A-036)", () => {
  it("template_id 匹配 → true", () => {
    expect(looksLikeReviewDecision(validReview())).toBe(true);
  });

  it("template_id 不匹配 → false", () => {
    expect(looksLikeReviewDecision({ template_id: "TPL-OTHER-001" })).toBe(false);
  });

  it("非对象 → false", () => {
    expect(looksLikeReviewDecision(null)).toBe(false);
    expect(looksLikeReviewDecision("string")).toBe(false);
  });
});
