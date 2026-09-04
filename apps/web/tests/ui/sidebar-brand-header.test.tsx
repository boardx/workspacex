/**
 * 2026-09-04 人类直接反馈（issue #2631 items 3/4）——`SidebarBrandHeader` 的品牌行
 * 换成真实 WorkspaceX wordmark、去掉装饰性下拉箭头。这里补一个聚焦的组件级回归，
 * 钉住这两条具体行为（而不是只靠 104 项既有回归测试间接兜底）：
 * ① 品牌图形以可访问名"WorkspaceX"出现（`role="img"` + `aria-label`），不是一段
 *    没有语义的纯装饰 SVG；
 * ② 不再渲染任何下拉/chevron 图标——这一行纯展示、不接任何交互（见组件头注）。
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarBrandHeader } from "@/components/chat/thread-list-shell";

describe("SidebarBrandHeader（issue #2631 items 3/4）", () => {
  it("渲染带可访问名「WorkspaceX」的品牌 logo", () => {
    render(<SidebarBrandHeader />);
    expect(screen.getByRole("img", { name: "WorkspaceX" })).toBeInTheDocument();
  });

  it("不再渲染装饰性下拉箭头——这一行纯展示，不该有任何看起来能点的东西", () => {
    const { container } = render(<SidebarBrandHeader />);
    // lucide `ChevronDown` 渲染为 `<svg class="lucide-chevron-down ...">`；
    // 品牌 wordmark 本身也是一个 <svg>（`aria-label="WorkspaceX"`），所以直接
    // 按 class 名排除，而不是断言"只有一个 svg"。
    expect(container.querySelector(".lucide-chevron-down")).not.toBeInTheDocument();
    // 品牌行本身不该有任何按钮/链接——它是纯展示（组件头注明确要求）。
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("⌘K 快捷键提示与品牌 logo 同一行渲染（既有视觉提示，未被本轮改动波及）", () => {
    render(<SidebarBrandHeader />);
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });
});
