/**
 * chat 里的 **工作坊画布模板围栏**（```canvas / ```persona）。
 *
 * ⚠ 概念边界（人类 2026-08-18 澄清）：这里验的是**便签协作模板**（分区框 + 可贴便签），
 *   不是 mermaid 图表（flowchart/类图/mindmap/gantt…）。两套系统各有各的校验器与错误态，
 *   本文件不涉及 `mermaid.parse`——真要走到那个函数就说明接线接错了。
 *
 * 此前 `markdown-message.tsx` 用 `.filter(b => b.lang === "mermaid")` 把画布围栏主动丢掉，
 * 于是它们落回 ReactMarkdown 渲成灰底 <code> 块。下面第一条就是那个回归的反面。
 *
 * fabric 建画布依赖真实 canvas context，jsdom 里 `data-ready` 起不来——这里验的是
 * **分段 / 分派 / 闸门 / 错误态 / 取数**，画布像素属浏览器 e2e。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { __resetFenceTemplateCache } from "@/lib/canvas/fence-template-resolver";

// mermaid 只为「同一条消息里既有图表又有画布」那条用例存在；画布路径不该碰它。
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

let currentOrgId: string | null = "org-personal-1";
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId } }),
}));

const PERSONA_FENCE = [
  "```canvas",
  "模板: persona",
  "姓名: 林可",
  "## 用户描述",
  "- 项目型采购",
  "## 目标和需求",
  "- 想把回本周期算清楚",
  "```",
].join("\n");

function orgTemplate(key: string, over: Record<string, unknown> = {}) {
  return {
    key,
    displayName: "复盘工作坊",
    version: 2,
    status: "published",
    builtin: false,
    visibility: "org-wide",
    underlyingType: "canvas",
    usageCount: 3,
    // 非内置 key 的 layoutSource 值不影响渲染判据（resolver 只在 key 是内置 key 时才
    // 检查这一栏），这里给个默认值只是为了满足契约的 `.strict()` 形状。
    layoutSource: "user-edited",
    sections: [
      { sectionId: "a", name: "做得好", order: 0, required: true, capacity: 6 },
      { sectionId: "b", name: "做得差", order: 1, required: true, capacity: 6 },
      { sectionId: "c", name: "下次试试", order: 2, required: false, capacity: null },
      { sectionId: "d", name: "感谢", order: 3, required: false, capacity: 3 },
    ],
    ...over,
  };
}

beforeEach(() => {
  __resetFenceTemplateCache();
  listCanvasTemplates.mockReset();
  // #2221 之后，内置 key 也会查一次组织模板库——默认没有任何自定义行，
  // 让没有显式 mock 的测试（各条纯内置模板断言）不因 `.then` on undefined 而炸。
  listCanvasTemplates.mockResolvedValue({ templates: [] });
  currentOrgId = "org-personal-1";
});

describe("工作坊画布模板围栏在 chat 里被渲染（不再是代码块）", () => {
  it("```canvas + 内置 persona 模板 → 走 fabric 画布分支，不落代码块、不落错误态", async () => {
    render(<MarkdownMessage text={`看这张画像：\n\n${PERSONA_FENCE}\n\n以上。`} />);
    const el = await screen.findByTestId("chat-canvas-fabric");
    expect(el.getAttribute("data-template-source")).toBe("builtin");
    expect(screen.queryByTestId("chat-canvas-error")).toBeNull();
    // 围栏前后的正文仍在（一个围栏不该吃掉整条消息）
    expect(screen.getByText(/看这张画像/)).toBeInTheDocument();
    expect(screen.getByText(/以上。/)).toBeInTheDocument();
    // 回归钉子：不再作为 <code> 块出现
    const md = screen.getByTestId("chat-ai-markdown");
    expect(md.querySelector("code")).toBeNull();
  });

  it("```persona 别名围栏同样渲染（lang 即模板 key）", async () => {
    const fence = ["```persona", "姓名: 林可", "## 动机", "- 少加班", "```"].join("\n");
    render(<MarkdownMessage text={fence} />);
    const el = await screen.findByTestId("chat-canvas-fabric");
    expect(el.getAttribute("data-fence-lang")).toBe("persona");
    expect(el.getAttribute("data-template-source")).toBe("builtin");
  });

  it("内置 key 会查一次组织模板库（判断是否被自定义过）；没有自定义行时仍用原生几何——" +
    "#2221 回归钉子：组织库里没有该 key 的自定义行时，不能因为「查了」就误判成已自定义", async () => {
    render(<MarkdownMessage text={PERSONA_FENCE} />);
    const el = await screen.findByTestId("chat-canvas-fabric");
    expect(el.getAttribute("data-template-source")).toBe("builtin");
    expect(listCanvasTemplates).toHaveBeenCalledWith({ orgId: "org-personal-1" });
  });
});

describe("组织自建模板 → 自动布局", () => {
  it("查到组织模板 → 生成几何并渲染，标记来源为 org-generated", async () => {
    listCanvasTemplates.mockResolvedValue({ templates: [orgTemplate("retro-x1")] });
    const fence = ["```canvas", "模板: retro-x1", "## 做得好", "- 上线没炸", "```"].join("\n");
    render(<MarkdownMessage text={fence} />);
    const el = await screen.findByTestId("chat-canvas-fabric");
    expect(el.getAttribute("data-template-source")).toBe("org-generated");
    expect(listCanvasTemplates).toHaveBeenCalledWith({ orgId: "org-personal-1" });
  });

  it("同 key 多版本取最高版本（「用这个模板」= 用它最新的样子）", async () => {
    listCanvasTemplates.mockResolvedValue({
      templates: [
        orgTemplate("retro-x2", { version: 1, displayName: "旧版" }),
        orgTemplate("retro-x2", { version: 5, displayName: "新版" }),
      ],
    });
    const fence = ["```canvas", "模板: retro-x2", "## 做得好", "- a", "```"].join("\n");
    render(<MarkdownMessage text={fence} />);
    await screen.findByTestId("chat-canvas-fabric");
    const { getTemplate } = await import("@repo/fabric-markdown");
    expect(getTemplate("retro-x2")?.title).toBe("新版");
  });

  it("一条消息里多个围栏只打一次 GET（列表有缓存）", async () => {
    listCanvasTemplates.mockResolvedValue({ templates: [orgTemplate("retro-x3")] });
    const one = ["```canvas", "模板: retro-x3", "## 做得好", "- a", "```"].join("\n");
    render(<MarkdownMessage text={`${one}\n\n中间一段\n\n${one}`} />);
    await waitFor(() => expect(screen.getAllByTestId("chat-canvas-fabric")).toHaveLength(2));
    expect(listCanvasTemplates).toHaveBeenCalledTimes(1);
  });
});

describe("诚实错误态（不崩、不静默丢、不退回 mock）", () => {
  it("缺 `模板:` 行 → syntax 错误态，回显原始围栏，页面不崩", async () => {
    const fence = ["```canvas", "## 做得好", "- 没写模板行", "```"].join("\n");
    render(<MarkdownMessage text={`前文\n\n${fence}\n\n后文`} />);
    const err = await screen.findByTestId("chat-canvas-error");
    expect(err.getAttribute("data-error-reason")).toBe("syntax");
    expect(err.textContent).toContain("模板");
    expect(err.querySelector("code")?.textContent).toContain("## 做得好");
    expect(screen.getByText(/后文/)).toBeInTheDocument();
    expect(screen.queryByTestId("chat-canvas-fabric")).toBeNull();
  });

  it("有模板行但没有任何 `## 分区` → syntax 错误态", async () => {
    const fence = ["```canvas", "模板: persona", "姓名: 林可", "```"].join("\n");
    render(<MarkdownMessage text={fence} />);
    const err = await screen.findByTestId("chat-canvas-error");
    expect(err.getAttribute("data-error-reason")).toBe("syntax");
    expect(err.textContent).toContain("分区");
  });

  it("组织里没有这个 key → template 错误态（不是空画布、不是 mock）", async () => {
    listCanvasTemplates.mockResolvedValue({ templates: [] });
    const fence = ["```canvas", "模板: 查无此模板", "## 某区", "- a", "```"].join("\n");
    render(<MarkdownMessage text={fence} />);
    const err = await screen.findByTestId("chat-canvas-error");
    expect(err.getAttribute("data-error-reason")).toBe("template");
    expect(err.textContent).toContain("查无此模板");
  });

  it("读取组织模板失败 → fetch 错误态，原因照实回显", async () => {
    listCanvasTemplates.mockRejectedValue(new Error("DEPENDENCY_UNAVAILABLE"));
    const fence = ["```canvas", "模板: retro-x4", "## 某区", "- a", "```"].join("\n");
    render(<MarkdownMessage text={fence} />);
    const err = await screen.findByTestId("chat-canvas-error");
    expect(err.getAttribute("data-error-reason")).toBe("fetch");
    expect(err.textContent).toContain("DEPENDENCY_UNAVAILABLE");
  });

  it("没有组织上下文（未登录）→ org 错误态，而不是假装渲染", async () => {
    currentOrgId = null;
    const fence = ["```canvas", "模板: retro-x5", "## 某区", "- a", "```"].join("\n");
    render(<MarkdownMessage text={fence} />);
    const err = await screen.findByTestId("chat-canvas-error");
    expect(err.getAttribute("data-error-reason")).toBe("org");
    expect(listCanvasTemplates).not.toHaveBeenCalled();
  });
});

describe("个人对话可用性", () => {
  /**
   * 个人对话 = `MarkdownMessage` 不带 threadId/messageId/bearer/projectId
   * （`chat-live-message-panel.tsx` 在 `canLandArtifacts` 为假时正是这么传的，
   * 而个人线程上它恒为假——见 `artifact-land-capability.test.ts` 钉死的既有设计）。
   * 这条渲染路径**不该**因此失效：它读的是会话的 orgId，不是项目判权。
   */
  it("不传任何项目/产物参数（= 个人对话）时，内置模板照样渲染", async () => {
    render(<MarkdownMessage text={PERSONA_FENCE} />);
    const el = await screen.findByTestId("chat-canvas-fabric");
    expect(el.getAttribute("data-template-source")).toBe("builtin");
    expect(screen.queryByTestId("chat-canvas-error")).toBeNull();
  });

  it("不传任何项目/产物参数时，组织自建模板也渲染（只需要 orgId，与 projectId 无关）", async () => {
    listCanvasTemplates.mockResolvedValue({ templates: [orgTemplate("retro-personal")] });
    const fence = ["```canvas", "模板: retro-personal", "## 做得好", "- a", "```"].join("\n");
    render(<MarkdownMessage text={fence} />);
    const el = await screen.findByTestId("chat-canvas-fabric");
    expect(el.getAttribute("data-template-source")).toBe("org-generated");
    // 取数只带 orgId——没有 projectId 这一栏，谈不上「意外依赖」
    expect(listCanvasTemplates).toHaveBeenCalledWith({ orgId: "org-personal-1" });
  });
});

describe("与 mermaid 图表分派互不干扰", () => {
  it("同一条消息里 mermaid 图表走图表分支、画布围栏走画布分支", async () => {
    const text = ["```mermaid", "flowchart TD", "  A --> B", "```", "", PERSONA_FENCE].join("\n");
    render(<MarkdownMessage text={text} />);
    await waitFor(() => expect(screen.getByTestId("chat-diagram-fabric")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("chat-canvas-fabric")).toBeInTheDocument());
    expect(screen.queryByTestId("chat-ai-mermaid-error")).toBeNull();
    expect(screen.queryByTestId("chat-canvas-error")).toBeNull();
  });
});
