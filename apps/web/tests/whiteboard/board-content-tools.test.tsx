import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, readObjects } from "@repo/whiteboard-core";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, onSelectionChange, onDrawingComplete }: {
    objects: readonly BoardFabricObject[];
    onSelectionChange: (ids: string[], source: "canvas") => void;
    onDrawingComplete?: (input: { tool: "pen" | "eraser"; points: Array<{ x: number; y: number; pressure: number }> }) => void;
  }) => <div data-testid="board-fabric-surface">
    <button data-testid="select-first" onClick={() => objects[0] && onSelectionChange([objects[0].id], "canvas")}>select</button>
    <button data-testid="draw-stroke" onClick={() => onDrawingComplete?.({ tool: "pen", points: [{ x: 10, y: 20, pressure: .2 }, { x: 50, y: 60, pressure: .9 }] })}>draw</button>
    <button data-testid="erase-stroke" onClick={() => onDrawingComplete?.({ tool: "eraser", points: [{ x: 20, y: 30, pressure: .5 }, { x: 40, y: 50, pressure: .7 }] })}>erase</button>
  </div>,
}));

class ResizeObserverMock { observe() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
afterEach(() => cleanup());

async function setup() {
  const { CollaborativeEditor } = await import("@/components/whiteboard/collaborative-editor");
  const doc = createWhiteboardDocument();
  render(<CollaborativeEditor boardId="content-board" clientId="content-client" doc={doc} readOnly={false} title="内容板" status="已连接" />);
  return doc;
}

it("creates a real shape and structured Tile from the touch-first dock", async () => {
  const doc = await setup();
  fireEvent.click(screen.getByTestId("board-add-shape"));
  fireEvent.click(screen.getByTestId("board-shape-diamond"));
  fireEvent.click(screen.getByTestId("board-add-more"));
  fireEvent.click(screen.getByTestId("board-content-tile"));

  const records = readObjects(doc);
  expect(records.some((object) => object.extensionData?.contentObject && (object.extensionData.contentObject as { variant?: string }).variant === "rounded-rectangle")).toBe(true);
  expect(records.some((object) => object.extensionData?.contentObject && (object.extensionData.contentObject as { type?: string }).type === "tile")).toBe(true);
  expect(screen.getByTestId("board-context-toolbar")).toBeVisible();
  doc.destroy();
});

it("stores pressure-aware drawing and eraser strokes as vector compositing objects", async () => {
  const doc = await setup();
  fireEvent.click(screen.getByTestId("board-add-draw"));
  fireEvent.click(screen.getByTestId("draw-stroke"));
  const drawing = readObjects(doc)[0]!;
  expect(drawing.kind).toBe("drawing");
  expect(drawing.extensionData?.contentObject).toMatchObject({ type: "drawing", strokes: [{ tool: "pen", points: [{ pressure: .2 }, { pressure: .9 }] }] });
  fireEvent.click(screen.getByTestId("erase-stroke"));
  expect(readObjects(doc)).toHaveLength(2);
  expect(readObjects(doc).some((item) => ((item.extensionData?.contentObject as { strokes?: Array<{ tool?: string }> } | undefined)?.strokes?.[0]?.tool === "eraser"))).toBe(true);
  doc.destroy();
});

it("keeps an unsupported image file recoverable without creating a broken object", async () => {
  const doc = await setup();
  const input = screen.getByTestId("board-image-input");
  fireEvent.change(input, { target: { files: [new File(["plain"], "notes.txt", { type: "text/plain" })] } });
  expect(screen.getByText(/请选择 JPG、PNG、WEBP、GIF 或 SVG/)).toBeVisible();
  expect(readObjects(doc)).toEqual([]);
  doc.destroy();
});

it("never writes image bytes or blob/data URLs into the shared document without a durable asset port", async () => {
  const doc = await setup();
  const input = screen.getByTestId("board-image-input");
  fireEvent.change(input, { target: { files: [new File(["private-image-bytes"], "photo.png", { type: "image/png" })] } });
  const image = readObjects(doc)[0]!;
  expect(image.kind).toBe("image");
  expect(image.extensionData?.contentObject).toMatchObject({ type: "image", status: "failed", assetId: null, sourceUrl: null, fileName: "photo.png", failureCode: "ASSET_UPLOAD_NOT_CONFIGURED" });
  expect(JSON.stringify(image)).not.toContain("private-image-bytes");
  expect(JSON.stringify(image)).not.toContain("data:image");
  expect(JSON.stringify(image)).not.toContain("blob:");
  expect(screen.getByText(/资产上传服务未接入/)).toBeVisible();
  doc.destroy();
});

it("applies contextual color and duplicates with a 24px offset", async () => {
  const doc = await setup();
  fireEvent.click(screen.getByTestId("board-add-shape"));
  const source = readObjects(doc)[0]!;
  fireEvent.click(screen.getByLabelText("填充色 #93C5FD"));
  expect(readObjects(doc).find((item) => item.id === source.id)?.extensionData?.contentObject).toMatchObject({ fill: "#93C5FD" });
  fireEvent.click(screen.getByRole("button", { name: "复制对象" }));
  const records = readObjects(doc);
  expect(records).toHaveLength(2);
  const duplicate = records.find((record) => record.id !== source.id)!;
  expect(duplicate.geometry.x).toBe(source.geometry.x + 24);
  expect(duplicate.geometry.y).toBe(source.geometry.y + 24);
  doc.destroy();
});
