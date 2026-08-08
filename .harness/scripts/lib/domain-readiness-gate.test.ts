// domain-readiness-gate.test.ts — H3A-019 的反证。纯函数，喂构造的输入。
import { describe, expect, it } from "vitest";
import {
  computeDomainReadiness,
  buildReadinessMap,
  checkTaskAssignmentReadiness,
} from "./domain-readiness-gate";
import type { DomainRegistryEntry } from "./domain-model";
import type { DomainSkillInstance } from "./domain-skill-model";
import type { TaskAssignment } from "./task-assignment-model";

function domain(overrides: Partial<DomainRegistryEntry> = {}): DomainRegistryEntry {
  return {
    domain_id: "DOM-CONTRACT-CONTROL-PLANE",
    name: "Contract & Control Plane",
    owner: "coord-architecture",
    areas: ["harness", "docs", "adr", "agent-protocol"],
    contracts: ["phases/02/contracts/harness"],
    verification: ["pnpm exec vitest run --dir .harness"],
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

function assignment(overrides: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    template_id: "TPL-TSK-001",
    template_version: 1,
    instance_id: "TSK-772-arch-01",
    parent_task_id: null,
    assigned_by: "coord-main",
    assignee_role: "coord-architecture",
    objective: "H3A-019 反证 fixture",
    scope: { include: [], exclude: [] },
    dependencies: [],
    acceptance_refs: ["pnpm exec vitest run --dir .harness"],
    skill_refs: [],
    budget: { max_parallel_workers: 1, max_total_worker_runs: 2, max_retries: 1, token: null, cost: null, wall_time_ms: null },
    authority_snapshot_hash: "abc123",
    sourceFile: ".harness/tasks/tsk-772-arch-01.yaml",
    ...overrides,
  };
}

describe("computeDomainReadiness (H3A-019)", () => {
  it("干净通过：owner 已知身份 + active Skill + contracts/verification 非空 → ready:true，无 reasons", () => {
    const readiness = computeDomainReadiness(
      [domain()],
      [skill()],
      new Set(["coord-architecture"]),
    )[0]!;
    expect(readiness).toEqual({ domain_id: "DOM-CONTRACT-CONTROL-PLANE", ready: true, reasons: [] });
  });

  it("Role 缺失①：owner 为 null → H3A019-ROLE-NO-OWNER WARN，ready:false", () => {
    const readiness = computeDomainReadiness(
      [domain({ owner: null })],
      [skill()],
      new Set(["coord-architecture"]),
    )[0]!;
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toEqual([
      expect.objectContaining({ code: "H3A019-ROLE-NO-OWNER", severity: "WARN" }),
    ]);
  });

  it("Role 缺失②：owner 是未知身份 → H3A019-ROLE-UNKNOWN-IDENTITY FAIL，ready:false", () => {
    const readiness = computeDomainReadiness(
      [domain({ owner: "coord-nonexistent" })],
      [skill({ domain_id: "DOM-CONTRACT-CONTROL-PLANE" })],
      new Set(["coord-architecture"]),
    )[0]!;
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toEqual([
      expect.objectContaining({ code: "H3A019-ROLE-UNKNOWN-IDENTITY", severity: "FAIL" }),
    ]);
  });

  it("Skill 缺失：该 Domain 没有 active Skill → H3A019-SKILL-MISSING WARN，ready:false", () => {
    const readiness = computeDomainReadiness(
      [domain()],
      [],
      new Set(["coord-architecture"]),
    )[0]!;
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toEqual([
      expect.objectContaining({ code: "H3A019-SKILL-MISSING", severity: "WARN" }),
    ]);
  });

  it("Skill 缺失：该 Domain 只有 retired/superseded Skill（没有 active）→ 同样判 H3A019-SKILL-MISSING WARN", () => {
    const readiness = computeDomainReadiness(
      [domain()],
      [skill({ status: "retired" })],
      new Set(["coord-architecture"]),
    )[0]!;
    expect(readiness.reasons.some((r) => r.code === "H3A019-SKILL-MISSING")).toBe(true);
  });

  it("数据源缺失：contracts[]、verification[] 均为空 → H3A019-DATA-SOURCE-EMPTY WARN，ready:false", () => {
    const readiness = computeDomainReadiness(
      [domain({ contracts: [], verification: [] })],
      [skill()],
      new Set(["coord-architecture"]),
    )[0]!;
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toEqual([
      expect.objectContaining({ code: "H3A019-DATA-SOURCE-EMPTY", severity: "WARN" }),
    ]);
  });

  it("数据源不缺失：只有 contracts 非空、verification 为空 → 不判 H3A019-DATA-SOURCE-EMPTY（两者均空才判）", () => {
    const readiness = computeDomainReadiness(
      [domain({ contracts: ["phases/02/contracts/harness"], verification: [] })],
      [skill()],
      new Set(["coord-architecture"]),
    )[0]!;
    expect(readiness.reasons.filter((r) => r.code === "H3A019-DATA-SOURCE-EMPTY")).toEqual([]);
  });

  it("三重缺失同时出现 → reasons 累积三条，不 fail-fast", () => {
    const readiness = computeDomainReadiness(
      [domain({ owner: null, contracts: [], verification: [] })],
      [],
      new Set(["coord-architecture"]),
    )[0]!;
    expect(readiness.reasons.map((r) => r.code).sort()).toEqual([
      "H3A019-DATA-SOURCE-EMPTY",
      "H3A019-ROLE-NO-OWNER",
      "H3A019-SKILL-MISSING",
    ]);
  });

  it("多个 Domain 独立计算，互不污染", () => {
    const readiness = computeDomainReadiness(
      [domain(), domain({ domain_id: "DOM-CANVAS-DIAGRAM", name: "Canvas", owner: null })],
      [skill()],
      new Set(["coord-architecture"]),
    );
    expect(readiness.find((r) => r.domain_id === "DOM-CONTRACT-CONTROL-PLANE")?.ready).toBe(true);
    expect(readiness.find((r) => r.domain_id === "DOM-CANVAS-DIAGRAM")?.ready).toBe(false);
  });
});

describe("checkTaskAssignmentReadiness (H3A-019)", () => {
  it("干净通过：assignee_role 是 owner，Domain 就绪 → 无 finding", () => {
    const readiness = buildReadinessMap(computeDomainReadiness([domain()], [skill()], new Set(["coord-architecture"])));
    const findings = checkTaskAssignmentReadiness([assignment()], [domain()], readiness);
    expect(findings).toEqual([]);
  });

  it("assignee_role 不是任何 Domain 的 owner → 本 gate 不适用，返回空（不是「通过」，是「不归本 gate 判」）", () => {
    const readiness = buildReadinessMap(computeDomainReadiness([domain()], [skill()], new Set(["coord-architecture"])));
    const findings = checkTaskAssignmentReadiness(
      [assignment({ assignee_role: "dev-ai-runtime" })],
      [domain()],
      readiness,
    );
    expect(findings).toEqual([]);
  });

  it("Domain 因 Skill 缺失未就绪（WARN 原因）→ Task Assignment 级 finding 也是 WARN（UNKNOWN）", () => {
    const readiness = buildReadinessMap(computeDomainReadiness([domain()], [], new Set(["coord-architecture"])));
    const findings = checkTaskAssignmentReadiness([assignment()], [domain()], readiness);
    expect(findings).toEqual([
      expect.objectContaining({ code: "H3A019-TASK-ASSIGNMENT-NOT-READY", severity: "WARN" }),
    ]);
    expect(findings[0]!.message).toContain("UNKNOWN");
  });

  it("Domain 因 Role 未知身份未就绪（FAIL 原因）→ Task Assignment 级 finding 是 FAIL（blocked），即使同时也有 WARN 原因", () => {
    const readiness = buildReadinessMap(
      computeDomainReadiness([domain({ owner: "coord-nonexistent" })], [], new Set(["coord-architecture"])),
    );
    const findings = checkTaskAssignmentReadiness(
      [assignment({ assignee_role: "coord-nonexistent" })],
      [domain({ owner: "coord-nonexistent" })],
      readiness,
    );
    expect(findings).toEqual([
      expect.objectContaining({ code: "H3A019-TASK-ASSIGNMENT-NOT-READY", severity: "FAIL" }),
    ]);
    expect(findings[0]!.message).toContain("blocked");
  });

  it("一个 assignee_role 是多个 Domain 的 owner（H3A-022b 已知结构问题）→ 每个未就绪 Domain 各产生一条 finding", () => {
    const domains = [
      domain(),
      domain({ domain_id: "DOM-CANVAS-DIAGRAM", name: "Canvas", contracts: [], verification: [] }),
    ];
    const readiness = buildReadinessMap(computeDomainReadiness(domains, [skill()], new Set(["coord-architecture"])));
    const findings = checkTaskAssignmentReadiness([assignment()], domains, readiness);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("DOM-CANVAS-DIAGRAM");
  });

  it("对多个 Task Assignment 分别判定并累积 finding", () => {
    const readiness = buildReadinessMap(computeDomainReadiness([domain()], [], new Set(["coord-architecture"])));
    const findings = checkTaskAssignmentReadiness(
      [assignment(), assignment({ instance_id: "TSK-772-arch-02", assignee_role: "dev-ai-runtime" })],
      [domain()],
      readiness,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.sourceFile).toBe(assignment().sourceFile);
  });
});
