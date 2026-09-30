import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, executeCommands, readObjects } from "@repo/whiteboard-core";
import { useWhiteboardDocument } from "@/components/whiteboard/use-whiteboard-document";

vi.mock("@repo/whiteboard-core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@repo/whiteboard-core")>();
  return { ...original, readObjects: vi.fn(original.readObjects) };
});

afterEach(() => vi.clearAllMocks());

it("reuses decoded objects on UI-only rerenders and decodes Yjs changes once", () => {
  const doc = createWhiteboardDocument();
  const view = renderHook(({ readOnly }) => useWhiteboardDocument(doc, readOnly), {
    initialProps: { readOnly: false },
  });
  const initial = view.result.current.objects;
  expect(readObjects).toHaveBeenCalledTimes(1);

  for (let index = 0; index < 100; index++) {
    view.rerender({ readOnly: index % 2 === 0 });
  }
  expect(view.result.current.objects).toBe(initial);
  expect(readObjects).toHaveBeenCalledTimes(1);

  act(() => executeCommands(doc, [{
    type: "create",
    object: {
      id: "note-1", kind: "sticky", schemaVersion: 1,
      geometry: { x: 0, y: 0, width: 180, height: 140, rotation: 0 },
      text: "Idea", style: {}, parentId: null, orderKey: "",
    },
  }], "test"));
  expect(view.result.current.objects.map((object) => object.id)).toEqual(["note-1"]);
  expect(readObjects).toHaveBeenCalledTimes(2);
  view.rerender({ readOnly: false });
  expect(readObjects).toHaveBeenCalledTimes(2);
  view.unmount();
  doc.destroy();
});

it("decodes a replacement document without retaining the previous board", () => {
  const first = createWhiteboardDocument();
  const second = createWhiteboardDocument();
  const view = renderHook(({ doc }) => useWhiteboardDocument(doc, false), {
    initialProps: { doc: first },
  });
  expect(readObjects).toHaveBeenCalledTimes(1);
  view.rerender({ doc: second });
  expect(readObjects).toHaveBeenCalledTimes(2);
  expect(view.result.current.objects).toEqual([]);
  act(() => executeCommands(first, [{
    type: "create",
    object: {
      id: "old-note", kind: "sticky", schemaVersion: 1,
      geometry: { x: 0, y: 0, width: 180, height: 140, rotation: 0 },
      text: "Old", style: {}, parentId: null, orderKey: "",
    },
  }], "old-doc"));
  expect(view.result.current.objects).toEqual([]);
  expect(readObjects).toHaveBeenCalledTimes(2);

  act(() => executeCommands(second, [{
    type: "create",
    object: {
      id: "new-note", kind: "sticky", schemaVersion: 1,
      geometry: { x: 0, y: 0, width: 180, height: 140, rotation: 0 },
      text: "New", style: {}, parentId: null, orderKey: "",
    },
  }], "new-doc"));
  expect(view.result.current.objects.map((object) => object.id)).toEqual(["new-note"]);
  expect(readObjects).toHaveBeenCalledTimes(3);
  view.rerender({ doc: second });
  expect(readObjects).toHaveBeenCalledTimes(3);
  view.unmount();
  first.destroy();
  second.destroy();
});
