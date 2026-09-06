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

describe("PROTOTYPE_SCHEMA_GUIDE", () => {
  it("每个原语类型都出现在给模型看的说明里", () => {
    for (const t of dp.PrototypeNodeType.options) expect(dp.PROTOTYPE_SCHEMA_GUIDE).toContain(t);
  });
});
