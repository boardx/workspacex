/**
 * 深度 S6（#3988）—— 右栏「代码」面板：编辑器里直接看、复制导出的 React 代码。
 *
 * 钉住：面板里就是「导出 → React 组件」下载的那一份（同一个 `exportPrototypeReactTsx`）；
 * 项目一变代码跟着重算；复制写进剪贴板、写不进如实说。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { PrototypeCodePanel } from "@/components/design-loop/prototype-code-panel";
import { exportPrototypeReactTsx } from "@/lib/prototype-react-export-icons";
import type { DesignProject } from "@/lib/live-design-workbench";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function project(title: string): DesignProject {
  return {
    id: "p1", name: "会员", template: "mobile", theme: "light", accent: "blue",
    tokens: { brand: null, font: "sans", radius: "default", density: "default" }, tags: [], refImages: [], share: null,
    problem: "", criteria: [], frames: ["首页"], frameNotes: [],
    prototype: [{ type: "stack", id: "s", children: [
      { type: "text", id: "t", props: { content: title, variant: "title" } },
      { type: "button", id: "b", props: { label: "分享", icon: "share" } },
    ] }] as never,
    pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null,
    chat: [], ownerId: "u1", ownerName: "我", createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z",
  };
}

describe("PrototypeCodePanel", () => {
  it("面板里是导出的那一份代码（含图标组件）；项目一变，代码跟着变", async () => {
    // ⭐ 反证锚点：面板不随 `project` 重算 ⇒ 第二段断言红——画布上改了字，代码还是旧的。
    const first = project("年度会员 · 专业版");
    const { rerender } = render(<PrototypeCodePanel project={first} />);
    const panel = await screen.findByTestId("design-code-panel");
    expect(panel.textContent).toBe(await exportPrototypeReactTsx(first, new Date()));
    expect(panel.textContent).toContain("function IconShare()");
    rerender(<PrototypeCodePanel project={project("年度会员 · 旗舰版")} />);
    await waitFor(() => expect(screen.getByTestId("design-code-panel").textContent).toContain("年度会员 · 旗舰版"));
    expect(screen.getByTestId("design-code-panel").textContent).not.toContain("专业版");
  });

  it("复制：剪贴板里就是这份代码；浏览器不给写 ⇒ 说出来，不装作复制了", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<PrototypeCodePanel project={project("年度会员")} />);
    const panel = await screen.findByTestId("design-code-panel");
    fireEvent.click(screen.getByTestId("design-code-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(panel.textContent));
    expect(await screen.findByText("已复制")).toBeTruthy();

    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByTestId("design-code-copy"));
    expect((await screen.findByRole("alert")).textContent).toContain("没能写进剪贴板");
  });
});
