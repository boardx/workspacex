/** B5.3 `buildDesignDocMarkdown` / `outlinePrototype` 纯函数正例。 */
import { describe, expect, it } from "vitest";
import { PROJECT_TEMPLATE_LABEL } from "@/lib/live-design-workbench";
import { buildDesignDocMarkdown, buildPrototypeSpecJson, describeNode, designDocFileName, outlinePrototype, prototypeSpecFileName } from "@/lib/design-doc-markdown";
import type { DesignProject } from "@/lib/live-design-workbench";

const base: DesignProject = {
  id: "p1", name: "聊天 UI/改版", template: "ui", theme: "dark", accent: "neutral", tags: [], refImages: [], share: null, problem: "对话入口太深", criteria: ["首屏可发消息"],
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
    // 迭代 38 起枚举取值走契约单源 `prototypeOptionLabel`（`primary` → 「主按钮」）——
    // 这份文档自己的注释写着「文档的读者是人」，断言跟着单源走，意图不变。
    expect(md).toContain("### 页 1：聊天\n\n> 首屏即可发消息；生成中可停止。\n\n- 布局（纵向）\n  - 导航栏「ChatGPT」\n  - 按钮「发送」（主按钮）");
    expect(md).toContain("### 页 2：设置\n\n- 列表"); // 空说明不出引用块
    const spec = JSON.parse(buildPrototypeSpecJson(base)) as { screens: { frame: string; notes: string }[] };
    expect(spec.screens.map((s) => s.notes)).toEqual(["首屏即可发消息；生成中可停止。", ""]);
    expect(prototypeSpecFileName(base, NOW)).toBe("UI-2026-09-06.prototype.json");
    expect(md).toContain("### 页 2：设置\n\n- 列表：账号 / 外观");
    expect(md).toContain("- 提需求的人：画个 聊天" /* 迭代 38：提需求的未必是 PM */);
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

/* ───────────── 迭代 21：前几轮加的数据不能在交付文档里凭空消失 ───────────── */

describe("交付文档带上列表三段式、图标、图片语义与视觉设定", () => {
  const richList = {
    type: "list" as const,
    props: {
      items: ["楼下的面馆", "书店"],
      detail: ["牛肉面 × 1，加蛋", "三本书"],
      trailing: ["¥28", "¥136"],
      leading: "icon" as const,
      icons: ["cart" as const],
    },
  };

  it("列表行的副标题与右侧值都在（工程照着文档实现，不能只看到主标题）", () => {
    /*
     * ⭐ 反证锚点：`describeNode` 只写 `items` ⇒ 这条红。
     * 那正是前几轮留下的洞：画布渲染了三段式、导出的 HTML 渲染了，而交付文档只剩一段，
     * 「店名 / 三件商品 / ¥128」到工程手里只剩「店名」。
     */
    const line = describeNode(richList as never);
    expect(line).toContain("楼下的面馆");
    expect(line).toContain("牛肉面 × 1，加蛋");
    expect(line).toContain("¥28");
    // icons 只给了第一行 ⇒ 第二行没有图标标记，不编一个出来
    expect(line).toContain("[cart]");
    expect(line.match(/\[cart\]/g)).toHaveLength(1);
  });

  it("按钮图标与图片语义也在——而且说的是人话，不是 schema 字面量", () => {
    /*
     * ⭐ 反证锚点：把 `opt(...)` 去掉、改回直接印 `n.props.icon` / `n.props.kind` ⇒ 这条红。
     * 第 5 轮已经为此建好了契约单源（带覆盖率门控），这份文档却一直印着 refresh / map。
     */
    const btn = describeNode({ type: "button", props: { label: "再来一单", icon: "refresh", variant: "primary" } } as never);
    expect(btn).toContain("图标：刷新");
    expect(btn).not.toContain("refresh");
    const img = describeNode({ type: "image", props: { alt: "取餐地点", kind: "map" } } as never);
    expect(img).toContain("地图");
    expect(img).not.toContain("map");
  });

  it("文档头部写清视觉设定：主题 + 强调色 + 保真度", () => {
    const md = buildDesignDocMarkdown(
      { ...base, template: "wireframe", theme: "light", accent: "rose" } as never,
      new Date("2026-09-22T00:00:00.000Z"),
    );
    expect(md).toContain("低保真线框图");
    expect(md).toContain("浅色");
    expect(md).toContain("玫红");
  });
});

describe("迭代 38：交付文档里不许再说机器话", () => {
  it("导出时间不是一串 UTC ISO，文件名也不按 UTC 的那一天", () => {
    /*
     * ⭐ 反证锚点：把时间改回 `now.toISOString()`、文件名改回 `toISOString().slice(0,10)` ⇒ 这条红。
     * ⚠ 必须显式设时区：CI 跑在 UTC 上，那里「本地日历」与 UTC 永远一致（第 14 轮实测过这个坑）。
     */
    const tz = process.env.TZ;
    process.env.TZ = "Asia/Shanghai";
    try {
      const localEarlyMorning = new Date(Date.UTC(2026, 8, 7, 17, 30, 0)); // 东八区 9/8 01:30
      expect(localEarlyMorning.toISOString().slice(0, 10)).toBe("2026-09-07"); // 场景真的分得开
      const md = buildDesignDocMarkdown(base, localEarlyMorning);
      expect(md).toContain("- 导出时间：2026-09-08 01:30");
      expect(md).not.toContain("T17:30");
      expect(designDocFileName(base, localEarlyMorning)).toContain("2026-09-08");
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });

  it("模板名只有一份——文档读的是和两块屏同一张表", () => {
    /*
     * ⭐ 反证锚点：在本文件里另写一份 `{ mobile: …, ui: …, wireframe: … }` 并改其中一个字 ⇒ 这条红。
     * 第 10 轮把首页与详情页那两份收敛了，却漏了交付文档这一处——收敛做了一半。
     */
    /*
     * ⚠ 必须比**整行**：第一版用的是 `toContain`，而「UI 原型稿」里含着「UI 原型」——
     *   在本文件里另写一份把 `ui` 改成「UI 原型稿」，它照样绿（实测）。
     */
    for (const t of ["mobile", "ui", "wireframe"] as const) {
      const md = buildDesignDocMarkdown({ ...base, template: t }, new Date());
      const line = md.split("\n").find((l) => l.startsWith("- 模板："));
      const suffix = t === "wireframe" ? "（低保真线框图：不靠颜色传达信息）" : "";
      expect(line).toBe(`- 模板：${PROJECT_TEMPLATE_LABEL[t]}${suffix}`);
    }
  });
});
