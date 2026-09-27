import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, executeCommands, type WhiteboardObject } from "@repo/whiteboard-core";
import { ObjectContextToolbar } from "@/components/whiteboard/object-context-toolbar";
import { CollaborativeThinkingEditor } from "@/components/whiteboard/collaborative-thinking-editor";
import { BoardSelectedObjectPanel } from "@/components/whiteboard/board-selected-object-panel";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, onSelectionChange }: { objects: readonly BoardFabricObject[]; onSelectionChange: (ids: readonly string[], source: "canvas") => void }) => <div>
    <button data-testid="select-one" onClick={() => onSelectionChange(objects.slice(0, 1).map((object) => object.id), "canvas")}>one</button>
    <button data-testid="select-two" onClick={() => onSelectionChange(objects.slice(0, 2).map((object) => object.id), "canvas")}>two</button>
  </div>,
}));
class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
afterEach(cleanup);

const sticky: WhiteboardObject = { id: "sticky", schemaVersion: 1, kind: "sticky", geometry: { x: 20, y: 80, width: 180, height: 180, rotation: 0 }, text: "Idea", style: {}, parentId: null, orderKey: "a", extensionData: { thinkingInput: { sticky: { variant: "square", color: "#F8D76E", sizing: "auto-height" } } } };

it("shows Sticky-only direct controls and makes every mutating control unavailable in readonly mode", () => {
  const onStickyChange = vi.fn(), onExperienceChange = vi.fn();
  const props = { object: sticky, readOnly: false, actorId: "me", onStickyChange, onTextChange: vi.fn(), onExperienceChange, onGeometryChange: vi.fn(), onClose: vi.fn(), onFutureAction: vi.fn() };
  const { rerender } = render(<ObjectContextToolbar {...props} />);
  expect(screen.queryByLabelText("新标签")).toBeNull();
  expect(screen.getByTestId("sticky-quick-color-yellow")).toBeEnabled();
  expect(screen.getByTestId("context-sticky-circle")).toBeEnabled();
  expect(screen.queryByLabelText("字号")).toBeNull();
  fireEvent.click(screen.getByTestId("context-sticky-circle"));
  expect(onStickyChange).toHaveBeenCalledWith({ variant: "circle" });

  rerender(<ObjectContextToolbar {...props} readOnly />);
  expect(screen.getByTestId("context-sticky-circle")).toBeDisabled();
  expect(screen.getByTestId("sticky-quick-color-yellow")).toBeDisabled();
  fireEvent.click(screen.getByTestId("board-widget-advanced-format").querySelector("summary")!);
  expect(screen.getByLabelText("便利贴自定义颜色")).toBeDisabled();
});

