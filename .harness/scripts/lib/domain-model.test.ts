// domain-model.test.ts — H3A-010 的反证。纯函数，喂构造的输入，不碰文件系统
// （真实 registry.yaml 的活体验证在 PR 描述里：实测跑 `pnpm harness domains doctor`）。
import { describe, expect, it } from "vitest";
import { validateDomainEntry, validateDomainRegistry } from "./domain-model";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    domain_id: "DOM-CHAT",
    name: "Chat / 对话",
    owner: "coord-chat-e2e",
    areas: ["chat"],
    contracts: ["phases/phase-01-run-a-project/contracts/chat"],
    verification: [],
    status: "active",
    ...overrides,
  };
}

describe("validateDomainEntry", () => {
  it("基线：合法条目通过", () => {
    const r = validateDomainEntry(entry(), 0);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("owner 允许为 null（今天没有唯一权威 owner 是诚实状态，不是校验失败）", () => {
    const r = validateDomainEntry(entry({ owner: null }), 0);
    expect(r.ok).toBe(true);
    expect(r.value!.owner).toBeNull();
  });

  it("contracts/verification 允许空数组", () => {
    const r = validateDomainEntry(entry({ contracts: [], verification: [] }), 0);
    expect(r.ok).toBe(true);
  });

  it.each([
    ["dom-chat", "小写"],
    ["DOMAIN-CHAT", "前缀不是 DOM"],
    ["DOM-", "缺内容"],
    ["", "空字符串"],
  ])("🔴 domain_id 格式非法（%s，%s）→ 红", (bad) => {
    const r = validateDomainEntry(entry({ domain_id: bad }), 0);
    expect(r.ok).toBe(false);
  });

  it("domain_id 允许多段连字符（如 DOM-CANVAS-DIAGRAM）", () => {
    const r = validateDomainEntry(entry({ domain_id: "DOM-CANVAS-DIAGRAM" }), 0);
    expect(r.ok).toBe(true);
  });

  it("🔴 name 缺失 → 红", () => {
    const r = validateDomainEntry(entry({ name: "" }), 0);
    expect(r.ok).toBe(false);
  });

  it("🔴 owner 是空字符串（不是 null，是真的空）→ 红", () => {
    const r = validateDomainEntry(entry({ owner: "" }), 0);
    expect(r.ok).toBe(false);
  });

  it("🔴 areas 是空数组 → 红（至少 1 个）", () => {
    const r = validateDomainEntry(entry({ areas: [] }), 0);
    expect(r.ok).toBe(false);
  });

  it("🔴 areas 不是数组 → 红", () => {
    const r = validateDomainEntry(entry({ areas: "chat" }), 0);
    expect(r.ok).toBe(false);
  });

  it("🔴 contracts 缺失字段本身 → 红（不是「可以为空」，是「必须存在」）", () => {
    const r = validateDomainEntry(entry({ contracts: undefined }), 0);
    expect(r.ok).toBe(false);
  });

  it("🔴 status 不在枚举里 → 红", () => {
    const r = validateDomainEntry(entry({ status: "proposed" }), 0);
    expect(r.ok).toBe(false);
  });

  it("status 接受 deprecated", () => {
    const r = validateDomainEntry(entry({ status: "deprecated" }), 0);
    expect(r.ok).toBe(true);
  });

  it("问题累积上报，不 fail-fast", () => {
    const r = validateDomainEntry(entry({ domain_id: "bad", name: "", status: "nope" }), 0);
    expect(r.issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateDomainRegistry", () => {
  it("基线：多条不重复 → 通过", () => {
    const r = validateDomainRegistry({
      entries: [entry(), entry({ domain_id: "DOM-PLATFORM", areas: ["platform"] })],
    });
    expect(r.ok).toBe(true);
    expect(r.value!.entries).toHaveLength(2);
  });

  it("🔴 重复 domain_id → 红，点名两个 index", () => {
    const r = validateDomainRegistry({ entries: [entry(), entry()] });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("重复"))).toBe(true);
  });

  it("🔴 顶层不是 { entries: [...] } 形状 → 红", () => {
    expect(validateDomainRegistry(null).ok).toBe(false);
    expect(validateDomainRegistry({}).ok).toBe(false);
    expect(validateDomainRegistry({ entries: "nope" }).ok).toBe(false);
  });

  it("单条非法条目的 issues 会带着 index 冒泡到整体结果", () => {
    const r = validateDomainRegistry({ entries: [entry({ domain_id: "bad" })] });
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.path).toBe("entries[0].domain_id");
  });
});
