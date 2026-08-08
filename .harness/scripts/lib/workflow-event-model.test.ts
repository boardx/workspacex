// workflow-event-model.test.ts — H3A-033 的反证。纯函数，喂构造的输入。
import { describe, expect, it } from "vitest";
import { validateWorkflowEvent, looksLikeWorkflowEvent, WORKFLOW_EVENT_TEMPLATE_ID } from "./workflow-event-model";

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    template_id: WORKFLOW_EVENT_TEMPLATE_ID,
    template_version: 1,
    instance_id: "EVT-658-0007",
    task_id: "TSK-658-canvas-01",
    actor: "agt_01HXAMPLE",
    head_sha: "abcdef123456",
    evidence_refs: [],
    ...overrides,
  };
}

function validProgress(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return envelope({
    kind: "progress",
    delta: { implemented: [] },
    blockers: [],
    next_action: { owner_role: "canvas-verifier", action: "verify_exact_sha" },
    ...overrides,
  });
}

function validTaskAssignment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return envelope({
    kind: "task_assignment",
    assignment_ref: "TSK-658-canvas-01",
    ...overrides,
  });
}

function validBlocker(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return envelope({
    kind: "blocker",
    blocked_reason: "缺少 SKL-MOD-CANVAS-001 的最新 Domain Skill 快照",
    next_action: { owner_role: "coord-canvas", action: "refresh_domain_skill" },
    ...overrides,
  });
}

function validTaskResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return envelope({
    kind: "task_result",
    result_summary: "完成 Mermaid→Fabric 稳定身份映射，产物见 evidence_refs",
    ...overrides,
  });
}

describe("validateWorkflowEvent — 公共 envelope 字段", () => {
  it("template_id 不对 → 拒绝", () => {
    const result = validateWorkflowEvent(validProgress({ template_id: "TPL-OTHER-001" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("template_id"))).toBe(true);
  });

  it("kind 不是四类之一 → 拒绝", () => {
    const result = validateWorkflowEvent(envelope({ kind: "unknown_kind" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("kind"))).toBe(true);
  });

  it("actor 缺失 → 拒绝", () => {
    const result = validateWorkflowEvent(validProgress({ actor: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("actor"))).toBe(true);
  });

  it("head_sha 缺失 → 拒绝（exact SHA 是完成契约要求）", () => {
    const result = validateWorkflowEvent(validProgress({ head_sha: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("head_sha"))).toBe(true);
  });

  it("evidence_refs 缺失字段本身 → 拒绝", () => {
    const bad = validProgress();
    delete bad.evidence_refs;
    const result = validateWorkflowEvent(bad, "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("evidence_refs"))).toBe(true);
  });

  it("顶层不是对象 → 拒绝", () => {
    const result = validateWorkflowEvent("not an object", "test.yaml");
    expect(result.ok).toBe(false);
  });
});

describe("validateWorkflowEvent — kind: progress（§10.4 示例原文）", () => {
  it("合法实例 → 通过", () => {
    const result = validateWorkflowEvent(validProgress(), "test.yaml");
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.value?.kind).toBe("progress");
  });

  it("delta.implemented 缺失 → 拒绝", () => {
    const result = validateWorkflowEvent(validProgress({ delta: {} }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("delta.implemented"))).toBe(true);
  });

  it("blockers 字段缺失 → 拒绝", () => {
    const bad = validProgress();
    delete bad.blockers;
    const result = validateWorkflowEvent(bad, "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("blockers"))).toBe(true);
  });

  it("next_action.owner_role 缺失 → 拒绝", () => {
    const result = validateWorkflowEvent(validProgress({ next_action: { action: "verify_exact_sha" } }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("next_action.owner_role"))).toBe(true);
  });
});

describe("validateWorkflowEvent — kind: task_assignment（推断字段，见文件头部注释）", () => {
  it("合法实例 → 通过", () => {
    const result = validateWorkflowEvent(validTaskAssignment(), "test.yaml");
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.value?.kind).toBe("task_assignment");
  });

  it("assignment_ref 缺失 → 拒绝", () => {
    const result = validateWorkflowEvent(validTaskAssignment({ assignment_ref: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("assignment_ref"))).toBe(true);
  });
});

describe("validateWorkflowEvent — kind: blocker（推断字段，见文件头部注释）", () => {
  it("合法实例 → 通过", () => {
    const result = validateWorkflowEvent(validBlocker(), "test.yaml");
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.value?.kind).toBe("blocker");
  });

  it("blocked_reason 缺失 → 拒绝", () => {
    const result = validateWorkflowEvent(validBlocker({ blocked_reason: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("blocked_reason"))).toBe(true);
  });

  it("next_action 缺失 → 拒绝（需要路由到范围外决策的 owner）", () => {
    const bad = validBlocker();
    delete bad.next_action;
    const result = validateWorkflowEvent(bad, "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("next_action"))).toBe(true);
  });
});

describe("validateWorkflowEvent — kind: task_result（推断字段，见文件头部注释）", () => {
  it("合法实例 → 通过", () => {
    const result = validateWorkflowEvent(validTaskResult(), "test.yaml");
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.value?.kind).toBe("task_result");
  });

  it("result_summary 缺失 → 拒绝", () => {
    const result = validateWorkflowEvent(validTaskResult({ result_summary: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("result_summary"))).toBe(true);
  });

  it("累积上报：多个字段同时缺失 → issues 里能看到全部，不 fail-fast 只报第一个", () => {
    const result = validateWorkflowEvent(validTaskResult({ result_summary: "", head_sha: "", actor: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe("looksLikeWorkflowEvent", () => {
  it("template_id 匹配 → true", () => {
    expect(looksLikeWorkflowEvent({ template_id: WORKFLOW_EVENT_TEMPLATE_ID })).toBe(true);
  });
  it("template_id 不匹配 → false", () => {
    expect(looksLikeWorkflowEvent({ template_id: "TPL-OTHER-001" })).toBe(false);
  });
  it("非对象 → false", () => {
    expect(looksLikeWorkflowEvent(null)).toBe(false);
    expect(looksLikeWorkflowEvent("string")).toBe(false);
  });
});
