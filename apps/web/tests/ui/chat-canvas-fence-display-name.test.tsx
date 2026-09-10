/**
 * 2026-09-10 人类实测：「检查用户旅程图的名字是否是错误的，每次都不能出来。
 * 这个名字我在后台没有看到，要怎么设置呢？」
 *
 * `模板:` 那一行一直是**按 key 精确匹配**的（`t.key === key`），而模型手里最顺口的
 * 名字是**显示名**。`模板: 用户旅程图` 于是恒判 `not-found`，用户看到的是一条
 * 「既不是内置模板、当前组织的模板库里也没有它」的报错——而那个 key（`journey-map`）
 * 在后台任何界面上都不显示，纯中文名的自建模板还会被 `slugifyTemplateKey` 生成成
 * `tpl-<随机6位>`：照着这条报错，人是改不动的。
 *
 * ## 判据判到哪一层
 *
 * 判**渲染真的发生了**（`chat-canvas-fabric` 出现、`data-template-source` 说清来源），
 * 不是「解析器返回了 ok」——只在解析器里换算 key 是不够的：真正画图的
 * `templateToModel` 会自己再读一次围栏里的 `模板:` 行，引擎的全局表按 `spec.key` 存，
 * 别名那一份没注册进去的话，校验过了照样画不出来。这一层差别在解析器的单测里看不见。
 *
 * ## 阳性对照
 *
 * 每条用例都配一条反向断言：真正不存在的名字仍然如实报 `chat-canvas-error`。
 * 否则「显示名能渲染」可能只是因为兜底把**任何**名字都放行了。
 *
 * ## 反证
 * 把 `ensureCanvasFenceTemplate` 里的别名分支（`resolveDisplayNameToKey` +
 * `registerTemplate({...spec, key})`）stash 掉，本文件三条用例立刻红。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { __resetFenceTemplateCache } from "@/lib/canvas/fence-template-resolver";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn().mockResolvedValue(true),
    render: vi.fn().mockResolvedValue({ svg: "<svg></svg>" }),
  },
}));

const listCanvasTemplates = vi.fn();
vi.mock("@/lib/live-canvas", () => ({
  listCanvasTemplates: (...args: unknown[]) => listCanvasTemplates(...args),
}));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: "org-display-name-1" } }),
}));

function fence(templateLine: string): string {
  return ["```canvas", `模板: ${templateLine}`, "## 行为 · 阶段1", "- 在大众点评搜索餐馆", "```"].join("\n");
}

function orgRow(over: Record<string, unknown> = {}) {
  return {
    key: "tpl-a1b2c3",
    displayName: "门店服务蓝图",
    version: 2,
    status: "published",
    builtin: false,
    visibility: "org-wide",
    underlyingType: "canvas",
    usageCount: 0,
    sections: [{ sectionId: "s1", name: "行为 · 阶段1", order: 0, required: true, capacity: 6 }],
    layoutSource: "user-edited",
    ...over,
  };
}

beforeEach(() => {
  __resetFenceTemplateCache();
  listCanvasTemplates.mockReset();
  listCanvasTemplates.mockResolvedValue({ templates: [] });
});

describe("`模板:` 认显示名（内置 + 组织自建）", () => {
  it("内置模板写显示名 `用户旅程图` → 照样渲染，来源仍是内置原生几何", async () => {
    render(<MarkdownMessage text={fence("用户旅程图")} />);
    const el = await screen.findByTestId("chat-canvas-fabric");
    expect(el.getAttribute("data-template-source")).toBe("builtin");
  });

  it("阳性对照：真的不存在的名字仍然如实报错，不是什么都放行", async () => {
    render(<MarkdownMessage text={fence("根本没有这张模板")} />);
    const el = await screen.findByTestId("chat-canvas-error");
    expect(el.getAttribute("data-error-reason")).toBe("template");
  });

  it("组织自建模板写显示名 → 走组织几何（key 是 `tpl-<随机6位>`，人根本看不到它）", async () => {
    listCanvasTemplates.mockResolvedValue({ templates: [orgRow()] });
    render(<MarkdownMessage text={fence("门店服务蓝图")} />);
    const el = await screen.findByTestId("chat-canvas-fabric");
    expect(el.getAttribute("data-template-source")).toBe("org-generated");
  });

  it("显示名撞车（两个不同 key 同名）时不猜，保持原来的错误", async () => {
    listCanvasTemplates.mockResolvedValue({
      templates: [orgRow(), orgRow({ key: "tpl-d4e5f6" })],
    });
    render(<MarkdownMessage text={fence("门店服务蓝图")} />);
    const el = await screen.findByTestId("chat-canvas-error");
    expect(el.getAttribute("data-error-reason")).toBe("template");
  });
});
