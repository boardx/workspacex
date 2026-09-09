import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SourceConnectionsPreview } from "@/components/ai-capability-studio/source-connections-preview";
import SourceConnectionsPage from "@/app/preview/ai-capability-studio/connections/page";
import SourceBindingPage from "@/app/preview/ai-capability-studio/source/page";
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const select = () => fireEvent.click(screen.getByRole("checkbox", { name: /private-research/ }));
const connect = () => { click("开始连接（演示）"); click("模拟授权成功回调"); select(); click("确认所选仓库（演示）"); };
describe("personal source connection demonstration", () => {
  it("distinguishes an expired connection from an expired authorization transaction", () => {
    render(<SourceConnectionsPreview />); connect();
    click("模拟连接失效");
    expect(screen.getByTestId("source-current-connection")).toHaveTextContent("需要重新授权");
    expect(screen.getByTestId("source-current-connection")).toHaveTextContent("版本 2");
    expect(screen.getByTestId("source-current-connection")).toHaveTextContent("当前不可读取");
    expect(screen.getByTestId("source-current-connection")).not.toHaveTextContent("已撤销");
    click("重新授权（演示）"); click("模拟授权过期");
    expect(screen.getByTestId("source-current-connection")).toHaveTextContent("需要重新授权");
    click("重新授权（演示）"); click("模拟授权成功回调"); select(); click("确认所选仓库（演示）");
    expect(screen.getByTestId("source-current-connection")).toHaveTextContent("可读取");
    expect(screen.getByTestId("source-current-connection")).toHaveTextContent("版本 3");
  });
  it("requires an explicit selection after the simulated callback and never links to real authorization", () => {
    render(<SourceConnectionsPreview />);
    expect(screen.getByText(/刷新页面会重置/)).toBeVisible();
    click("开始连接（演示）");
    expect(screen.queryByRole("button", { name: "确认所选仓库（演示）" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link").every(link => !link.getAttribute("href")?.startsWith("https://github.com"))).toBe(true);
    click("模拟授权成功回调");
    expect(screen.getAllByRole("checkbox").every(input => !(input as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("button", { name: "确认所选仓库（演示）" })).toBeDisabled();
    select(); click("确认所选仓库（演示）");
    expect(screen.getByTestId("source-current-connection")).toHaveTextContent("版本 1");
    expect(screen.getByTestId("source-current-connection")).toHaveTextContent("example/private-research");
    expect(screen.getByTestId("source-current-connection")).not.toHaveTextContent("example/team-skills");
  });
  it("keeps the original connection across failed reauthorization and advances the same ID once on success", () => {
    render(<SourceConnectionsPreview />); connect();
    for (const failure of ["模拟拒绝授权", "模拟授权过期"]) {
      click("重新授权（演示）"); click(failure);
      expect(screen.getByTestId("source-current-connection")).toHaveTextContent("版本 1");
      expect(screen.getByTestId("source-current-connection")).toHaveTextContent("example/private-research");
      expect(screen.getByRole("status")).toHaveTextContent("原连接与已有草稿保持原样");
    }
    click("重新授权（演示）"); click("模拟授权成功回调");
    expect(screen.getByRole("checkbox", { name: /private-research/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /team-skills/ })); click("确认所选仓库（演示）");
    expect(screen.getByTestId("source-current-connection")).toHaveTextContent("demo-personal-connection · 版本 2");
    expect(screen.getByTestId("source-current-connection")).not.toHaveTextContent("example/private-research");
  });
  it("cancels pending and selection attempts without changing existing state, then supports revoke and restore", () => {
    render(<SourceConnectionsPreview />); connect();
    click("重新授权（演示）"); click("取消本次授权");
    expect(screen.getByRole("status")).toHaveTextContent("原连接与已有草稿保持原样");
    click("重新授权（演示）"); click("模拟授权成功回调"); select(); click("取消本次授权");
    expect(screen.getByTestId("source-current-connection")).toHaveTextContent("版本 1");
    click("撤销演示连接");
    expect(screen.getByTestId("source-current-connection")).toHaveTextContent("已撤销");
    expect(screen.getByTestId("source-current-connection")).toHaveTextContent("版本 2");
    click("重新授权（演示）"); click("模拟授权成功回调"); select(); click("确认所选仓库（演示）");
    expect(screen.getByTestId("source-current-connection")).toHaveTextContent("demo-personal-connection · 版本 3");
  });
  it("retains the chosen return target through cancellation and resets state on remount", () => {
    const view = render(<SourceConnectionsPreview />);
    fireEvent.click(screen.getByRole("radio", { name: "草稿来源修复" }));
    click("开始连接（演示）"); click("取消本次授权");
    expect(screen.getByRole("link", { name: /返回草稿来源修复示例/ })).toHaveAttribute("href", "/preview/ai-capability-studio/source?skillId=demo-skill&draftId=demo-source-draft");
    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href")!;
      expect(existsSync(resolve(process.cwd(), "app", new URL(href, "http://preview.local").pathname.slice(1), "page.tsx")), `return route exists: ${href}`).toBe(true);
    }
    click("开始连接（演示）"); click("模拟授权成功回调"); select(); click("确认所选仓库（演示）");
    view.unmount(); render(<SourceConnectionsPreview />);
    expect(screen.queryByTestId("source-current-connection")).not.toBeInTheDocument();
  });
});

it("starts source recovery with the exact fixed draft return target", () => {
  render(<SourceConnectionsPreview initialTarget="upstream" />);
  expect(screen.getByRole("radio", { name: "草稿来源修复" })).toBeChecked();
  click("开始连接（演示）"); click("模拟拒绝授权");
  const url = new URL(screen.getByRole("link", { name: /返回草稿来源修复示例/ }).getAttribute("href")!, "http://preview.local");
  expect(url.pathname).toBe("/preview/ai-capability-studio/source");
  expect(url.searchParams.get("skillId")).toBe("demo-skill");
  expect(url.searchParams.get("draftId")).toBe("demo-source-draft");
});

it("routes source entry context and rejects an unrelated draft instead of opening the demo", () => {
  const view = render(<SourceConnectionsPage searchParams={{ returnTo: "source", skillId: "demo-skill", draftId: "demo-source-draft" }} />);
  expect(screen.getByRole("radio", { name: "草稿来源修复" })).toBeChecked();
  view.unmount();
  const invalid = render(<SourceConnectionsPage searchParams={{ returnTo: "source", skillId: "other", draftId: "other" }} />);
  expect(screen.getByRole("heading", { name: "来源修复上下文不可用" })).toBeInTheDocument();
  invalid.unmount();
  render(<SourceBindingPage searchParams={{ skillId: "other", draftId: "other" }} />);
  expect(screen.getByRole("heading", { name: "来源修复上下文不可用" })).toBeInTheDocument();
});
