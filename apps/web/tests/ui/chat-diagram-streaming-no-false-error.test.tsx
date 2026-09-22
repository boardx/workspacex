/**
 * 流式 mermaid 围栏不得先闪一个「语法错误」（#3866 R5）。
 *
 * `markdown-message.tsx` 的 `segment()` 对 canvas 围栏透传 `closed`，对 mermaid 围栏
 * **不透传**——于是 `ChatDiagramFabric` 在流式期间拿到的是半截源码，`mermaid.parse`
 * 抛错，状态机直接进 error：用户在模型写图的整段时间里盯着一个红框和一段残缺源码，
 * 写完才翻成图。「还没写完」不是「写错了」。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MarkdownMessage } from "@/components/chat/markdown-message";

const parse = vi.fn();
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: (...a: unknown[]) => parse(...a),
    render: vi.fn().mockResolvedValue({ svg: "<svg></svg>" }),
  },
}));
vi.mock("@/lib/live-canvas", () => ({ listCanvasTemplates: vi.fn().mockResolvedValue({ templates: [] }) }));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: "org-1" } }),
}));

beforeEach(() => {
  parse.mockReset();
  // 真实 mermaid 对半截源码就是抛错——这里照搬那个行为，不放宽。
  parse.mockImplementation((src: string) =>
    /-->\s*$|\[\s*$/.test(String(src).trim()) ? Promise.reject(new Error("Parse error")) : Promise.resolve(true),
  );
});

const PARTIAL = ["```mermaid", "graph TD", "  A[开始] --> "].join("\n");
const CLOSED_BROKEN = ["```mermaid", "graph TD", "  A[开始] --> ", "```"].join("\n");

describe("流式 mermaid", () => {
  it("半截围栏（未闭合）不判语法错误，只停在加载态", async () => {
    render(<MarkdownMessage text={PARTIAL} />);
    await waitFor(() => expect(screen.getByTestId("chat-diagram-fabric")).toBeTruthy());
    // 给状态机足够的时间走完 parse
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("chat-ai-mermaid-error")).toBeNull();
  });

  it("闭合之后内容真的坏了，才判语法错误", async () => {
    render(<MarkdownMessage text={CLOSED_BROKEN} />);
    await waitFor(() => expect(screen.getByTestId("chat-ai-mermaid-error")).toBeTruthy());
  });
});

/**
 * `canStartDiagram` 决定流式期间那**唯一一帧**落在哪。没有它，第一帧会在几乎没有内容时
 * 被取走然后冻到闭合，等于整条流都不渲染——那是我加它的原因，所以它得有自己的反证。
 */
describe("流式期间那一帧落在哪", () => {
  it("认不出图种、或只有一行时不占用那一帧", async () => {
    const { __canStartDiagramForTest } = await import("@/components/chat/chat-diagram-fabric");
    expect(__canStartDiagramForTest("graph T")).toBe(false);
    expect(__canStartDiagramForTest("graph TD")).toBe(false);          // 只有图种行，没有图体
    expect(__canStartDiagramForTest("随便写点什么\n还有一行")).toBe(false);
  });
  it("认得出图种且有图体时就可以画了", async () => {
    const { __canStartDiagramForTest } = await import("@/components/chat/chat-diagram-fabric");
    expect(__canStartDiagramForTest("graph TD\n  A[开始] --> B")).toBe(true);
  });
});
