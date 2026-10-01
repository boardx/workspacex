import { expect, it } from "vitest";
import * as Y from "yjs";
import { SelectionLayoutCommandPort, createLayoutPreconditions, createWhiteboardDocument, executeCommands, readObjects, type WhiteboardLayoutCommand, type WhiteboardObject } from "@repo/whiteboard-core";

const note = (id: string, x: number): WhiteboardObject => ({ id, schemaVersion: 1, kind: "sticky", geometry: { x, y: 20, width: 100, height: 80, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: id });
const command: WhiteboardLayoutCommand = { type: "arrange-objects", kind: "row", objectIds: ["a", "b"], gap: 24 };

it("rejects preview confirmation after a remote field revision without overwriting it", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: note("a", 0) }, { type: "create", object: note("b", 300) }], "seed");
  const port = new SelectionLayoutCommandPort(doc);
  const preview = port.preview({ boardId: "board", clientId: "human", gestureId: "preview", command, preconditions: createLayoutPreconditions(readObjects(doc), command), stateVector: Y.encodeStateVector(doc) });
  const geometryBefore = readObjects(doc).map(object => object.geometry);
  executeCommands(doc, [{ type: "text", id: "a", index: 0, deleteCount: 1, insert: "remote-a" }], "remote");
  expect(() => port.applyPreview(preview.previewId)).toThrow("LAYOUT_CONFLICT");
  expect(readObjects(doc).find(object => object.id === "a")?.text).toBe("remote-a");
  expect(readObjects(doc).map(object => object.geometry)).toEqual(geometryBefore);
  doc.destroy();
});

it("invalidates consumed and cancelled preview identities", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object: note("a", 0) }, { type: "create", object: note("b", 300) }], "seed");
  const port = new SelectionLayoutCommandPort(doc);
  const envelope = (gestureId: string) => ({ boardId: "board", clientId: "human", gestureId, command, preconditions: createLayoutPreconditions(readObjects(doc), command), stateVector: Y.encodeStateVector(doc) });
  const cancelled = port.preview(envelope("cancel"));
  expect(port.cancelPreview(cancelled.previewId)).toBe(true);
  expect(() => port.applyPreview(cancelled.previewId)).toThrow("LAYOUT_PREVIEW_NOT_FOUND");
  const applied = port.preview(envelope("apply"));
  port.applyPreview(applied.previewId);
  expect(() => port.applyPreview(applied.previewId)).toThrow("LAYOUT_PREVIEW_NOT_FOUND");
  doc.destroy();
});
