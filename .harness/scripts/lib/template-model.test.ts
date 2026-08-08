// template-model.test.ts — HMV2-007/008 的反证。
import { describe, expect, it } from "vitest";
import { validateInstanceMetadata, validateRegistry, validateRegistryEntry } from "./template-model";

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    template_id: "TPL-REQ-001",
    template_version: 1,
    name: "Requirement / Use Case",
    status: "active",
    owner: "coord-architecture",
    consumers: [],
    authority: "人工维护",
    ...overrides,
  };
}

describe("registry entry schema", () => {
  it("基线合法条目通过（否则下面全部反证都是空转）", () => {
    const r = validateRegistryEntry(validEntry(), 0);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it.each([
    ["TPL-req-001", "小写域码"],
    ["TPL-REQ-1", "流水号不是三位"],
    ["REQ-001", "缺 TPL 前缀"],
    ["", "空字符串"],
  ])("🔴 template_id=%s（%s）→ 红", (bad) => {
    const r = validateRegistryEntry(validEntry({ template_id: bad }), 0);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.endsWith("template_id"))).toBe(true);
  });

  it("🔴 template_version 非正整数 → 红", () => {
    expect(validateRegistryEntry(validEntry({ template_version: 0 }), 0).ok).toBe(false);
    expect(validateRegistryEntry(validEntry({ template_version: 1.5 }), 0).ok).toBe(false);
    expect(validateRegistryEntry(validEntry({ template_version: "1" }), 0).ok).toBe(false);
  });

  it("🔴 status 不在枚举内 → 红", () => {
    expect(validateRegistryEntry(validEntry({ status: "archived" }), 0).ok).toBe(false);
  });

  it("consumers 允许空数组，但字段缺失要红（不能靠 undefined 悄悄通过）", () => {
    expect(validateRegistryEntry(validEntry({ consumers: [] }), 0).ok).toBe(true);
    const { consumers, ...noConsumers } = validEntry();
    expect(validateRegistryEntry(noConsumers, 0).ok).toBe(false);
  });

  it("累加全部问题，不是遇到第一个就停", () => {
    const r = validateRegistryEntry({ template_id: "bad", template_version: -1 }, 0);
    expect(r.issues.length).toBeGreaterThanOrEqual(5); // template_id/version/name/status/owner/consumers/authority 里坏的那几项
  });
});

describe("registry 表级校验", () => {
  it("🔴 重复 template_id → 红，且指出是哪两条", () => {
    const r = validateRegistry({ entries: [validEntry(), validEntry()] });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("重复"))).toBe(true);
  });

  it("不同 template_id 的两条互不干扰", () => {
    const r = validateRegistry({ entries: [validEntry(), validEntry({ template_id: "TPL-FTR-001" })] });
    expect(r.ok).toBe(true);
    expect(r.value!.entries).toHaveLength(2);
  });

  it("🔴 顶层不是 { entries: [...] } 形状 → 红，不是抛异常崩溃", () => {
    expect(() => validateRegistry(null)).not.toThrow();
    expect(validateRegistry(null).ok).toBe(false);
    expect(validateRegistry({ foo: "bar" }).ok).toBe(false);
    expect(validateRegistry([]).ok).toBe(false);
  });
});

function validInstance(overrides: Record<string, unknown> = {}) {
  return {
    template_id: "TPL-EVT-001",
    template_version: 1,
    instance_id: "EVT-test-0001",
    status: "active",
    scope: { project: "workspacex", phase: "01" },
    refs: [],
    ...overrides,
  };
}

describe("instance metadata schema", () => {
  it("基线合法实例通过", () => {
    const r = validateInstanceMetadata(validInstance(), "f.yaml");
    expect(r.ok).toBe(true);
  });

  it("phase 允许 null（跨阶段实例）", () => {
    const r = validateInstanceMetadata(validInstance({ scope: { project: "workspacex", phase: null } }), "f.yaml");
    expect(r.ok).toBe(true);
  });

  it("refs 字段可以省略（等价空数组），但存在时必须是字符串数组", () => {
    const { refs, ...noRefs } = validInstance();
    expect(validateInstanceMetadata(noRefs, "f.yaml").ok).toBe(true);
    expect(validateInstanceMetadata({ ...noRefs, refs: [1, 2] }, "f.yaml").ok).toBe(false);
  });

  it("🔴 instance_id 空字符串 → 红", () => {
    expect(validateInstanceMetadata(validInstance({ instance_id: "" }), "f.yaml").ok).toBe(false);
  });

  it("🔴 scope.project 缺失 → 红", () => {
    expect(validateInstanceMetadata(validInstance({ scope: { phase: "01" } }), "f.yaml").ok).toBe(false);
  });

  it("报错信息带上 sourceFile，便于定位", () => {
    const r = validateInstanceMetadata(validInstance({ instance_id: "" }), "docs/foo.yaml");
    expect(r.issues[0]!.path).toContain("docs/foo.yaml");
  });
});
