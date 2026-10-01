import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BoardSelectedObjectPanel } from "@/components/whiteboard/board-selected-object-panel";
import type { WhiteboardObject } from "@repo/whiteboard-core";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each([390, 1440])("top-anchored inspector grows downward at viewport width %s", width => {
  vi.stubGlobal("innerWidth", width); vi.stubGlobal("innerHeight", 900);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const object: WhiteboardObject = { id: "note", schemaVersion: 1, kind: "sticky", text: "", geometry: { x: 100, y: 300, width: 100, height: 100, rotation: 0 }, style: {}, parentId: null, orderKey: "a" };
  render(<BoardSelectedObjectPanel object={object} title="Note" typeLabel="Sticky" readOnly={false} onClose={vi.fn()} onGeometryChange={vi.fn()} floatingStyle={{ left: 16, top: 100 }}><span>Details</span></BoardSelectedObjectPanel>);
  fireEvent.click(screen.getByTestId("board-inspector-expand"));
  const resize = screen.getByTestId("board-inspector-resize-height");
  expect(resize).toHaveAttribute("aria-valuenow", "440");
  fireEvent.keyDown(resize, { key: "ArrowDown" }); expect(resize).toHaveAttribute("aria-valuenow", "464");
  fireEvent.keyDown(resize, { key: "ArrowUp" }); expect(resize).toHaveAttribute("aria-valuenow", "440");
});
