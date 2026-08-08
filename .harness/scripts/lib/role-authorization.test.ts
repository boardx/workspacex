// role-authorization.test.ts — H3A-020/021/023/024/025/026/027/029 的反证。
// 纯函数，喂构造的输入，不碰文件系统（真实文件的活体验证在 PR 描述里：
// 实测跑 role-authorization doctor + 逐条临时改坏真实文件确认会红）。
import { describe, expect, it } from "vitest";
import {
  validateRoleFile,
  validateRoleFiles,
  checkRootOrchestratorSingleton,
  checkSpecialistWorkerSpecs,
  checkMaxDepthGate,
  checkAuthorityMonotonicity,
  checkMergeSignoffGate,
  checkProducerVerifierSeparation,
  checkRootDirectL3Exception,
  type RawRoleFile,
  type LayeredRole,
  type RawAgentSpec,
  type RegistryIdentity,
} from "./role-authorization";

function roleFile(overrides: Record<string, unknown> = {}, sourceFile = "roles/x.yaml"): RawRoleFile {
  return {
    sourceFile,
    parsed: {
      name: "coord-x",
      kind: "module-coordinator",
      areas: ["x"],
      reports_to: "coord-main",
      merge_authority: false,
      dispatch_authority: false,
      ...overrides,
    },
  };
}

function layeredRole(overrides: Partial<LayeredRole> = {}): LayeredRole {
  return {
    sourceFile: "roles/x.yaml",
    name: "coord-x",
    kind: "module-coordinator",
    layer: "domain_orchestrator",
    areas: ["x"],
    supervisor: "coord-main",
    mergeAuthority: false,
    signoffAuthority: false,
    dispatchAuthority: false,
    ...overrides,
  };
}

/* ═══════════════════════ H3A-020 ═══════════════════════ */

