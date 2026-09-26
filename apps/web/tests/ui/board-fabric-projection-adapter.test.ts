import { describe, expect, it } from "vitest";
import type { WhiteboardObject } from "@repo/whiteboard-core";
import { toBoardFabricObjects } from "@/components/whiteboard/whiteboard-fabric-projection";

const canonical = (id: string, kind: WhiteboardObject["kind"]): WhiteboardObject => ({
  id,
  schemaVersion: 1,
  kind,
  geometry: { x: 10, y: 20, width: 180, height: 140, rotation: 0 },
  text: `${kind} content`,
  style: {},
  parentId: null,
  orderKey: id,
  ...(kind === "connector" ? { connector: { from: "a", to: "b" } } : {}),
});

describe("Board canonical-to-Fabric projection adapter", () => {
  it("keeps unsupported canonical objects visible as locked placeholders with the same identity", () => {
    const source = [canonical("supported", "sticky"), canonical("future", "frame")];

    const projected = toBoardFabricObjects(source);

    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({ id: "supported", kind: "sticky" });
    expect(projected[1]).toMatchObject({
      id: "future",
      kind: "placeholder",
      locked: true,
      geometry: source[1]!.geometry,
      projectionIssue: { code: "BOARD_OBJECT_UNSUPPORTED", sourceKind: "frame" },
    });
    expect(projected[1]!.content.text).toContain("暂不支持“frame”对象");
    expect(source[1]).toMatchObject({ id: "future", kind: "frame", text: "frame content" });
  });

  it("projects every currently unsupported canonical kind instead of silently filtering records", () => {
    const kinds = ["frame", "group", "connector", "image", "drawing", "extension"] as const;
    const projected = toBoardFabricObjects(kinds.map((kind) => canonical(`object-${kind}`, kind)));

    expect(projected.map((object) => object.id)).toEqual(kinds.map((kind) => `object-${kind}`));
    expect(projected.every((object) => object.kind === "placeholder" && object.locked)).toBe(true);
    expect(projected.map((object) => object.projectionIssue?.sourceKind)).toEqual(kinds);
  });
});
