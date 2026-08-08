// domain-skill-gates.test.ts — H3A-013/014/015 的反证。纯函数，喂构造的输入。
import { describe, expect, it } from "vitest";
import { findActiveGateViolations, findDeadReferences, findFreshnessIssues } from "./domain-skill-gates";
import type { DomainRegistryEntry } from "./domain-model";
import type { DomainSkillInstance } from "./domain-skill-model";

function domain(overrides: Partial<DomainRegistryEntry> = {}): DomainRegistryEntry {
  return {
    domain_id: "DOM-CANVAS-DIAGRAM",
    name: "Canvas & Diagram",
    owner: "coord-chat-e2e",
    areas: ["canvas"],
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
    instance_id: "MODKNOW-canvas-diagram",
    skill_id: "SKL-MOD-CANVAS-001",
    domain_id: "DOM-CANVAS-DIAGRAM",
    status: "active",
    authority_refs: { contracts: [], adrs: [], source_paths: [], verification: [] },
    last_verified: { commit: null, evidence_refs: [] },
    sourceFile: ".agents/skills/mod-canvas-diagram/SKILL.md",
    ...overrides,
  };
}

describe("findActiveGateViolations (H3A-013)", () => {
  it("0 个 active Domain、0 个 skill → 无 finding", () => {
    expect(findActiveGateViolations([], [])).toEqual([]);
  });

  it("1 个 active Domain、0 个 skill → WARN missing（今天全仓的真实状态，不阻断）", () => {
    const findings = findActiveGateViolations([domain()], []);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A013-MISSING-ACTIVE-SKILL");
    expect(findings[0]!.severity).toBe("WARN");
  });

  it("1 个 active Domain、1 个匹配 active skill → 无 finding", () => {
    const findings = findActiveGateViolations([domain()], [skill()]);
    expect(findings).toEqual([]);
  });

  it("🔴 1 个 active Domain、2 个 active skill → FAIL duplicate", () => {
    const findings = findActiveGateViolations(
      [domain()],
      [skill({ skill_id: "SKL-MOD-CANVAS-001" }), skill({ skill_id: "SKL-MOD-CANVAS-002", instance_id: "MODKNOW-canvas-diagram-2" })],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A013-DUPLICATE-ACTIVE-SKILL");
    expect(findings[0]!.severity).toBe("FAIL");
  });

  it("非 active（superseded）skill 不计入 duplicate 判定", () => {
    const findings = findActiveGateViolations(
      [domain()],
      [skill({ status: "active" }), skill({ status: "superseded", skill_id: "SKL-MOD-CANVAS-002", instance_id: "x" })],
    );
    expect(findings).toEqual([]);
  });

  it("deprecated Domain 没有 skill 不算 missing（只检查 active Domain）", () => {
    const findings = findActiveGateViolations([domain({ status: "deprecated" })], []);
    expect(findings).toEqual([]);
  });

  it("🔴 skill 引用了 registry 里不存在的 domain_id → FAIL", () => {
    const findings = findActiveGateViolations([domain()], [skill({ domain_id: "DOM-GHOST" })]);
    expect(findings.some((f) => f.code === "H3A013-SKILL-UNKNOWN-DOMAIN" && f.severity === "FAIL")).toBe(true);
    // 该 domain 因为没有匹配的 active skill，仍然会报 missing（WARN）
    expect(findings.some((f) => f.code === "H3A013-MISSING-ACTIVE-SKILL")).toBe(true);
  });
});

describe("findDeadReferences (H3A-014)", () => {
  it("空 authority_refs → 无 finding", () => {
    expect(findDeadReferences([skill()], () => true)).toEqual([]);
  });

  it("引用存在的路径 → 无 finding", () => {
    const s = skill({ authority_refs: { contracts: ["docs/x.md"], adrs: [], source_paths: [], verification: [] } });
    expect(findDeadReferences([s], () => true)).toEqual([]);
  });

  it("🔴 引用不存在的路径 → FAIL，点名字段和路径", () => {
    const s = skill({ authority_refs: { contracts: ["docs/does-not-exist.md"], adrs: [], source_paths: [], verification: [] } });
    const findings = findDeadReferences([s], () => false);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A014-DEAD-REFERENCE");
    expect(findings[0]!.severity).toBe("FAIL");
    expect(findings[0]!.message).toContain("does-not-exist.md");
  });

  it("verification 字段不检查（是 shell 命令不是路径）——即便 pathExists 恒 false 也不报", () => {
    const s = skill({ authority_refs: { contracts: [], adrs: [], source_paths: [], verification: ["pnpm test"] } });
    expect(findDeadReferences([s], () => false)).toEqual([]);
  });

  it("adrs / source_paths 都会被检查", () => {
    const s = skill({
      authority_refs: { contracts: [], adrs: ["docs/adr/ADR-999-ghost.md"], source_paths: ["apps/ghost/"], verification: [] },
    });
    const findings = findDeadReferences([s], () => false);
    expect(findings).toHaveLength(2);
  });
});

describe("findFreshnessIssues (H3A-015)", () => {
  it("commit === null 且 status !== active → 无 finding", () => {
    expect(findFreshnessIssues([skill({ status: "retired", last_verified: { commit: null, evidence_refs: [] } })])).toEqual([]);
  });

  it("commit === null 且 status === active → WARN never-verified", () => {
    const findings = findFreshnessIssues([skill({ last_verified: { commit: null, evidence_refs: [] } })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A015-NEVER-VERIFIED");
    expect(findings[0]!.severity).toBe("WARN");
  });

  it("commit 是合法形状的 SHA（7~40 位十六进制）→ 无 finding", () => {
    const findings = findFreshnessIssues([skill({ last_verified: { commit: "abc1234", evidence_refs: [] } })]);
    expect(findings).toEqual([]);
  });

  it("commit 是 40 位完整 SHA → 无 finding", () => {
    const findings = findFreshnessIssues([
      skill({ last_verified: { commit: "0123456789abcdef0123456789abcdef01234567", evidence_refs: [] } }),
    ]);
    expect(findings).toEqual([]);
  });

  it.each([
    ["not-a-sha", "含非法字符"],
    ["abc123", "少于 7 位"],
    ["0123456789abcdef0123456789abcdef012345678", "超过 40 位"],
  ])("🔴 commit 形状不像 SHA（%s，%s）→ FAIL", (bad) => {
    const findings = findFreshnessIssues([skill({ last_verified: { commit: bad, evidence_refs: [] } })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A015-MALFORMED-COMMIT");
    expect(findings[0]!.severity).toBe("FAIL");
  });
});
