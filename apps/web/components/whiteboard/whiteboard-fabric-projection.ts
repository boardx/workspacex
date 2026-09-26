import type { WhiteboardObject } from "@repo/whiteboard-core";
import type { BoardFabricObject, BoardFabricKind } from "./fabric/board-fabric-object";

const SUPPORTED_KINDS = new Set<WhiteboardObject["kind"]>(["sticky", "text", "rectangle", "ellipse"]);

function projectionRevision(object: WhiteboardObject): number {
  const value = JSON.stringify({ kind: object.kind, geometry: object.geometry, text: object.text, style: object.style, parentId: object.parentId, orderKey: object.orderKey });
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Pure adapter: derives disposable renderer input from whiteboard-core canonical objects. */
export function toBoardFabricObjects(objects: readonly WhiteboardObject[]): BoardFabricObject[] {
  return objects.filter((object) => SUPPORTED_KINDS.has(object.kind)).map((object) => ({
    id: object.id,
    kind: object.kind as BoardFabricKind,
    revision: projectionRevision(object),
    orderKey: object.orderKey || object.id,
    geometry: { ...object.geometry },
    style: {
      fill: object.style.fill ?? (object.kind === "sticky" ? "#F8D76E" : "#F4F4F5"),
      textColor: object.style.color ?? "#29261E",
      stroke: object.style.stroke,
      fontSize: object.style.fontSize,
    },
    content: { text: object.text },
    parentId: object.parentId ?? undefined,
  }));
}