it("provides adjustable inspector size, compact geometry disclosure and grouped quick actions", () => {
  const onGeometryChange = vi.fn();
  render(<BoardSelectedObjectPanel object={sticky} title="Idea" typeLabel="便利贴" readOnly={false} onClose={vi.fn()} onGeometryChange={onGeometryChange}><button type="button">样式操作</button></BoardSelectedObjectPanel>);
  const panel = screen.getByTestId("board-context-toolbar");
  expect(panel).toHaveAttribute("aria-label", "便利贴属性");
  expect(screen.getByTestId("board-inspector-scroll-content")).toBeVisible();
  const width = screen.getByTestId("board-inspector-resize");
  expect(width).toHaveAttribute("aria-valuenow", "368");
  width.setPointerCapture = vi.fn();
  fireEvent.pointerDown(width, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(width, { pointerId: 1, clientX: 140, clientY: 100 });
  fireEvent.pointerUp(width, { pointerId: 1, clientX: 140, clientY: 100 });
  expect(width).toHaveAttribute("aria-valuenow", "328");
  fireEvent.keyDown(width, { key: "ArrowLeft" });
  expect(width).toHaveAttribute("aria-valuenow", "304");
  const height = screen.getByTestId("board-inspector-resize-height");
  expect(height).toHaveAttribute("aria-valuenow", "520");
  height.setPointerCapture = vi.fn();
  fireEvent.pointerDown(height, { pointerId: 2, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(height, { pointerId: 2, clientX: 100, clientY: 160 });
  fireEvent.pointerUp(height, { pointerId: 2, clientX: 100, clientY: 160 });
  expect(height).toHaveAttribute("aria-valuenow", "580");
  fireEvent.keyDown(height, { key: "ArrowDown" });
  expect(height).toHaveAttribute("aria-valuenow", "604");
  const geometry = screen.getByTestId("board-inspector-geometry");
  expect(geometry).not.toHaveAttribute("open");
  fireEvent.click(within(geometry).getByText("位置与尺寸"));
  const x = screen.getByTestId("board-inspector-geometry-x");
  fireEvent.change(x, { target: { value: "88" } });
  fireEvent.blur(x);
  expect(onGeometryChange).toHaveBeenCalledWith(expect.objectContaining({ x: 88, y: 80, width: 180, height: 180, rotation: 0 }));
});

it("groups the selected widget's frequent actions separately from detailed properties", () => {
  render(<ObjectContextToolbar object={sticky} readOnly={false} actorId="me" onStickyChange={vi.fn()} onTextChange={vi.fn()} onExperienceChange={vi.fn()} onGeometryChange={vi.fn()} onClose={vi.fn()} onFutureAction={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByTestId("board-object-quick-actions")).toHaveAccessibleName("对象快捷操作");
  expect(screen.getByTestId("board-sticky-inspector-style")).toBeVisible();
  expect(screen.getByTestId("board-widget-quick-format")).toBeVisible();
  expect(screen.getByTestId("sticky-quick-color-yellow")).toBeVisible();
  expect(screen.getByTestId("board-widget-advanced-format")).not.toHaveAttribute("open");
  expect(screen.getByTestId("board-inspector-geometry")).not.toHaveAttribute("open");
  fireEvent.click(screen.getByTestId("board-widget-advanced-format").querySelector("summary")!);
  expect(screen.getByLabelText("便利贴尺寸模式")).toBeVisible();
});

it("exposes the selected Text's common formatting and object actions before detailed controls", () => {
  const text: WhiteboardObject = { ...sticky, id: "text", kind: "text", text: "Heading" };
  const onTextChange = vi.fn();
  render(<ObjectContextToolbar object={text} readOnly={false} actorId="me" onStickyChange={vi.fn()} onTextChange={onTextChange} onExperienceChange={vi.fn()} onGeometryChange={vi.fn()} onClose={vi.fn()} onFutureAction={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByTestId("board-widget-quick-format")).toBeVisible();
  expect(screen.getByTestId("board-text-quick-bold")).toBeVisible();
  expect(screen.getByTestId("board-text-quick-align")).toBeVisible();
  expect(screen.getByTestId("board-widget-advanced-format")).not.toHaveAttribute("open");
  fireEvent.click(screen.getByTestId("board-widget-advanced-format").querySelector("summary")!);
  expect(screen.getByTestId("board-inspector-text")).toBeVisible();
  fireEvent.click(screen.getByTestId("board-text-quick-bold"));
  expect(onTextChange).toHaveBeenCalledWith({ preset: "body", bold: true });
});

it("shows shape-specific fill controls and common duplicate/delete actions for selected widgets", () => {
  const shape: WhiteboardObject = { ...sticky, id: "shape", kind: "rectangle", text: "Plan", style: { fill: "#FFFFFF", stroke: "#111111" } };
  const onStyleChange = vi.fn();
  render(<ObjectContextToolbar object={shape} readOnly={false} actorId="me" onStickyChange={vi.fn()} onTextChange={vi.fn()} onStyleChange={onStyleChange} onExperienceChange={vi.fn()} onGeometryChange={vi.fn()} onClose={vi.fn()} onFutureAction={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "Plan" })).toBeVisible();
  expect(screen.getByTestId("board-generic-quick-format")).toBeVisible();
  fireEvent.change(screen.getByTestId("board-object-fill-color"), { target: { value: "#FF0000" } });
  expect(onStyleChange).toHaveBeenCalledWith({ fill: "#FF0000", stroke: "#111111" });
  fireEvent.change(screen.getByTestId("board-object-stroke-color"), { target: { value: "#0000FF" } });
  expect(onStyleChange).toHaveBeenCalledWith({ fill: "#FFFFFF", stroke: "#0000FF" });
  expect(screen.getByRole("button", { name: "复制对象" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "删除对象" })).toBeEnabled();
  expect(screen.queryByTestId("board-inspector-text")).toBeNull();
});

it("opens the matching object menu when a shape is selected on the Fabric board", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: { ...sticky, id: "shape", kind: "rectangle", text: "Plan", style: { fill: "#FFFFFF" } } }], "seed");
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("select-one"));
  const panel = screen.getByTestId("board-context-toolbar");
  expect(panel).toHaveAttribute("aria-label", "形状属性");
  expect(panel.style.left).toMatch(/px$/);
  expect(panel.style.top).toMatch(/px$/);
  expect(screen.getByTestId("board-object-fill-color")).toBeVisible();
  doc.destroy();
});

