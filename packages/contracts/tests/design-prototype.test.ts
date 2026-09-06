/**
 * `design-prototype` 契约（UC-17.8 B5.3）——三件事：
 *   1. `PrototypeNode` 正反例：容器/叶子形状、`.strict()` 拒未知 props、未知 type 拒。
 *   2. 整页上限：深度 / 节点数超限 ⇒ `PrototypeScreen` 拒。
 *   3. `DesignProject.prototype` 不变量：长度 0 或等于 `frames.length`。
 *   4. `PROTOTYPE_SCHEMA_GUIDE` 覆盖全部类型名（给模型看的说明与闭集不漂移）。
 */
import { describe, expect, it } from "vitest";
import * as dp from "../src/design-prototype";
import * as dw from "../src/design-workbench";
import * as ac from "../src/design-ai-collab";

const chatScreen: dp.PrototypeNode = {
  type: "stack",
  props: { direction: "column", gap: "md" },
  children: [
    { type: "navbar", props: { title: "ChatGPT", left: "☰", right: "新对话" } },
    {
      type: "stack",
      props: { fill: true, gap: "sm" },
      children: [
        { type: "card", children: [{ type: "text", props: { content: "帮我写一封邮件", variant: "body" } }] },
        { type: "card", children: [{ type: "text", props: { content: "好的，请告诉我收件人……", variant: "body", muted: true } }] },
      ],
    },
    { type: "input", props: { placeholder: "发送消息" } },
    { type: "button", props: { label: "发送", variant: "primary", full: true } },
  ],
};

describe("PrototypeNode", () => {
  it("正例：容器含叶子", () => {
    expect(dp.PrototypeNode.safeParse(chatScreen).success).toBe(true);
  });
  it("反例：未知 type / 未知 props / 叶子带 children / 容器缺 children", () => {
    expect(dp.PrototypeNode.safeParse({ type: "iframe", props: {} }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "text", props: { content: "x", color: "red" } }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "text", props: { content: "x" }, children: [] }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "stack" }).success).toBe(false);
  });
  it("measurePrototype：节点数与深度", () => {
    expect(dp.measurePrototype(chatScreen)).toEqual({ nodes: 9, depth: 4 });
    expect(dp.measurePrototype({ type: "divider" })).toEqual({ nodes: 1, depth: 1 });
  });
});

describe("PrototypeScreen 上限", () => {
  it("深度超过上限 ⇒ 拒", () => {
    let n: dp.PrototypeNode = { type: "divider" };
    for (let i = 0; i < dp.PROTOTYPE_MAX_DEPTH; i += 1) n = { type: "stack", children: [n] };
    expect(dp.measurePrototype(n).depth).toBe(dp.PROTOTYPE_MAX_DEPTH + 1);
    expect(dp.PrototypeScreen.safeParse({ frame: "f", root: n }).success).toBe(false);
  });
  it("节点数超过上限 ⇒ 拒；刚好不超 ⇒ 过", () => {
    const leaves = (k: number): dp.PrototypeNode[] => new Array(k).fill({ type: "divider" });
    expect(dp.PrototypeScreen.safeParse({ frame: "f", root: { type: "stack", children: leaves(dp.PROTOTYPE_MAX_NODES - 1) } }).success).toBe(true);
    expect(dp.PrototypeScreen.safeParse({ frame: "f", root: { type: "stack", children: leaves(dp.PROTOTYPE_MAX_NODES) } }).success).toBe(false);
  });
  it("写回：1–20 页；frame 标签非空", () => {
    expect(dp.DesignPrototypeWriteback.safeParse([]).success).toBe(false);
    expect(dp.DesignPrototypeWriteback.safeParse([{ frame: "", root: chatScreen }]).success).toBe(false);
    expect(ac.DesignChatWriteback.safeParse({ prototype: [{ frame: "聊天", root: chatScreen }] }).success).toBe(true);
    expect(ac.DesignWritebackField.options).toContain("prototype");
  });
});

describe("rawPrototypeDepth（解析前迭代探测）", () => {
  it("正常树给出真实深度；几千层嵌套不递归、到上限即停", () => {
    expect(dp.rawPrototypeDepth(chatScreen)).toBe(4);
    expect(dp.rawPrototypeDepth({ type: "divider" })).toBe(1);
    expect(dp.rawPrototypeDepth(null)).toBe(1);
    let n: unknown = { type: "divider" };
    for (let i = 0; i < 5000; i += 1) n = { type: "stack", children: [n] };
    expect(dp.rawPrototypeDepth(n)).toBe(dp.PROTOTYPE_MAX_DEPTH + 1);
    expect(dp.rawPrototypeDepth(n, 100)).toBe(100);
  });
});

