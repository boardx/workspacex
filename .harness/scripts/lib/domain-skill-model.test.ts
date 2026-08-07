// domain-skill-model.test.ts — H3A-012 的反证。纯函数，喂构造的输入，不碰文件系统。
import { describe, expect, it } from "vitest";
import { validateDomainSkillInstance, looksLikeDomainSkillInstance } from "./domain-skill-model";

function instance(overrides: Record<string, unknown> = {}) {
  return {
    template_id: "TPL-MOD-001",
    template_version: 1,
    instance_id: "MODKNOW-canvas-diagram",
    skill_id: "SKL-MOD-CANVAS-001",
    domain_id: "DOM-CANVAS-DIAGRAM",
    status: "active",
    authority_refs: { contracts: [], adrs: [], source_paths: [], verification: [] },
    last_verified: { commit: null, evidence_refs: [] },
    ...overrides,
  };
}

describe("looksLikeDomainSkillInstance", () => {
  it("template_id === TPL-MOD-001 → true", () => {
    expect(looksLikeDomainSkillInstance({ template_id: "TPL-MOD-001" })).toBe(true);
  });
  it("其他 template_id → false（不是我们的目标文件）", () => {
    expect(looksLikeDomainSkillInstance({ template_id: "TPL-ROL-001" })).toBe(false);
  });
  it("没有 template_id 字段（比如普通 skill 的 name/description frontmatter）→ false", () => {
    expect(looksLikeDomainSkillInstance({ name: "mod-_template", description: "..." })).toBe(false);
  });
  it("非对象 → false", () => {
    expect(looksLikeDomainSkillInstance(null)).toBe(false);
    expect(looksLikeDomainSkillInstance("TPL-MOD-001")).toBe(false);
  });
});

describe("validateDomainSkillInstance", () => {
  it("基线：合法实例通过", () => {
    const r = validateDomainSkillInstance(instance(), "fixture.md");
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("last_verified.commit 允许 null（从未验证过）", () => {
    const r = validateDomainSkillInstance(instance({ last_verified: { commit: null, evidence_refs: [] } }), "f.md");
    expect(r.ok).toBe(true);
  });

  it("🔴 template_id 不是 TPL-MOD-001 → 红", () => {
    const r = validateDomainSkillInstance(instance({ template_id: "TPL-ROL-001" }), "f.md");
    expect(r.ok).toBe(false);
  });

  it("🔴 template_version 不是正整数 → 红", () => {
    expect(validateDomainSkillInstance(instance({ template_version: 0 }), "f.md").ok).toBe(false);
    expect(validateDomainSkillInstance(instance({ template_version: 1.5 }), "f.md").ok).toBe(false);
  });

  it.each([
    ["skl-mod-canvas-001", "小写"],
    ["SKL-CANVAS-001", "缺 MOD"],
    ["SKL-MOD-CANVAS-1", "编号不是三位"],
  ])("🔴 skill_id 格式非法（%s，%s）→ 红", (bad) => {
    const r = validateDomainSkillInstance(instance({ skill_id: bad }), "f.md");
    expect(r.ok).toBe(false);
  });

  it("🔴 domain_id 缺失 → 红", () => {
    const r = validateDomainSkillInstance(instance({ domain_id: "" }), "f.md");
    expect(r.ok).toBe(false);
  });

  it("🔴 status 不在枚举里 → 红", () => {
    const r = validateDomainSkillInstance(instance({ status: "unknown" }), "f.md");
    expect(r.ok).toBe(false);
  });

  it("status 接受 superseded / retired", () => {
    expect(validateDomainSkillInstance(instance({ status: "superseded" }), "f.md").ok).toBe(true);
    expect(validateDomainSkillInstance(instance({ status: "retired" }), "f.md").ok).toBe(true);
  });

  it("🔴 authority_refs 缺字段（比如缺 adrs）→ 红", () => {
    const r = validateDomainSkillInstance(
      instance({ authority_refs: { contracts: [], source_paths: [], verification: [] } }),
      "f.md",
    );
    expect(r.ok).toBe(false);
  });

  it("🔴 authority_refs 不是对象 → 红", () => {
    const r = validateDomainSkillInstance(instance({ authority_refs: null }), "f.md");
    expect(r.ok).toBe(false);
  });

  it("🔴 last_verified.commit 是空字符串（不是 null，是真的空）→ 红", () => {
    const r = validateDomainSkillInstance(instance({ last_verified: { commit: "", evidence_refs: [] } }), "f.md");
    expect(r.ok).toBe(false);
  });

  it("🔴 last_verified.evidence_refs 缺失 → 红", () => {
    const r = validateDomainSkillInstance(instance({ last_verified: { commit: null } }), "f.md");
    expect(r.ok).toBe(false);
  });

  it("问题累积上报，不 fail-fast", () => {
    const r = validateDomainSkillInstance(
      instance({ template_id: "bad", skill_id: "bad", status: "nope" }),
      "f.md",
    );
    expect(r.issues.length).toBeGreaterThanOrEqual(3);
  });
});