it("keeps the image edit menu as the single floating inspector for selected image widgets", () => {
  const doc = createWhiteboardDocument();
  const image: WhiteboardObject = { ...sticky, id: "image", kind: "image", text: "Landscape", extensionData: { contentObject: { version: 1, type: "image", status: "ready", assetId: "asset_image_1", sourceUrl: null, mimeType: "image/png", intrinsicWidth: 800, intrinsicHeight: 600, crop: { x: 0, y: 0, width: 1, height: 1 }, opacity: 1, borderColor: "#FFFFFF", borderWidth: 0, cornerRadius: 0, fileName: "landscape.png", replacementOf: null, failureCode: null, byteSize: 3, contentDigest: `sha256:${"a".repeat(64)}`, magicMimeType: "image/png", retryCount: 0 } } };
  executeCommands(doc, [{ type: "create", object: image }], "seed");
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("select-one"));
  expect(screen.getAllByTestId("board-context-toolbar")).toHaveLength(1);
  const panel = screen.getByTestId("board-context-toolbar");
  expect(panel).toHaveAttribute("aria-label", "图片属性");
  expect(panel.style.left).toMatch(/px$/);
  fireEvent.click(screen.getByTestId("board-inspector-appearance"));
  expect(screen.getByRole("button", { name: "裁剪" })).toBeVisible();
  doc.destroy();
});

it("derives command availability from selection count and hides single-object controls for a mixed selection", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: sticky }, { type: "create", object: { ...sticky, id: "sticky-2", orderKey: "b", geometry: { ...sticky.geometry, x: 240 } } }], "seed");
  render(<CollaborativeThinkingEditor boardId="board" clientId="web" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("select-one"));
  expect(screen.queryByTestId("board-shared-properties")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  expect(screen.getByTestId("board-context-toolbar")).toBeVisible();
  expect(within(screen.getByTestId("board-spatial-toolbar")).getByRole("button", { name: "组合" })).toBeDisabled();
  expect(within(screen.getByTestId("board-spatial-toolbar")).getByRole("button", { name: "组合" })).toHaveAttribute("title", "至少选择 2 个对象");
  expect(screen.getByText("组合不可用：至少选择 2 个对象。")).toHaveClass("sr-only");
  fireEvent.click(screen.getByTestId("select-two"));
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  expect(screen.queryByTestId("board-context-toolbar")).toBeNull();
  expect(within(screen.getByTestId("board-spatial-toolbar")).getByRole("button", { name: "组合" })).toBeEnabled();
  doc.destroy();
});

it("explains readonly command unavailability through the toolbar description", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: sticky }], "seed");
  render(<CollaborativeThinkingEditor boardId="board" clientId="viewer" doc={doc} readOnly title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("select-one"));
  expect(screen.queryByTestId("board-shared-properties")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  expect(screen.getByTestId("board-spatial-duplicate")).toBeDisabled();
  expect(screen.getByTestId("board-spatial-duplicate")).toHaveAttribute("title", "当前白板为只读");
  expect(screen.getByTestId("board-command-availability")).toHaveTextContent("修改命令不可用：当前白板为只读。");
  doc.destroy();
});

it("hides mutating single-object controls when the selected object is locked", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: { ...sticky, locked: true } }], "seed");
  render(<CollaborativeThinkingEditor boardId="board" clientId="editor" doc={doc} readOnly={false} title="Board" status="已连接" />);
  fireEvent.click(screen.getByTestId("select-one"));
  expect(screen.queryByTestId("board-shared-properties")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  expect(screen.queryByTestId("board-context-toolbar")).toBeNull();
  expect(screen.getByTestId("board-spatial-duplicate")).toBeDisabled();
  expect(screen.getByTestId("board-spatial-duplicate")).toHaveAttribute("title", "选择中包含锁定对象");
  doc.destroy();
});
