import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, readObjects } from "@repo/whiteboard-core";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

const probe = vi.hoisted(() => ({ tool: "", selection: [] as string[] }));
vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, tool, onSelectionChange }: { objects: readonly BoardFabricObject[]; tool: string; onSelectionChange: (ids: readonly string[], source: "canvas") => void }) => {
    probe.tool = tool; probe.selection = objects.map((object) => object.id);
    return <div data-testid="surface"><button data-testid="select-all" onClick={() => onSelectionChange(objects.map((object) => object.id), "canvas")}>select</button></div>;
  },
}));
class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
afterEach(cleanup);

it("maps authoring shortcuts to canonical object creation and tool state without firing in an input", () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.keyDown(window, { key: "n" });
  fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  fireEvent.keyDown(window, { key: "t" });
  fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  fireEvent.keyDown(window, { key: "s" });
  expect(new Set(readObjects(doc).map((object) => object.kind))).toEqual(new Set(["sticky", "text", "rectangle"]));
  fireEvent.keyDown(window, { key: "p" }); expect(probe.tool).toBe("draw-pen");
  fireEvent.keyDown(window, { key: "h" }); expect(probe.tool).toBe("hand");
  fireEvent.keyDown(window, { key: "v" }); expect(probe.tool).toBe("select");
  const before = readObjects(doc).length;
  fireEvent.keyDown(screen.getByLabelText("白板名称"), { key: "n" });
  expect(readObjects(doc)).toHaveLength(before);
  doc.destroy();
});

it("groups a multi-selection through Cmd/Ctrl+G and opens bulk sticky creation with Shift+N", () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.keyDown(window, { key: "n" }); fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  fireEvent.keyDown(window, { key: "n" }); fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  fireEvent.click(screen.getByTestId("select-all"));
  fireEvent.keyDown(window, { key: "g", ctrlKey: true });
  expect(readObjects(doc).filter((object) => object.kind === "group")).toHaveLength(1);
  fireEvent.keyDown(window, { key: "n", shiftKey: true });
  expect(screen.getByRole("dialog", { name: "批量创建便利贴" })).toBeVisible();
  doc.destroy();
});
