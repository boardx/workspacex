// domain-worker-task-assignment-gate.test.ts — H3A-032 的反证。纯函数，喂
// 构造的输入，不碰文件系统（真实文件的活体验证在 PR 描述里：实测跑
// task-assignment doctor + 临时注入违规 fixture 确认会红，再还原）。
import { describe, expect, it } from "vitest";
import { checkDomainScope, checkWorkerBudgetQuota, checkAssigneeAuthorityCeiling } from "./domain-worker-task-assignment-gate";
import { TASK_ASSIGNMENT_TEMPLATE_ID, type TaskAssignment } from "./task-assignment-model";
import type { LayeredRole } from "./role-authorization";

function task(overrides: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    template_id: TASK_ASSIGNMENT_TEMPLATE_ID,
    template_version: 1,
    instance_id: "TSK-658-canvas-01",
    parent_task_id: "TSK-658-main",
    assigned_by: "coord-canvas",
    assignee_role: "canvas-implementer",
    objective: "建立 Mermaid 到 Fabric 对象的稳定身份映射",
    scope: { include: [], exclude: [] },
    dependencies: [],
    acceptance_refs: ["pnpm exec vitest run --dir .harness"],
    skill_refs: ["SKL-MOD-CANVAS-001"],
    budget: { max_parallel_workers: 1, max_total_worker_runs: 2, max_retries: 1, token: null, cost: null, wall_time_ms: null },
    authority_snapshot_hash: "abc123",
    sourceFile: ".harness/tasks/test.yaml",
    ...overrides,
  };
}

function role(overrides: Partial<LayeredRole> = {}): LayeredRole {
  return {
    sourceFile: "roles/x.yaml",
    name: "coord-canvas",
    kind: "module-coordinator",
    layer: "domain_orchestrator",
    areas: ["canvas"],
    supervisor: "coord-main",
    mergeAuthority: false,
    signoffAuthority: false,
    dispatchAuthority: false,
    ...overrides,
  };
}

const DOMAIN_ORCH = role({ name: "coord-canvas", layer: "domain_orchestrator", areas: ["canvas", "diagram"] });
const WORKER_IN_SCOPE = role({
  name: "canvas-implementer",
  kind: "worker",
  layer: "specialist_worker",
  areas: ["canvas"],
  supervisor: "coord-canvas",
});

function rolesMap(...roles: LayeredRole[]): Map<string, LayeredRole> {
  return new Map(roles.map((r) => [r.name, r]));
}

/* ═══════════════════════ H3A-032a：不越领域 ═══════════════════════ */

