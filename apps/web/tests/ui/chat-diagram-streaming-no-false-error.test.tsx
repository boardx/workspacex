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
