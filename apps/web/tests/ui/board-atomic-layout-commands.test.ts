import { expect, it } from "vitest";
import * as Y from "yjs";
import { SelectionLayoutCommandPort, WhiteboardCommandOrigin, WhiteboardUndo, createLayoutPreconditions, createWhiteboardDocument, executeCommands, readObjects, type WhiteboardLayoutCommand, type WhiteboardObject } from "@repo/whiteboard-core";

const note = (id: string, x: number, y: number, width = 100, height = 80): WhiteboardObject => ({ id, schemaVersion: 1, kind: "sticky", geometry: { x, y, width, height, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: id });
const layout = (kind: WhiteboardLayoutCommand["kind"], ids: string[], extra: Partial<WhiteboardLayoutCommand> = {}): WhiteboardLayoutCommand => ({ type: "arrange-objects", kind, objectIds: ids, ...extra } as WhiteboardLayoutCommand);

it.each(["align-left", "align-center", "align-right", "align-top", "align-middle", "align-bottom", "distribute-horizontal", "distribute-vertical", "equal-width", "equal-height", "equal-size", "grid", "row", "column", "tidy-up"] as const)("commits %s as one operation and one undo entry", (kind) => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [note("a", 0, 0, 80, 60), note("b", 180, 130, 120, 90), note("c", 460, 280, 100, 70)].map(object => ({ type: "create" as const, object })), "seed");
  const before = readObjects(doc).map(object => object.geometry), command = layout(kind, ["a", "b", "c"], { columns: 2, gap: 24 });
  const transactions: Y.Transaction[] = [];
  doc.on("afterTransaction", transaction => { if (transaction.origin instanceof WhiteboardCommandOrigin) transactions.push(transaction); });
  const undo = new WhiteboardUndo(doc);
  const result = new SelectionLayoutCommandPort(doc).dispatch({ boardId: "board", clientId: "client", gestureId: `layout-${kind}`, command, preconditions: createLayoutPreconditions(readObjects(doc), command), stateVector: Y.encodeStateVector(doc) });
  expect(result.events).toHaveLength(1);
  expect(result.events[0]).toMatchObject({ type: "ObjectsArranged", layoutKind: kind, selectionObjectIds: ["a", "b", "c"] });
  expect(transactions).toHaveLength(1);
  expect(undo.undo()).toBe("undone");
  expect(readObjects(doc).map(object => object.geometry)).toEqual(before);
  doc.destroy();
});

it("arranges 500 objects in one canonical transaction without per-object dispatch", () => {
  const doc = createWhiteboardDocument();
  const objects = Array.from({ length: 500 }, (_, index) => note(`n-${String(index).padStart(3, "0")}`, (index % 25) * 17, Math.floor(index / 25) * 19));
  executeCommands(doc, objects.map(object => ({ type: "create" as const, object })), "seed");
  const command = layout("grid", objects.map(object => object.id), { columns: 25, gap: 24 });
  let canonicalTransactions = 0;
  doc.on("afterTransaction", transaction => { if (transaction.origin instanceof WhiteboardCommandOrigin) canonicalTransactions += 1; });
  const result = new SelectionLayoutCommandPort(doc).dispatch({ boardId: "board", clientId: "agent", gestureId: "grid-500", command, preconditions: createLayoutPreconditions(readObjects(doc), command), stateVector: Y.encodeStateVector(doc) });
  expect(result.events[0].selectionObjectIds).toHaveLength(500);
  expect(result.events[0].objectIds).toHaveLength(499);
  expect(canonicalTransactions).toBe(1);
  doc.destroy();
});
