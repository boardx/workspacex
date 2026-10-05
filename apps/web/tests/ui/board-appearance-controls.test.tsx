import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoardColorSwatches, BoardCommentIndicator, BoardRadiusPresets, BoardStrokePresets } from "@/components/whiteboard/board-appearance-controls";
import { BoardContentObjectInspector } from "@/components/whiteboard/board-content-object-inspector";
import type { CanonicalContentObject, WhiteboardObject } from "@repo/whiteboard-core";
import { BOARD_INK_COLORS } from "@/components/whiteboard/board-color-palette";

describe("board visual appearance controls", () => {
  it("offers visible line weights and radius presets that commit their represented value", () => {
    const onWidth = vi.fn(), onRadius = vi.fn();
    render(<><BoardStrokePresets label="边框粗细" value={2} onChange={onWidth} /><BoardRadiusPresets label="圆角" value={8} onChange={onRadius} /></>);
    fireEvent.click(screen.getByRole("button", { name: "边框粗细 8px" }));
    fireEvent.click(screen.getByRole("button", { name: "圆角 20px" }));
    expect(onWidth).toHaveBeenCalledWith(8);
    expect(onRadius).toHaveBeenCalledWith(20);
    expect(screen.getByRole("button", { name: "边框粗细 2px" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("uses the shared palette and refuses disabled color changes", () => {
    const change = vi.fn();
    render(<BoardColorSwatches label="笔色" value={BOARD_INK_COLORS[0]} disabled onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: `笔色 ${BOARD_INK_COLORS[8]}` }));
    expect(change).not.toHaveBeenCalled();
  });
  it("renders accessible comment count and opens its object thread", () => {
    const open = vi.fn();
    render(<BoardCommentIndicator objectId="shape" label="形状" count={3} style={{left:10,top:20}} onClick={open} />);
    const badge = screen.getByRole("button", { name: "形状有 3 条评论" });
    fireEvent.click(badge);
    expect(open).toHaveBeenCalledOnce();
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(badge.textContent).toBe("3");
  });
});

it("sets opacity slider accent from the neutral primary token", () => {
  const object = { id: "shape", locked: false } as WhiteboardObject;
  const content = { type: "shape", fill: "#FFFFFF", borderColor: "#18181B", borderWidth: 2, borderStyle: "solid", radius: 8, opacity: 1, textColor: "#18181B", horizontalAlign: "center" } as CanonicalContentObject;
  render(<BoardContentObjectInspector object={object} content={content} readOnly={false} onChange={vi.fn()} onReplaceImage={vi.fn()} onEditText={vi.fn()} onEditStructured={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
  expect((screen.getByRole("slider", { name: "形状透明度" }) as HTMLInputElement).style.accentColor).toBe("hsl(var(--primary))");
});
