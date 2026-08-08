// task-assignment-model.test.ts — H3A-030 的反证。纯函数，喂构造的输入。
import { describe, expect, it } from "vitest";
import { validateTaskAssignment, looksLikeTaskAssignment, TASK_ASSIGNMENT_TEMPLATE_ID } from "./task-assignment-model";

function validTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    template_id: TASK_ASSIGNMENT_TEMPLATE_ID,
    template_version: 1,
    instance_id: "TSK-658-canvas-01",
    parent_task_id: "TSK-658-main",
    assigned_by: "coord-main",
    assignee_role: "coord-architecture",
    objective: "建立 Mermaid 到 Fabric 对象的稳定身份映射",
    scope: { include: [], exclude: [] },
    dependencies: [],
    acceptance_refs: ["pnpm exec vitest run --dir .harness"],
    skill_refs: ["SKL-MOD-CANVAS-001"],
    budget: {
      max_parallel_workers: 1,
      max_total_worker_runs: 2,
      max_retries: 1,
      token: null,
      cost: null,
      wall_time_ms: null,
    },
    authority_snapshot_hash: "abc123",
    ...overrides,
  };
}

describe("validateTaskAssignment (H3A-030)", () => {
  it("合法实例（Proposal §10.3 示例形状）→ 通过", () => {
    const result = validateTaskAssignment(validTask(), "test.yaml");
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.value?.instance_id).toBe("TSK-658-canvas-01");
  });

  it("template_id 不对 → 拒绝", () => {
    const result = validateTaskAssignment(validTask({ template_id: "TPL-OTHER-001" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("template_id"))).toBe(true);
  });

  it("parent_task_id 为 null（根任务）→ 允许", () => {
    const result = validateTaskAssignment(validTask({ parent_task_id: null }), "test.yaml");
    expect(result.ok).toBe(true);
  });

  it("objective 为空字符串 → 拒绝（完成契约要求 objective 完整）", () => {
    const result = validateTaskAssignment(validTask({ objective: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("objective"))).toBe(true);
  });

  it("acceptance_refs 为空数组 → 拒绝（完成契约要求 acceptance 完整，空验收标准不算完整）", () => {
    const result = validateTaskAssignment(validTask({ acceptance_refs: [] }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("acceptance_refs"))).toBe(true);
  });

  it("authority_snapshot_hash 缺失 → 拒绝（完成契约要求 authority hash 完整）", () => {
    const result = validateTaskAssignment(validTask({ authority_snapshot_hash: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("authority_snapshot_hash"))).toBe(true);
  });

  it("scope 缺 exclude 字段 → 拒绝", () => {
    const result = validateTaskAssignment(validTask({ scope: { include: [] } }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("scope.exclude"))).toBe(true);
  });

  it("budget.max_parallel_workers 为 0 → 拒绝（必须 ≥1）", () => {
    const result = validateTaskAssignment(
      validTask({ budget: { max_parallel_workers: 0, max_total_worker_runs: 1, max_retries: 0, token: null, cost: null, wall_time_ms: null } }),
      "test.yaml",
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("max_parallel_workers"))).toBe(true);
  });

  it("budget.token 为负数 → 拒绝", () => {
    const result = validateTaskAssignment(
      validTask({ budget: { max_parallel_workers: 1, max_total_worker_runs: 1, max_retries: 0, token: -1, cost: null, wall_time_ms: null } }),
      "test.yaml",
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("budget.token"))).toBe(true);
  });

  it("budget 全为 null 预算上限（token/cost/wall_time_ms）→ 允许（Proposal 示例本身如此）", () => {
    const result = validateTaskAssignment(validTask(), "test.yaml");
    expect(result.ok).toBe(true);
  });

  it("累积上报：多个字段同时缺失 → issues 里能看到全部，不 fail-fast 只报第一个", () => {
    const result = validateTaskAssignment(validTask({ objective: "", acceptance_refs: [], authority_snapshot_hash: "" }), "test.yaml");
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });

  it("顶层不是对象 → 拒绝", () => {
    const result = validateTaskAssignment("not an object", "test.yaml");
    expect(result.ok).toBe(false);
  });
});

describe("looksLikeTaskAssignment", () => {
  it("template_id 匹配 → true", () => {
    expect(looksLikeTaskAssignment({ template_id: TASK_ASSIGNMENT_TEMPLATE_ID })).toBe(true);
  });
  it("template_id 不匹配 → false", () => {
    expect(looksLikeTaskAssignment({ template_id: "TPL-OTHER-001" })).toBe(false);
  });
  it("非对象 → false", () => {
    expect(looksLikeTaskAssignment(null)).toBe(false);
    expect(looksLikeTaskAssignment("string")).toBe(false);
  });
});
