// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardShapePicker } from "@/components/whiteboard/board-shape-picker";
import { BOARD_SHAPE_CATEGORIES } from "@/components/whiteboard/board-shape-catalog";

afterEach(cleanup);
describe("categorized shape picker", () => {
  it("preserves all 15 supported shapes without duplicates", () => {
    const shapes = BOARD_SHAPE_CATEGORIES.flatMap(category => category.shapes.map(shape => shape.variant));
    expect(shapes).toHaveLength(15);
    expect(new Set(shapes).size).toBe(15);
  });
  it("shows icon-only choices with accessible names and selects a database", () => {
    const change = vi.fn();
    render(<BoardShapePicker variant="rectangle" readOnly={false} onVariantChange={change}/>);
    expect(screen.getByRole("button", { name: "矩形" }).textContent).toBe("");
    fireEvent.click(screen.getByRole("tab", { name: "资料" }));
    const database = screen.getByRole("button", { name: "数据库" });
    expect(database.title).toBe("数据库");
    fireEvent.click(database);
    expect(change).toHaveBeenCalledWith("database");
  });
  it("starts on the selected shape category and supports keyboard tab navigation", () => {
    render(<BoardShapePicker variant="database" readOnly={false} onVariantChange={vi.fn()}/>);
    expect(screen.getByRole("tab", { name: "资料" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "资料" }), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "流程" }));
    expect(screen.getByRole("button", { name: "预定义流程" })).toBeTruthy();
  });
  it("transfers the canonical shape tool for drag creation", () => {
    render(<BoardShapePicker variant="database" readOnly={false} onVariantChange={vi.fn()}/>);
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByRole("button", { name: "数据库" }), { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith("application/x-workspacex-board-tool", JSON.stringify({ kind: "shape", variant: "database" }));
  });
  it("allows browsing but blocks creation and dragging in read-only mode", () => {
    const change = vi.fn();
    render(<BoardShapePicker variant="rectangle" readOnly onVariantChange={change}/>);
    fireEvent.click(screen.getByRole("tab", { name: "资料" }));
    const database = screen.getByRole("button", { name: "数据库" });
    expect((database as HTMLButtonElement).disabled).toBe(true);
    expect(database.draggable).toBe(false);
    fireEvent.click(database);
    const setData = vi.fn();
    fireEvent.dragStart(database, { dataTransfer: { setData } });
    expect(change).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });
});
