// workflow-event-renderer.test.ts — H3A-035 的反证。纯函数，喂构造的输入。
import { describe, expect, it } from "vitest";
import { renderWorkflowEvent, DEFAULT_MAX_LINES } from "./workflow-event-renderer";
import { WORKFLOW_EVENT_TEMPLATE_ID, type WorkflowEvent } from "./workflow-event-model";

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    template_id: WORKFLOW_EVENT_TEMPLATE_ID,
    template_version: 1,
    instance_id: "EVT-658-0007",
    task_id: "TSK-658-canvas-01",
    actor: "agt_01HXAMPLE",
    head_sha: "abcdef123456",
    evidence_refs: [],
    sourceFile: "test.yaml",
    ...overrides,
  };
}

function validProgress(overrides: Record<string, unknown> = {}): WorkflowEvent {
  return envelope({
    kind: "progress",
    delta: { implemented: ["stableNodeId 映射已实现"] },
    blockers: [],
    next_action: { owner_role: "canvas-verifier", action: "verify_exact_sha" },
    evidence_refs: ["EVD-canvas-unit-0042"],
    ...overrides,
  }) as unknown as WorkflowEvent;
}

function validTaskAssignment(overrides: Record<string, unknown> = {}): WorkflowEvent {
  return envelope({
    kind: "task_assignment",
    assignment_ref: "TSK-658-canvas-01",
    ...overrides,
  }) as unknown as WorkflowEvent;
}

function validBlocker(overrides: Record<string, unknown> = {}): WorkflowEvent {
  return envelope({
    kind: "blocker",
    blocked_reason: "缺少 SKL-MOD-CANVAS-001 的最新 Domain Skill 快照",
    next_action: { owner_role: "coord-canvas", action: "refresh_domain_skill" },
    ...overrides,
  }) as unknown as WorkflowEvent;
}

function validTaskResult(overrides: Record<string, unknown> = {}): WorkflowEvent {
  return envelope({
    kind: "task_result",
    result_summary: "完成 Mermaid→Fabric 稳定身份映射，产物见 evidence_refs",
    ...overrides,
  }) as unknown as WorkflowEvent;
}

function manyItems(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}-${i + 1}`);
}

describe("renderWorkflowEvent — 通用契约：≤12 行", () => {
  it("progress：§13.2 逐字示例场景，行数 ≤12", () => {
    const lines = renderWorkflowEvent(validProgress());
    expect(lines.length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
    expect(lines[0]).toBe("TSK-658-canvas-01 · progress · abcdef1");
  });

  it("task_assignment：行数 ≤12", () => {
    const lines = renderWorkflowEvent(validTaskAssignment());
    expect(lines.length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
    expect(lines[0]).toContain("task_assignment");
  });

  it("blocker：行数 ≤12", () => {
    const lines = renderWorkflowEvent(validBlocker());
    expect(lines.length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
    expect(lines[0]).toContain("blocker");
  });

  it("task_result：行数 ≤12", () => {
    const lines = renderWorkflowEvent(validTaskResult());
    expect(lines.length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
    expect(lines[0]).toContain("task_result");
  });
});

describe("renderWorkflowEvent — 超长字段的截断策略", () => {
  it("progress：evidence_refs 有 20 条时，行数仍 ≤12 且保留摘要信息（不是信息全丢）", () => {
    const event = validProgress({
      delta: { implemented: manyItems("impl", 20) },
      blockers: manyItems("blk", 20),
      evidence_refs: manyItems("EVD", 20),
    });
    const lines = renderWorkflowEvent(event);
    expect(lines.length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
    // 摘要不是"截断到看不出内容"——至少能看到第一条真实内容和"还有 N 条"提示。
    expect(lines.some((l) => l.includes("impl-1"))).toBe(true);
    expect(lines.some((l) => l.includes("blk-1"))).toBe(true);
    expect(lines.some((l) => l.includes("EVD-1"))).toBe(true);
    expect(lines.some((l) => /还有 \d+ 条/.test(l))).toBe(true);
  });

  it("progress：所有三个数组字段同时超长仍是最坏情形下也 ≤12（先例反证：3 段各 limit+1 行 + 头 + next_action）", () => {
    const event = validProgress({
      delta: { implemented: manyItems("impl", 5) },
      blockers: manyItems("blk", 5),
      evidence_refs: manyItems("EVD", 5),
    });
    const lines = renderWorkflowEvent(event);
    expect(lines.length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
  });

  it("task_assignment：evidence_refs 超长时仍 ≤12 且保留摘要", () => {
    const event = validTaskAssignment({ evidence_refs: manyItems("EVD", 30) });
    const lines = renderWorkflowEvent(event);
    expect(lines.length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
    expect(lines.some((l) => l.includes("EVD-1"))).toBe(true);
    expect(lines.some((l) => /还有 \d+ 条/.test(l))).toBe(true);
  });

  it("blocker：evidence_refs 超长时仍 ≤12 且保留摘要", () => {
    const event = validBlocker({ evidence_refs: manyItems("EVD", 30) });
    const lines = renderWorkflowEvent(event);
    expect(lines.length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
    expect(lines.some((l) => l.includes("EVD-1"))).toBe(true);
  });

  it("task_result：evidence_refs 超长时仍 ≤12 且保留摘要", () => {
    const event = validTaskResult({ evidence_refs: manyItems("EVD", 30) });
    const lines = renderWorkflowEvent(event);
    expect(lines.length).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
    expect(lines.some((l) => l.includes("EVD-1"))).toBe(true);
  });

  it("空数组字段渲染为「无」，不是空字符串或缺失行", () => {
    const lines = renderWorkflowEvent(validProgress({ blockers: [] }));
    expect(lines.some((l) => l.includes("阻塞：无"))).toBe(true);
  });
});

describe("renderWorkflowEvent — verbose 放开截断", () => {
  it("verbose:true 时完整展开超长数组字段，不再截断", () => {
    const event = validProgress({ evidence_refs: manyItems("EVD", 20) });
    const lines = renderWorkflowEvent(event, { verbose: true });
    expect(lines.length).toBeGreaterThan(DEFAULT_MAX_LINES);
    // 20 条全部逐条出现，不再有"还有 N 条"提示。
    for (const item of manyItems("EVD", 20)) {
      expect(lines.some((l) => l.includes(item))).toBe(true);
    }
    expect(lines.some((l) => /还有 \d+ 条/.test(l))).toBe(false);
  });

  it("verbose:false（默认）与显式传 false 行为一致", () => {
    const event = validProgress();
    const a = renderWorkflowEvent(event);
    const b = renderWorkflowEvent(event, { verbose: false });
    expect(a).toEqual(b);
  });
});
