import { nextStickyPlacement, resolveConnectorPath, rotatedAnchorPoint, type ConnectorRelationship, type WhiteboardCommand, type WhiteboardObject } from "@repo/whiteboard-core";

/** One canonical transaction creates an adjacent same-type widget and its edge. */
export function boardWidgetContinuation(objects: readonly WhiteboardObject[], sourceId: string, widgetId: string, edgeId: string): { widgetId: string; commands: WhiteboardCommand[] } | null {
  const source = objects.find(object => object.id === sourceId);
  if (!source || source.kind === "connector" || source.kind === "group") return null;
  const byId = new Map(objects.map(object => [object.id, object]));
  const seen = new Set<string>();
  for (let current: WhiteboardObject | undefined = source; current; current = current.parentId ? byId.get(current.parentId) : undefined) {
    if (current.locked || current.hidden || seen.has(current.id)) return null;
    seen.add(current.id);
  }
  const placement = nextStickyPlacement(source.geometry, objects.filter(object => !object.hidden && object.kind !== "connector").map(object => object.geometry), 24);
  const widget: WhiteboardObject = { ...structuredClone(source), id: widgetId, geometry: placement.geometry, locked: false };
  const previous = objects.find(object => object.connector?.from === sourceId);
  const relationship: ConnectorRelationship = { from: sourceId, to: widgetId, fromAnchor: placement.direction === "row" ? "right" : "bottom", toAnchor: placement.direction === "row" ? "left" : "top", type: previous?.connector?.type ?? "straight", startStyle: previous?.connector?.startStyle ?? "none", endStyle: previous?.connector?.endStyle ?? "arrow", lineStyle: previous?.connector?.lineStyle ?? "solid", ...(previous?.connector?.strokeWidth === undefined ? {} : { strokeWidth: previous.connector.strokeWidth }), label: "", semanticRelation: previous?.connector?.semanticRelation ?? "" };
  const path = resolveConnectorPath({ start: rotatedAnchorPoint(source, relationship.fromAnchor), end: rotatedAnchorPoint(widget, relationship.toAnchor), type: relationship.type, fromAnchor: relationship.fromAnchor, toAnchor: relationship.toAnchor });
  const edge: WhiteboardObject = { id: edgeId, schemaVersion: 1, kind: "connector", geometry: { ...path.bounds, width: Math.max(1, path.bounds.width), height: Math.max(1, path.bounds.height), rotation: 0 }, text: "", style: previous ? structuredClone(previous.style) : {}, parentId: null, orderKey: "", connector: relationship };
  return { widgetId, commands: [{ type: "create", object: widget }, { type: "create", object: edge }] };
}
