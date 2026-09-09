import { fireEvent, render, screen } from "@testing-library/react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SourceBindingPreview } from "@/components/ai-capability-studio/source-binding-preview";
const reason = (value = "明确更换来源") => fireEvent.change(screen.getByLabelText("变更理由"), { target: { value } });
const confirm = () => fireEvent.click(screen.getByRole("checkbox", { name: /我已审阅/ }));
const select = () => fireEvent.click(screen.getByRole("checkbox", { name: /选择 research-skill/ }));
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
describe("source binding recovery demonstration", () => {
  it("requires a reason and explicit confirmation, and invalidates consent when intent changes", () => {
    render(<SourceBindingPreview />);
    const detach = screen.getByRole("button", { name: "解绑当前来源（演示）" });
    expect(detach).toBeDisabled(); confirm(); expect(detach).toBeDisabled();
    reason(); expect(screen.getByRole("checkbox", { name: /我已审阅/ })).not.toBeChecked();
    confirm(); expect(detach).not.toBeDisabled();
    select(); expect(detach).toBeDisabled(); expect(screen.getByRole("checkbox", { name: /我已审阅/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "绑定所选新来源（演示）" })).toBeDisabled();
  });
  it("detaches an offline source without changing local files or published lineage", () => {
    render(<SourceBindingPreview />);
    expect(screen.getByTestId("source-binding-current")).toHaveTextContent("原来源离线");
    const files = screen.getByTestId("source-binding-files").textContent;
    reason("离线来源不再跟踪"); confirm(); click("解绑当前来源（演示）");
    expect(screen.getByTestId("source-binding-current")).toHaveTextContent("已解绑，比较基线已清除");
    expect(screen.getByTestId("source-binding-current")).toHaveTextContent("r4");
    expect(screen.getByTestId("source-binding-current")).toHaveTextContent("demo-published-v1");
    expect(screen.getByTestId("source-binding-files").textContent).toBe(files);
    expect(screen.getByRole("status")).toHaveTextContent("远端离线不影响解绑");
  });
  it("rebinds a selected candidate but leaves baseline creation and merging unavailable", () => {
    render(<SourceBindingPreview />);
    const files = screen.getByTestId("source-binding-files").textContent;
    reason(); select(); confirm(); click("绑定所选新来源（演示）");
    expect(screen.getByTestId("source-binding-current")).toHaveTextContent("example/new-skills");
    expect(screen.getByTestId("source-binding-current")).toHaveTextContent("baseline-required");
    expect(screen.getByTestId("source-binding-current")).toHaveTextContent("此步骤尚未实现");
    expect(screen.getByTestId("source-binding-files").textContent).toBe(files);
    expect(screen.getByRole("button", { name: "合并上游（尚未接线）" })).toBeDisabled();
    click("模拟旧页面重新绑定请求");
    expect(screen.getByRole("status")).toHaveTextContent("请求已拒绝");
    expect(screen.getByTestId("source-binding-current")).toHaveTextContent("r4");
    expect(screen.getByTestId("source-binding-files").textContent).toBe(files);
  });
  it("resets on remount and provides existing routes without persisting or fetching", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    try {
      const view = render(<SourceBindingPreview />);
      expect(screen.getByText(/刷新页面会重置/)).toBeVisible();
      expect(screen.getByRole("link", { name: "返回开发工作台" })).toHaveAttribute("href", "/preview/ai-capability-studio/workbench");
      expect(screen.getByRole("link", { name: "返回导入向导" })).toHaveAttribute("href", "/preview/ai-capability-studio/import");
      expect(screen.getByRole("link", { name: "管理个人来源连接" })).toHaveAttribute("href", "/preview/ai-capability-studio/connections?returnTo=source&skillId=demo-skill&draftId=demo-source-draft");
      for (const link of screen.getAllByRole("link")) {
        const href = link.getAttribute("href")!;
        expect(href.startsWith("/preview/ai-capability-studio/")).toBe(true);
        expect(existsSync(resolve(process.cwd(), "app", new URL(href, "http://preview.local").pathname.slice(1), "page.tsx")), `navigation route exists: ${href}`).toBe(true);
      }
      reason(); confirm(); click("解绑当前来源（演示）"); view.unmount(); render(<SourceBindingPreview />);
      expect(screen.getByTestId("source-binding-current")).toHaveTextContent("r3");
      expect(fetch).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    } finally { storage.mockRestore(); vi.unstubAllGlobals(); }
  });
});