describe("DesignProject.prototype 不变量", () => {
  const base = {
    id: "dp-1", name: "n", template: "ui" as const, problem: "", criteria: [], pushed: false, pushedAt: null,
    linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null, chat: [], ownerId: "u", ownerName: null,
    createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
  };
  it("空 = 还没生成，过；一页一棵，过；数目对不上，拒", () => {
    expect(dw.DesignProject.safeParse({ ...base, frames: ["a", "b"], prototype: [] }).success).toBe(true);
    expect(dw.DesignProject.safeParse({ ...base, frames: ["a", "b"], prototype: [chatScreen, chatScreen] }).success).toBe(true);
    expect(dw.DesignProject.safeParse({ ...base, frames: ["a", "b"], prototype: [chatScreen] }).success).toBe(false);
  });
});

describe("迭代 5 属性面板元数据（单源门控）", () => {
  it("每种类型：PROTOTYPE_FIELDS 的 key 集合 == 对应 *Props 的 shape 键集合；枚举 options 与 zod 一致", () => {
    for (const type of dp.PrototypeNodeType.options) {
      const schema = dp.PROTOTYPE_PROPS_SCHEMAS[type];
      const keys = schema === null ? [] : Object.keys(schema.shape).sort();
      expect([type, dp.PROTOTYPE_FIELDS[type].map((f) => f.key).sort()]).toEqual([type, keys]);
      for (const f of dp.PROTOTYPE_FIELDS[type]) {
        if (f.kind !== "enum" || schema === null) continue;
        const z = (schema.shape as Record<string, unknown>)[f.key] as { unwrap?: () => { options?: readonly string[] } } | undefined;
        const opts = z?.unwrap?.().options;
        if (opts !== undefined) expect([type, f.key, f.options]).toEqual([type, f.key, opts]);
      }
    }
  });
  it("setProps 里 null = 删键；拒绝原因是闭集且带 nodeId", () => {
    const base = dp.ensurePrototypeIds([{ type: "stack", children: [{ type: "button", props: { label: "x", variant: "danger" } }] }]);
    const out = dp.applyPrototypePatch(base, [{ op: "setProps", id: "n2", props: { variant: null } }]);
    expect((out[0] as { children: readonly dp.PrototypeNode[] }).children[0]).toEqual({ id: "n2", type: "button", props: { label: "x" } });
    try {
      dp.applyPrototypePatch(base, [{ op: "remove", id: "zzz" }]);
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(dp.PrototypePatchError);
      expect(e).toMatchObject({ reason: "UNKNOWN_NODE", nodeId: "zzz" });
      expect(dp.PrototypePatchRejectReason.safeParse((e as dp.PrototypePatchError).reason).success).toBe(true);
    }
  });
});

describe("迭代 6 原语扩充", () => {
  it("八种新原语正例；grid 是容器；闭集 21 种；bottomnav 2–6 项", () => {
    const page: dp.PrototypeNode = {
      type: "stack", children: [
        { type: "hero", props: { title: "本月用量", subtitle: "已用 68%", cta: "升级" } },
        { type: "grid", props: { columns: 2 }, children: [
          { type: "stat", props: { label: "对话数", value: "1,284", delta: "+12%", tone: "success" } },
          { type: "progress", props: { value: 68, label: "配额" } },
        ] },
        { type: "chip", props: { label: "本周", selected: true } },
        { type: "switch", props: { label: "提醒", on: true } },
        { type: "checkbox", props: { label: "含测试" } },
        { type: "bottomnav", props: { items: ["聊天", "用量"], active: 1 } },
      ],
    };
    expect(dp.PrototypeNode.safeParse(page).success).toBe(true);
    expect(dp.PrototypeNodeType.options).toHaveLength(21);
    expect(dp.isPrototypeContainer({ type: "grid", children: [] })).toBe(true);
    expect(dp.isPrototypeContainer({ type: "hero", props: { title: "x" } })).toBe(false);
    expect(dp.measurePrototype(page)).toEqual({ nodes: 9, depth: 3 });
    expect(dp.PrototypeNode.safeParse({ type: "bottomnav", props: { items: ["只有一项"] } }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "progress", props: { value: 120 } }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "grid", props: { columns: 4 }, children: [] }).success).toBe(false);
    // patch 能进 grid
    const withIds = dp.ensurePrototypeIds([page]);
    const gridId = (withIds[0] as { children: dp.PrototypeNode[] }).children[1]!.id!;
    const out = dp.applyPrototypePatch(withIds, [{ op: "insert", parentId: gridId, node: { type: "stat", props: { label: "新", value: "1" } } }]);
    expect(dp.measurePrototype(out[0]!).nodes).toBe(10);
  });
});

describe("PROTOTYPE_SCHEMA_GUIDE", () => {
  it("每个原语类型都出现在给模型看的说明里", () => {
    for (const t of dp.PrototypeNodeType.options) expect(dp.PROTOTYPE_SCHEMA_GUIDE).toContain(t);
  });
});

/* ─────────────── 迭代 1：节点 id + patch ─────────────── */

