import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, executeCommands, readContentObject, readObjects } from "@repo/whiteboard-core";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";

const probe = vi.hoisted(() => ({ upload: vi.fn(), verify: vi.fn() }));
vi.mock("@/components/whiteboard/board-content-adapter", async () => ({ ...await vi.importActual<typeof import("@/components/whiteboard/board-content-adapter")>("@/components/whiteboard/board-content-adapter"), verifyBoardImageBytes: probe.verify }));
vi.mock("@/components/whiteboard/board-session-image-assets", () => ({
  durableBoardImageMetadata: () => null,
  getBoardSessionImageAsset: () => undefined,
  BoardDurableImageSession: class { upload = probe.upload; get() { return undefined; } dispose() {} },
}));
vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({ BoardFabricSurface: ({ onViewportChange }: { onViewportChange: (value: { zoom: number; panX: number; panY: number; fitRequest: number; fitMode: string }, source: string) => void }) => <button data-testid="zoom-pan" onClick={() => onViewportChange({ zoom: 2, panX: 100, panY: 80, fitRequest: 0, fitMode: "board" }, "pan")}>zoom</button> }));
class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
const file = new File(["bytes"], "photo.png", { type: "image/png" });
const metadata = { assetId: `board-image-${"a".repeat(64)}`, mimeType: "image/png", magicMimeType: "image/png", byteSize: 4, contentDigest: `sha256:${"a".repeat(64)}`, intrinsicWidth: 200, intrinsicHeight: 100, persistence: "durable" };
beforeEach(() => { probe.upload.mockResolvedValue(metadata); probe.verify.mockResolvedValue({ blob: file }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function setup() { const doc = createWhiteboardDocument(); render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />); return doc; }

it("I opens the unified picker; one successful selection creates exactly one image", async () => {
  const doc = setup(); fireEvent.keyDown(window, { key: "i" });
  expect(screen.getByRole("dialog", { name: "添加图片" })).toBeVisible();
  fireEvent.change(screen.getByTestId("board-image-input"), { target: { files: [file] } });
  await waitFor(() => expect(readObjects(doc)).toHaveLength(1));
  expect(readContentObject(readObjects(doc)[0]!)).toMatchObject({ type: "image", persistence: "durable", sourceUrl: null });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); doc.destroy();
});

it("board drop uses the world coordinate under zoom and pan, rather than viewport center", async () => {
  const doc = setup(); fireEvent.click(screen.getByTestId("zoom-pan"));
  const drop = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 600, clientY: 480 });
  Object.defineProperty(drop, "dataTransfer", { value: { files: [file] } });
  fireEvent(screen.getByTestId("collaborative-editor"), drop);
  await waitFor(() => expect(readObjects(doc)).toHaveLength(1));
  const image = readObjects(doc)[0]!;
  expect(image.geometry.x + image.geometry.width / 2).toBe(250);
  expect(image.geometry.y + image.geometry.height / 2).toBe(200); doc.destroy();
});

it("paste uses the same upload and upload failure leaves the document unchanged with retry", async () => {
  probe.upload.mockRejectedValueOnce(new Error("IMAGE_ASSET_UNAVAILABLE"));
  const doc = setup(); fireEvent.paste(screen.getByTestId("collaborative-editor"), { clipboardData: { files: [file] } });
  await screen.findByTestId("board-image-error"); expect(readObjects(doc)).toHaveLength(0);
  fireEvent.click(screen.getByText("重试")); await waitFor(() => expect(readObjects(doc)).toHaveLength(1));
  expect(probe.upload).toHaveBeenCalledTimes(2); doc.destroy();
});

it("closing during an in-flight asset upload prevents late creation even if transport ignores abort", async () => {
  let finish!: (value: typeof metadata) => void;
  probe.upload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const doc = setup(); fireEvent.keyDown(window, { key: "i" });
  fireEvent.change(screen.getByTestId("board-image-input"), { target: { files: [file] } });
  await waitFor(() => expect(probe.upload).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByTestId("board-image-close"));
  expect((probe.upload.mock.calls[0]?.[2] as AbortSignal).aborted).toBe(true);
  finish(metadata);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(readObjects(doc)).toHaveLength(0); doc.destroy();
});

