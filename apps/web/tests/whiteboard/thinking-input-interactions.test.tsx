import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, executeCommands, readObjects, WhiteboardCommandOrigin, type WhiteboardObject } from "@repo/whiteboard-core";
import { CollaborativeEditor } from "@/components/whiteboard/collaborative-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, onCanvasClick, onCanvasDoubleClick, onObjectDoubleClick, onToolDrop }: {
    objects: readonly BoardFabricObject[];
    onCanvasClick?: (point: { x: number; y: number }) => void;
    onCanvasDoubleClick?: (point: { x: number; y: number }) => void;
    onObjectDoubleClick?: (id: string) => void;
    onToolDrop?: (point: { x: number; y: number }, payload: string) => void;
  }) => <div data-testid="board-fabric-surface">
    <canvas data-testid="board-fabric-canvas" />
    <button data-testid="mock-canvas-click" onClick={() => onCanvasClick?.({ x: 100, y: 120 })}>canvas click</button>
    <button data-testid="mock-canvas-double" onClick={() => onCanvasDoubleClick?.({ x: 200, y: 220 })}>canvas double</button>
    <button data-testid="mock-object-double" onClick={() => objects[0] && onObjectDoubleClick?.(objects[0].id)}>object double</button>
    <button data-testid="mock-tool-drop" onClick={() => onToolDrop?.({ x: 300, y: 320 }, JSON.stringify({ kind: "sticky", variant: "circle" }))}>tool drop</button>
  </div>,
}));

class ResizeObserverMock { observe() {} disconnect() {} }
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const editor = (readOnly = false, supplied = createWhiteboardDocument()) => {
  const doc = supplied;
  render(<CollaborativeEditor boardId="thinking-board" clientId="thinking-client" doc={doc} readOnly={readOnly} title="想法板" status="已连接" />);
  return doc;
};

const object = (kind: "sticky" | "text", extensionData: Record<string, unknown>): WhiteboardObject => ({
  id: `${kind}-one`, schemaVersion: 1, kind,
  geometry: { x: 100, y: 120, width: kind === "sticky" ? 180 : 320, height: kind === "sticky" ? 180 : 96, rotation: 0 },
  text: kind === "sticky" ? "保留想法" : "结构化标题", style: {}, parentId: null, orderKey: "", extensionData,
});

it("double-clicks blank Fabric space into an immediately focused, IME-safe sticky editor", () => {
  const doc = editor();
  fireEvent.click(screen.getByTestId("mock-canvas-double"));
  const input = screen.getByLabelText("对象文字");
  expect(input).toHaveFocus();
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "中文想法" } });
  expect(readObjects(doc)[0]?.text).toBe("");
  fireEvent.compositionEnd(input, { data: "中文想法" });
  fireEvent.change(input, { target: { value: "中文想法" } });
  expect(readObjects(doc)[0]?.text).toBe("中文想法");
  expect(screen.queryByLabelText("未应用的输入草稿")).toBeNull();
  doc.destroy();
});

it("creates twenty 24px-spaced stickies by typing and pressing Tab without opening a menu", () => {
  const doc = editor();
  fireEvent.click(screen.getByTestId("mock-canvas-double"));
  for (let index = 0; index < 19; index++) {
    const input = screen.getByLabelText("对象文字");
    fireEvent.change(input, { target: { value: `想法 ${index + 1}` } });
    fireEvent.keyDown(input, { key: "Tab" });
  }
  fireEvent.change(screen.getByLabelText("对象文字"), { target: { value: "想法 20" } });
  const notes = readObjects(doc);
  expect(notes).toHaveLength(20);
  expect(notes.every((note) => note.kind === "sticky")).toBe(true);
  const xPositions = notes.map((note) => note.geometry.x).sort((left, right) => left - right);
  for (let index = 1; index < xPositions.length; index++) expect(xPositions[index]! - xPositions[index - 1]!).toBe(204);
  doc.destroy();
});

it("guards shortcuts inside inputs and creates from N/T only when canvas context owns the key", () => {
  const doc = editor();
  const title = screen.getByLabelText("白板名称");
  fireEvent.keyDown(title, { key: "n" });
  expect(readObjects(doc)).toHaveLength(0);
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true })));
  expect(readObjects(doc)).toHaveLength(1);
  fireEvent.keyDown(screen.getByLabelText("对象文字"), { key: "t" });
  expect(readObjects(doc)).toHaveLength(1);
  doc.destroy();
});

