// domain-orchestrator-binding.test.ts — H3A-022 的反证。纯函数，喂构造的输入。
import { describe, expect, it } from "vitest";
import {
  checkDomainOwnerIdentity,
  checkOneDomainPerOrchestrator,
  checkOrchestratorRoleHasDomain,
  checkActiveSkillBinding,
} from "./domain-orchestrator-binding";
import type { DomainRegistryEntry } from "./domain-model";
import type { DomainSkillInstance } from "./domain-skill-model";
import type { LayeredRole } from "./role-authorization";

function domain(overrides: Partial<DomainRegistryEntry> = {}): DomainRegistryEntry {
  return {
    domain_id: "DOM-CONTRACT-CONTROL-PLANE",
    name: "Contract & Control Plane",
    owner: "coord-architecture",
    areas: ["harness"],
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

function role(overrides: Partial<LayeredRole> = {}): LayeredRole {
  return {
    sourceFile: ".harness/agents/roles/coord-architecture.yaml",
    name: "coord-architecture",
    kind: "architecture-coordinator",
    layer: "domain_orchestrator",
    areas: ["harness"],
    supervisor: "coord-main",
    mergeAuthority: false,
    signoffAuthority: false,
    dispatchAuthority: false,
    ...overrides,
  };
}

describe("checkDomainOwnerIdentity (H3A-022a)", () => {
  it("owner 是已知 domain_orchestrator 身份 → 无 finding", () => {
    const findings = checkDomainOwnerIdentity([domain()], new Set(["coord-architecture"]), new Set(["coord-architecture"]));
    expect(findings).toEqual([]);
  });

  it("owner 为 null → WARN（今天的已知未裁决状态）", () => {
    const findings = checkDomainOwnerIdentity([domain({ owner: null })], new Set(), new Set());
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A022-DOMAIN-NO-OWNER");
    expect(findings[0]!.severity).toBe("WARN");
  });

  it("owner 不在任何已知身份集合里 → FAIL（真实结构性错误）", () => {
    const findings = checkDomainOwnerIdentity([domain({ owner: "coord-nonexistent-ghost" })], new Set(), new Set());
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A022-OWNER-UNKNOWN-IDENTITY");
    expect(findings[0]!.severity).toBe("FAIL");
  });

  it("owner 是已知身份但不是 domain_orchestrator 层 → WARN（已知结构问题，非新回归）", () => {
    const findings = checkDomainOwnerIdentity(
      [domain({ owner: "dev-ai-runtime" })],
      new Set(["coord-architecture"]),
      new Set(["coord-architecture", "dev-ai-runtime"]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A022-OWNER-NOT-ORCHESTRATOR-LAYER");
    expect(findings[0]!.severity).toBe("WARN");
  });
});

describe("checkOneDomainPerOrchestrator (H3A-022b)", () => {
  it("每个 owner 最多 1 个 Domain → 无 finding", () => {
    const findings = checkOneDomainPerOrchestrator([
      domain({ domain_id: "DOM-A", owner: "coord-a" }),
      domain({ domain_id: "DOM-B", owner: "coord-b" }),
    ]);
    expect(findings).toEqual([]);
  });

  it("owner 为 null 的 Domain 不参与计数", () => {
    const findings = checkOneDomainPerOrchestrator([
      domain({ domain_id: "DOM-A", owner: null }),
      domain({ domain_id: "DOM-B", owner: null }),
    ]);
    expect(findings).toEqual([]);
  });

  it("同一 owner 拥有 >1 个 Domain → WARN（coord-chat-e2e 的真实既有状态）", () => {
    const findings = checkOneDomainPerOrchestrator([
      domain({ domain_id: "DOM-CHAT", owner: "coord-chat-e2e" }),
      domain({ domain_id: "DOM-CANVAS-DIAGRAM", owner: "coord-chat-e2e" }),
      domain({ domain_id: "DOM-E2E-RELEASE-READINESS", owner: "coord-chat-e2e" }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A022-ORCHESTRATOR-MULTIPLE-DOMAINS");
    expect(findings[0]!.severity).toBe("WARN");
    expect(findings[0]!.message).toContain("DOM-CHAT");
    expect(findings[0]!.message).toContain("DOM-CANVAS-DIAGRAM");
    expect(findings[0]!.message).toContain("DOM-E2E-RELEASE-READINESS");
  });
});

describe("checkOrchestratorRoleHasDomain (H3A-022c)", () => {
  it("持久 domain_orchestrator 角色有 Domain 挂靠 → 无 finding", () => {
    const findings = checkOrchestratorRoleHasDomain([role()], [domain({ owner: "coord-architecture" })]);
    expect(findings).toEqual([]);
  });

  it("非 domain_orchestrator 层角色不受本检查约束", () => {
    const findings = checkOrchestratorRoleHasDomain(
      [role({ name: "dev-ai-runtime", layer: "specialist_worker" })],
      [domain({ owner: "coord-architecture" })],
    );
    expect(findings).toEqual([]);
  });

  it("持久 domain_orchestrator 角色在 Domain Registry 里找不到任何 Domain → FAIL", () => {
    const findings = checkOrchestratorRoleHasDomain([role()], [domain({ owner: "someone-else" })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A022-ORCHESTRATOR-ROLE-NO-DOMAIN");
    expect(findings[0]!.severity).toBe("FAIL");
  });
});

describe("checkActiveSkillBinding (H3A-022d)", () => {
  it("active Domain 恰好 1 个匹配 active skill → 无 finding", () => {
    const findings = checkActiveSkillBinding([domain()], [skill()]);
    expect(findings).toEqual([]);
  });

  it("active Domain 0 个匹配 active skill → WARN（今天全仓 0 实例的已知状态）", () => {
    const findings = checkActiveSkillBinding([domain()], []);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A022-NO-ACTIVE-SKILL");
    expect(findings[0]!.severity).toBe("WARN");
  });

  it("active Domain 有 >1 个匹配 active skill → FAIL（歧义）", () => {
    const findings = checkActiveSkillBinding(
      [domain()],
      [skill({ instance_id: "MODKNOW-a" }), skill({ instance_id: "MODKNOW-b" })],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A022-MULTIPLE-ACTIVE-SKILLS");
    expect(findings[0]!.severity).toBe("FAIL");
  });

  it("owner 为 null 的 Domain 不重复报（已由 H3A022-DOMAIN-NO-OWNER 覆盖）", () => {
    const findings = checkActiveSkillBinding([domain({ owner: null })], []);
    expect(findings).toEqual([]);
  });

  it("status 非 active 的 Domain 不检查 Skill 绑定", () => {
    const findings = checkActiveSkillBinding([domain({ status: "deprecated" })], []);
    expect(findings).toEqual([]);
  });

  it("status/domain_id 不匹配的 skill 不计入", () => {
    const findings = checkActiveSkillBinding(
      [domain()],
      [skill({ status: "retired" }), skill({ domain_id: "DOM-OTHER" })],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A022-NO-ACTIVE-SKILL");
  });
});
