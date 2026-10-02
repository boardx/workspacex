import { describe, expect, it } from "vitest";
import { Group, Path, Point, Textbox, util } from "fabric";
import { connectorLabelPlacement, resolveConnectorPath } from "@repo/whiteboard-core";
import { createFabricObject, applyCanonicalObject } from "@/components/whiteboard/fabric/board-fabric-surface";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

describe("real Fabric connector path", () => {
  it("preserves exact world path, stroke width and manual label placement without bounds scaling", () => {
    const connector = { start: { x: 100, y: 100 }, end: { x: 300, y: 200 }, fromAnchor: "right" as const, toAnchor: "left" as const, type: "curve" as const, startStyle: "circle" as const, endStyle: "arrow" as const, lineStyle: "solid" as const, label: "关系", semanticRelation: "", strokeWidth: 9, route: { kind: "curve" as const, startOffset: { x: 70, y: -60 }, endOffset: { x: -20, y: 90 } }, labelPosition: { t: .3, normalOffset: 20 } };
    const resolved = resolveConnectorPath(connector);
    const object: BoardFabricObject = { id: "edge", kind: "connector", revision: 1, orderKey: "a", geometry: { ...resolved.bounds, width: Math.max(1, resolved.bounds.width), height: Math.max(1, resolved.bounds.height), rotation: 0 }, content: { text: "关系" }, style: { fill: "", textColor: "#222" }, connector };
    const group = createFabricObject(object) as Group;
    applyCanonicalObject(group, object, false);
    const line = group.getObjects().find(child => child instanceof Path) as Path;
    const start = util.transformPoint(new Point(connector.start.x - line.pathOffset.x, connector.start.y - line.pathOffset.y), line.calcTransformMatrix());
    const end = util.transformPoint(new Point(connector.end.x - line.pathOffset.x, connector.end.y - line.pathOffset.y), line.calcTransformMatrix());
    expect(start.x).toBeCloseTo(connector.start.x); expect(start.y).toBeCloseTo(connector.start.y);
    expect(end.x).toBeCloseTo(connector.end.x); expect(end.y).toBeCloseTo(connector.end.y);
    expect(line.strokeWidth).toBe(9); expect(group.scaleX).toBe(1); expect(group.scaleY).toBe(1);
    const label = group.getObjects().find(child => child instanceof Textbox)!;
    const expected = connectorLabelPlacement(resolved, connector.labelPosition).point, center = label.getCenterPoint();
    expect(center.x).toBeCloseTo(expected.x); expect(center.y).toBeCloseTo(expected.y);
  });
});
