// task-context-bundle.test.ts — H3A-038 的反证。纯函数，喂构造的 fixture。
import { describe, expect, it } from "vitest";
import { buildTaskContextBundle } from "./task-context-bundle";
import { TASK_ASSIGNMENT_TEMPLATE_ID, type TaskAssignment } from "./task-assignment-model";
import { WORKFLOW_EVENT_TEMPLATE_ID, type WorkflowEvent } from "./workflow-event-model";

function task(overrides: Record<string, unknown> = {}): TaskAssignment {
  return {
    template_id: TASK_ASSIGNMENT_TEMPLATE_ID,
    template_version: 1,
    instance_id: "TSK-658-canvas-01",
    parent_task_id: null,
    assigned_by: "agt_main_01HXAMPLE",
    assignee_role: "coord-canvas",
    objective: "建立 Mermaid 到 Fabric 对象的稳定身份映射",
    scope: { include: ["apps/web/src/canvas/**"], exclude: [] },
    dependencies: [],
    acceptance_refs: ["ACC-canvas-stable-id"],
    skill_refs: ["SKL-MOD-CANVAS-001"],
    budget: { max_parallel_workers: 1, max_total_worker_runs: 2, max_retries: 1, token: null, cost: null, wall_time_ms: null },
    authority_snapshot_hash: "authhash0001",
    sourceFile: "task.yaml",
    ...overrides,
  } as TaskAssignment;
}

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    template_id: WORKFLOW_EVENT_TEMPLATE_ID,
    template_version: 1,
    instance_id: "EVT-658-0001",
    task_id: "TSK-658-canvas-01",
    actor: "agt_worker_01HXAMPLE",
    head_sha: "abcdef1",
    evidence_refs: [],
    sourceFile: "event.yaml",
    ...overrides,
  };
}

function progressEvent(overrides: Record<string, unknown> = {}): WorkflowEvent {
  return envelope({
    kind: "progress",
    delta: { implemented: ["stableNodeId 映射已实现"] },
    blockers: [],
    next_action: { owner_role: "canvas-verifier", action: "verify_exact_sha" },
    evidence_refs: ["EVD-canvas-unit-0042"],
    ...overrides,
  }) as unknown as WorkflowEvent;
}

function blockerEvent(overrides: Record<string, unknown> = {}): WorkflowEvent {
  return envelope({
    kind: "blocker",
    instance_id: "EVT-658-0002",
    blocked_reason: "缺少 SKL-MOD-CANVAS-001 的最新 Domain Skill 快照",
    next_action: { owner_role: "coord-canvas", action: "refresh_domain_skill" },
    ...overrides,
  }) as unknown as WorkflowEvent;
}

function taskResultEvent(overrides: Record<string, unknown> = {}): WorkflowEvent {
  return envelope({
    kind: "task_result",
    instance_id: "EVT-658-0003",
    result_summary: "完成 Mermaid→Fabric 稳定身份映射，产物见 evidence_refs",
    evidence_refs: ["EVD-canvas-unit-0042"],
    ...overrides,
  }) as unknown as WorkflowEvent;
}

function taskAssignmentEvent(overrides: Record<string, unknown> = {}): WorkflowEvent {
  return envelope({
    kind: "task_assignment",
    instance_id: "EVT-658-0000",
    assignment_ref: "TSK-658-canvas-01",
    ...overrides,
  }) as unknown as WorkflowEvent;
}

