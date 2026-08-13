/**
 * VZ-01 —— AI 气泡把 `msg.text` 当 markdown 渲染，并把 ```mermaid 围栏交给白名单闸门。
 * mermaid 引擎（浏览器 API）在 jsdom 里 mock 掉：这里验的是**分段 + 闸门 + 错误态**，不是
 * mermaid 自身产 SVG（那属浏览器 e2e）。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MarkdownMessage } from "@/components/chat/markdown-message";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn().mockResolvedValue(true),
    render: vi.fn().mockResolvedValue({ svg: "<svg data-testid=\"fake-svg\"></svg>" }),
  },
}));

describe("MarkdownMessage", () => {
  it("把 markdown 渲染成结构（标题/加粗/列表），容器带 chat-ai-markdown", async () => {
    render(<MarkdownMessage text={"# 决策路径\n\n**关键**结论：\n\n- 一\n- 二"} />);
    const md = await screen.findByTestId("chat-ai-markdown");
    expect(md).toBeInTheDocument();
    expect(md.querySelector("h1")?.textContent).toContain("决策路径");
    expect(md.querySelector("strong")?.textContent).toBe("关键");
    expect(md.querySelectorAll("li")).toHaveLength(2);
  });

  it("越界图类型的 mermaid 围栏 → 诚实错误态（chat-ai-mermaid-error），不崩不静默丢", async () => {
    render(<MarkdownMessage text={"看图：\n\n```mermaid\nxychart-beta\n  line [1,2]\n```\n\n完。"} />);
    const err = await screen.findByTestId("chat-ai-mermaid-error");
    expect(err.textContent).toContain("xychart-beta"); // 明示不支持的类型
    // 前后 markdown 仍在（不因一个坏围栏丢掉整条消息）。
    expect(screen.getByTestId("chat-ai-markdown")).toBeInTheDocument();
    expect(screen.getByText(/完。/)).toBeInTheDocument();
  });

  it("白名单内的 mermaid 围栏 → 走 fabric 渲染路径（validating→valid，挂 fabric 容器），不落错误态", async () => {
    // VZ-fabric 增量：happy-path 从 VZ-01 的静态 SVG（chat-ai-mermaid）换成 fabric 渲染
    // （ChatDiagramFabric）。mermaid.parse mock 成功 → 状态机 validating→valid → 挂
    // data-testid="chat-diagram-fabric" 容器（内含 <canvas> 与最大化入口）。fabric 建画布
    // 依赖真实 canvas context，jsdom 里不产 data-ready，但容器随 valid 态同步出现——这里验
    // 的是「白名单内走渲染路径、不落错误态」，画布像素属浏览器 e2e。
    render(<MarkdownMessage text={"```mermaid\nflowchart TD\n  A --> B\n```"} />);
    await waitFor(() => expect(screen.getByTestId("chat-diagram-fabric")).toBeInTheDocument());
    expect(screen.queryByTestId("chat-ai-mermaid-error")).toBeNull();
  });
});
