import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
      setActiveObject = vi.fn();
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

import { BoardObjectAuthoringPreview } from "@/components/whiteboard/authoring-preview/board-object-authoring-preview";

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
    ["contextual", "board-sticky-contextual-toolbar"],
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
});
