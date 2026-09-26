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

/** 迭代 11：`applyPrototypePatch` 收的是屏（`{root, links}`），这两个小工具把既有用例的裸树用法接过去。 */
const asScreens = (roots: readonly dp.PrototypeNode[]) => roots.map((root) => ({ root }));
const rootsOf = (screens: readonly { readonly root: dp.PrototypeNode }[]) => screens.map((s) => s.root);

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
    id: "dp-1", name: "n", template: "ui" as const, problem: "", criteria: [], frameNotes: [], pushed: false, pushedAt: null,
    linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null, chat: [], ownerId: "u", ownerName: null,
    createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
  };
  it("空 = 还没生成，过；一页一棵，过；数目对不上，拒", () => {
    expect(dw.DesignProject.safeParse({ ...base, frames: ["a", "b"], prototype: [] }).success).toBe(true);
    expect(dw.DesignProject.safeParse({ ...base, frames: ["a", "b"], prototype: [chatScreen, chatScreen] }).success).toBe(true);
    expect(dw.DesignProject.safeParse({ ...base, frames: ["a", "b"], prototype: [chatScreen] }).success).toBe(false);
    // 迭代 8：frameNotes 同样按位置对应
    expect(dw.DesignProject.safeParse({ ...base, frames: ["a", "b"], prototype: [], frameNotes: ["x"] }).success).toBe(false);
    expect(dw.DesignProject.safeParse({ ...base, frames: ["a", "b"], prototype: [], frameNotes: ["x", ""] }).success).toBe(true);
    expect(dp.PrototypeScreen.safeParse({ frame: "f", root: chatScreen, notes: "首屏即可发消息" }).success).toBe(true);
    expect(dp.PrototypeScreen.safeParse({ frame: "f", root: chatScreen, notes: "x".repeat(dp.PROTOTYPE_NOTES_MAX + 1) }).success).toBe(false);
  });
});