describe("checkDomainScope / H3A-032a", () => {
  it("干净：assignee 是 specialist_worker，areas 是 assigned_by areas 的子集", () => {
    const findings = checkDomainScope([task()], rolesMap(DOMAIN_ORCH, WORKER_IN_SCOPE));
    expect(findings).toEqual([]);
  });

  it("assigned_by 不是 domain_orchestrator（例如 root）→ 跳过，不是本模块范围", () => {
    const root = role({ name: "coord-main", layer: "root_orchestrator", areas: ["*"] });
    const findings = checkDomainScope(
      [task({ assigned_by: "coord-main" })],
      rolesMap(root, WORKER_IN_SCOPE),
    );
    expect(findings).toEqual([]);
  });

  it("assigned_by 解析不到任何已知身份 → 跳过（不能证明是也不能证明不是 Domain Orchestrator）", () => {
    const findings = checkDomainScope([task({ assigned_by: "agt_unknown_ulid" })], rolesMap(DOMAIN_ORCH, WORKER_IN_SCOPE));
    expect(findings).toEqual([]);
  });

  it("assignee_role 未知身份 → FAIL", () => {
    const findings = checkDomainScope([task({ assignee_role: "no-such-worker" })], rolesMap(DOMAIN_ORCH));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A032-ASSIGNEE-UNKNOWN-IDENTITY");
  });

  it("assignee_role 不是 specialist_worker（例如另一个 domain_orchestrator）→ FAIL", () => {
    const otherOrch = role({ name: "coord-other", layer: "domain_orchestrator", areas: ["other"] });
    const findings = checkDomainScope(
      [task({ assignee_role: "coord-other" })],
      rolesMap(DOMAIN_ORCH, otherOrch),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A032-ASSIGNEE-NOT-WORKER");
  });

  it("assignee areas 不是 assigned_by areas 的子集 → FAIL（越领域）", () => {
    const workerOutOfScope = role({
      name: "auth-worker",
      kind: "worker",
      layer: "specialist_worker",
      areas: ["canvas", "auth"], // "auth" 不在 coord-canvas 的 [canvas, diagram] 里
      supervisor: "coord-canvas",
    });
    const findings = checkDomainScope(
      [task({ assignee_role: "auth-worker" })],
      rolesMap(DOMAIN_ORCH, workerOutOfScope),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A032-AREA-OUT-OF-DOMAIN");
    expect(findings[0]!.message).toContain("auth");
  });

  it("assignee areas 是 assigned_by areas 的真子集（更窄专精）→ 允许", () => {
    const narrowWorker = role({
      name: "diagram-only-worker",
      kind: "worker",
      layer: "specialist_worker",
      areas: ["diagram"], // DOMAIN_ORCH 是 [canvas, diagram]，真子集
      supervisor: "coord-canvas",
    });
    const findings = checkDomainScope(
      [task({ assignee_role: "diagram-only-worker" })],
      rolesMap(DOMAIN_ORCH, narrowWorker),
    );
    expect(findings).toEqual([]);
  });
});

/* ═══════════════════════ H3A-032b：不越配额 ═══════════════════════ */

describe("checkWorkerBudgetQuota / H3A-032b", () => {
  it("干净：默认 budget（max_parallel_workers:1, max_total_worker_runs:2）", () => {
    const findings = checkWorkerBudgetQuota([task()]);
    expect(findings).toEqual([]);
  });

  it("max_parallel_workers > 默认值 1 → WARN（不阻断，schema 没有例外理由字段）", () => {
    const findings = checkWorkerBudgetQuota([
      task({ budget: { max_parallel_workers: 3, max_total_worker_runs: 5, max_retries: 1, token: null, cost: null, wall_time_ms: null } }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A032-PARALLEL-WORKERS-ABOVE-DEFAULT");
    expect(findings[0]!.severity).toBe("WARN");
  });

  it("max_total_worker_runs < max_parallel_workers → FAIL（结构不自洽）", () => {
    const findings = checkWorkerBudgetQuota([
      task({ budget: { max_parallel_workers: 2, max_total_worker_runs: 1, max_retries: 1, token: null, cost: null, wall_time_ms: null } }),
    ]);
    // 同时也会触发 H3A032-PARALLEL-WORKERS-ABOVE-DEFAULT（2 > 1），所以断言两条都在。
    const codes = findings.map((f) => f.code);
    expect(codes).toContain("H3A032-BUDGET-RUNS-BELOW-PARALLEL");
    expect(findings.find((f) => f.code === "H3A032-BUDGET-RUNS-BELOW-PARALLEL")!.severity).toBe("FAIL");
  });
});

/* ═══════════════════════ H3A-032c：不越权限 ═══════════════════════ */

describe("checkAssigneeAuthorityCeiling / H3A-032c", () => {
  it("干净：assignee 两项 authority 都是 false", () => {
    const findings = checkAssigneeAuthorityCeiling([task()], rolesMap(DOMAIN_ORCH, WORKER_IN_SCOPE));
    expect(findings).toEqual([]);
  });

  it("assignee merge_authority:true 但 assigned_by 是 false → FAIL", () => {
    const overreachWorker = role({ ...WORKER_IN_SCOPE, mergeAuthority: true });
    const findings = checkAssigneeAuthorityCeiling(
      [task()],
      rolesMap(DOMAIN_ORCH, overreachWorker),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A032-AUTHORITY-EXCEEDS-ASSIGNER");
    expect(findings[0]!.message).toContain("merge_authority");
  });

  it("assignee dispatch_authority:true 但 assigned_by 是 false → FAIL", () => {
    const overreachWorker = role({ ...WORKER_IN_SCOPE, dispatchAuthority: true });
    const findings = checkAssigneeAuthorityCeiling(
      [task()],
      rolesMap(DOMAIN_ORCH, overreachWorker),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A032-AUTHORITY-EXCEEDS-ASSIGNER");
    expect(findings[0]!.message).toContain("dispatch_authority");
  });

  it("assigned_by 也拥有该 authority → 允许（不超过上级即可）", () => {
    const orchWithMerge = role({ ...DOMAIN_ORCH, mergeAuthority: true });
    const workerWithMerge = role({ ...WORKER_IN_SCOPE, mergeAuthority: true });
    const findings = checkAssigneeAuthorityCeiling(
      [task()],
      rolesMap(orchWithMerge, workerWithMerge),
    );
    expect(findings).toEqual([]);
  });

  it("assigned_by 不是 domain_orchestrator → 跳过", () => {
    const root = role({ name: "coord-main", layer: "root_orchestrator", areas: ["*"], mergeAuthority: true });
    const overreachWorker = role({ ...WORKER_IN_SCOPE, mergeAuthority: true });
    const findings = checkAssigneeAuthorityCeiling(
      [task({ assigned_by: "coord-main" })],
      rolesMap(root, overreachWorker),
    );
    expect(findings).toEqual([]);
  });
});