it("replacement preserves the original ID and geometry; a failure preserves original content", async () => {
  const doc = setup(); fireEvent.keyDown(window, { key: "i" });
  fireEvent.change(screen.getByTestId("board-image-input"), { target: { files: [file] } });
  await waitFor(() => expect(readObjects(doc)).toHaveLength(1));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const original = readObjects(doc)[0]!;
  fireEvent.click(screen.getByTestId("board-inspector-expand"));
  fireEvent.click(screen.getByText("替换"));
  probe.upload.mockRejectedValueOnce(new Error("IMAGE_ASSET_UNAVAILABLE"));
  fireEvent.change(screen.getByTestId("board-image-input"), { target: { files: [file] } });
  await screen.findByTestId("board-image-error"); expect(readObjects(doc)).toEqual([original]);
  probe.upload.mockResolvedValueOnce({ ...metadata, assetId: `board-image-${"b".repeat(64)}`, contentDigest: `sha256:${"b".repeat(64)}` });
  fireEvent.click(screen.getByText("重试"));
  await waitFor(() => { const content = readContentObject(readObjects(doc)[0]!); expect(content?.type === "image" && content.replacementOf).toBe(original.id); });
  expect(readObjects(doc)).toHaveLength(1); expect(readObjects(doc)[0]?.id).toBe(original.id); expect(readObjects(doc)[0]?.geometry).toEqual(original.geometry); doc.destroy();
});

it.each(["board", "document", "user"])("cannot send a delayed verified image into another %s scope", async identity => {
  let finish!: (value: { blob: File }) => void;
  probe.verify.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const doc = createWhiteboardDocument(), nextDoc = createWhiteboardDocument();
  const props = { boardId: "board", clientId: "web", doc, currentUserId: "old-user", readOnly: false, title: "Board", status: "已连接" };
  const { rerender } = render(<CollaborativeThinkingEditor {...props} />);
  fireEvent.keyDown(window, { key: "i" }); fireEvent.change(screen.getByTestId("board-image-input"), { target: { files: [file] } });
  await waitFor(() => expect(probe.verify).toHaveBeenCalledTimes(1));
  rerender(<CollaborativeThinkingEditor {...props} boardId={identity === "board" ? "new-board" : props.boardId} doc={identity === "document" ? nextDoc : doc} currentUserId={identity === "user" ? "new-user" : props.currentUserId} />);
  finish({ blob: file });
  await waitFor(() => expect((probe.verify.mock.calls[0]?.[3] as AbortSignal).aborted).toBe(true));
  expect(probe.upload).not.toHaveBeenCalled(); expect(readObjects(doc)).toEqual([]); expect(readObjects(nextDoc)).toEqual([]); doc.destroy(); nextDoc.destroy();
});

it("rejects a replacement if a remote edit changes the target during upload", async () => {
  const doc = setup(); fireEvent.keyDown(window, { key: "i" });
  fireEvent.change(screen.getByTestId("board-image-input"), { target: { files: [file] } });
  await waitFor(() => expect(readObjects(doc)).toHaveLength(1)); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const original = readObjects(doc)[0]!, content = readContentObject(original)!;
  let finish!: (value: typeof metadata) => void;
  probe.upload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByTestId("board-inspector-expand")); fireEvent.click(screen.getByText("替换"));
  fireEvent.change(screen.getByTestId("board-image-input"), { target: { files: [file] } });
  await waitFor(() => expect(probe.upload).toHaveBeenCalledTimes(2));
  executeCommands(doc, [{ type: "extension", id: original.id, key: "contentObject", value: { ...content, assetId: `board-image-${"c".repeat(64)}`, contentDigest: `sha256:${"c".repeat(64)}` } }], "remote");
  const remote = readObjects(doc)[0]!;
  finish({ ...metadata, assetId: `board-image-${"b".repeat(64)}` });
  await screen.findByTestId("board-image-error");
  expect(readObjects(doc)).toEqual([remote]); doc.destroy();
});
