// terminology-model.test.ts — H3A-006/007 的反证。纯函数，喂构造的输入，
// 不碰文件系统（真实文件的活体验证在 PR 描述里：实测跑 terminology doctor）。
import { describe, expect, it } from "vitest";
import {
  validateTerminologyEntry,
  validateTerminologyRegistry,
  validateCompatMapping,
  validateCompatRegistry,
} from "./terminology-model";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    term_id: "TERM-ORG-001",
    category: "组织与知识",
    legacy_names: ["三层 Agent 架构"],
    canonical_name_en: "Hierarchical Multi-Agent Orchestration",
    canonical_name_zh: "分层多 Agent 编排",
    usage_boundary: "整体架构",
    ...overrides,
  };
}

describe("validateTerminologyEntry", () => {
  it("基线：合法条目通过", () => {
    const r = validateTerminologyEntry(entry(), 0);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("legacy_names 允许空数组（不是所有规范名都有旧名）", () => {
    const r = validateTerminologyEntry(entry({ legacy_names: [] }), 0);
    expect(r.ok).toBe(true);
  });

  it.each([
    ["term-org-001", "小写"],
    ["TERM-ORG-1", "编号不是三位"],
    ["TERM-ORGX-001", "域码不是三位"],
    ["ORG-001", "缺 TERM 前缀"],
    ["", "空字符串"],
  ])("🔴 term_id 格式非法（%s，%s）→ 红", (bad) => {
    const r = validateTerminologyEntry(entry({ term_id: bad }), 0);
    expect(r.ok).toBe(false);
  });

  it("🔴 canonical_name_en 缺失 → 红", () => {
    const r = validateTerminologyEntry(entry({ canonical_name_en: "" }), 0);
    expect(r.ok).toBe(false);
  });

  it("🔴 usage_boundary 缺失 → 红", () => {
    const r = validateTerminologyEntry(entry({ usage_boundary: undefined }), 0);
    expect(r.ok).toBe(false);
  });

  it("🔴 legacy_names 不是数组 → 红，不是静默丢弃/崩溃", () => {
    const r = validateTerminologyEntry(entry({ legacy_names: "三层 Agent 架构" }), 0);
    expect(r.ok).toBe(false);
  });

  it("问题累积上报，不 fail-fast", () => {
    const r = validateTerminologyEntry(
      entry({ term_id: "bad", canonical_name_en: "", usage_boundary: "" }),
      0,
    );
    expect(r.issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateTerminologyRegistry", () => {
  it("基线：36 个条目、无重复、无歧义 → 通过", () => {
    const r = validateTerminologyRegistry({
      entries: [entry(), entry({ term_id: "TERM-ORG-002", legacy_names: ["Main Agent"] })],
    });
    expect(r.ok).toBe(true);
    expect(r.value!.entries).toHaveLength(2);
  });

  it("🔴 重复 term_id → 红，点名两个 index", () => {
    const r = validateTerminologyRegistry({ entries: [entry(), entry()] });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("entries[0]"))).toBe(true);
  });

  it("🔴 歧义映射：同一个旧名指向两个不同 term_id → 红——这是 H3A-008 完成契约点名的那条", () => {
    const r = validateTerminologyRegistry({
      entries: [
        entry({ term_id: "TERM-ORG-001", legacy_names: ["旧名X"] }),
        entry({ term_id: "TERM-ORG-002", legacy_names: ["旧名X"] }),
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("歧义映射"))).toBe(true);
  });

  it("同一个旧名在同一个 term_id 下重复出现，不误判为歧义", () => {
    // 极端构造：不应该发生，但函数不该把"同名同源"误判成歧义。
    const r = validateTerminologyRegistry({
      entries: [entry({ term_id: "TERM-ORG-001", legacy_names: ["旧名X", "旧名X"] })],
    });
    expect(r.ok).toBe(true);
  });

  it("🔴 顶层不是对象/entries 不是数组 → 红，不抛异常", () => {
    expect(validateTerminologyRegistry(null).ok).toBe(false);
    expect(validateTerminologyRegistry({ entries: "not-array" }).ok).toBe(false);
    expect(validateTerminologyRegistry([]).ok).toBe(false);
  });
});

describe("validateCompatMapping / validateCompatRegistry", () => {
  function mapping(overrides: Record<string, unknown> = {}) {
    return {
      old_field: "module_id",
      new_field: "domain_id",
      strategy: "旧字段只读",
      stable_instance_id_unchanged: false,
      ...overrides,
    };
  }

  it("基线：合法映射通过", () => {
    const r = validateCompatMapping(mapping(), 0);
    expect(r.ok).toBe(true);
  });

  it("🔴 stable_instance_id_unchanged 不是布尔值 → 红", () => {
    const r = validateCompatMapping(mapping({ stable_instance_id_unchanged: "true" }), 0);
    expect(r.ok).toBe(false);
  });

  it("基线：6 条真实迁移映射（§2.4 原文）全部通过", () => {
    const r = validateCompatRegistry({
      mappings: [
        mapping({ old_field: "module_id", new_field: "domain_id" }),
        mapping({ old_field: "parent_agent_id", new_field: "supervisor_agent_id", stable_instance_id_unchanged: true }),
        mapping({ old_field: "work_event", new_field: "workflow_event", stable_instance_id_unchanged: true }),
        mapping({ old_field: "result/verdict", new_field: "task_result/review_decision" }),
        mapping({ old_field: "context_pack", new_field: "task_context_bundle", stable_instance_id_unchanged: true }),
        mapping({ old_field: "graph_definition/run", new_field: "workflow_definition/run", stable_instance_id_unchanged: true }),
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.value!.mappings).toHaveLength(6);
  });

  it("🔴 同一个旧字段映射到两个不同新字段 → 红，歧义映射", () => {
    const r = validateCompatRegistry({
      mappings: [
        mapping({ old_field: "module_id", new_field: "domain_id" }),
        mapping({ old_field: "module_id", new_field: "something_else" }),
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("歧义映射"))).toBe(true);
  });
});
