import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const canvasAdd = vi.fn();
const canvasDispose = vi.fn();

vi.mock("fabric", () => {
  class FabricShape {
    data?: unknown;
    constructor(public options?: Record<string, unknown>) { Object.assign(this, options); }
    set(next: Record<string, unknown>) { Object.assign(this, next); return this; }
  }
  class Group extends FabricShape { constructor(public children: unknown[], options?: Record<string, unknown>) { super(options); } }
  return {
    Canvas: class {
      add = canvasAdd;
      active: unknown;
      setActiveObject = vi.fn((object: unknown) => { this.active = object; });
      getActiveObject = vi.fn(() => this.active);
      on = vi.fn();
      setDimensions = vi.fn();
      requestRenderAll = vi.fn();
      dispose = canvasDispose;
    },
    Circle: FabricShape,
    Group,
    Rect: FabricShape,
    Shadow: FabricShape,
    Textbox: FabricShape,
  };
});

vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a> }));

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

import {
  BoardObjectAuthoringPreview,
  resolveBoardObjectAuthoringScene,
  type BoardObjectAuthoringScene,
} from "@/components/whiteboard/authoring-preview/board-object-authoring-preview";
import { getAuthoringSceneObjects } from "@/components/whiteboard/authoring-preview/board-object-authoring-surface";

