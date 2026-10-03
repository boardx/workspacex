import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, readObjects } from "@repo/whiteboard-core";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

const probe = vi.hoisted(() => ({ tool: "", selection: [] as string[] }));
vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, tool, onSelectionChange, onCanvasClick }: { objects: readonly BoardFabricObject[]; tool: string; onCanvasClick: (point:{x:number;y:number})=>void; onSelectionChange: (ids: readonly string[], source: "canvas") => void }) => {
    probe.tool = tool; probe.selection = objects.map((object) => object.id);
    return <div data-testid="surface"><button data-testid="canvas-click" onClick={()=>onCanvasClick({x:200,y:240})}>place</button><button data-testid="select-all" onClick={() => onSelectionChange(objects.map((object) => object.id), "canvas")}>select</button></div>;
  },
}));
class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
afterEach(cleanup);
const createOnce=(doc:ReturnType<typeof createWhiteboardDocument>,key:string)=>{const count=readObjects(doc).length;fireEvent.keyDown(window,{key});expect(readObjects(doc)).toHaveLength(count);fireEvent.click(screen.getByTestId('canvas-click'));expect(readObjects(doc)).toHaveLength(count+1);expect(probe.tool).toBe('select');};

it("maps authoring shortcuts to canonical object creation and tool state without firing in an input", () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  createOnce(doc,'n');
  fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  createOnce(doc,'t');
  fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  createOnce(doc,'s');
  expect(new Set(readObjects(doc).map((object) => object.kind))).toEqual(new Set(["sticky", "text", "rectangle"]));
  fireEvent.keyDown(window, { key: "p" }); expect(probe.tool).toBe("draw-pen");
  fireEvent.keyDown(window, { key: "h" }); expect(probe.tool).toBe("hand");
  fireEvent.keyDown(window, { key: "v" }); expect(probe.tool).toBe("select");
  const before = readObjects(doc).length;
  fireEvent.pointerDown(screen.getByTestId("board-title-menu"), {button:0,ctrlKey:false,pointerType:"mouse"});
  fireEvent.keyDown(screen.getByLabelText("白板名称"), { key: "n" });
  expect(readObjects(doc)).toHaveLength(before);
  doc.destroy();
});

it("groups a multi-selection through Cmd/Ctrl+G and opens bulk sticky creation with Shift+N", () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  createOnce(doc,'n'); fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  createOnce(doc,'n'); fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  fireEvent.click(screen.getByTestId("select-all"));
  fireEvent.keyDown(window, { key: "g", ctrlKey: true });
  expect(readObjects(doc).filter((object) => object.kind === "group")).toHaveLength(1);
  fireEvent.keyDown(window, { key: "n", shiftKey: true });
  expect(screen.getByRole("dialog", { name: "批量创建便利贴" })).toBeVisible();
  doc.destroy();
});

it("copies, pastes, and duplicates canonical selections through standard shortcuts", () => {
  const doc = createWhiteboardDocument();
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  createOnce(doc,'n'); fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "Escape" });
  fireEvent.click(screen.getByTestId("select-all"));
  const original = readObjects(doc)[0]!;
  fireEvent.keyDown(window, { key: "c", ctrlKey: true });
  fireEvent.keyDown(window, { key: "v", ctrlKey: true });
  expect(readObjects(doc)).toHaveLength(2);
  expect(readObjects(doc).find((object) => object.id !== original.id)?.geometry).toMatchObject({ x: original.geometry.x + 24, y: original.geometry.y + 24 });
  fireEvent.keyDown(window, { key: "d", ctrlKey: true });
  expect(readObjects(doc)).toHaveLength(3);
  expect(new Set(readObjects(doc).map((object) => object.id)).size).toBe(3);
  doc.destroy();
});
