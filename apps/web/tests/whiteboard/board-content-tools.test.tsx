import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, readObjects } from "@repo/whiteboard-core";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, onSelectionChange, onDrawingComplete, onCanvasClick }: {
    objects: readonly BoardFabricObject[];
    onSelectionChange: (ids: string[], source: "canvas") => void;
    onDrawingComplete?: (input: { tool: "pen" | "eraser"; points: Array<{ x: number; y: number; pressure: number }> }) => void;
    onCanvasClick?: (point: { x: number; y: number }) => void;
  }) => <div data-testid="board-fabric-surface">
    <button data-testid="select-first" onClick={() => objects[0] && onSelectionChange([objects[0].id], "canvas")}>select</button>
    <button data-testid="draw-stroke" onClick={() => onDrawingComplete?.({ tool: "pen", points: [{ x: 10, y: 20, pressure: .2 }, { x: 50, y: 60, pressure: .9 }] })}>draw</button>
    <button data-testid="erase-stroke" onClick={() => onDrawingComplete?.({ tool: "eraser", points: [{ x: 20, y: 30, pressure: .5 }, { x: 40, y: 50, pressure: .7 }] })}>erase</button>
    <button data-testid="canvas-click" onClick={() => onCanvasClick?.({ x: 200, y: 220 })}>canvas</button>
  </div>,
}));

class ResizeObserverMock { observe() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
  fireEvent.click(screen.getByTestId("canvas-click"));
  fireEvent.click(screen.getByTestId("board-add-more"));
  fireEvent.click(screen.getByTestId("board-content-tile"));

  const records = readObjects(doc);
  expect(records.some((object) => object.extensionData?.contentObject && (object.extensionData.contentObject as { variant?: string }).variant === "diamond")).toBe(true);
  expect(records.some((object) => object.extensionData?.contentObject && (object.extensionData.contentObject as { type?: string }).type === "tile")).toBe(true);
  expect(screen.getByTestId("board-context-toolbar")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "更新结构" }));
  const tile = readObjects(doc).find((object) => (object.extensionData?.contentObject as { type?: string } | undefined)?.type === "tile")!;
  expect(tile.extensionData?.contentObject).toMatchObject({ status: "active", tags: ["board"], fields: [{ key: "owner", value: "WorkspaceX" }] });
  doc.destroy();
});

it("makes all fifteen canonical shape variants reachable from the dock", async () => {
  const doc = await setup();
  fireEvent.click(screen.getByTestId("board-add-shape"));
  for (const variant of ["rectangle", "rounded-rectangle", "circle", "ellipse", "diamond", "triangle", "hexagon", "cloud", "database", "document", "process", "decision", "terminator", "data", "predefined-process"]) expect(screen.getByTestId(`board-shape-${variant}`)).toBeVisible();
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
  expect(readObjects(doc)).toHaveLength(1);
  expect(readObjects(doc)[0]?.extensionData?.contentObject).toMatchObject({ type: "drawing", strokes: [{ tool: "pen" }, { tool: "eraser", erases: [expect.any(String)] }] });
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

it("validates HTTPS image MIME, size, and magic bytes before storing a durable URL reference", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => new Response(png, { status: init?.headers ? 206 : 200, headers: { "content-type": "image/png", "content-range": "bytes 0-5/6", "content-length": "6" } })));
  const doc = await setup();
  fireEvent.click(screen.getByTestId("board-add-image"));
  fireEvent.change(screen.getByTestId("board-image-url"), { target: { value: "https://assets.example.com/photo.png" } });
  fireEvent.click(screen.getByTestId("board-image-url-apply"));
  await waitFor(() => expect(readObjects(doc)).toHaveLength(1));
  expect(readObjects(doc)[0]?.extensionData?.contentObject).toMatchObject({ type: "image", status: "ready", sourceUrl: "https://assets.example.com/photo.png", mimeType: "image/png", byteSize: 6, contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), magicMimeType: "image/png" });
  fireEvent.click(screen.getByRole("button", { name: "裁剪" }));
  fireEvent.click(screen.getByRole("button", { name: "透明度" }));
  fireEvent.click(screen.getByRole("button", { name: "边框" }));
  fireEvent.click(screen.getByRole("button", { name: "圆角" }));
  expect(readObjects(doc)[0]?.extensionData?.contentObject).toMatchObject({ crop: { x: .1, y: .1, width: .8, height: .8 }, opacity: .6, borderWidth: 2, cornerRadius: 20 });
  expect(fetch).toHaveBeenNthCalledWith(1, "https://assets.example.com/photo.png", expect.objectContaining({ credentials: "omit", redirect: "error", headers: { Range: "bytes=0-511" } }));
  expect(fetch).toHaveBeenNthCalledWith(2, "https://assets.example.com/photo.png", expect.objectContaining({ credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" }));
  doc.destroy();
});

it("rejects malformed partial responses before creating an image object", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(png, { status: 206, headers: { "content-type": "image/png", "content-range": "bytes 8-11/12" } })));
  const doc = await setup();
  fireEvent.click(screen.getByTestId("board-add-image"));
  fireEvent.change(screen.getByTestId("board-image-url"), { target: { value: "https://assets.example.com/photo.png" } });
  fireEvent.click(screen.getByTestId("board-image-url-apply"));
  await waitFor(() => expect(screen.getByText(/无法读取该 HTTPS 图片/)).toBeVisible());
  expect(readObjects(doc)).toEqual([]);
  doc.destroy();
});

it("applies contextual color and duplicates with a 24px offset", async () => {
  const doc = await setup();
  fireEvent.click(screen.getByTestId("board-add-shape"));
  const source = readObjects(doc)[0]!;
  fireEvent.click(screen.getByLabelText("填充色 #93C5FD"));
  expect(readObjects(doc).find((item) => item.id === source.id)?.extensionData?.contentObject).toMatchObject({ fill: "#93C5FD" });
  fireEvent.click(screen.getByRole("button", { name: "边框样式" }));
  fireEvent.click(screen.getByRole("button", { name: "文字对齐" }));
  expect(readObjects(doc).find((item) => item.id === source.id)?.extensionData?.contentObject).toMatchObject({ borderStyle: "dashed", horizontalAlign: "left", verticalAlign: "top" });
  fireEvent.click(screen.getByRole("button", { name: "复制对象" }));
  const records = readObjects(doc);
  expect(records).toHaveLength(2);
  const duplicate = records.find((record) => record.id !== source.id)!;
  expect(duplicate.geometry.x).toBe(source.geometry.x + 24);
  expect(duplicate.geometry.y).toBe(source.geometry.y + 24);
  doc.destroy();
});

it("instantiates a template as one stable object set", async () => {
  const doc = await setup();
  fireEvent.click(screen.getByTestId("board-add-more"));
  fireEvent.click(screen.getByTestId("board-content-template"));
  const objects = readObjects(doc);
  expect(objects).toHaveLength(3);
  const instance = (objects[0]?.extensionData?.templateInstance as { instanceId: string } | undefined)?.instanceId;
  expect(instance).toBeTruthy();
  expect(objects.map((object) => object.id).sort()).toEqual([`${instance}-tile-1`, `${instance}-tile-2`, `${instance}-tile-3`]);
  doc.destroy();
});