describe("BoardObjectAuthoringPreview", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    canvasAdd.mockClear();
    canvasDispose.mockClear();
  });

  it.each([
    ["default", "board-inline-editor-sticky-focus"],
    ["continuous", "board-continuous-status"],
    ["composing", "board-inline-editor-composing"],
    ["resize", "board-sticky-resize-mode"],
    ["contextual", "board-text-contextual-toolbar"],
    ["link-failed", "board-object-link-preview"],
    ["readonly", "board-object-authoring-preview"],
    ["undo-conflict", "err-board-history-conflict"],
  ] as const)("renders the %s signing scene", (scene, testId) => {
    render(<BoardObjectAuthoringPreview initialScene={scene} />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
    expect(screen.getByTestId("board-authoring-fabric-canvas")).toHaveAttribute("aria-label", "Fabric.js 白板对象画布");
  });

  it("keeps readonly authoring controls disabled while the canvas remains visible", () => {
    render(<BoardObjectAuthoringPreview initialScene="readonly" />);
    expect(screen.getByTestId("board-tool-sticky")).toBeDisabled();
    expect(screen.getByTestId("board-action-undo")).toBeDisabled();
    expect(screen.getByTestId("board-authoring-fabric-stage")).toBeVisible();
  });

  it("announces an accepted mock command without creating a second data store", () => {
    render(<BoardObjectAuthoringPreview initialScene="default" />);
    fireEvent.click(screen.getByTestId("board-tool-sticky"));
    expect(screen.getByTestId("board-authoring-announcer")).toHaveTextContent("便利贴已创建，文字编辑已就绪");
    expect(screen.getByTestId("board-authoring-trace")).toHaveTextContent("caret-ready");
  });

  it("projects exactly eleven ordered neighbors with a 24 world-space gap", () => {
    const objects = getAuthoringSceneObjects("continuous");
    expect(objects).toHaveLength(11);
    expect(objects.map((object) => object.id)).toEqual(Array.from({ length: 11 }, (_, index) => `sticky-series-${index + 1}`));
    for (let index = 1; index < objects.length; index += 1) {
      const current = objects[index]!;
      const previous = objects[index - 1]!;
      expect(current.x - (previous.x + previous.width)).toBe(24);
      expect(current.y).toBe(previous.y);
    }
  });

  it("keeps contextual controls matched to the selected canonical kind", () => {
    const { unmount } = render(<BoardObjectAuthoringPreview initialScene="contextual" />);
    const toolbar = screen.getByTestId("board-text-contextual-toolbar");
    expect(toolbar).toHaveAttribute("data-object-kind", "text");
    expect(within(toolbar).getByRole("button", { name: /Heading/ })).toBeVisible();
    expect(within(toolbar).queryByRole("button", { name: /方形/ })).not.toBeInTheDocument();
    unmount();
    render(<BoardObjectAuthoringPreview initialScene="link-failed" />);
    const stickyToolbar = screen.getByTestId("board-sticky-contextual-toolbar");
    expect(stickyToolbar).toHaveAttribute("data-object-kind", "sticky");
    expect(within(stickyToolbar).getByRole("button", { name: /方形/ })).toBeVisible();
    expect(within(stickyToolbar).queryByRole("button", { name: /Heading/ })).not.toBeInTheDocument();
  });

  it("derives contextual UI, property controls and command targets from one selected object", () => {
    const onCommand = vi.fn();
    render(<BoardObjectAuthoringPreview initialScene="contextual" onMockCommand={onCommand} />);

    const text = screen.getByTestId("board-mirror-object-text-heading");
    expect(text).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("board-properties-title")).toHaveTextContent("文字");
    expect(screen.getByTestId("board-properties-text-controls")).toBeVisible();
    fireEvent.click(within(screen.getByTestId("board-properties-text-controls")).getByRole("button", { name: "Heading" }));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({ type: "presentation", objectId: "text-heading" }));

    const reactionSticky = screen.getByTestId("board-mirror-object-sticky-context");
    fireEvent.click(reactionSticky);
    expect(reactionSticky).toHaveAttribute("aria-pressed", "true");
    expect(text).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("board-sticky-contextual-toolbar")).toHaveAttribute("data-object-kind", "sticky");
    expect(screen.getByTestId("board-properties-title")).toHaveTextContent("便利贴");
    expect(screen.getByTestId("board-object-reaction-summary")).toHaveTextContent("👍 3");
    fireEvent.click(screen.getByTestId("board-object-reaction-menu"));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({ type: "reaction", objectId: "sticky-context" }));

    const linkSticky = screen.getByTestId("board-mirror-object-sticky-link");
    fireEvent.click(linkSticky);
    expect(linkSticky).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("board-object-reaction-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("board-object-link-preview")).toBeVisible();
    fireEvent.click(screen.getByTestId("board-object-link-editor"));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({ type: "link", objectId: "sticky-link" }));
  });

  it("updates the default scene property panel when the mirror selects Text", () => {
    const onCommand = vi.fn();
    render(<BoardObjectAuthoringPreview initialScene="default" onMockCommand={onCommand} />);
    expect(screen.getByTestId("board-properties-title")).toHaveTextContent("便利贴");
    fireEvent.click(screen.getByTestId("board-mirror-object-text-heading"));
    expect(screen.getByTestId("board-properties-title")).toHaveTextContent("文字");
    expect(screen.getByTestId("board-properties-text-controls")).toBeVisible();
    expect(screen.queryByTestId("board-properties-sticky-controls")).not.toBeInTheDocument();
    const textEditor = screen.getByTestId("board-inline-editor-text-heading");
    fireEvent.compositionEnd(within(textEditor).getByRole("textbox"));
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({ type: "text-splice", objectId: "text-heading" }));
  });

  it("models normal, free and auto-height as three distinct canonical resize modes", () => {
    const objects = getAuthoringSceneObjects("resize");
    expect(objects.map((object) => object.resizeMode)).toEqual(["normal", "free", "auto-height"]);
    expect(objects.map(({ width, height }) => [width, height])).toEqual([[190, 190], [300, 150], [240, 270]]);
  });

  it("dispatches no text splice during IME composition and one after compositionend", () => {
    const onCommand = vi.fn();
    render(<BoardObjectAuthoringPreview initialScene="composing" onMockCommand={onCommand} />);
    const editor = screen.getByRole("textbox", { name: /编辑便利贴/ });
    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: "我们可以先从用户旅" } });
    expect(onCommand).not.toHaveBeenCalled();
    fireEvent.compositionEnd(editor);
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ type: "text-splice", objectId: "sticky-focus" }));
  });

  it("exposes ready links as safe keyboard anchors and blocked links as inert text", () => {
    const { unmount } = render(<BoardObjectAuthoringPreview initialScene="default" />);
    const ready = screen.getByTestId("board-mirror-link-sticky-link");
    expect(ready.tagName).toBe("A");
    expect(ready).toHaveAttribute("href", "https://miro.com/templates");
    expect(ready).toHaveAttribute("rel", "noopener noreferrer");
    unmount();
    render(<BoardObjectAuthoringPreview initialScene="link-failed" />);
    expect(screen.queryByTestId("board-mirror-link-sticky-link")).not.toBeInTheDocument();
    expect(screen.getByTestId("board-mirror-link-blocked-sticky-link").tagName).toBe("SPAN");
  });

  it("uses the DOM mirror to select Text while keeping Fabric and ARIA identity aligned", () => {
    render(<BoardObjectAuthoringPreview initialScene="default" />);
    const text = screen.getByTestId("board-mirror-object-text-heading");
    expect(text).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(text);
    expect(text).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("board-authoring-object-mirror")).toHaveTextContent("文字先看事实，再归纳机会");
    expect(screen.getByTestId("board-authoring-object-mirror")).toHaveTextContent("👍 3");
  });

  it("keeps readonly mutations disabled while safe links and mirror selection remain keyboard reachable", () => {
    render(<BoardObjectAuthoringPreview initialScene="readonly" />);
    expect(screen.getByTestId("board-tool-sticky")).toBeDisabled();
    expect(screen.getByTestId("board-action-undo")).toBeDisabled();
    expect(screen.getByTestId("board-mirror-link-sticky-link")).toHaveAttribute("href", "https://miro.com/templates");
    const text = screen.getByTestId("board-mirror-object-text-heading");
    fireEvent.click(text);
    expect(text).toHaveAttribute("aria-pressed", "true");
  });

  it("parses every signing query state and safely falls back for unknown input", () => {
    const states: readonly BoardObjectAuthoringScene[] = ["default", "continuous", "composing", "resize", "contextual", "link-failed", "readonly", "undo-conflict"];
    for (const state of states) expect(resolveBoardObjectAuthoringScene(state)).toBe(state);
    expect(resolveBoardObjectAuthoringScene("fabric-json")).toBe("default");
    expect(resolveBoardObjectAuthoringScene(null)).toBe("default");
  });
});
