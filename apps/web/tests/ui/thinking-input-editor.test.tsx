import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThinkingInputEditor } from "@/components/whiteboard/thinking-input-editor";
import type { BoardFabricObject, BoardViewport } from "@/components/whiteboard/fabric/board-fabric-object";
import { scenePointFromLocal } from "@repo/whiteboard-core";

const viewport: BoardViewport = { zoom: 1.5, panX: 10, panY: 20, fitRequest: 0 };

function object(kind: "sticky" | "text"): BoardFabricObject {
  return {
    id: `${kind}-1`, kind, revision: 1, orderKey: "a",
    geometry: { x: 100, y: 120, width: kind === "sticky" ? 180 : 320, height: kind === "sticky" ? 180 : 96, rotation: 17 },
    style: { fill: "#F8D76E", textColor: "#123456", fontFamily: "Noto Serif SC", fontSize: 20, bold: true, italic: true, underline: true, alignment: "right", lineHeight: 1.4 },
    content: { text: "原位编辑" },
  };
}

describe("ThinkingInputEditor", () => {
  it.each([
    { rotation: 0, left: "196px", top: "314px" },
    { rotation: 90, left: "46px", top: "236px" },
  ])("places the inset middle-aligned editor at independent fixed coordinates for $rotation degrees", ({ rotation, left, top }) => {
    const note = object("sticky");
    note.geometry.rotation = rotation;
    render(<ThinkingInputEditor object={note} initialValue="短文字" viewport={viewport} readOnly={false} onLiveCommit={vi.fn()} onCommit={vi.fn(() => true)} onCancel={vi.fn()} onContinue={vi.fn()} />);
    // The local origin (24, 76) maps to (124, 196) at 0 degrees and
    // (24, 144) at 90 degrees, before zoom 1.5 and pan (10, 20).
    expect(screen.getByTestId("board-thinking-editor")).toHaveStyle({ left, top, width: "198px", height: "42px", padding: "0px", transformOrigin: "0 0" });
  });
  it.each(["top", "middle", "bottom"] as const)("limits rotated %s-aligned editing to the real text content box", alignment => {
    const note = object("sticky");
    note.style.verticalAlignment = alignment;
    render(<ThinkingInputEditor object={note} initialValue="短文字" viewport={viewport} readOnly={false} onLiveCommit={vi.fn()} onCommit={vi.fn(() => true)} onCancel={vi.fn()} onContinue={vi.fn()} />);
    const input = screen.getByTestId("board-thinking-editor");
    const top = alignment === "top" ? 24 : alignment === "bottom" ? 128 : 76;
    const position = scenePointFromLocal(note.geometry, { x: 24, y: top });
    expect(parseFloat(input.style.left)).toBeCloseTo(position.x * 1.5 + 10, 8);
    expect(parseFloat(input.style.top)).toBeCloseTo(position.y * 1.5 + 20, 8);
    expect(input).toHaveStyle({ width: "198px", height: "42px", padding: "0px", transformOrigin: "0 0" });
    expect(input.style.pointerEvents).not.toBe("none");
  });

  it("keeps long-text scrolling inside the inset content rectangle without discarding text", () => {
    const long = "long text ".repeat(200);
    render(<ThinkingInputEditor object={object("sticky")} initialValue={long} viewport={viewport} readOnly={false} onLiveCommit={vi.fn()} onCommit={vi.fn(() => true)} onCancel={vi.fn()} onContinue={vi.fn()} />);
    const input = screen.getByTestId("board-thinking-editor");
    expect(input).toHaveValue(long);
    expect(input).toHaveStyle({ width: "198px", height: "198px", overflow: "auto", padding: "0px" });
  });
  it("edits a sticky in place without replacing its paper with form chrome", async () => {
    const onCommit = vi.fn(() => true);
    render(<ThinkingInputEditor object={object("sticky")} initialValue="原位编辑" viewport={viewport} readOnly={false} onLiveCommit={vi.fn()} onCommit={onCommit} onCancel={vi.fn()} onContinue={vi.fn()} />);
    const input = screen.getByTestId("board-thinking-editor");
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveClass("appearance-none", "bg-transparent", "border-0", "outline-none", "resize-none", "p-0", "shadow-none");
    const position = scenePointFromLocal(object("sticky").geometry, { x: 24, y: 76 });
    expect(parseFloat(input.style.left)).toBeCloseTo(position.x * viewport.zoom + viewport.panX, 8);
    expect(parseFloat(input.style.top)).toBeCloseTo(position.y * viewport.zoom + viewport.panY, 8);
    expect(input).toHaveStyle({ width: "198px", height: "42px", transform: "rotate(17deg)", color: "#123456" });
    expect(input.style.paddingLeft).toBe("0px");
    expect(input.style.paddingRight).toBe("0px");
    expect(input.style.fontFamily).toBe('"Noto Serif SC"');
    expect(input.style.fontSize).toBe("30px");
    expect(input.style.fontWeight).toBe("700");
    expect(input.style.fontStyle).toBe("italic");
    expect(input.style.textDecoration).toBe("underline");
    expect(input.style.textAlign).toBe("right");
    fireEvent.change(input, { target: { value: "更新后的便利贴" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onCommit).toHaveBeenCalledWith("更新后的便利贴", "enter");
  });

  it("keeps free text flush with its canvas geometry", () => {
    render(<ThinkingInputEditor object={object("text")} initialValue="标题" viewport={{ ...viewport, zoom: 1 }} readOnly={false} onLiveCommit={vi.fn()} onCommit={vi.fn(() => true)} onCancel={vi.fn()} onContinue={vi.fn()} />);
    const input = screen.getByTestId("board-thinking-editor");
    expect(input).toHaveStyle({ paddingLeft: "0px", paddingRight: "0px", paddingTop: "0px", borderRadius: "0px", transform: "rotate(17deg)", color: "#123456", fontSize: "20px", fontWeight: "700", fontStyle: "italic", textAlign: "right" });
    expect(input.style.fontFamily).toBe('"Noto Serif SC"');
  });
});
