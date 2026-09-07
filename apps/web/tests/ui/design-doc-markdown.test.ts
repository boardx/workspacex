/** B5.3 `buildDesignDocMarkdown` / `outlinePrototype` 纯函数正例。 */
import { describe, expect, it } from "vitest";
import { buildDesignDocMarkdown, buildPrototypeSpecJson, designDocFileName, outlinePrototype, prototypeSpecFileName } from "@/lib/design-doc-markdown";
import type { DesignProject } from "@/lib/live-design-workbench";

const base: DesignProject = {
  id: "p1", name: "聊天 UI/改版", template: "ui", problem: "对话入口太深", criteria: ["首屏可发消息"],
  frames: ["聊天", "设置"],
  frameNotes: ["首屏即可发消息；生成中可停止。", ""],
  prototype: [
    { type: "stack", children: [{ type: "navbar", props: { title: "ChatGPT" } }, { type: "button", props: { label: "发送", variant: "primary" } }] },
    { type: "list", props: { items: ["账号", "外观"] } },
  ],
  pushed: false, pushedAt: null, linkedFeedbackId: "fb-1", githubIssueUrl: null, githubIssueNumber: null,
  chat: [{ role: "user", text: "画个\n聊天", at: "2026-09-06T00:00:00.000Z" }, { role: "ai", text: "好", at: "2026-09-06T00:00:01.000Z", source: "model" }],
  ownerId: "u1", ownerName: "我", createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
};
const NOW = new Date("2026-09-06T12:00:00.000Z");

describe("buildDesignDocMarkdown", () => {
  it("四节齐全，原型按页输出缩进大纲，对话换行压成一行", () => {
    const md = buildDesignDocMarkdown(base, NOW);
    expect(md).toContain("# 聊天 UI/改版");
    expect(md).toContain("- 来源反馈：fb-1");
    expect(md).toContain("## 问题与目标\n\n对话入口太深");
    expect(md).toContain("1. 首屏可发消息");
    expect(md).toContain("### 页 1：聊天\n\n> 首屏即可发消息；生成中可停止。\n\n- 布局（纵向）\n  - 导航栏「ChatGPT」\n  - 按钮「发送」（primary）");
    expect(md).toContain("### 页 2：设置\n\n- 列表"); // 空说明不出引用块
    const spec = JSON.parse(buildPrototypeSpecJson(base)) as { screens: { frame: string; notes: string }[] };
    expect(spec.screens.map((s) => s.notes)).toEqual(["首屏即可发消息；生成中可停止。", ""]);
    expect(prototypeSpecFileName(base, NOW)).toBe("UI-2026-09-06.prototype.json");
    expect(md).toContain("### 页 2：设置\n\n- 列表：账号 / 外观");
    expect(md).toContain("- PM：画个 聊天");
  });
  it("没有原型时说明页面划分而不是输出空节", () => {
    expect(buildDesignDocMarkdown({ ...base, prototype: [] }, NOW)).toContain("还没有生成原型。页面划分：聊天、设置");
  });
  it("迭代 6：新原语的大纲文案；grid 是容器会缩进", () => {
    expect(outlinePrototype({ type: "grid", props: { columns: 3 }, children: [{ type: "stat", props: { label: "对话数", value: "1,284", delta: "+12%" } }, { type: "progress", props: { value: 68 } }] }))
      .toEqual(["- 网格（3 列）", "  - 指标「对话数」= 1,284（+12%）", "  - 进度 68%"]);
    expect(outlinePrototype({ type: "bottomnav", props: { items: ["聊天", "用量"], active: 1 } })).toEqual(["- 底部导航：聊天 / [用量]"]);
    expect(outlinePrototype({ type: "hero", props: { title: "T", cta: "Go" } })).toEqual(["- 头图「T」，按钮「Go」"]);
  });
  /**
   * 迭代 11：跳转关系要进交付物——工程照着它接路由。写「哪个控件 → 第几页（标签）」而不是
   * 裸的节点 id：文档的读者是人。
   */
  it("迭代 11：设计文档每页多一节「跳转」，JSON 规格带 links", () => {
    // ⚠ 节点必须**真的带 id**，否则 `findPrototypeNodePath` 找不到、标签回落成裸 id，
    //   这条断言就会以错误的理由通过（人话标签那半边等于没测）。
    const withLinks = {
      ...base,
      prototype: [
        { type: "stack" as const, id: "n1", children: [{ type: "navbar" as const, id: "n2", props: { title: "ChatGPT" } }, { type: "button" as const, id: "n3", props: { label: "发送", variant: "primary" as const } }] },
        base.prototype[1]!,
      ],
      frameLinks: [[{ from: "n3", to: 1 }], []],
    };
    const md = buildDesignDocMarkdown(withLinks, NOW);
    expect(md).toContain("跳转：");
    expect(md).toContain("- 按钮「发送」 → 第 2 页「设置」"); // 人话标签，不是裸 id
    const spec = JSON.parse(buildPrototypeSpecJson(withLinks)) as { screens: { links: unknown[] }[] };
    expect(spec.screens[0]!.links).toEqual([{ from: "n3", to: 1 }]);
    expect(spec.screens[1]!.links).toEqual([]);
    // 没有跳转的项目不该凭空多出一个空的「跳转」小节
    expect(buildDesignDocMarkdown(base, NOW)).not.toContain("跳转：");
  });

  it("outlinePrototype 深度缩进；文件名去掉不安全字符并带日期", () => {
    expect(outlinePrototype({ type: "card", props: { title: "T" }, children: [{ type: "divider" }] })).toEqual(["- 卡片「T」", "  - 分隔线"]);
    expect(designDocFileName(base, NOW)).toBe("UI-2026-09-06.md"); // 非 ASCII 去掉（Chromium 会把中文 download 名退成「download」）
    expect(designDocFileName({ ...base, name: "对话助手" }, NOW)).toBe("design-2026-09-06.md");
  });
});