it("exposes three sticky shapes and five text presets from the touch dock", () => {
  const doc = editor();
  fireEvent.click(screen.getByTestId("board-add-sticky"));
  expect(screen.getByTestId("board-sticky-square")).toBeVisible();
  expect(screen.getByTestId("board-sticky-rectangle")).toBeVisible();
  expect(screen.getByTestId("board-sticky-circle")).toBeVisible();
  const setData = vi.fn();
  fireEvent.dragStart(screen.getByTestId("board-sticky-circle"), { dataTransfer: { setData, effectAllowed: "" } });
  expect(setData).toHaveBeenCalledWith("application/x-workspacex-board-tool", JSON.stringify({ kind: "sticky", variant: "circle" }));
  fireEvent.click(screen.getByTestId("board-add-text"));
  for (const preset of ["title", "heading", "subheading", "body", "caption"]) expect(screen.getByTestId(`board-text-${preset}`)).toBeVisible();
  fireEvent.click(screen.getByTestId("board-text-title"));
  fireEvent.click(screen.getByTestId("mock-canvas-click"));
  const created = readObjects(doc).find((item) => item.kind === "text" && item.style.fontSize === 48)!;
  expect(created.kind).toBe("text");
  expect(created.style.fontSize).toBe(48);
  doc.destroy();
});

it("dispatches Shift+N bulk creation as one command transaction for up to 100 rows", () => {
  const doc = editor();
  const origins: WhiteboardCommandOrigin[] = [];
  doc.on("afterTransaction", (transaction) => { if (transaction.origin instanceof WhiteboardCommandOrigin) origins.push(transaction.origin); });
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "N", shiftKey: true, bubbles: true })));
  fireEvent.change(screen.getByTestId("board-bulk-text"), { target: { value: "研究\n设计\n验证" } });
  fireEvent.click(screen.getByTestId("board-bulk-apply"));
  expect(readObjects(doc).map((item) => item.text)).toEqual(["研究", "设计", "验证"]);
  expect(origins).toHaveLength(1);
  expect(new Set(origins.map((origin) => origin.operationId)).size).toBe(1);
  doc.destroy();
});

it("offers intelligent multiline paste and creates the chosen stickies in one operation", () => {
  const doc = editor();
  fireEvent.paste(screen.getByTestId("collaborative-editor"), { clipboardData: { getData: () => "发现\n定义\n交付" } });
  expect(screen.getByText("如何放入这些内容？")).toBeVisible();
  fireEvent.click(screen.getByTestId("board-paste-stickies"));
  expect(readObjects(doc).map((item) => item.text)).toEqual(["发现", "定义", "交付"]);
  doc.destroy();
});

it("accepts dock drag payloads at the Fabric drop point and rejects every read-only creation path", () => {
  const writable = editor();
  fireEvent.click(screen.getByTestId("mock-tool-drop"));
  expect(readObjects(writable)[0]?.geometry).toMatchObject({ x: 210, y: 230, width: 180, height: 180 });
  writable.destroy(); cleanup();

  const readonly = editor(true);
  fireEvent.click(screen.getByTestId("mock-canvas-double"));
  fireEvent.click(screen.getByTestId("mock-tool-drop"));
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true })));
  expect(readObjects(readonly)).toEqual([]);
  expect(screen.getByTestId("board-add-sticky")).toBeDisabled();
  readonly.destroy();
});

it("edits sticky appearance through canonical commands while preserving future extension fields", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: object("sticky", { plugin: { keep: true }, thinkingInput: { future: "root", sticky: { future: "sticky", variant: "square", sizing: "auto-height", color: "#F8D76E" } } }) }], "seed");
  editor(false, doc);
  fireEvent.click(screen.getByTestId("mock-object-double"));
  expect(screen.getByRole("complementary", { name: "便利贴快捷工具" })).toBeVisible();
  fireEvent.click(screen.getByTestId("sticky-color-blue"));
  fireEvent.click(screen.getByTestId("context-sticky-circle"));
  fireEvent.change(screen.getByTestId("sticky-sizing"), { target: { value: "fixed" } });
  const updated = readObjects(doc)[0]!;
  expect(updated.geometry).toMatchObject({ width: 180, height: 180 });
  expect(updated.style.fill).toBe("#BBDDF8");
  expect(updated.extensionData).toMatchObject({
    plugin: { keep: true },
    thinkingInput: { future: "root", sticky: { future: "sticky", variant: "circle", sizing: "fixed", color: "#BBDDF8" } },
  });
  doc.destroy();
});

