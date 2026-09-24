/**
 * 对标 R7（#3933）—— 直接编辑：画布上双击改字、图层拖拽排序、重做。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/d", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import * as React from "react";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";
import { PrototypeLayers } from "@/components/design-loop/prototype-layers";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";
import { dropBeforeOps } from "@/lib/prototype-node-actions";
import type { DesignProject } from "@/lib/live-design-workbench";

afterEach(() => { cleanup(); apiRequest.mockReset(); });

const tree = {
  type: "stack" as const, id: "root", children: [
    { type: "text" as const, id: "t", props: { content: "年度会员 · 专业版", variant: "title" as const } },
    { type: "tabs" as const, id: "tabs", props: { items: ["详情", "规格"] } },
    { type: "stack" as const, id: "box", children: [{ type: "checkbox" as const, id: "agree", props: { label: "同意" } }] },
    { type: "button" as const, id: "buy", props: { label: "立即购买" } },
  ],
};

describe("dropBeforeOps", () => {
  it("同一父容器里往前拖：挪到目标前面，保留原 id", () => {
    expect(dropBeforeOps([tree], "buy", "tabs")).toEqual([
      { op: "remove", id: "buy" },
      { op: "insert", parentId: "root", index: 1, node: tree.children[3] },
    ]);
  });
  it("往后拖：按删除之后的下标算（差一格就会变成原地不动或多挪一格）", () => {
    // t(0) tabs(1) box(2) buy(3)：把 t 拖到 buy 上 ⇒ 删掉 t 后 buy 在 2 ⇒ 插在 2。
    expect(dropBeforeOps([tree], "t", "buy")?.[1]).toMatchObject({ index: 2, parentId: "root" });
  });
  it("跨父容器：把深处的勾选拖到 tabs 前面", () => {
    expect(dropBeforeOps([tree], "agree", "tabs")?.[1]).toMatchObject({ parentId: "root", index: 1 });
  });
  it("非法的拖放返回 null：拖到自己子树里、拖根、拖到根、原地", () => {
    expect(dropBeforeOps([tree], "box", "agree")).toBeNull();
    expect(dropBeforeOps([tree], "root", "t")).toBeNull();
    expect(dropBeforeOps([tree], "t", "root")).toBeNull();
    expect(dropBeforeOps([tree], "t", "tabs")).toBeNull();
  });
});

describe("画布上双击改字", () => {
  it("双击 ⇒ 就地可编辑；回车提交走 onInlineEdit（文本改 content、按钮改 label）", () => {
    const onInlineEdit = vi.fn();
    render(<PrototypeCanvas label="x" root={tree} onSelect={() => undefined} onInlineEdit={onInlineEdit} />);
    // ⭐ 反证锚点：不接 onDoubleClick ⇒ 双击之后没有可编辑区，这条红。
    fireEvent.doubleClick(screen.getByText("年度会员 · 专业版"));
    const ed = screen.getByTestId("design-canvas-inline-edit");
    ed.innerText = "年度会员 · 旗舰版";
    fireEvent.keyDown(ed, { key: "Enter" });
    expect(onInlineEdit).toHaveBeenCalledWith("t", "content", "年度会员 · 旗舰版");

    fireEvent.doubleClick(screen.getByText("立即购买"));
    const ed2 = screen.getByTestId("design-canvas-inline-edit");
    ed2.innerText = "马上购买";
    fireEvent.keyDown(ed2, { key: "Enter" });
    expect(onInlineEdit).toHaveBeenLastCalledWith("buy", "label", "马上购买");
  });

  it("Esc 放弃、没改就不提交、空的不提交；预览态双击不进编辑", () => {
    const onInlineEdit = vi.fn();
    const { rerender } = render(<PrototypeCanvas label="x" root={tree} onSelect={() => undefined} onInlineEdit={onInlineEdit} />);
    fireEvent.doubleClick(screen.getByText("立即购买"));
    fireEvent.keyDown(screen.getByTestId("design-canvas-inline-edit"), { key: "Escape" });
    expect(screen.queryByTestId("design-canvas-inline-edit")).toBeNull();
    fireEvent.doubleClick(screen.getByText("立即购买"));
    fireEvent.keyDown(screen.getByTestId("design-canvas-inline-edit"), { key: "Enter" });
    const ed = (fireEvent.doubleClick(screen.getByText("立即购买")), screen.getByTestId("design-canvas-inline-edit"));
    ed.innerText = "   ";
    fireEvent.keyDown(ed, { key: "Enter" });
    expect(onInlineEdit).not.toHaveBeenCalled();
    rerender(<PrototypeCanvas label="x" root={tree} mode="preview" onInlineEdit={onInlineEdit} />);
    fireEvent.doubleClick(screen.getByText("立即购买"));
    expect(screen.queryByTestId("design-canvas-inline-edit")).toBeNull();
  });
});

describe("图层拖拽", () => {
  it("把一行拖到另一行上 ⇒ onMove(被拖, 目标)；根不可拖", () => {
    const onMove = vi.fn();
    render(<PrototypeLayers root={tree} selectedId={null} onSelect={() => undefined} onMove={onMove} />);
    const store = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => store.set(k, v), getData: (k: string) => store.get(k) ?? "", get types() { return [...store.keys()]; }, effectAllowed: "", dropEffect: "" };
    const from = screen.getByTestId("design-layer-agree");
    const to = screen.getByTestId("design-layer-tabs");
    expect(from.getAttribute("draggable")).toBe("true");
    expect(screen.getByTestId("design-layer-root").getAttribute("draggable")).toBe("false");
    fireEvent.dragStart(from, { dataTransfer });
    fireEvent.dragOver(to, { dataTransfer });
    fireEvent.drop(to, { dataTransfer });
    expect(onMove).toHaveBeenCalledWith("agree", "tabs");
  });
});

describe("重做", () => {
  function project(label: string, updatedAt: string): DesignProject {
    return {
      id: "p1", name: "下单", template: "mobile", theme: "light", accent: "neutral", tokens: { brand: null, font: "sans", radius: "default", density: "default" },
      tags: [], refImages: [], share: null, problem: "", criteria: [], frames: ["首页"], frameNotes: [],
      prototype: [{ type: "stack", id: "root", children: [{ type: "button", id: "buy", props: { label } }] }] as never,
      pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null,
      chat: [], ownerId: "u", ownerName: "我", createdAt: "2026-09-23T00:00:00.000Z", updatedAt,
    };
  }

  it("撤销之后重做可用，重做恢复的是撤销之前那一版；之后有别的改动 ⇒ 重做失效", async () => {
    let current = project("马上购买", "t2");
    const restored: string[] = [];
    apiRequest.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === "/pm-designs") return { items: [current] };
      if (path === "/pm-designs/p1/versions") return { items: [{ id: "v2", seq: 2, source: "user", summary: "", frames: ["首页"], notes: [], createdAt: "t2" }, { id: "v1", seq: 1, source: "model", summary: "", frames: ["首页"], notes: [], createdAt: "t1" }] };
      const m = path.match(/^\/pm-designs\/p1\/versions\/(v\d)\/restore$/);
      if (m !== null && opts?.method === "POST") {
        restored.push(m[1]!);
        current = project(m[1] === "v1" ? "立即购买" : "马上购买", `r${restored.length}`);
        return { project: current };
      }
      if (path === "/pm-designs/p1/prototype/patch") { current = project("再改一次", "t9"); return { project: current }; }
      throw new Error(`unexpected ${path}`);
    });
    render(<DesignDetailScreen projectId="p1" />);
    await screen.findByTestId("design-detail");
    const redoBtn = screen.getByTestId("design-detail-redo");
    expect((redoBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("design-detail-undo"));
    await waitFor(() => expect(restored).toEqual(["v1"]));
    await waitFor(() => expect((screen.getByTestId("design-detail-redo") as HTMLButtonElement).disabled).toBe(false));
    // ⭐ 反证锚点：重做不按「撤销之前那一版」恢复（比如又恢复一次倒数第二版）⇒ 这里拿到的不是 v2。
    fireEvent.click(screen.getByTestId("design-detail-redo"));
    await waitFor(() => expect(restored).toEqual(["v1", "v2"]));
    await waitFor(() => expect((screen.getByTestId("design-detail-redo") as HTMLButtonElement).disabled).toBe(true));
  });
});
