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
  return objects.map((object) => {
    const supported = SUPPORTED_KINDS.has(object.kind);
    return {
      id: object.id,
      kind: supported ? object.kind as BoardFabricKind : "placeholder",
      revision: projectionRevision(object),
      orderKey: object.orderKey || object.id,
      geometry: { ...object.geometry },
      style: supported ? {
        fill: object.style.fill ?? (object.kind === "sticky" ? "#F8D76E" : "#F4F4F5"),
        textColor: object.style.color ?? "#29261E",
        stroke: object.style.stroke,
        fontSize: object.style.fontSize,
      } : {
        fill: "#FEF2F2",
        textColor: "#991B1B",
        stroke: "#DC2626",
        fontSize: 14,
      },
      content: supported
        ? { text: object.text }
        : { text: `暂不支持“${object.kind}”对象，内容已安全保留。` },
      parentId: object.parentId ?? undefined,
      locked: supported ? undefined : true,
      projectionIssue: supported ? undefined : {
        code: "BOARD_OBJECT_UNSUPPORTED" as const,
        sourceKind: object.kind,
        message: `暂不支持“${object.kind}”对象，内容已安全保留。`,
      },
    };
  });
}
