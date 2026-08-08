// task-assignment-root-domain-gate.test.ts — H3A-031 的反证。纯函数，喂构造的输入。
import { describe, expect, it } from "vitest";
import { checkRootToDomainAssignment, checkRootToDomainAssignments, type RootDomainGateContext } from "./task-assignment-root-domain-gate";
import type { TaskAssignment } from "./task-assignment-model";
import type { DomainRegistryEntry } from "./domain-model";
import type { DomainSkillInstance } from "./domain-skill-model";

function assignment(overrides: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    template_id: "TPL-TSK-001",
    template_version: 1,
    instance_id: "TSK-720-arch-01",
    parent_task_id: null,
    assigned_by: "coord-main",
    assignee_role: "coord-architecture",
    objective: "H3A-031 反证 fixture",
    scope: { include: [], exclude: [] },
    dependencies: [],
    acceptance_refs: ["pnpm exec vitest run --dir .harness"],
    skill_refs: [],
    budget: { max_parallel_workers: 1, max_total_worker_runs: 2, max_retries: 1, token: null, cost: null, wall_time_ms: null },
    authority_snapshot_hash: "abc123",
    sourceFile: ".harness/tasks/tsk-720-arch-01.yaml",
    ...overrides,
  };
}

function domain(overrides: Partial<DomainRegistryEntry> = {}): DomainRegistryEntry {
  return {
    domain_id: "DOM-CONTRACT-CONTROL-PLANE",
    name: "Contract & Control Plane",
    owner: "coord-architecture",
    areas: ["harness", "docs", "adr", "agent-protocol"],
    contracts: [],
    verification: [],
    status: "active",
    ...overrides,
  };
}

function skill(overrides: Partial<DomainSkillInstance> = {}): DomainSkillInstance {
  return {
    template_id: "TPL-MOD-001",
    template_version: 1,
    instance_id: "MODKNOW-harness",
    skill_id: "SKL-MOD-HARNESS-001",
    domain_id: "DOM-CONTRACT-CONTROL-PLANE",
    status: "active",
    authority_refs: { contracts: [], adrs: [], source_paths: [], verification: [] },
    last_verified: { commit: null, evidence_refs: [] },
    sourceFile: ".agents/skills/mod-harness/SKILL.md",
    ...overrides,
  };
}

function baseCtx(overrides: Partial<RootDomainGateContext> = {}): RootDomainGateContext {
  return {
    rootOrchestratorIds: new Set(["coord-main"]),
    domainOrchestratorNames: new Set(["coord-architecture"]),
    reviewerIds: new Set(["rev-e2e", "rev-feature"]),
    allKnownIdentityNames: new Set(["coord-main", "coord-architecture", "rev-e2e", "rev-feature", "dev-ai-runtime"]),
    domains: [domain()],
    domainSkills: [],
    allTaskIds: new Set(["TSK-720-arch-01"]),
    ...overrides,
  };
}