describe("迭代 28 枚举取值的中文档位（覆盖率门控）", () => {
  it("PROTOTYPE_FIELDS 里每一个 enum option 都查得到中文——漏一个就判失败", () => {
    const missing: string[] = [];
    for (const type of dp.PrototypeNodeType.options) {
      for (const f of dp.PROTOTYPE_FIELDS[type]) {
        if (f.kind !== "enum") continue;
        for (const o of f.options ?? []) {
          // 查不到中文时 `prototypeOptionLabel` 原样返回英文值——那正是要挡的情况。
          if (dp.prototypeOptionLabel(type, f.key, o) === o) missing.push(`${type}.${f.key}=${o}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("同名不同义的字段按 `<类型>.<key>` 取到各自的话，其余走字段级", () => {
    expect(dp.prototypeOptionLabel("stack", "align", "start")).toBe("贴着起点");
    expect(dp.prototypeOptionLabel("text", "align", "start")).toBe("靠左");
    expect(dp.prototypeOptionLabel("button", "variant", "primary")).toBe("主按钮");
    expect(dp.prototypeOptionLabel("text", "variant", "body")).toBe("正文");
  });

  it("没登记的取值原样返回，不抛", () => {
    expect(dp.prototypeOptionLabel("button", "variant", "不存在的值")).toBe("不存在的值");
    expect(dp.prototypeOptionLabel("button", "不存在的字段", "x")).toBe("x");
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
        const z = (schema.shape as Record<string, unknown>)[f.key] as { unwrap?: () => { options?: readonly unknown[] } } | undefined;
        // ⚠ `z.enum` 的 `.options` 是**值**，`z.union([z.literal(2), …])` 的 `.options` 是
        //   ZodLiteral **对象**——直接 `String()` 会得到 "[object Object]"，而那样的比对
        //   两边都是它，会静悄悄地通过。所以对象要先取 `.value`。
        const opts = z?.unwrap?.().options?.map((o) =>
          typeof o === "object" && o !== null && "value" in o ? (o as { value: unknown }).value : o,
        ) as readonly (string | number)[] | undefined;
        // 迭代 13：`numeric: true` 的档位字段在 schema 里是数字字面量的 union（`grid.columns`），
        // 面板里展示为字符串档位——比对时按 `String` 折一次，仍然是**同一份** zod 派生的闭集。
        if (opts !== undefined) {
          expect([type, f.key, f.options]).toEqual([type, f.key, f.numeric === true ? opts.map(String) : opts]);
        }
      }
    }
  });
  it("setProps 里 null = 删键；拒绝原因是闭集且带 nodeId", () => {
    const base = dp.ensurePrototypeIds([{ type: "stack", children: [{ type: "button", props: { label: "x", variant: "danger" } }] }]);
    const out = dp.applyPrototypePatch(asScreens(base), [{ op: "setProps", id: "n2", props: { variant: null } }]);
    expect((out[0]!.root as { children: readonly dp.PrototypeNode[] }).children[0]).toEqual({ id: "n2", type: "button", props: { label: "x" } });
    try {
      dp.applyPrototypePatch(asScreens(base), [{ op: "remove", id: "zzz" }]);
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(dp.PrototypePatchError);
      expect(e).toMatchObject({ reason: "UNKNOWN_NODE", nodeId: "zzz" });
      expect(dp.PrototypePatchRejectReason.safeParse((e as dp.PrototypePatchError).reason).success).toBe(true);
    }
  });
});

describe("迭代 7 coercePrototypeRaw", () => {
  it("只修机械格式错，不猜缺失必填、不删未知键；非对象原样返回", () => {
    expect(dp.coercePrototypeRaw({ type: " CARD ", props: { title: "t", bogus: 1 } })).toEqual({ type: "card", props: { title: "t", bogus: 1 }, children: [] });
    expect(dp.coercePrototypeRaw({ type: "tabs", props: { items: ["a"], active: "1" } })).toEqual({ type: "tabs", props: { items: ["a"], active: 1 } });
    expect(dp.coercePrototypeRaw({ type: "input", props: { value: "123" } })).toEqual({ type: "input", props: { value: "123" } }); // 字符串型 value 不动
    expect(dp.coercePrototypeRaw({ type: "button" })).toEqual({ type: "button" }); // 缺 props 不补
    expect(dp.coercePrototypeRaw("x")).toBe("x");
    expect(dp.coercePrototypeRaw(null)).toBe(null);
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
    // 对标 R3：+ table / chart；R4：+ select / radio / overlay；R5：+ section / footer。
    expect(dp.PrototypeNodeType.options).toHaveLength(28);
    expect(dp.isPrototypeContainer({ type: "grid", children: [] })).toBe(true);
    expect(dp.isPrototypeContainer({ type: "hero", props: { title: "x" } })).toBe(false);
    expect(dp.measurePrototype(page)).toEqual({ nodes: 9, depth: 3 });
    expect(dp.PrototypeNode.safeParse({ type: "bottomnav", props: { items: ["只有一项"] } }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "progress", props: { value: 120 } }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "grid", props: { columns: 4 }, children: [] }).success).toBe(false);
    // active 必须指向真实存在的项（Codex）
    expect(dp.PrototypeNode.safeParse({ type: "bottomnav", props: { items: ["a", "b"], active: 2 } }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "tabs", props: { items: ["a"], active: 1 } }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "tabs", props: { items: ["a"], active: 0 } }).success).toBe(true);
    // patch 能进 grid
    const withIds = dp.ensurePrototypeIds([page]);
    const gridId = (withIds[0] as { children: readonly dp.PrototypeNode[] }).children[1]!.id!;
    const out = dp.applyPrototypePatch(asScreens(withIds), [{ op: "insert", parentId: gridId, node: { type: "stat", props: { label: "新", value: "1" } } }]);
    expect(dp.measurePrototype(out[0]!.root).nodes).toBe(10);
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
    const out = dp.applyPrototypePatch(asScreens(base), [
      { op: "setProps", id: "n5", props: { variant: "danger" } },
      { op: "replace", id: "n4", node: { type: "text", props: { content: "hello" } } },
      { op: "insert", parentId: "n3", index: 0, node: { type: "badge", props: { label: "新" } } },
      { op: "remove", id: "n2" },
    ]);
    const root = out[0]!.root;
    if (root.type !== "stack") throw new Error("root");
    expect(root.children.map((c) => c.id)).toEqual(["n3", "n5"]);
    expect(root.children[1]).toMatchObject({ type: "button", props: { label: "发送", variant: "danger" } });
    const inner = root.children[0]!;
    if (inner.type !== "stack") throw new Error("inner");
    expect(inner.children.map((c) => [c.type, c.id])).toEqual([["badge", "n6"], ["text", "n4"]]);
    expect(inner.children[1]).toMatchObject({ props: { content: "hello" } });
    // replace 时 node 自带的 id 被忽略，沿用被替换节点的 id；同批后续 op 仍能按原 id 寻址
    const kept = dp.applyPrototypePatch(asScreens(base), [
      { op: "replace", id: "n4", node: { id: "custom", type: "badge", props: { label: "x" } } },
      { op: "setProps", id: "n4", props: { tone: "info" } },
    ]);
    const k = kept[0]!.root; if (k.type !== "stack") throw new Error();
    const ki = k.children[1]!; if (ki.type !== "stack") throw new Error();
    expect(ki.children[0]).toMatchObject({ id: "n4", type: "badge", props: { label: "x", tone: "info" } });
    expect(base[0]).toBe(base[0]); // 入参未改
    expect(dp.prototypeIdsUnique(rootsOf(out))).toBe(true);
  });

  it("失败整批抛：未知 id / 删根 / 往叶子里 insert / setProps 造出非法节点", () => {
    expect(() => dp.applyPrototypePatch(asScreens(base), [{ op: "remove", id: "nope" }])).toThrow(dp.PrototypePatchError);
    expect(() => dp.applyPrototypePatch(asScreens(base), [{ op: "remove", id: "n1" }])).toThrow(/page root/);
    expect(() => dp.applyPrototypePatch(asScreens(base), [{ op: "insert", parentId: "n5", node: { type: "divider" } }])).toThrow(/not a container/);
    expect(() => dp.applyPrototypePatch(asScreens(base), [{ op: "setProps", id: "n5", props: { variant: "neon" } }])).toThrow(/invalid node/);
  });

  it("契约：patch 数组 1–50 条；PATCH_GUIDE 提到四种 op", () => {
    expect(dp.DesignPrototypePatch.safeParse([]).success).toBe(false);
    expect(ac.DesignChatWriteback.safeParse({ patch: [{ op: "remove", id: "n2" }] }).success).toBe(true);
    for (const op of ["setProps", "replace", "insert", "remove"]) expect(dp.PROTOTYPE_PATCH_GUIDE).toContain(op);
  });
});

/**
 * 迭代 11（design-delta `prototype-navigation`，待签核）—— V26：跳转关系是契约的一部分，
 * 悬空**只丢那一条**、页面保留（与 I-10 的粒度不同，是 delta §7 取舍 ①；这里按建议 A 锁定）。
 */
describe("迭代 11 跳转关系 validateLinks：逐条丢、不整页拒", () => {
  const btn = (id: string) => ({ id, type: "button" as const, props: { label: id } });
  const page = (id: string, links: dp.PrototypeLink[], extra: dp.PrototypeNode[] = []) => ({
    root: { id: `root-${id}`, type: "stack" as const, children: [btn(id), ...extra] },
    links,
  });
  it("目标越界 / 自跳 / from 不在本页 / item 越界 / 重复：各自只丢那一条，其余保留", () => {
    const nav = { id: "nav", type: "bottomnav" as const, props: { items: ["A", "B"], active: 0 } };
    const screens = [
      page("a", [
        { from: "a", to: 1 },              // 合法
        { from: "a", to: 9 },              // 越界
        { from: "a", to: 0 },              // 自跳
        { from: "ghost", to: 1 },          // from 不在本页
        { from: "nav", item: 2, to: 1 },   // item 越界（只有 2 项）
        { from: "nav", item: 1, to: 1 },   // 合法
        { from: "nav", item: 1, to: 1 },   // 重复 (from,item)
        { from: "a", item: 0, to: 1 },     // 单目标原语带 item:0 视同不带 ⇒ 与第一条重复
      ], [nav]),
      page("b", []),
    ];
    const { links, dropped } = dp.validateLinks(screens);
    expect(links[0]).toEqual([{ from: "a", to: 1 }, { from: "nav", item: 1, to: 1 }]);
    expect(links[1]).toEqual([]);
    expect(dropped.map((d) => d.reason)).toEqual([
      "TARGET_OUT_OF_RANGE", "SELF_LINK", "FROM_NOT_FOUND", "ITEM_OUT_OF_RANGE", "DUPLICATE", "DUPLICATE",
    ]);
  });
  it("一页超过 30 条 ⇒ 截到 30（按顺序），不拒", () => {
    const many = Array.from({ length: 35 }, (_, i) => ({ id: `b${i}`, type: "button" as const, props: { label: "x" } }));
    const screens = [
      { root: { id: "r", type: "stack" as const, children: many }, links: many.map((n) => ({ from: n.id, to: 1 })) },
      page("z", []),
    ];
    const { links, dropped } = dp.validateLinks(screens);
    expect(links[0]).toHaveLength(dp.PROTOTYPE_MAX_LINKS);
    expect(dropped.filter((d) => d.reason === "TOO_MANY")).toHaveLength(5);
  });
  it("幂等：清洗过的结果再清洗一次不再丢任何东西", () => {
    const screens = [page("a", [{ from: "a", to: 1 }, { from: "a", to: 5 }]), page("b", [{ from: "b", to: 0 }])];
    const once = dp.validateLinks(screens);
    const twice = dp.validateLinks(screens.map((s, i) => ({ ...s, links: once.links[i] })));
    expect(twice.dropped).toEqual([]);
    expect(twice.links).toEqual(once.links);
  });
  it("契约：PrototypeScreen.links 可省略；PrototypeLink 严格、to/item 非负整数；DesignProject.frameLinks 与 frames 等长或空", () => {
    expect(dp.PrototypeScreen.safeParse({ frame: "首页", root: { type: "divider" } }).success).toBe(true);
    expect(dp.PrototypeLink.safeParse({ from: "a", to: -1 }).success).toBe(false);
    expect(dp.PrototypeLink.safeParse({ from: "a", to: 1, extra: 1 }).success).toBe(false);
    const base = { id: "p", name: "n", template: "mobile", problem: "", criteria: [], frames: ["a", "b"], prototype: [], frameNotes: [],
      pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null, chat: [], ownerId: "u", ownerName: null,
      createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z" };
    expect(dw.DesignProject.safeParse({ ...base, frameLinks: [[], []] }).success).toBe(true);
    expect(dw.DesignProject.safeParse({ ...base, frameLinks: [[]] }).success).toBe(false);
  });
});

/**
 * 迭代 11（V27 契约半边）—— `setLinks` 是唯一改 links 的 op，人改与模型改共用它（I-11）。
 * 收尾统一过 `validateLinks`，所以"删掉源节点"这类**间接**失效不需要调用方自己收拾。
 */
describe("迭代 11 setLinks op", () => {
  const two = () => dp.ensurePrototypeIds([
    { type: "stack", children: [{ type: "button", props: { label: "去第二页" } }] },
    { type: "stack", children: [{ type: "divider" }] },
  ]).map((root) => ({ root }));

  it("整体替换某页 links；其余页不动；frame/notes 这类附加字段原样穿过去", () => {
    const screens = two().map((s, i) => ({ ...s, frame: `第${i + 1}页`, notes: `说明${i + 1}` }));
    const out = dp.applyPrototypePatch(screens, [{ op: "setLinks", screen: 0, links: [{ from: "n2", to: 1 }] }]);
    expect(out[0]!.links).toEqual([{ from: "n2", to: 1 }]);
    expect(out[1]!.links).toEqual([]);
    // 泛型让 frame/notes 穿过去——这个函数不需要知道它们存在
    expect([out[0]!.frame, out[0]!.notes]).toEqual(["第1页", "说明1"]);
    expect(Object.hasOwn(screens[0]!, "links")).toBe(false); // 入参未被改（没被就地塞上 links）
  });

  it("screen 越界 ⇒ UNKNOWN_SCREEN（闭集里与 UNKNOWN_NODE 分开：说的是页没找到，不是节点）", () => {
    try {
      dp.applyPrototypePatch(two(), [{ op: "setLinks", screen: 5, links: [] }]);
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(dp.PrototypePatchError);
      expect(e).toMatchObject({ reason: "UNKNOWN_SCREEN" });
      expect(dp.PrototypePatchRejectReason.options).toContain("UNKNOWN_SCREEN");
    }
  });

  it("悬空的那条被丢、其余生效（不整批拒）——V27 最后一行", () => {
    const out = dp.applyPrototypePatch(two(), [
      { op: "setLinks", screen: 0, links: [{ from: "n2", to: 1 }, { from: "n2", item: 3, to: 9 }] },
    ]);
    expect(out[0]!.links).toEqual([{ from: "n2", to: 1 }]);
  });

  it("删掉 link 的源节点 ⇒ 那条 link 跟着失效（收尾的 validateLinks 兜住间接失效）", () => {
    const linked = dp.applyPrototypePatch(two(), [{ op: "setLinks", screen: 0, links: [{ from: "n2", to: 1 }] }]);
    const out = dp.applyPrototypePatch(linked, [{ op: "remove", id: "n2" }]);
    expect(out[0]!.links).toEqual([]);
  });
});

/**
 * 迭代 12（delta `paged-generation-and-doc-export` §2）—— V41 / V42。
 * 增删**页**不再需要整页重给 `prototype`，且增删之后跳转目标序号整体平移。
 */
describe("迭代 12：addScreen / removeScreen 与跳转索引平移", () => {
  /** 三页，每页一个按钮；page0 的按钮指向 page2。 */
  const three = () => {
    const roots = dp.ensurePrototypeIds([
      { type: "stack", children: [{ type: "button", props: { label: "去第三页" } }] },
      { type: "stack", children: [{ type: "button", props: { label: "b" } }] },
      { type: "stack", children: [{ type: "button", props: { label: "c" } }] },
    ]);
    return roots.map((root, i) => ({ frame: `第${i + 1}页`, root, links: [] as dp.PrototypeLink[] }));
  };
  /** page0 的按钮 id（`ensurePrototypeIds` 是深度优先，root=n1、button=n2）。 */
  const btn0 = "n2";

  it("addScreen 同时插入 frame 与树，长度一致；`at` 越界 ⇒ UNKNOWN_SCREEN", () => {
    const out = dp.applyPrototypePatch(three(), [
      { op: "addScreen", at: 1, frame: "插进来的", root: { type: "stack", children: [{ type: "text", props: { content: "新" } }] } },
    ]);
    expect(out).toHaveLength(4);
    expect(out.map((s) => s.frame)).toEqual(["第1页", "插进来的", "第2页", "第3页"]);
    // 每一页都还有树，且新页的树补上了 id
    expect(out.every((s) => s.root !== undefined)).toBe(true);
    expect(out[1]!.root!.id).toBeDefined();
    expect(() => dp.applyPrototypePatch(three(), [{ op: "addScreen", at: 9, frame: "x" }]))
      .toThrow(expect.objectContaining({ reason: "UNKNOWN_SCREEN" }));
  });

  it("addScreen 不带 root ⇒ 插入一个还没生成的空页（root 缺，不是空树）", () => {
    const out = dp.applyPrototypePatch(three(), [{ op: "addScreen", at: 3, frame: "待生成" }]);
    expect(out).toHaveLength(4);
    expect(out[3]).toMatchObject({ frame: "待生成" });
    expect(out[3]!.root).toBeUndefined();
  });

  it("removeScreen 同时删 frame 与树；越界 ⇒ UNKNOWN_SCREEN；只剩一页时不许删", () => {
    const out = dp.applyPrototypePatch(three(), [{ op: "removeScreen", screen: 1 }]);
    expect(out.map((s) => s.frame)).toEqual(["第1页", "第3页"]);
    expect(() => dp.applyPrototypePatch(three(), [{ op: "removeScreen", screen: 9 }]))
      .toThrow(expect.objectContaining({ reason: "UNKNOWN_SCREEN" }));
    const one = three().slice(0, 1);
    expect(() => dp.applyPrototypePatch(one, [{ op: "removeScreen", screen: 0 }]))
      .toThrow(expect.objectContaining({ reason: "LIMITS" }));
  });

  /**
   * ⚠ 本 delta 最值钱的一条（verification.md V42）。不平移的失败是**静默错位**：
   * 删掉第 2 页之后原本指向第 3 页的跳转仍写着 `to: 2`，界面上一切正常，点下去去了错的页。
   */
  it("删页 ⇒ 后面页的跳转目标整体前移；指向被删页的那条被丢", () => {
    const linked = dp.applyPrototypePatch(three(), [{ op: "setLinks", screen: 0, links: [{ from: btn0, to: 2 }] }]);
    expect(linked[0]!.links).toEqual([{ from: btn0, to: 2 }]);
    const out = dp.applyPrototypePatch(linked, [{ op: "removeScreen", screen: 1 }]);
    // 第 3 页现在是第 2 页（索引 1）——目标必须跟着变，不能还写着 2
    expect(out[0]!.links).toEqual([{ from: btn0, to: 1 }]);

    const toDeleted = dp.applyPrototypePatch(three(), [{ op: "setLinks", screen: 0, links: [{ from: btn0, to: 1 }] }]);
    expect(dp.applyPrototypePatch(toDeleted, [{ op: "removeScreen", screen: 1 }])[0]!.links).toEqual([]);
  });

  it("插页 ⇒ 插入点及其之后的跳转目标整体后移", () => {
    const linked = dp.applyPrototypePatch(three(), [{ op: "setLinks", screen: 0, links: [{ from: btn0, to: 1 }] }]);
    const out = dp.applyPrototypePatch(linked, [{ op: "addScreen", at: 1, frame: "插进来的" }]);
    expect(out[0]!.links).toEqual([{ from: btn0, to: 2 }]);
  });

  it("还没生成的页：从它出发的 link 丢掉，指向它的 link 保留", () => {
    const withHole = [
      { frame: "有树", root: { id: "r0", type: "stack" as const, children: [{ id: "b0", type: "button" as const, props: { label: "去" } }] }, links: [{ from: "b0", to: 1 }] },
      { frame: "没树", links: [{ from: "b0", to: 0 }] },
    ];
    const { links } = dp.validateLinks(withHole);
    expect(links[0]).toEqual([{ from: "b0", to: 1 }]);  // 指向未生成页 ⇒ 保留（那页迟早会生成）
    expect(links[1]).toEqual([]);                        // 从未生成页出发 ⇒ 丢（没有节点可寻址）
  });
});


/**
 * 迭代 13（delta §6）—— V70。属性面板的**视觉组只给档位，不给自由数值**。
 *
 * 这条门是给未来的自己看的：加一个 `width: number` 这种"就这一次"的字段特别自然，
 * 而它一旦进来，整套原语就不再是一套设计系统，是一堆各写各的内联样式。
 */
describe("V70 视觉组：全是 enum，且分组从 key 派生", () => {
  const allFields = Object.values(dp.PROTOTYPE_FIELDS).flat();

  it("每个字段都带 group，且 group == prototypeFieldGroup(key, type)（类型级例外只有登记过的那几条）", () => {
    expect(allFields.length).toBeGreaterThan(20);
    for (const [type, fields] of Object.entries(dp.PROTOTYPE_FIELDS)) {
      for (const f of fields) expect(f.group, `${type}.${f.key}`).toBe(dp.prototypeFieldGroup(f.key, type));
    }
    // 对标 R3：表头是内容、列数是视觉——同名不同义的那一对。
    expect(dp.prototypeFieldGroup("columns", "table")).toBe("content");
    expect(dp.prototypeFieldGroup("columns", "grid")).toBe("visual");
  });

  it("视觉组的字段 kind **全部**是 enum 或 bool——没有一个是 number/text", () => {
    const visual = allFields.filter((f) => f.group === "visual");
    expect(visual.length).toBeGreaterThan(10);
    // ⚠ `numeric: true` 的档位字段（`grid.columns`）**也算 enum**：它展示为档位、存储为数字，
    //   不是自由输入框（见 `PrototypeField.numeric` 头注）。
    const offenders = visual.filter((f) => f.kind !== "enum" && f.kind !== "bool");
    // ⭐ 反证：把 gap 做成 number（px 输入）⇒ 这条红。
    expect(offenders.map((f) => `${f.key}:${f.kind}`)).toEqual([]);
    // 数字档位仍然是闭集：options 必须列全
    const num = visual.filter((f) => f.numeric === true);
    expect(num.map((f) => f.key)).toEqual(["columns"]);
    expect(num[0]!.options).toEqual(["2", "3"]);
    // enum 的 options 必须来自 zod（非空）——手抄一份会漏掉后来新增的档位。
    for (const f of visual.filter((x) => x.kind === "enum")) expect((f.options ?? []).length).toBeGreaterThan(0);
  });

  it("迭代 13 新增的 size / radius 真的在表里，且是 enum", () => {
    const byKey = (k: string) => allFields.filter((f) => f.key === k);
    for (const k of ["size", "radius"]) {
      expect(byKey(k).length).toBeGreaterThan(0);
      for (const f of byKey(k)) {
        expect(f.kind).toBe("enum");
        expect(f.group).toBe("visual");
      }
    }
  });

  it("内容组里没有混进视觉字段（分组是全集划分，不是两张各写各的表）", () => {
    const content = allFields.filter((f) => f.group === "content");
    expect(content.some((f) => f.key === "gap" || f.key === "variant" || f.key === "radius")).toBe(false);
    // 文案类字段确实在内容组
    expect(content.some((f) => f.key === "label" || f.key === "title" || f.key === "content")).toBe(true);
  });
});


/**
 * 迭代 13 —— 加了 props 却忘了告诉模型，是一种**安静的半成品**：
 * 属性面板里能调，模型永远不会主动用，于是生成出来的东西看着就是"没人调过样式"。
 * 这条门把「加 props」与「改 guide」绑在一起。
 */
describe("PROTOTYPE_SCHEMA_GUIDE 覆盖每一个 props 键", () => {
  /**
   * ⚠ 必须**按类型切段**再查，不能在整份 guide 里 `includes(key)`：
   *   `radius` 同时出现在 button 和 card 上，全局查的话把 card 那份删掉照样绿——
   *   实测过，第一版就是这么写的，反证变异一条也没抓住。
   */
  const segmentOf = (type: string): string => {
    // 前面必须是非字母，否则 `switch` 会匹配到别的词里去；guide 里各段之间是「；」，
    // 而第一段前面是「类型与 props：」——所以别写死分隔符，只要求"不是字母"。
    const m = new RegExp(`(?:^|[^A-Za-z])${type}\\{([^}]*)\\}`).exec(dp.PROTOTYPE_SCHEMA_GUIDE);
    return m?.[1] ?? "";
  };

  it("guide 里真的能切出每种类型的那一段（否则下面两条会空跑）", () => {
    for (const type of dp.PrototypeNodeType.options) {
      const fields = dp.PROTOTYPE_FIELDS[type];
      if (fields.length === 0) continue; // divider 没有 props
      expect(segmentOf(type), `guide 里找不到 ${type}{...} 这一段`).not.toBe("");
    }
  });

  it("每种类型的每个字段名都在**它自己那一段**里", () => {
    const missing: string[] = [];
    for (const type of dp.PrototypeNodeType.options) {
      const seg = segmentOf(type);
      for (const f of dp.PROTOTYPE_FIELDS[type]) if (!seg.includes(f.key)) missing.push(`${type}.${f.key}`);
    }
    // ⭐ 反证：把 card 的 radius 从 guide 里删掉 ⇒ 这条红（即使 button 那段还留着它）。
    expect(missing).toEqual([]);
  });

  it("视觉档位的**取值**也写在那一段里（只说键名，模型不知道能填什么）", () => {
    /**
     * 迭代 16（#3773 R4）：取值写在**自己那一段**或**共用名册**里都算数。
     *
     * 名册这条口子只为图标开：`icon`/`icons` 出现在三种原语上，46 个名字抄三遍既是
     * 「同一事实声明三处」，也会把这段说明的信噪比压垮。别的视觉档位（圆角、间距、
     * 色调）各自只有三五个值、只属于自己那一段，照旧要求就地写全。
     */
    const missing: string[] = [];
    for (const type of dp.PrototypeNodeType.options) {
      const seg = segmentOf(type);
      for (const f of dp.PROTOTYPE_FIELDS[type]) {
        if (f.group !== "visual" || f.kind !== "enum") continue;
        for (const o of f.options ?? []) {
          if (!seg.includes(o) && !dp.PROTOTYPE_ICON_ROSTER.includes(o)) missing.push(`${type}.${f.key}=${o}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("迭代 16：图标名册列全了，而且**只在 guide 里出现一次**（同一事实不得声明两处）", () => {
    for (const o of dp.PrototypeIcon.options) {
      expect(dp.PROTOTYPE_ICON_ROSTER, `名册里缺 ${o}`).toContain(o);
    }
    expect(dp.PROTOTYPE_SCHEMA_GUIDE).toContain(dp.PROTOTYPE_ICON_ROSTER);
    // ⭐ 反证：把名册整段在 button 那一段里再抄一遍 ⇒ 这条红。
    const occurrences = dp.PROTOTYPE_SCHEMA_GUIDE.split(dp.PROTOTYPE_ICON_ROSTER).length - 1;
    expect(occurrences).toBe(1);
  });
});


/**
 * 迭代 15 —— 契约里有的 op，**必须在给模型看的说明里出现**。
 *
 * 这条门是从一个真实的洞长出来的：`addScreen` / `removeScreen` 从迭代 12 起就在契约里，
 * 而 `PROTOTYPE_PATCH_GUIDE` 三轮都没提过它们——模型不知道有这条便宜路，
 * 于是为了加一页把所有页重画一遍，正好撞上「单页超输出预算」。
 * 能力存在但没人告诉使用者，等于不存在。
 */
describe("PROTOTYPE_PATCH_GUIDE 覆盖每一个 patch op", () => {
  it("每个 op 名都出现在说明里", () => {
    const names = dp.PrototypePatchOp.options.map((o) => {
      const shape = (o as unknown as { shape: { op: { value: string } } }).shape;
      return shape.op.value;
    });
    expect(names.length).toBeGreaterThanOrEqual(7);
    const missing = names.filter((n) => !dp.PROTOTYPE_PATCH_GUIDE.includes(n));
    // ⭐ 反证：把 addScreen 从说明里删掉 ⇒ 这条红。它正是这条门当初漏掉的那一个。
    expect(missing).toEqual([]);
  });

  it("说明里明确告诉模型「加一页用 addScreen，不要重画所有页」", () => {
    // 光列出 op 名不够——原来那句「新页面 ⇒ 用 prototype 整页给出」会把模型推回老路。
    expect(dp.PROTOTYPE_PATCH_GUIDE).toContain("不要为此重画所有页");
  });
});

/* ─────────────── 对标 R3（#3933）：表格与图表 ─────────────── */
describe("对标 R3：table / chart", () => {
  it("正例：表格与柱状/折线图过契约；不要求等长（缺的格子空着、多出的数据点不画）", () => {
    expect(dp.PrototypeNode.safeParse({ type: "table", props: { columns: ["订单号", "金额"], rows: [["#1", "¥1"], ["#2"]], striped: true } }).success).toBe(true);
    expect(dp.PrototypeNode.safeParse({ type: "chart", props: { kind: "bar", labels: ["一", "二"], values: [30, 45, 0] } }).success).toBe(true);
    expect(dp.PrototypeNode.safeParse({ type: "chart", props: { kind: "line", title: "趋势", labels: ["4月"], values: [-3.5], unit: "万元" } }).success).toBe(true);
  });

  it("反例：超出能画下的量、非有限数、空表头都拒", () => {
    const cols = Array.from({ length: dp.PROTOTYPE_TABLE_MAX_COLUMNS + 1 }, (_, i) => `列${i}`);
    expect(dp.PrototypeNode.safeParse({ type: "table", props: { columns: cols, rows: [] } }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "table", props: { columns: [], rows: [] } }).success).toBe(false);
    const pts = Array.from({ length: dp.PROTOTYPE_CHART_MAX_POINTS + 1 }, (_, i) => i);
    expect(dp.PrototypeNode.safeParse({ type: "chart", props: { labels: pts.map(String), values: pts } }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "chart", props: { labels: ["a"], values: [Number.NaN] } }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "chart", props: { kind: "pie", labels: ["a"], values: [1] } }).success).toBe(false);
  });

  it("属性面板：表格数据是 rows、数值是 numbers，表头归内容组（与 grid.columns 同名不同义）", () => {
    const byKey = (t: "table" | "chart", k: string) => dp.PROTOTYPE_FIELDS[t].find((f) => f.key === k)!;
    expect(byKey("table", "rows").kind).toBe("rows");
    expect(byKey("chart", "values").kind).toBe("numbers");
    expect(byKey("table", "columns").group).toBe("content");
    expect(dp.prototypeOptionLabel("chart", "kind", "line")).toBe("折线图");
  });

  it("给模型的说明里有这两种原语与它们的上限（不教，模型只会退回 image(kind:chart) 那个灰块）", () => {
    // ⭐ 反证锚点：SCHEMA_GUIDE 里删掉 table/chart 那一段 ⇒ 这条红。
    expect(dp.PROTOTYPE_SCHEMA_GUIDE).toMatch(/table\{columns/);
    expect(dp.PROTOTYPE_SCHEMA_GUIDE).toMatch(/chart\{kind:bar\|line/);
    expect(dp.PROTOTYPE_SCHEMA_GUIDE).toContain(String(dp.PROTOTYPE_CHART_MAX_POINTS));
  });

  it("节点短标签说清是什么、多大", () => {
    expect(dp.prototypeNodeLabel({ type: "table", props: { columns: ["a", "b"], rows: [["1", "2"]] } })).toBe("表格（2 列 × 1 行）");
    expect(dp.prototypeNodeLabel({ type: "chart", props: { title: "趋势", labels: ["a"], values: [1] } })).toBe("图表「趋势」");
  });
});

/* ─────────────── 对标 R4（#3933）：下拉、单选、叠层 ─────────────── */
describe("对标 R4：select / radio / overlay", () => {
  it("正例：下拉、单选、带内容的弹窗；overlay 是容器", () => {
    const page: dp.PrototypeNode = { type: "stack", children: [
      { type: "select", props: { label: "城市", options: ["北京", "上海"], value: "上海" } },
      { type: "radio", props: { label: "性别", options: ["男", "女", "不透露"], selected: 2 } },
      { type: "overlay", props: { kind: "modal", title: "确定注销？" }, children: [{ type: "button", props: { label: "确认" } }] },
    ] };
    expect(dp.PrototypeNode.safeParse(page).success).toBe(true);
    expect(dp.isPrototypeContainer({ type: "overlay", children: [] })).toBe(true);
    expect(dp.PROTOTYPE_CONTAINER_TYPES).toContain("overlay");
  });

  it("反例：单选只有一项、选中越界、叠层样式不在闭集、下拉没有选项", () => {
    expect(dp.PrototypeNode.safeParse({ type: "radio", props: { options: ["只有一项"] } }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "radio", props: { options: ["a", "b"], selected: 2 } }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "overlay", props: { kind: "popover" }, children: [] }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "select", props: { options: [] } }).success).toBe(false);
  });

  it("模型写成字符串的 selected 会被纠偏成数字（同 tabs.active）", () => {
    const raw = dp.coercePrototypeRaw({ type: "radio", props: { options: ["a", "b"], selected: "1" } });
    expect(dp.PrototypeNode.safeParse(raw).success).toBe(true);
  });

  it("给模型的说明：容器清单由 PROTOTYPE_CONTAINER_TYPES 派生（不手抄），并教它弹窗单独一页", () => {
    // ⭐ 反证锚点：说明里仍写死「只有 stack/card/grid 有 children」⇒ 模型不知道 overlay 能装东西，这条红。
    expect(dp.PROTOTYPE_SCHEMA_GUIDE).toContain(`只有 ${dp.PROTOTYPE_CONTAINER_TYPES.join("/")} 有 children`);
    expect(dp.PROTOTYPE_SCHEMA_GUIDE).toMatch(/overlay\{kind:modal\|sheet\|toast/);
    expect(dp.PROTOTYPE_SCHEMA_GUIDE).toMatch(/单独做一页/);
  });
});

/* ─────────────── 对标 R5（#3933）：落地页的分区与页脚 ─────────────── */
describe("对标 R5：section / footer", () => {
  it("正例：分区是容器（可以装 hero / grid），页脚是叶子", () => {
    const page: dp.PrototypeNode = { type: "stack", props: { padding: "none", gap: "none" }, children: [
      { type: "section", props: { tone: "primary", align: "center" }, children: [{ type: "hero", props: { title: "五分钟搞定一个月的账" } }] },
      { type: "section", props: { tone: "muted" }, children: [{ type: "grid", props: { columns: 3 }, children: [] }] },
      { type: "footer", props: { brand: "轻账", links: ["产品", "价格"], note: "© 2026" } },
    ] };
    expect(dp.PrototypeNode.safeParse(page).success).toBe(true);
    expect(dp.isPrototypeContainer({ type: "section", children: [] })).toBe(true);
    expect(dp.PrototypeNode.safeParse({ type: "footer", props: { brand: "轻账" }, children: [] }).success).toBe(false);
  });

  it("反例：分区底色不在闭集、页脚没有品牌名", () => {
    expect(dp.PrototypeNode.safeParse({ type: "section", props: { tone: "gradient" }, children: [] }).success).toBe(false);
    expect(dp.PrototypeNode.safeParse({ type: "footer", props: { links: ["a"] } }).success).toBe(false);
  });

  it("分区底色的中文档位按「section.tone」登记，不串到徽标的语义色上", () => {
    expect(dp.prototypeOptionLabel("section", "tone", "muted")).toBe("浅灰底");
    expect(dp.prototypeOptionLabel("badge", "tone", "success")).toBe("成功绿");
  });

  it("给模型的说明教了落地页怎么搭（不教，官网首页会被画成一张很长的 App 屏）", () => {
    // ⭐ 反证锚点：删掉 section / footer 那一段 ⇒ 这条红。
    expect(dp.PROTOTYPE_SCHEMA_GUIDE).toMatch(/section\{tone:default\|muted\|primary\|inverse/);
    expect(dp.PROTOTYPE_SCHEMA_GUIDE).toMatch(/footer\{brand/);
  });
});