describe("validateRoleFile / H3A-020", () => {
  it("基线：合法角色文件通过，layer 从 kind 正确派生", () => {
    const { role, issues } = validateRoleFile(roleFile());
    expect(issues).toEqual([]);
    expect(role?.layer).toBe("domain_orchestrator");
  });

  it.each([
    ["coordinator", "root_orchestrator"],
    ["architecture-coordinator", "domain_orchestrator"],
    ["module-coordinator", "domain_orchestrator"],
    ["worker", "specialist_worker"],
    ["reviewer", "specialist_worker"],
  ] as const)("kind %s 派生为 layer %s", (kind, layer) => {
    const { role } = validateRoleFile(roleFile({ kind, reports_to: kind === "coordinator" ? null : "coord-main" }));
    expect(role?.layer).toBe(layer);
  });

  it("未知 kind 无法派生 layer，累积报错而不是崩溃", () => {
    const { role, issues } = validateRoleFile(roleFile({ kind: "bogus-kind" }));
    expect(role).toBeNull();
    expect(issues.some((i) => i.message.includes("bogus-kind"))).toBe(true);
  });

  it("累积上报全部字段问题，不 fail-fast", () => {
    const { issues } = validateRoleFile(roleFile({ name: "", areas: "not-an-array", merge_authority: "yes" }));
    // name 空、areas 类型错、merge_authority 类型错——至少 3 条，且 kind 仍合法所以不额外报 kind 的问题
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it("reports_to 允许 null（root 没有 supervisor）", () => {
    const { role, issues } = validateRoleFile(roleFile({ kind: "coordinator", reports_to: null }));
    expect(issues).toEqual([]);
    expect(role?.supervisor).toBeNull();
  });

  it("顶层不是对象时不崩溃，返回单条问题", () => {
    const { role, issues } = validateRoleFile({ sourceFile: "x", parsed: null });
    expect(role).toBeNull();
    expect(issues.length).toBe(1);
  });
});

describe("validateRoleFiles", () => {
  it("多个文件里坏的不影响好的：好文件仍然进入 roles，坏文件只产生 finding", () => {
    const files = [roleFile({ name: "good" }, "roles/good.yaml"), roleFile({ kind: "bogus" }, "roles/bad.yaml")];
    const { roles, findings } = validateRoleFiles(files);
    expect(roles.map((r) => r.name)).toEqual(["good"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A020-INVALID-ROLE-FIELD");
    expect(findings[0]!.severity).toBe("FAIL");
  });
});

/* ═══════════════════════ H3A-021 ═══════════════════════ */

describe("checkRootOrchestratorSingleton / H3A-021", () => {
  function identity(overrides: Partial<RegistryIdentity> = {}): RegistryIdentity {
    return { id: "coord-main", kind: "coordinator", active: true, ...overrides };
  }

  it("基线：单个 active 的 coordinator 干净", () => {
    expect(checkRootOrchestratorSingleton([identity()])).toEqual([]);
  });

  it("inactive 的第二个 coordinator 不算数", () => {
    const findings = checkRootOrchestratorSingleton([
      identity(),
      identity({ id: "coord-shadow", active: false }),
    ]);
    expect(findings).toEqual([]);
  });

  it("非 coordinator kind（module-coordinator/worker）不算 root，即使 active", () => {
    const findings = checkRootOrchestratorSingleton([
      identity(),
      identity({ id: "coord-x", kind: "module-coordinator" }),
      identity({ id: "dev-x", kind: "worker" }),
    ]);
    expect(findings).toEqual([]);
  });

  it("两个 active 的 coordinator 同时存在 → FAIL", () => {
    const findings = checkRootOrchestratorSingleton([identity(), identity({ id: "coord-second" })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A021-MULTIPLE-ROOT-ACTIVE");
    expect(findings[0]!.severity).toBe("FAIL");
    expect(findings[0]!.message).toContain("coord-main");
    expect(findings[0]!.message).toContain("coord-second");
  });

  it("零个 active 的 coordinator 不算违规（这个 gate 只管上限，不管下限）", () => {
    expect(checkRootOrchestratorSingleton([])).toEqual([]);
  });
});

/* ═══════════════════════ H3A-023 ═══════════════════════ */

describe("checkSpecialistWorkerSpecs / H3A-023", () => {
  function spec(overrides: Partial<RawAgentSpec> = {}): RawAgentSpec {
    return { sourceFile: "agents/x.yaml", name: "x", role: "implementer", tools: ["read_files"], ...overrides };
  }

  it("基线：合法 spec 干净", () => {
    expect(checkSpecialistWorkerSpecs([spec()])).toEqual([]);
  });

  it("role 缺失/非字符串 → FAIL", () => {
    const findings = checkSpecialistWorkerSpecs([spec({ role: undefined })]);
    expect(findings.some((f) => f.code === "H3A023-MISSING-ROLE-FIELD" && f.severity === "FAIL")).toBe(true);
  });

  it("tools 缺失或空数组 → WARN", () => {
    const findings = checkSpecialistWorkerSpecs([spec({ tools: [] })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "H3A023-TOOLS-EMPTY", severity: "WARN" });
  });

  it("tools 超过合理上限 → WARN", () => {
    const findings = checkSpecialistWorkerSpecs([spec({ tools: Array.from({ length: 9 }, (_, i) => `t${i}`) })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "H3A023-TOOLS-TOO-MANY", severity: "WARN" });
  });
});

/* ═══════════════════════ H3A-024 ═══════════════════════ */

describe("checkMaxDepthGate / H3A-024", () => {
  it("specialist_worker 声明 dispatch_authority:true → FAIL", () => {
    const findings = checkMaxDepthGate([layeredRole({ layer: "specialist_worker", dispatchAuthority: true })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "H3A024-DISPATCH-AUTHORITY-ON-WORKER", severity: "FAIL" });
  });

  it("root/domain_orchestrator 声明 dispatch_authority:true 合法", () => {
    const findings = checkMaxDepthGate([
      layeredRole({ layer: "root_orchestrator", dispatchAuthority: true }),
      layeredRole({ layer: "domain_orchestrator", dispatchAuthority: true }),
    ]);
    expect(findings).toEqual([]);
  });

  it("specialist_worker 且 dispatch_authority:false 合法（默认态）", () => {
    expect(checkMaxDepthGate([layeredRole({ layer: "specialist_worker", dispatchAuthority: false })])).toEqual([]);
  });
});

/* ═══════════════════════ H3A-025 ═══════════════════════ */

describe("checkAuthorityMonotonicity / H3A-025", () => {
  it("root（supervisor:null）豁免，即使权限全开", () => {
    const root = layeredRole({ name: "coord-main", supervisor: null, mergeAuthority: true, dispatchAuthority: true });
    expect(checkAuthorityMonotonicity([root])).toEqual([]);
  });

  it("子角色权限是 supervisor 的子集 → 干净", () => {
    const root = layeredRole({ name: "coord-main", supervisor: null, mergeAuthority: true, dispatchAuthority: true });
    const child = layeredRole({ name: "coord-x", supervisor: "coord-main", mergeAuthority: false, dispatchAuthority: true });
    expect(checkAuthorityMonotonicity([root, child])).toEqual([]);
  });

  it("子角色 merge_authority:true 但 supervisor 是 false → FAIL", () => {
    const root = layeredRole({ name: "coord-main", supervisor: null, mergeAuthority: false });
    const child = layeredRole({ name: "coord-x", supervisor: "coord-main", mergeAuthority: true });
    const findings = checkAuthorityMonotonicity([root, child]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "H3A025-AUTHORITY-EXCEEDS-SUPERVISOR", severity: "FAIL" });
  });

  it("子角色 dispatch_authority:true 但 supervisor 是 false → FAIL", () => {
    const root = layeredRole({ name: "coord-main", supervisor: null, dispatchAuthority: false });
    const child = layeredRole({ name: "coord-x", supervisor: "coord-main", dispatchAuthority: true });
    const findings = checkAuthorityMonotonicity([root, child]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A025-AUTHORITY-EXCEEDS-SUPERVISOR");
  });

  it("supervisor 在集合里找不到 → FAIL（不能默默放行）", () => {
    const orphan = layeredRole({ name: "coord-x", supervisor: "coord-nonexistent" });
    const findings = checkAuthorityMonotonicity([orphan]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A025-SUPERVISOR-NOT-FOUND");
  });
});

/* ═══════════════════════ H3A-026 ═══════════════════════ */

describe("checkMergeSignoffGate / H3A-026", () => {
  it("root_orchestrator 声明 merge_authority:true 合法", () => {
    expect(checkMergeSignoffGate([layeredRole({ layer: "root_orchestrator", mergeAuthority: true })])).toEqual([]);
  });

  it.each(["domain_orchestrator", "specialist_worker"] as const)(
    "%s 声明 merge_authority:true → FAIL",
    (layer) => {
      const findings = checkMergeSignoffGate([layeredRole({ layer, mergeAuthority: true })]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ code: "H3A026-MERGE-AUTHORITY-NOT-ROOT", severity: "FAIL" });
    },
  );

  it("merge_authority:false 到处都合法", () => {
    const roles = (["root_orchestrator", "domain_orchestrator", "specialist_worker"] as const).map((layer) =>
      layeredRole({ layer, mergeAuthority: false }),
    );
    expect(checkMergeSignoffGate(roles)).toEqual([]);
  });
});

/* ═══════════════════════ H3A-027 ═══════════════════════ */

describe("checkProducerVerifierSeparation / H3A-027", () => {
  it("基线：agents/reviewers 无重叠，role kind 无冲突 → 干净", () => {
    const findings = checkProducerVerifierSeparation(
      new Set(["coord-main", "dev-x"]),
      new Set(["rev-feature"]),
      [layeredRole({ name: "coord-main", kind: "coordinator" }), layeredRole({ name: "rev-feature", kind: "reviewer" })],
    );
    expect(findings).toEqual([]);
  });

  it("同一 id 同时出现在 agents[] 和 reviewers[] → FAIL", () => {
    const findings = checkProducerVerifierSeparation(new Set(["coord-main"]), new Set(["coord-main"]), []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "H3A027-DUAL-IDENTITY", severity: "FAIL" });
  });

  it("同一角色名在不同文件里一次是 reviewer 一次不是 → FAIL", () => {
    const findings = checkProducerVerifierSeparation(new Set(), new Set(), [
      layeredRole({ name: "dup", kind: "reviewer", sourceFile: "roles/a.yaml" }),
      layeredRole({ name: "dup", kind: "worker", sourceFile: "roles/b.yaml" }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("H3A027-ROLE-KIND-CONFLICT");
  });

  it("同一角色名 kind 不同但都不是 reviewer（比如 worker vs module-coordinator）不算 producer/verifier 冲突", () => {
    const findings = checkProducerVerifierSeparation(new Set(), new Set(), [
      layeredRole({ name: "dup", kind: "worker", sourceFile: "roles/a.yaml" }),
      layeredRole({ name: "dup", kind: "module-coordinator", sourceFile: "roles/b.yaml" }),
    ]);
    expect(findings).toEqual([]);
  });
});

/* ═══════════════════════ H3A-029 ═══════════════════════ */

describe("checkRootDirectL3Exception / H3A-029", () => {
  it("reports_to:coord-main 且 kind:reviewer（唯一今天真实合法的例外）→ 干净", () => {
    const role = layeredRole({ name: "rev-feature", kind: "reviewer", layer: "specialist_worker", supervisor: "coord-main" });
    expect(checkRootDirectL3Exception([role])).toEqual([]);
  });

  it("reports_to:coord-main 且 layer:domain_orchestrator（正常 L1→L2）→ 干净", () => {
    const role = layeredRole({ name: "coord-x", kind: "module-coordinator", layer: "domain_orchestrator", supervisor: "coord-main" });
    expect(checkRootDirectL3Exception([role])).toEqual([]);
  });

  it("reports_to:coord-main 且 kind:worker（今天真实的迁移兼容缺口）→ WARN 不阻断", () => {
    const role = layeredRole({ name: "dev-ai-runtime", kind: "worker", layer: "specialist_worker", supervisor: "coord-main" });
    const findings = checkRootDirectL3Exception([role]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "H3A029-DIRECT-L3-NOT-REVIEWER", severity: "WARN" });
  });

  it("reports_to 不是 coord-main（正常多级链路）不触发这条规则", () => {
    const role = layeredRole({ name: "dev-x", kind: "worker", layer: "specialist_worker", supervisor: "coord-x" });
    expect(checkRootDirectL3Exception([role])).toEqual([]);
  });
});