describe("checkRootToDomainAssignment (H3A-031)", () => {
  it("干净通过：Root→domain_orchestrator，域存在，scope/skill/依赖都合法 → 无 finding", () => {
    const findings = checkRootToDomainAssignment(
      assignment({ scope: { include: ["harness"], exclude: [] }, skill_refs: ["SKL-MOD-HARNESS-001"] }),
      baseCtx({ domainSkills: [skill()] }),
    );
    expect(findings).toEqual([]);
  });

  it("assigned_by 不是 root_orchestrator → 不在本 gate 范围，返回空（不是「通过」，是「不归本 gate 判」）", () => {
    const findings = checkRootToDomainAssignment(
      assignment({ assigned_by: "coord-architecture", assignee_role: "dev-ai-runtime" }),
      baseCtx(),
    );
    expect(findings).toEqual([]);
  });

  it("assignee_role 不存在任何已知身份 → H3A031-ASSIGNEE-ROLE-UNKNOWN FAIL", () => {
    const findings = checkRootToDomainAssignment(assignment({ assignee_role: "coord-nonexistent" }), baseCtx());
    expect(findings.some((f) => f.code === "H3A031-ASSIGNEE-ROLE-UNKNOWN" && f.severity === "FAIL")).toBe(true);
  });

  it("assignee_role 是已知 reviewer（非 domain_orchestrator）→ H3A031-ROOT-DIRECT-REVIEWER WARN（§6.4 允许的例外）", () => {
    const findings = checkRootToDomainAssignment(assignment({ assignee_role: "rev-e2e" }), baseCtx());
    expect(findings).toEqual([
      expect.objectContaining({ code: "H3A031-ROOT-DIRECT-REVIEWER", severity: "WARN" }),
    ]);
  });

  it("assignee_role 是已知身份但既非 domain_orchestrator 也非 reviewer → H3A031-ASSIGNEE-NOT-DOMAIN-ORCHESTRATOR FAIL", () => {
    const findings = checkRootToDomainAssignment(assignment({ assignee_role: "dev-ai-runtime" }), baseCtx());
    expect(findings.some((f) => f.code === "H3A031-ASSIGNEE-NOT-DOMAIN-ORCHESTRATOR" && f.severity === "FAIL")).toBe(true);
  });

  it("assignee_role 是 domain_orchestrator 但没有 Domain 认它是 owner → H3A031-NO-DOMAIN-FOR-ASSIGNEE FAIL", () => {
    const findings = checkRootToDomainAssignment(
      assignment(),
      baseCtx({ domains: [domain({ owner: "someone-else" })] }),
    );
    expect(findings.some((f) => f.code === "H3A031-NO-DOMAIN-FOR-ASSIGNEE" && f.severity === "FAIL")).toBe(true);
  });

  it("skill_ref 在全仓 Domain Skill 语料库里查无 → H3A031-SKILL-REF-UNVERIFIABLE WARN（今天 0 实例是已知状态）", () => {
    const findings = checkRootToDomainAssignment(
      assignment({ skill_refs: ["SKL-MOD-GHOST-001"] }),
      baseCtx({ domainSkills: [] }),
    );
    expect(findings.some((f) => f.code === "H3A031-SKILL-REF-UNVERIFIABLE" && f.severity === "WARN")).toBe(true);
  });

  it("skill_ref 查到了但属于别的 Domain → H3A031-SKILL-REF-WRONG-DOMAIN FAIL", () => {
    const findings = checkRootToDomainAssignment(
      assignment({ skill_refs: ["SKL-MOD-CANVAS-001"] }),
      baseCtx({ domainSkills: [skill({ skill_id: "SKL-MOD-CANVAS-001", domain_id: "DOM-CANVAS-DIAGRAM" })] }),
    );
    expect(findings.some((f) => f.code === "H3A031-SKILL-REF-WRONG-DOMAIN" && f.severity === "FAIL")).toBe(true);
  });

  it("scope.include 项不在管辖 Domain 的 areas[] 里 → H3A031-SCOPE-AREA-MISMATCH WARN（启发式，非确认违规）", () => {
    const findings = checkRootToDomainAssignment(
      assignment({ scope: { include: ["some-unrelated-path"], exclude: [] } }),
      baseCtx(),
    );
    expect(findings.some((f) => f.code === "H3A031-SCOPE-AREA-MISMATCH" && f.severity === "WARN")).toBe(true);
  });

  it("dependencies 引用的 task_id 在语料库里找不到 → H3A031-DEPENDENCY-NOT-FOUND FAIL", () => {
    const findings = checkRootToDomainAssignment(
      assignment({ dependencies: ["TSK-does-not-exist"] }),
      baseCtx(),
    );
    expect(findings.some((f) => f.code === "H3A031-DEPENDENCY-NOT-FOUND" && f.severity === "FAIL")).toBe(true);
  });

  it("dependencies 引用的 task_id 在语料库里存在 → 无 finding", () => {
    const findings = checkRootToDomainAssignment(
      assignment({ dependencies: ["TSK-720-arch-01"] }),
      baseCtx(),
    );
    expect(findings.filter((f) => f.code === "H3A031-DEPENDENCY-NOT-FOUND")).toEqual([]);
  });

  it("assignee_role 是多个 Domain 的 owner（H3A-022b 已知结构问题）→ 用并集 areas 做 scope 检查，不重复判 FAIL", () => {
    const findings = checkRootToDomainAssignment(
      assignment({ scope: { include: ["canvas"], exclude: [] } }),
      baseCtx({
        domains: [domain(), domain({ domain_id: "DOM-CANVAS-DIAGRAM", name: "Canvas", areas: ["canvas"] })],
      }),
    );
    expect(findings.filter((f) => f.code === "H3A031-NO-DOMAIN-FOR-ASSIGNEE")).toEqual([]);
    expect(findings.filter((f) => f.code === "H3A031-SCOPE-AREA-MISMATCH")).toEqual([]);
  });
});

describe("checkRootToDomainAssignments (H3A-031，批量)", () => {
  it("对多个实例分别判定并累积 finding", () => {
    const findings = checkRootToDomainAssignments(
      [assignment(), assignment({ instance_id: "TSK-720-arch-02", assignee_role: "coord-nonexistent" })],
      baseCtx(),
    );
    expect(findings.some((f) => f.code === "H3A031-ASSIGNEE-ROLE-UNKNOWN")).toBe(true);
  });
});
