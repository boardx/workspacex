// template-id.test.ts — HMV2-009 的反证。跟随 adr-id.test.ts 的验证方式：
// 纯函数，喂构造的 id 列表，不碰文件系统。
import { describe, expect, it } from "vitest";
import { findTemplateIdConflict, nextTemplateId, parseTemplateId } from "./template-id";
import type { TemplateRegistryEntry } from "./template-model";

describe("parseTemplateId", () => {
  it("正确拆出域码与数字", () => {
    expect(parseTemplateId("TPL-REQ-003")).toEqual({ domain: "REQ", number: 3 });
  });

  it.each(["req-003", "TPL-REQ-3", "TPL-RE-003", "TPL-REQQ-003", "not-a-tpl-id"])(
    "🔴 非法格式 %s → null，不抛异常",
    (bad) => {
      expect(parseTemplateId(bad)).toBeNull();
    },
  );
});

describe("nextTemplateId —— 域内严格递增", () => {
  it("空域 → 001 起", () => {
    expect(nextTemplateId("REQ", [])).toBe("TPL-REQ-001");
  });

  it("已有 001/002 → 003", () => {
    expect(nextTemplateId("REQ", ["TPL-REQ-001", "TPL-REQ-002"])).toBe("TPL-REQ-003");
  });

  it("🔴 不同域码互不干扰 —— FTR 域已经到 005，不该影响 REQ 域从 001 起", () => {
    expect(nextTemplateId("REQ", ["TPL-FTR-005"])).toBe("TPL-REQ-001");
  });

  it("取 max+1，不是取「下一个空位」（中间空洞不回填，同 ADR 序列同一策略）", () => {
    // 故意留一个空洞：001 存在，002 不存在，003 存在
    expect(nextTemplateId("REQ", ["TPL-REQ-001", "TPL-REQ-003"])).toBe("TPL-REQ-004");
  });

  it("🔴 非法域码格式（非三位大写字母）→ 抛错，不静默生成一个坏 id", () => {
    expect(() => nextTemplateId("re", [])).toThrow();
    expect(() => nextTemplateId("REQQ", [])).toThrow();
    expect(() => nextTemplateId("123", [])).toThrow();
  });
});

function entry(id: string): TemplateRegistryEntry {
  return {
    template_id: id, template_version: 1, name: "x", status: "active",
    owner: "coord-architecture", consumers: [], authority: "人工维护",
  };
}

describe("findTemplateIdConflict —— 显式 --id 路径", () => {
  it("没有冲突时返回 null", () => {
    expect(findTemplateIdConflict("TPL-REQ-002", [entry("TPL-REQ-001")])).toBeNull();
  });

  it("🔴 已被占用 → 返回非 null 且点名占用者", () => {
    const msg = findTemplateIdConflict("TPL-REQ-001", [entry("TPL-REQ-001")]);
    expect(msg).not.toBeNull();
    expect(msg).toContain("TPL-REQ-001");
  });
});