describe("buildTaskContextBundle — 干净场景：只含相关 event，字段白名单生效", () => {
  it("task_ref/role_ref/objective/scope/acceptance_refs 从 TaskAssignment 白名单透传", () => {
    const bundle = buildTaskContextBundle({ task: task(), events: [progressEvent()] });
    expect(bundle.task_ref).toBe("TSK-658-canvas-01");
    expect(bundle.role_ref).toBe("coord-canvas");
    expect(bundle.objective).toBe("建立 Mermaid 到 Fabric 对象的稳定身份映射");
    expect(bundle.scope).toEqual({ include: ["apps/web/src/canvas/**"], exclude: [] });
    expect(bundle.acceptance_refs).toEqual(["ACC-canvas-stable-id"]);
  });

  it("不泄漏 assigned_by/dependencies/budget/authority_snapshot_hash", () => {
    const bundle = buildTaskContextBundle({ task: task(), events: [] });
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("agt_main_01HXAMPLE"); // assigned_by
    expect(serialized).not.toContain("authhash0001"); // authority_snapshot_hash
    expect(serialized).not.toContain("max_parallel_workers"); // budget
  });

  it("progress event 只保留白名单字段，丢弃 actor/template_id/sourceFile", () => {
    const bundle = buildTaskContextBundle({ task: task(), events: [progressEvent()] });
    expect(bundle.events).toHaveLength(1);
    const e = bundle.events[0]!;
    expect(e).toEqual({
      kind: "progress",
      instance_id: "EVT-658-0001",
      task_id: "TSK-658-canvas-01",
      head_sha: "abcdef1",
      delta: { implemented: ["stableNodeId 映射已实现"] },
      blockers: [],
      next_action: { owner_role: "canvas-verifier", action: "verify_exact_sha" },
      evidence_refs: ["EVD-canvas-unit-0042"],
    });
    expect(Object.keys(e)).not.toContain("actor");
    expect(Object.keys(e)).not.toContain("template_id");
    expect(Object.keys(e)).not.toContain("sourceFile");
  });

  it("blocker/task_result/task_assignment 四类 kind 各自的白名单都生效", () => {
    const bundle = buildTaskContextBundle({
      task: task(),
      events: [blockerEvent(), taskResultEvent(), taskAssignmentEvent()],
    });
    const byKind = Object.fromEntries(bundle.events.map((e) => [e.kind, e]));
    expect(byKind.blocker).toEqual({
      kind: "blocker",
      instance_id: "EVT-658-0002",
      task_id: "TSK-658-canvas-01",
      head_sha: "abcdef1",
      blocked_reason: "缺少 SKL-MOD-CANVAS-001 的最新 Domain Skill 快照",
      next_action: { owner_role: "coord-canvas", action: "refresh_domain_skill" },
      evidence_refs: [],
    });
    expect(byKind.task_result).toEqual({
      kind: "task_result",
      instance_id: "EVT-658-0003",
      task_id: "TSK-658-canvas-01",
      head_sha: "abcdef1",
      result_summary: "完成 Mermaid→Fabric 稳定身份映射，产物见 evidence_refs",
      evidence_refs: ["EVD-canvas-unit-0042"],
    });
    expect(byKind.task_assignment).toEqual({
      kind: "task_assignment",
      instance_id: "EVT-658-0000",
      task_id: "TSK-658-canvas-01",
      head_sha: "abcdef1",
      assignment_ref: "TSK-658-canvas-01",
    });
  });

  it("filtering_notes.not_applicable 如实标注排不出 supervisor 私有推理", () => {
    const bundle = buildTaskContextBundle({ task: task(), events: [] });
    expect(bundle.filtering_notes.not_applicable.join(" ")).toContain("supervisor");
    expect(bundle.filtering_notes.applied.length).toBeGreaterThan(0);
  });
});

describe("buildTaskContextBundle — 无关 event 被过滤", () => {
  it("task_id 不匹配的 event 不进 events，出现在 excluded_task_ids", () => {
    const unrelated = progressEvent({ instance_id: "EVT-999-0001", task_id: "TSK-999-unrelated" });
    const bundle = buildTaskContextBundle({ task: task(), events: [progressEvent(), unrelated] });
    expect(bundle.events).toHaveLength(1);
    expect(bundle.events[0]!.instance_id).toBe("EVT-658-0001");
    expect(bundle.excluded_task_ids).toEqual(["TSK-999-unrelated"]);
  });
});

describe("buildTaskContextBundle — 多个不相关 task 混在一起，只选出目标 task（含子任务链）", () => {
  it("三个不同 task_id 混合输入，只保留目标 task 的 event", () => {
    const target = progressEvent({ instance_id: "EVT-A", task_id: "TSK-A" });
    const other1 = progressEvent({ instance_id: "EVT-B", task_id: "TSK-B" });
    const other2 = blockerEvent({ instance_id: "EVT-C", task_id: "TSK-C" });
    const bundle = buildTaskContextBundle({
      task: task({ instance_id: "TSK-A" }),
      events: [target, other1, other2],
    });
    expect(bundle.events.map((e) => e.instance_id)).toEqual(["EVT-A"]);
    expect(bundle.excluded_task_ids).toEqual(["TSK-B", "TSK-C"]);
  });

  it("提供 subtasks 时沿 parent_task_id 链条把子任务的 event 也纳入", () => {
    const parent = task({ instance_id: "TSK-parent", parent_task_id: null });
    const child = task({ instance_id: "TSK-child", parent_task_id: "TSK-parent" });
    const grandchild = task({ instance_id: "TSK-grandchild", parent_task_id: "TSK-child" });
    const events = [
      progressEvent({ instance_id: "EVT-parent", task_id: "TSK-parent" }),
      progressEvent({ instance_id: "EVT-child", task_id: "TSK-child" }),
      progressEvent({ instance_id: "EVT-grandchild", task_id: "TSK-grandchild" }),
      progressEvent({ instance_id: "EVT-sibling-unrelated", task_id: "TSK-sibling" }),
    ];
    const bundle = buildTaskContextBundle({ task: parent, events, subtasks: [child, grandchild] });
    expect(bundle.events.map((e) => e.instance_id).sort()).toEqual(["EVT-child", "EVT-grandchild", "EVT-parent"]);
    expect(bundle.excluded_task_ids).toEqual(["TSK-sibling"]);
  });

  it("不提供 subtasks 时不做隐式展开，只精确匹配 task.instance_id", () => {
    const parent = task({ instance_id: "TSK-parent" });
    const events = [
      progressEvent({ instance_id: "EVT-parent", task_id: "TSK-parent" }),
      progressEvent({ instance_id: "EVT-child", task_id: "TSK-child" }),
    ];
    const bundle = buildTaskContextBundle({ task: parent, events });
    expect(bundle.events.map((e) => e.instance_id)).toEqual(["EVT-parent"]);
    expect(bundle.excluded_task_ids).toEqual(["TSK-child"]);
  });
});
