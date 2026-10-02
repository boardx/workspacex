import { editConnectorPathHandle, localPointFromScene, nearestConnectorPoint, resolveConnectorPath, rotatedAnchorPoint, snapConnectorEndpoint, translateConnector, type ConnectorRelationship, type ConnectorSnapCandidate, type ResolvedConnectorPath, type WhiteboardObject } from "@repo/whiteboard-core";

export type ConnectorGestureKind = "from" | "to" | "route" | "label" | "translate";
export type ConnectorScenePoint = { x: number; y: number };

export function connectorRelationshipFromObject(object: WhiteboardObject): ConnectorRelationship | null {
  if (object.kind !== "connector" || !object.connector) return null;
  return { ...object.connector, type: object.connector.type ?? "straight", fromAnchor: object.connector.fromAnchor ?? "right", toAnchor: object.connector.toAnchor ?? "left", startStyle: object.connector.startStyle ?? "none", endStyle: object.connector.endStyle ?? "arrow", lineStyle: object.connector.lineStyle ?? "solid", label: object.connector.label ?? object.text, semanticRelation: object.connector.semanticRelation ?? "" } as ConnectorRelationship;
}

export function connectorResolvedPath(relationship: ConnectorRelationship, objects: readonly WhiteboardObject[]): ResolvedConnectorPath | null {
  const from = objects.find(object => object.id === relationship.from), to = objects.find(object => object.id === relationship.to);
  const start = from ? rotatedAnchorPoint(from, relationship.fromAnchor ?? "right", relationship.fromOffset) : relationship.fromPoint;
  const end = to ? rotatedAnchorPoint(to, relationship.toAnchor ?? "left", relationship.toOffset) : relationship.toPoint;
  if (!start || !end) return null;
  return resolveConnectorPath({ start, end, type: relationship.type, route: relationship.route, fromAnchor: relationship.fromAnchor, toAnchor: relationship.toAnchor });
}

export function connectorGestureSnap(objects: readonly WhiteboardObject[], point: ConnectorScenePoint, zoom: number, excludeIds: readonly string[], bypass: boolean): ConnectorSnapCandidate | null {
  const candidate = snapConnectorEndpoint(objects, point, { zoom, excludeIds, bypass });
  if (candidate || bypass) return candidate;
  // Inside a shape, attach to its nearest real edge anchor, not a hidden offset.
  const contained = objects.filter(object => {
    if (object.kind === "connector" || object.locked || object.hidden || excludeIds.includes(object.id)) return false;
    const local = localPointFromScene(object.geometry, point);
    return local.x >= 0 && local.y >= 0 && local.x <= object.geometry.width && local.y <= object.geometry.height;
  });
  let nearest: ConnectorSnapCandidate | null = null;
  for (const object of contained) for (const anchor of ["top", "right", "bottom", "left"] as const) {
    const world = rotatedAnchorPoint(object, anchor), distance = Math.hypot(world.x - point.x, world.y - point.y);
    if (!nearest || distance < nearest.distance) nearest = { objectId: object.id, anchor, point: world, distance };
  }
  return nearest;
}

export function connectorEndpointChange(relationship: ConnectorRelationship, side: "from" | "to", point: ConnectorScenePoint, candidate: ConnectorSnapCandidate | null): ConnectorRelationship {
  const next = { ...relationship };
  if (side === "from") {
    delete next.from; delete next.fromPoint; delete next.fromOffset;
    if (candidate) { next.from = candidate.objectId; next.fromAnchor = candidate.anchor; } else next.fromPoint = { ...point };
  } else {
    delete next.to; delete next.toPoint; delete next.toOffset;
    if (candidate) { next.to = candidate.objectId; next.toAnchor = candidate.anchor; } else next.toPoint = { ...point };
  }
  return next;
}

export function connectorGestureChange(relationship: ConnectorRelationship, path: ResolvedConnectorPath, kind: ConnectorGestureKind, handleId: string | null, point: ConnectorScenePoint, initialPoint: ConnectorScenePoint): Partial<ConnectorRelationship> {
  if (kind === "route") return { route: editConnectorPathHandle({ start: path.start, end: path.end, type: relationship.type, route: relationship.route, fromAnchor: relationship.fromAnchor, toAnchor: relationship.toAnchor }, handleId ?? "", point) };
  if (kind === "label") { const nearest = nearestConnectorPoint(path, point); return { labelPosition: { t: nearest.arcLengthT, normalOffset: nearest.normalOffset } }; }
  if (kind === "translate" && !relationship.from && !relationship.to) return translateConnector(relationship, point.x - initialPoint.x, point.y - initialPoint.y);
  return {};
}