describe("ensurePrototypeIds", () => {
  it("补齐缺失 id、保留已有、跨页唯一、幂等", () => {
    const page1: dp.PrototypeNode = { type: "stack", children: [{ id: "n2", type: "divider" }, { type: "divider" }] };
    const page2: dp.PrototypeNode = { type: "stack", id: "hero", children: [{ type: "text", props: { content: "x" } }] };
    const out = dp.ensurePrototypeIds([page1, page2]);
    expect(dp.prototypeIdsUnique(out)).toBe(true);
    const ids: string[] = [];
    const walk = (n: dp.PrototypeNode) => { ids.push(n.id ?? "?"); if (n.type === "stack" || n.type === "card") n.children.forEach(walk); };
    out.forEach(walk);
    expect(ids).toEqual(["n1", "n2", "n3", "hero", "n4"]); // n2 已占用被跳过
    expect(dp.ensurePrototypeIds(out)).toBe(out); // 幂等：引用相等
  });
  it("重复 id：第二次出现的重新分配，输出唯一", () => {
    const dup = dp.ensurePrototypeIds([
      { type: "stack", id: "a", children: [{ type: "divider", id: "a" }, { type: "divider", id: "n1" }] },
      { type: "text", id: "a", props: { content: "x" } },
    ]);
    const ids: string[] = [];
    const walk = (n: dp.PrototypeNode) => { ids.push(n.id ?? "?"); if (n.type === "stack" || n.type === "card") n.children.forEach(walk); };
    dup.forEach(walk);
    expect(ids).toEqual(["a", "n2", "n1", "n3"]);
    expect(dp.prototypeIdsUnique(dup)).toBe(true);
  });
});

describe("applyPrototypePatch", () => {
  const base = dp.ensurePrototypeIds([
    { type: "stack", children: [
      { type: "navbar", props: { title: "首页" } },
      { type: "stack", children: [{ type: "text", props: { content: "hi" } }] },
      { type: "button", props: { label: "发送" } },
    ] },
  ]);
  // ids: n1(stack) n2(navbar) n3(stack) n4(text) n5(button)

  it("setProps 浅合并；replace 换子树并保留 id；insert 按 index；remove 删子树；新节点补 id", () => {
    const out = dp.applyPrototypePatch(base, [
      { op: "setProps", id: "n5", props: { variant: "danger" } },
      { op: "replace", id: "n4", node: { type: "text", props: { content: "hello" } } },
      { op: "insert", parentId: "n3", index: 0, node: { type: "badge", props: { label: "新" } } },
      { op: "remove", id: "n2" },
    ]);
    const root = out[0]!;
    if (root.type !== "stack") throw new Error("root");
    expect(root.children.map((c) => c.id)).toEqual(["n3", "n5"]);
    expect(root.children[1]).toMatchObject({ type: "button", props: { label: "发送", variant: "danger" } });
    const inner = root.children[0]!;
    if (inner.type !== "stack") throw new Error("inner");
    expect(inner.children.map((c) => [c.type, c.id])).toEqual([["badge", "n6"], ["text", "n4"]]);
    expect(inner.children[1]).toMatchObject({ props: { content: "hello" } });
    // replace 时 node 自带的 id 被忽略，沿用被替换节点的 id；同批后续 op 仍能按原 id 寻址
    const kept = dp.applyPrototypePatch(base, [
      { op: "replace", id: "n4", node: { id: "custom", type: "badge", props: { label: "x" } } },
      { op: "setProps", id: "n4", props: { tone: "info" } },
    ]);
    const k = kept[0]!; if (k.type !== "stack") throw new Error();
    const ki = k.children[1]!; if (ki.type !== "stack") throw new Error();
    expect(ki.children[0]).toMatchObject({ id: "n4", type: "badge", props: { label: "x", tone: "info" } });
    expect(base[0]).toBe(base[0]); // 入参未改
    expect(dp.prototypeIdsUnique(out)).toBe(true);
  });

  it("失败整批抛：未知 id / 删根 / 往叶子里 insert / setProps 造出非法节点", () => {
    expect(() => dp.applyPrototypePatch(base, [{ op: "remove", id: "nope" }])).toThrow(dp.PrototypePatchError);
    expect(() => dp.applyPrototypePatch(base, [{ op: "remove", id: "n1" }])).toThrow(/page root/);
    expect(() => dp.applyPrototypePatch(base, [{ op: "insert", parentId: "n5", node: { type: "divider" } }])).toThrow(/not a container/);
    expect(() => dp.applyPrototypePatch(base, [{ op: "setProps", id: "n5", props: { variant: "neon" } }])).toThrow(/invalid node/);
  });

  it("契约：patch 数组 1–50 条；PATCH_GUIDE 提到四种 op", () => {
    expect(dp.DesignPrototypePatch.safeParse([]).success).toBe(false);
    expect(ac.DesignChatWriteback.safeParse({ patch: [{ op: "remove", id: "n2" }] }).success).toBe(true);
    for (const op of ["setProps", "replace", "insert", "remove"]) expect(dp.PROTOTYPE_PATCH_GUIDE).toContain(op);
  });
});
