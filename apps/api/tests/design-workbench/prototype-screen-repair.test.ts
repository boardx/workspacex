import { describe, expect, it } from "vitest";
import { designPrototype } from "@repo/contracts";
import {
  balanceJsonBrackets, describeScreenIssues, normalizeScreenCandidate, parseScreenJson,
} from "../../src/application/design-workbench/prototype-screen-repair";

/** #4321 —— 分页生成单页输出的保守修正。纪律：只做不丢信息的修正，修不了的原样留给重问。 */
const valid = (screen: Record<string, unknown>) => designPrototype.PrototypeScreen.safeParse(screen).success;

describe("括号配平", () => {
  it("多一个右括号（真实输出里最常见的形态）⇒ 配平后能解析，内容不变", () => {
    const text = '{"frame":"x","root":{"type":"stack","children":[{"type":"divider"}]}}}';
    expect(() => JSON.parse(text)).toThrow();
    expect(parseScreenJson(text)).toEqual({ frame: "x", root: { type: "stack", children: [{ type: "divider" }] } });
  });

  it("少一个右括号 ⇒ 末尾补齐；字符串里的括号不算", () => {
    expect(JSON.parse(balanceJsonBrackets('{"a":"}]{","b":[1,2'))).toEqual({ a: "}]{", b: [1, 2] });
  });

  it("本来就合法的 JSON 原样解析，不经过配平", () => {
    expect(parseScreenJson('前缀 {"a":1} 后缀')).toEqual({ a: 1 });
  });
});

describe("normalizeScreenCandidate —— 无损修正", () => {
  const screen = {
    frame: "x",
    root: {
      type: "stack", props: { direction: "column", align: "" }, children: [
        { type: "navbar", props: { title: "我的", right: "", id: "nav-1" }, children: [] },
        { type: "divider", props: {} },
        { type: "radio", props: { label: "成色", options: ["全新", "九成新"], selected: "九成新" } },
      ],
    },
  };

  it("⭐ 反证锚点：真实输出里的四类小错修完就过契约（修之前不过）", () => {
    expect(valid(screen)).toBe(false);
    const { screen: fixed, fixes } = normalizeScreenCandidate(screen);
    expect(valid(fixed)).toBe(true);
    expect(fixes.length).toBeGreaterThanOrEqual(5);
  });

  it("每条修正都不改变意思：id 换位置、序号对应原文字、空的东西才删", () => {
    const root = normalizeScreenCandidate(screen).screen.root as { children: Record<string, any>[]; props: Record<string, unknown> };
    const [nav, divider, radio] = root.children;
    expect(nav).toEqual({ type: "navbar", id: "nav-1", props: { title: "我的" } });
    expect(divider).toEqual({ type: "divider" });
    expect(radio!.props.selected).toBe(1);
    expect(root.props).toEqual({ direction: "column" });
  });

  it("不猜语义：非空叶子 children、闭集外的图标、对不上选项的 selected 一律原样留下", () => {
    const risky = {
      frame: "x",
      root: {
        type: "stack", children: [
          { type: "text", props: { content: "a" }, children: [{ type: "text", props: { content: "b" } }] },
          { type: "bottomnav", props: { items: ["首页", "我的"], icons: ["home", "rocket-ship"] } },
          { type: "radio", props: { options: ["甲", "乙"], selected: "丙" } },
        ],
      },
    };
    const { screen: out, fixes } = normalizeScreenCandidate(risky);
    expect(out).toEqual(risky);
    expect(fixes).toEqual([]);
    expect(valid(out)).toBe(false);
  });

  it("不改入参（调用方失败时还要拿原文重问）", () => {
    const before = JSON.stringify(screen);
    normalizeScreenCandidate(screen);
    expect(JSON.stringify(screen)).toBe(before);
  });
});

describe("describeScreenIssues —— 重问时说清是哪个节点哪个字段", () => {
  it("联合类型整体失败时，逐节点报出具体字段，而不是一句 root: Invalid input", () => {
    const lines = describeScreenIssues({
      frame: "x",
      root: { type: "stack", children: [{ type: "stat", props: { label: "连续", value: "3天", tone: "info" } }] },
    });
    expect(lines.join("\n")).toContain("root.0（stat）.tone");
    expect(lines.join("\n")).toContain("「info」不在可选值里");
    expect(lines.join("\n")).not.toContain("Invalid input");
  });
});
