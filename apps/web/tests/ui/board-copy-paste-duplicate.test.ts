import { expect, it } from "vitest";
import { createWhiteboardDocument, executeCommands, readObjects, SpatialRelationshipCommandPort, type WhiteboardObject } from "@repo/whiteboard-core";

it("duplicates a selected subgraph with fresh ids while preserving only internal relationships", () => {
  const doc = createWhiteboardDocument(), port = new SpatialRelationshipCommandPort(doc);
  const note = (id: string, x: number): WhiteboardObject => ({ id, schemaVersion: 1, kind: "sticky", geometry: { x, y: 20, width: 180, height: 180, rotation: 0 }, text: id, style: {}, parentId: null, orderKey: id });
  executeCommands(doc, [{ type: "create", object: note("a", 10) }, { type: "create", object: note("b", 240) }], "seed");
  port.dispatch({ boardId: "board", clientId: "test", gestureId: "edge", command: { type: "create-connector", id: "edge", relationship: { from: "a", to: "b", fromAnchor: "right", toAnchor: "left", type: "straight", startStyle: "none", endStyle: "arrow", lineStyle: "solid", label: "relates", semanticRelation: "relates_to" } } });
  port.dispatch({ boardId: "board", clientId: "test", gestureId: "duplicate", command: { type: "duplicate-subgraph", rootIds: ["a", "b"], newIds: { a: "a-copy", b: "b-copy", edge: "edge-copy" } } });
  const copies = readObjects(doc).filter((object) => object.id.endsWith("-copy"));
  expect(copies).toHaveLength(3);
  expect(copies.find((object) => object.id === "a-copy")?.geometry).toMatchObject({ x: 34, y: 44 });
  expect(copies.find((object) => object.id === "edge-copy")?.connector).toMatchObject({ from: "a-copy", to: "b-copy", semanticRelation: "relates_to" });
  expect(readObjects(doc).find((object) => object.id === "edge")?.connector).toMatchObject({ from: "a", to: "b" });
  doc.destroy();
});

it("stores hostile clipboard markup as inert plain text rather than executable HTML", async () => {
  const { parseThinkingPaste } = await import("@repo/whiteboard-core");
  const pasted = `<img src=x onerror=alert(1)>\n<script>globalThis.pwned=true</script>`;
  const parsed = parseThinkingPaste(pasted);
  expect(parsed.stickies).toEqual(["<img src=x onerror=alert(1)>", "<script>globalThis.pwned=true</script>"]);
  expect(parsed.text).toBe(pasted);
  expect((globalThis as typeof globalThis & { pwned?: boolean }).pwned).toBeUndefined();
});
