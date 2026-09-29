import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThinkingInputEditor } from "@/components/whiteboard/thinking-input-editor";
import type { BoardFabricObject, BoardViewport } from "@/components/whiteboard/fabric/board-fabric-object";

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
  it("edits a sticky in place without replacing its paper with form chrome", async () => {
    const onCommit = vi.fn(() => true);
    render(<ThinkingInputEditor object={object("sticky")} initialValue="原位编辑" viewport={viewport} readOnly={false} onLiveCommit={vi.fn()} onCommit={onCommit} onCancel={vi.fn()} onContinue={vi.fn()} />);
    const input = screen.getByTestId("board-thinking-editor");
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveClass("appearance-none", "bg-transparent", "border-0", "outline-none", "resize-none", "p-0", "shadow-none");
    expect(input).toHaveStyle({ left: "160px", top: "200px", width: "270px", height: "270px", transform: "rotate(17deg)", color: "#123456" });
    expect(input.style.paddingLeft).toBe("36px");
    expect(input.style.paddingRight).toBe("36px");
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
