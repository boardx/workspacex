import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, executeCommands, readObjects } from "@repo/whiteboard-core";
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
const objectUrls = new Map<string, Blob>();
const revokeObjectUrl = vi.fn((url: string) => { objectUrls.delete(url); });
async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(new Uint8Array(reader.result)) : reject(new Error("read")); reader.readAsArrayBuffer(blob); });
}
beforeEach(() => {
  objectUrls.clear(); revokeObjectUrl.mockClear();
  vi.stubGlobal("URL", class extends globalThis.URL {
    static createObjectURL(blob: Blob) { const url = `blob:verified-${objectUrls.size + 1}`; objectUrls.set(url, blob); return url; }
    static revokeObjectURL(url: string) { revokeObjectUrl(url); }
  });
  vi.stubGlobal("createImageBitmap", vi.fn(async (blob: Blob) => {
    const bytes = await readBlobBytes(blob);
    if (bytes.length <= 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error("decode failed");
    const view = new DataView(bytes.buffer); return { width: view.getUint32(16), height: view.getUint32(20), close: vi.fn() };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function png(width = 32, height = 24): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
function webp(kind: "VP8" | "VP8L" | "VP8X", width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode("RIFF")); bytes.set(new TextEncoder().encode("WEBP"), 8);
  if (kind === "VP8X") {
    bytes.set(new TextEncoder().encode("VP8X"), 12);
    const w = width - 1, h = height - 1;
    bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  } else if (kind === "VP8L") {
    bytes.set(new TextEncoder().encode("VP8L"), 12); bytes[20] = 0x2f;
    const w = width - 1, h = height - 1;
    bytes[21] = w & 0xff; bytes[22] = ((w >> 8) & 0x3f) | ((h & 0x03) << 6); bytes[23] = (h >> 2) & 0xff; bytes[24] = (h >> 10) & 0x0f;
  } else {
    bytes.set(new TextEncoder().encode("VP8 "), 12); bytes.set([0x9d, 0x01, 0x2a, width & 0xff, (width >> 8) & 0x3f, height & 0xff, (height >> 8) & 0x3f], 23);
  }
  return bytes;
}
const byteBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

async function setupView() {
  const { CollaborativeEditor } = await import("@/components/whiteboard/collaborative-editor");
  const doc = createWhiteboardDocument();
  const view = render(<CollaborativeEditor boardId="content-board" clientId="content-client" doc={doc} readOnly={false} title="内容板" status="已连接" />);
  return { doc, ...view };
}
async function setup() { return (await setupView()).doc; }

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
  fireEvent.click(screen.getByRole("button", { name: "编辑字段" }));
  fireEvent.change(screen.getByTestId("board-structured-title"), { target: { value: "访谈记录" } });
  fireEvent.change(screen.getByTestId("board-structured-details"), { target: { value: JSON.stringify({ description: "直接编辑", fields: [{ key: "owner", label: "负责人", value: "Grace" }], tags: ["research"], status: "active", link: null, actions: ["open"] }) } });
  fireEvent.click(screen.getByTestId("board-structured-save"));
  const tile = readObjects(doc).find((object) => (object.extensionData?.contentObject as { type?: string } | undefined)?.type === "tile")!;
  expect(tile.text).toBe("访谈记录");
  expect(tile.extensionData?.contentObject).toMatchObject({ title: "访谈记录", description: "直接编辑", status: "active", tags: ["research"], fields: [{ key: "owner", value: "Grace" }] });
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

it("creates a verified local-session image without writing bytes or blob/data URLs into the shared document", async () => {
  const { doc, unmount } = await setupView();
  const input = screen.getByTestId("board-image-input");
  fireEvent.change(input, { target: { files: [new File([byteBuffer(png())], "photo.png", { type: "image/png" })] } });
  await waitFor(() => expect(readObjects(doc)).toHaveLength(1));
  const image = readObjects(doc)[0]!;
  expect(image.kind).toBe("image");
  expect(image.extensionData?.contentObject).toMatchObject({ type: "image", status: "ready", assetId: expect.stringMatching(/^local-session-/), sourceUrl: null, fileName: "photo.png", intrinsicWidth: 32, intrinsicHeight: 24, persistence: "local-session" });
  expect(JSON.stringify(image)).not.toContain("data:image");
  expect(JSON.stringify(image)).not.toContain("blob:");
  expect(screen.getByText(/当前浏览器会话中验证并显示/)).toBeVisible();
  expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute("href", "blob:verified-1");
  fireEvent.click(screen.getByRole("button", { name: "替换" }));
  await waitFor(() => expect(screen.getByText("替换图片")).toBeVisible());
  fireEvent.change(input, { target: { files: [new File([byteBuffer(png(64, 48))], "replacement.png", { type: "image/png" })] } });
  await waitFor(() => expect((readObjects(doc)[0]?.extensionData?.contentObject as { fileName?: string } | undefined)?.fileName).toBe("replacement.png"));
  expect(readObjects(doc)).toHaveLength(1);
  expect(readObjects(doc)[0]).toMatchObject({ id: image.id, extensionData: { contentObject: { replacementOf: image.id, intrinsicWidth: 64, intrinsicHeight: 48 } } });
  expect(revokeObjectUrl).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute("href", "blob:verified-2");
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  await waitFor(() => expect((readObjects(doc)[0]?.extensionData?.contentObject as { fileName?: string } | undefined)?.fileName).toBe("photo.png"));
  expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute("href", "blob:verified-1");
  fireEvent.click(screen.getByRole("button", { name: "重做" }));
  await waitFor(() => expect((readObjects(doc)[0]?.extensionData?.contentObject as { fileName?: string } | undefined)?.fileName).toBe("replacement.png"));
  expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute("href", "blob:verified-2");
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  expect(revokeObjectUrl).not.toHaveBeenCalled();
  unmount();
  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:verified-1");
  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:verified-2");
  doc.destroy();
});

it("discards a local image decode that completes after editor unmount", async () => {
  let resolveDecode!: (value: { width: number; height: number; close: () => void }) => void;
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(() => new Promise((resolve) => { resolveDecode = resolve; })));
  const { doc, unmount } = await setupView();
  fireEvent.change(screen.getByTestId("board-image-input"), { target: { files: [new File([byteBuffer(png())], "late.png", { type: "image/png" })] } });
  await waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());
  unmount();
  await act(async () => { resolveDecode({ width: 32, height: 24, close }); await Promise.resolve(); });
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(readObjects(doc)).toEqual([]);
  expect(objectUrls.size).toBe(0);
  doc.destroy();
});

it("retains a shared image asset across duplicate deletion and remote bulk deletion until editor unmount", async () => {
  const { doc, unmount } = await setupView();
  fireEvent.change(screen.getByTestId("board-image-input"), { target: { files: [new File([byteBuffer(png())], "shared.png", { type: "image/png" })] } });
  await waitFor(() => expect(readObjects(doc)).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "复制对象" }));
  expect(readObjects(doc)).toHaveLength(2);
  const assetIds = readObjects(doc).map((object) => (object.extensionData?.contentObject as { assetId?: string }).assetId);
  expect(new Set(assetIds).size).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  expect(readObjects(doc)).toHaveLength(1);
  expect(revokeObjectUrl).not.toHaveBeenCalled();
  act(() => executeCommands(doc, readObjects(doc).map((object) => ({ type: "delete" as const, id: object.id })), "remote-delete"));
  expect(readObjects(doc)).toEqual([]);
  expect(revokeObjectUrl).not.toHaveBeenCalled();
  unmount();
  expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  doc.destroy();
});

it("uses the verified local-session path for clipboard paste", async () => {
  const doc = await setup();
  const pasted = new File([byteBuffer(png(20, 10))], "paste.png", { type: "image/png" });
  fireEvent.paste(screen.getByTestId("collaborative-editor"), { clipboardData: { files: [pasted], getData: () => "" } });
  await waitFor(() => expect(readObjects(doc)).toHaveLength(1));
  expect(readObjects(doc)[0]?.extensionData?.contentObject).toMatchObject({ fileName: "paste.png", status: "ready", intrinsicWidth: 20, intrinsicHeight: 10 });
  doc.destroy();
});

it("uses the verified local-session path for file drop", async () => {
  const doc = await setup();
  const dropped = new File([byteBuffer(png(40, 30))], "drop.png", { type: "image/png" });
  const target = screen.getByTestId("collaborative-editor"), drop = createEvent.drop(target);
  Object.defineProperties(drop, { clientX: { value: 300 }, clientY: { value: 240 }, dataTransfer: { value: { files: [dropped], items: [{ kind: "file" }] } } });
  fireEvent(target, drop);
  await waitFor(() => expect(readObjects(doc)).toHaveLength(1));
  expect(readObjects(doc)[0]?.extensionData?.contentObject).toMatchObject({ fileName: "drop.png", status: "ready", intrinsicWidth: 40, intrinsicHeight: 30 });
  doc.destroy();
});

it("decimates a 512-point stroke below the canonical extension budget while preserving endpoints", async () => {
  const { fitDrawingStrokeToExtensionBudget } = await import("@/components/whiteboard/collaborative-thinking-editor");
  const points = Array.from({ length: 512 }, (_, index) => ({ x: index * 1.234567, y: Math.sin(index) * 100.123456, pressure: (index % 10) / 10 }));
  const fitted = fitDrawingStrokeToExtensionBudget([], { id: "max-stroke", tool: "pen", points, color: "#18181B", width: 3, opacity: 1 });
  expect(fitted.points.length).toBeLessThan(512);
  expect(fitted.points[0]).toEqual(points[0]);
  expect(fitted.points.at(-1)).toEqual(points.at(-1));
  expect(new TextEncoder().encode(JSON.stringify({ contentObject: { version: 1, type: "drawing", strokes: [fitted] } })).length).toBeLessThanOrEqual(14_000);
});

it("preserves both endpoints for 513-point and very long deterministic drawing input", async () => {
  const { fitDrawingStrokeToExtensionBudget } = await import("@/components/whiteboard/collaborative-thinking-editor");
  for (const length of [513, 10_000]) {
    const points = Array.from({ length }, (_, index) => ({ x: index, y: index % 17, pressure: .5 }));
    const fitted = fitDrawingStrokeToExtensionBudget([], { id: `stroke-${length}`, tool: "pen", points, color: "#18181B", width: 3, opacity: 1 });
    expect(fitted.points[0]).toEqual(points[0]);
    expect(fitted.points.at(-1)).toEqual(points.at(-1));
    expect(fitted.points.length).toBeLessThanOrEqual(512);
    const maximumGap = Math.max(...fitted.points.slice(1).map((point, index) => point.x - fitted.points[index]!.x));
    expect(maximumGap).toBeLessThanOrEqual(Math.ceil((length - 1) / (fitted.points.length - 1)) + 1);
    expect(new TextEncoder().encode(JSON.stringify({ contentObject: { version: 1, type: "drawing", strokes: [fitted] } })).length).toBeLessThanOrEqual(14_000);
  }
});

it("validates HTTPS image MIME, size, and magic bytes before storing a durable URL reference", async () => {
  const bytes = png(48, 36);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(byteBuffer(bytes), { status: 206, headers: { "content-type": "image/png", "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}`, "content-length": String(bytes.length) } })));
  const doc = await setup();
  fireEvent.click(screen.getByTestId("board-add-image"));
  fireEvent.change(screen.getByTestId("board-image-url"), { target: { value: "https://assets.example.com/photo.png" } });
  fireEvent.click(screen.getByTestId("board-image-url-apply"));
  await waitFor(() => expect(readObjects(doc)).toHaveLength(1));
  expect(readObjects(doc)[0]?.extensionData?.contentObject).toMatchObject({ type: "image", status: "ready", sourceUrl: "https://assets.example.com/photo.png", assetId: expect.stringMatching(/^local-session-/), mimeType: "image/png", byteSize: bytes.length, intrinsicWidth: 48, intrinsicHeight: 36, contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), magicMimeType: "image/png", persistence: "local-session" });
  fireEvent.click(screen.getByRole("button", { name: "裁剪" }));
  fireEvent.click(screen.getByRole("button", { name: "透明度" }));
  fireEvent.click(screen.getByRole("button", { name: "边框" }));
  fireEvent.click(screen.getByRole("button", { name: "圆角" }));
  expect(readObjects(doc)[0]?.extensionData?.contentObject).toMatchObject({ crop: { x: .1, y: .1, width: .8, height: .8 }, opacity: .6, borderWidth: 2, cornerRadius: 20 });
  expect(screen.getByRole("link", { name: "下载" })).toHaveAttribute("href", "blob:verified-1");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("https://assets.example.com/photo.png", expect.objectContaining({ credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", headers: { Range: "bytes=0-26214399" } }));
  doc.destroy();
});

it("aborts and discards a remote image fetch that completes after editor unmount", async () => {
  const bytes = png(48, 36);
  let resolveFetch!: (value: Response) => void;
  const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve) => {
    resolveFetch = resolve;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  }));
  vi.stubGlobal("fetch", fetcher);
  const { doc, unmount } = await setupView();
  fireEvent.click(screen.getByTestId("board-add-image"));
  fireEvent.change(screen.getByTestId("board-image-url"), { target: { value: "https://assets.example.com/late.png" } });
  fireEvent.click(screen.getByTestId("board-image-url-apply"));
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  const signal = fetcher.mock.calls[0]![1]!.signal!;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolveFetch(new Response(byteBuffer(bytes), { status: 206, headers: { "content-type": "image/png", "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}`, "content-length": String(bytes.length) } }));
    await Promise.resolve();
  });
  expect(readObjects(doc)).toEqual([]);
  expect(objectUrls.size).toBe(0);
  doc.destroy();
});

it("verifies JPEG, GIF, WEBP and sanitizes SVG into the exact displayed bytes", async () => {
  const { verifyBoardImageBytes } = await import("@/components/whiteboard/board-content-adapter");
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20]);
  const gif = new Uint8Array(10); gif.set(new TextEncoder().encode("GIF89a")); new DataView(gif.buffer).setUint16(6, 30, true); new DataView(gif.buffer).setUint16(8, 20, true);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><script>alert(1)</script><image href="https://tracker.example/x"/><rect width="80" height="60"/></svg>`;
  await expect(verifyBoardImageBytes(new Blob([byteBuffer(jpeg)]), "image/jpeg", async () => ({ width: 32, height: 16 }))).resolves.toMatchObject({ intrinsicWidth: 32, intrinsicHeight: 16 });
  await expect(verifyBoardImageBytes(new Blob([byteBuffer(gif)]), "image/gif", async () => ({ width: 30, height: 20 }))).resolves.toMatchObject({ intrinsicWidth: 30, intrinsicHeight: 20 });
  for (const kind of ["VP8", "VP8L", "VP8X"] as const) await expect(verifyBoardImageBytes(new Blob([byteBuffer(webp(kind, 64, 48))]), "image/webp", async () => ({ width: 64, height: 48 }))).resolves.toMatchObject({ intrinsicWidth: 64, intrinsicHeight: 48 });
  const sanitized = await verifyBoardImageBytes(new Blob([svg]), "image/svg+xml");
  expect(sanitized).toMatchObject({ intrinsicWidth: 80, intrinsicHeight: 60 });
  expect(new TextDecoder().decode(sanitized.bytes)).not.toMatch(/script|tracker\.example/);
});

it("rejects header-only raster fakes and closes decoded bitmaps on dimension rejection", async () => {
  const { verifyBoardImageBytes } = await import("@/components/whiteboard/board-content-adapter");
  const fakePng = png().subarray(0, 24);
  const fakeJpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20]);
  const fakeGif = new Uint8Array(10); fakeGif.set(new TextEncoder().encode("GIF89a")); new DataView(fakeGif.buffer).setUint16(6, 30, true); new DataView(fakeGif.buffer).setUint16(8, 20, true);
  await expect(verifyBoardImageBytes(new Blob([byteBuffer(fakePng)]), "image/png")).rejects.toThrow("IMAGE_DECODE_FAILED");
  await expect(verifyBoardImageBytes(new Blob([byteBuffer(fakeJpeg)]), "image/jpeg")).rejects.toThrow("IMAGE_DECODE_FAILED");
  await expect(verifyBoardImageBytes(new Blob([byteBuffer(fakeGif)]), "image/gif")).rejects.toThrow("IMAGE_DECODE_FAILED");
  const close = vi.fn();
  await expect(verifyBoardImageBytes(new Blob([byteBuffer(png())]), "image/png", async () => ({ width: 100_000, height: 100_000, close }))).rejects.toThrow("IMAGE_DIMENSIONS_INVALID");
  expect(close).toHaveBeenCalledOnce();
  const mismatchClose = vi.fn();
  await expect(verifyBoardImageBytes(new Blob([byteBuffer(png())]), "image/png", async () => ({ width: 31, height: 24, close: mismatchClose }))).rejects.toThrow("IMAGE_DIMENSIONS_MISMATCH");
  expect(mismatchClose).toHaveBeenCalledOnce();
  const oversized = png(32_769, 24), decoder = vi.fn(async () => ({ width: 32_769, height: 24, close: vi.fn() }));
  await expect(verifyBoardImageBytes(new Blob([byteBuffer(oversized)]), "image/png", decoder)).rejects.toThrow("IMAGE_DIMENSIONS_INVALID");
  expect(decoder).not.toHaveBeenCalled();
  const unknownWebp = new Uint8Array(32); unknownWebp.set(new TextEncoder().encode("RIFF")); unknownWebp.set(new TextEncoder().encode("WEBP"), 8); unknownWebp.set(new TextEncoder().encode("JUNK"), 12);
  const webpDecoder = vi.fn(async () => ({ width: 32, height: 24, close: vi.fn() }));
  await expect(verifyBoardImageBytes(new Blob([byteBuffer(unknownWebp)]), "image/webp", webpDecoder)).rejects.toThrow("IMAGE_DIMENSIONS_INVALID");
  expect(webpDecoder).not.toHaveBeenCalled();
  for (const kind of ["VP8", "VP8L", "VP8X"] as const) {
    const oversizedWebpDecoder = vi.fn(async () => ({ width: 32_769, height: 24, close: vi.fn() }));
    const dimensions = kind === "VP8X" ? [32_769, 24] as const : [16_383, 16_383] as const;
    await expect(verifyBoardImageBytes(new Blob([byteBuffer(webp(kind, ...dimensions))]), "image/webp", oversizedWebpDecoder)).rejects.toThrow("IMAGE_DIMENSIONS_INVALID");
    expect(oversizedWebpDecoder).not.toHaveBeenCalled();
  }
});

it("aborts and disposes the Image fallback decoder without retaining its temporary URL", async () => {
  const { browserRasterDecoder } = await import("@/components/whiteboard/board-content-adapter");
  vi.stubGlobal("createImageBitmap", undefined);
  let imageInstance: { onload: (() => void) | null; onerror: (() => void) | null; src: string } | undefined;
  vi.stubGlobal("Image", class { naturalWidth = 32; naturalHeight = 24; onload: (() => void) | null = null; onerror: (() => void) | null = null; private value = ""; constructor() { imageInstance = this; } set src(value: string) { this.value = value; } get src() { return this.value; } });
  const controller = new AbortController();
  const pending = browserRasterDecoder(new Blob([byteBuffer(png())], { type: "image/png" }), controller.signal);
  expect(imageInstance?.src).toBe("blob:verified-1");
  controller.abort();
  await expect(pending).rejects.toThrow("IMAGE_DECODE_ABORTED");
  expect(imageInstance?.src).toBe("");
  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:verified-1");
});

it("times out and disposes a stalled Image fallback decode", async () => {
  const { browserRasterDecoder } = await import("@/components/whiteboard/board-content-adapter");
  vi.stubGlobal("createImageBitmap", undefined);
  let imageInstance: { src: string } | undefined;
  vi.stubGlobal("Image", class { naturalWidth = 0; naturalHeight = 0; onload: (() => void) | null = null; onerror: (() => void) | null = null; private value = ""; constructor() { imageInstance = this; } set src(value: string) { this.value = value; } get src() { return this.value; } });
  vi.useFakeTimers();
  try {
    const pending = browserRasterDecoder(new Blob([byteBuffer(png())], { type: "image/png" }));
    const rejection = expect(pending).rejects.toThrow("IMAGE_DECODE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    expect(imageInstance?.src).toBe("");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:verified-1");
  } finally { vi.useRealTimers(); }
});

it("rejects malformed partial responses before creating an image object", async () => {
  const bytes = png();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(byteBuffer(bytes), { status: 206, headers: { "content-type": "image/png", "content-range": `bytes 8-${bytes.length + 7}/${bytes.length + 8}` } })));
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
