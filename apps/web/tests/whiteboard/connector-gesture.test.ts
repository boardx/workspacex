import { describe, expect, it } from "vitest";
import { connectorEndpointChange, connectorGestureChange, connectorGestureSnap, connectorResolvedPath } from "@/components/whiteboard/connector-gesture";
import type { ConnectorRelationship, WhiteboardObject } from "@repo/whiteboard-core";

const relationship: ConnectorRelationship = { fromPoint: { x: 0, y: 0 }, toPoint: { x: 200, y: 100 }, fromAnchor: "right", toAnchor: "left", type: "curve", startStyle: "circle", endStyle: "arrow", lineStyle: "dashed", label: "关系", semanticRelation: "depends", strokeWidth: 7, route: { kind: "curve", startOffset: { x: 30, y: 80 }, endOffset: { x: -30, y: 20 } }, labelPosition: { t: .3, normalOffset: 8 } };
const object: WhiteboardObject = { schemaVersion: 1, parentId: null, id: "node", kind: "sticky", text: "", geometry: { x: 100, y: 100, width: 100, height: 80, rotation: 0 }, style: {}, orderKey: "a" };

describe("connector gesture projection", () => {
  it("snaps an interior drop to the closest edge and bypasses to a free point", () => {
    const snap = connectorGestureSnap([object], { x: 180, y: 140 }, 2, [], false);
    expect(snap).toMatchObject({ objectId: "node", anchor: "right", point: { x: 200, y: 140 } });
    expect(connectorGestureSnap([object], { x: 180, y: 140 }, 2, [], true)).toBeNull();
    expect(connectorGestureSnap([{ ...object, locked: true }], { x: 180, y: 140 }, 2, [], false)).toBeNull();
  });
  it("rebinds or detaches exactly one endpoint while preserving manual route and style", () => {
    const attached = connectorEndpointChange(relationship, "to", { x: 150, y: 100 }, { objectId: "node", anchor: "top", point: { x: 150, y: 100 }, distance: 0 });
    expect(attached.to).toBe("node"); expect(attached.toPoint).toBeUndefined();
    const detached = connectorEndpointChange({ ...attached, toOffset: { x: 2, y: 3 } }, "to", { x: 500, y: 500 }, null);
    expect(detached.to).toBeUndefined(); expect(detached.toOffset).toBeUndefined();
    expect(detached.toPoint).toEqual({ x: 500, y: 500 });
    expect(detached.route).toEqual(relationship.route); expect(detached.strokeWidth).toBe(7); expect(detached.fromPoint).toEqual(relationship.fromPoint);
  });
  it("changes a curve handle through the canonical helper and translates both free endpoints once", () => {
    const path = connectorResolvedPath(relationship, [])!;
    expect(connectorGestureChange(relationship, path, "route", "curve-start", { x: 40, y: 60 }, { x: 0, y: 0 }).route).toEqual({ kind: "curve", startOffset: { x: 40, y: 60 }, endOffset: { x: -30, y: 20 } });
    const moved = connectorGestureChange(relationship, path, "translate", null, { x: 24, y: 36 }, { x: 0, y: 0 });
    expect(moved.fromPoint).toEqual({ x: 24, y: 36 }); expect(moved.toPoint).toEqual({ x: 224, y: 136 }); expect(moved.route).toEqual(relationship.route);
  });
});