it("persists tags, per-person reactions and a safe link preview without losing unknown experience data", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: object("sticky", { objectExperience: { future: { keep: true }, tags: ["已有"], reactions: { "👍": ["peer"], custom: ["future"] }, linkPreview: { url: "https://old.example", title: "旧链接", description: "旧描述", future: "preview" } } }) }], "seed");
  editor(false, doc);
  fireEvent.click(screen.getByTestId("mock-object-double"));
  fireEvent.change(screen.getByLabelText("新标签"), { target: { value: "洞察" } });
  fireEvent.click(screen.getByLabelText("添加标签"));
  fireEvent.click(screen.getByRole("button", { name: /👍 回应 1/ }));
  fireEvent.change(screen.getByLabelText("预览链接"), { target: { value: "https://example.com/research" } });
  fireEvent.change(screen.getByLabelText("预览标题"), { target: { value: "研究资料" } });
  fireEvent.change(screen.getByLabelText("预览描述"), { target: { value: "访谈来源" } });
  fireEvent.click(screen.getByText("保存预览", { exact: true }));
  const experience = readObjects(doc)[0]!.extensionData?.objectExperience;
  expect(experience).toMatchObject({
    future: { keep: true }, tags: ["已有", "洞察"],
    reactions: { "👍": ["peer", "thinking-client"], custom: ["future"] },
    linkPreview: { url: "https://example.com/research", title: "研究资料", description: "访谈来源", future: "preview" },
  });
  expect(screen.getByRole("link", { name: /研究资料/ })).toHaveAttribute("href", "https://example.com/research");
  doc.destroy();
});

it("applies all direct text controls and rejects a non-http link without mutating canonical data", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: object("text", { plugin: { keep: true }, thinkingInput: { future: "root", text: { future: "text", preset: "body", fontFamily: "Noto Sans SC", fontSize: 18, bold: false, italic: false, underline: false, color: "#242424", alignment: "left", lineHeight: 1.4, list: "none", link: null } } }) }], "seed");
  editor(false, doc);
  fireEvent.click(screen.getByTestId("mock-object-double"));
  fireEvent.change(screen.getByLabelText("文字样式"), { target: { value: "title" } });
  fireEvent.change(screen.getByLabelText("字体"), { target: { value: "Noto Serif SC" } });
  fireEvent.change(screen.getByLabelText("字号"), { target: { value: "56" } });
  fireEvent.click(screen.getByLabelText("粗体"));
  fireEvent.click(screen.getByLabelText("斜体"));
  fireEvent.click(screen.getByLabelText("下划线"));
  fireEvent.change(screen.getByLabelText("文字颜色"), { target: { value: "#123456" } });
  fireEvent.change(screen.getByLabelText("文字对齐"), { target: { value: "center" } });
  fireEvent.change(screen.getByLabelText("行高"), { target: { value: "1.8" } });
  fireEvent.change(screen.getByLabelText("列表"), { target: { value: "bullet" } });
  fireEvent.change(screen.getByLabelText("文字链接"), { target: { value: "https://example.com/doc" } });
  fireEvent.blur(screen.getByLabelText("文字链接"));
  let updated = readObjects(doc)[0]!;
  expect(updated.style).toMatchObject({ color: "#123456", fontSize: 56 });
  expect(updated.extensionData).toMatchObject({ plugin: { keep: true }, thinkingInput: { future: "root", text: { future: "text", preset: "title", fontFamily: "Noto Serif SC", fontSize: 56, bold: false, italic: true, underline: true, color: "#123456", alignment: "center", lineHeight: 1.8, list: "bullet", link: "https://example.com/doc" } } });
  fireEvent.change(screen.getByLabelText("文字链接"), { target: { value: "javascript:alert(1)" } });
  fireEvent.blur(screen.getByLabelText("文字链接"));
  updated = readObjects(doc)[0]!;
  expect((updated.extensionData?.thinkingInput as { text: { link: string } }).text.link).toBe("https://example.com/doc");
  expect(screen.getByText(/链接仅支持 http\(s\)/)).toBeVisible();
  doc.destroy();
});

it("shows contextual data in read-only mode but disables every mutation control", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: object("sticky", { objectExperience: { tags: ["只读"], reactions: {} } }) }], "seed");
  const before = readObjects(doc);
  editor(true, doc);
  fireEvent.click(screen.getByTestId("mock-object-double"));
  expect(screen.getByText("只读", { exact: true })).toBeVisible();
  expect(screen.getByTestId("context-sticky-circle")).toBeDisabled();
  expect(screen.getByLabelText("新标签")).toBeDisabled();
  expect(screen.getByText("保存预览", { exact: true })).toBeDisabled();
  fireEvent.click(screen.getByTestId("context-sticky-circle"));
  expect(readObjects(doc)).toEqual(before);
  doc.destroy();
});
