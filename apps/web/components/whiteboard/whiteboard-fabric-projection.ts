import { readPanelMetadata, validateTextAttributes, type ConnectorAnchor, type WhiteboardObject } from "@repo/whiteboard-core";
import type { BoardFabricObject, BoardFabricKind, BoardFabricStickyAppearance, BoardFabricStyle } from "./fabric/board-fabric-object";
import { readBoardContent } from "./board-content-adapter";
import { getBoardSessionImageAsset } from "./board-session-image-assets";

const SUPPORTED_KINDS = new Set<WhiteboardObject["kind"]>(["sticky", "text", "rectangle", "ellipse", "frame", "group", "connector"]);

function projectionRevision(object: Omit<BoardFabricObject, "revision">): number {
  const value = JSON.stringify(object);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const STICKY_VARIANTS = new Set(["square", "rectangle", "circle"]);
const STICKY_SIZING_MODES = new Set(["auto-height", "fixed", "auto-size"]);
const TEXT_PRESETS = new Set(["title", "heading", "subheading", "body", "caption"]);
const TEXT_ALIGNMENTS = new Set(["left", "center", "right"]);
const TEXT_LISTS = new Set(["none", "bullet", "number"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function projectedSticky(object: WhiteboardObject): { appearance: BoardFabricStickyAppearance; fill?: string } | undefined {
  if (object.kind !== "sticky") return undefined;
  const fallback = { appearance: { variant: "square", sizingMode: "auto-height" } as const };
  const thinking = record(object.extensionData?.thinkingInput);
  const sticky = record(thinking?.sticky);
  if (!sticky) return fallback;
  if (typeof sticky.variant !== "string" || !STICKY_VARIANTS.has(sticky.variant)) return fallback;
  const sizing = sticky.sizing ?? sticky.sizingMode;
  if (typeof sizing !== "string" || !STICKY_SIZING_MODES.has(sizing)) return fallback;
  if (typeof sticky.color !== "string" || !HEX_COLOR.test(sticky.color)) return fallback;
  return {
    appearance: {
      variant: sticky.variant as BoardFabricStickyAppearance["variant"],
      sizingMode: sizing as BoardFabricStickyAppearance["sizingMode"],
    },
    fill: sticky.color.toUpperCase(),
  };
}

function projectedTextStyle(object: WhiteboardObject): Partial<BoardFabricStyle> {
  const thinking = record(object.extensionData?.thinkingInput);
  const text = record(thinking?.text);
  if (!text || typeof text.preset !== "string" || !TEXT_PRESETS.has(text.preset)) return {};
  if (text.fontFamily !== undefined && typeof text.fontFamily !== "string") return {};
  if (text.fontSize !== undefined && typeof text.fontSize !== "number") return {};
  if (text.bold !== undefined && typeof text.bold !== "boolean") return {};
  if (text.italic !== undefined && typeof text.italic !== "boolean") return {};
  if (text.underline !== undefined && typeof text.underline !== "boolean") return {};
  if (text.color !== undefined && typeof text.color !== "string") return {};
  if (text.alignment !== undefined && (typeof text.alignment !== "string" || !TEXT_ALIGNMENTS.has(text.alignment))) return {};
  if (text.lineHeight !== undefined && typeof text.lineHeight !== "number") return {};
  if (text.list !== undefined && (typeof text.list !== "string" || !TEXT_LISTS.has(text.list))) return {};
  if (text.link !== undefined && text.link !== null && typeof text.link !== "string") return {};
  try {
    const validated = validateTextAttributes(text as unknown as Parameters<typeof validateTextAttributes>[0]);
    return {
      textPreset: validated.preset,
      fontFamily: validated.fontFamily,
      fontSize: validated.fontSize,
      bold: validated.bold,
      italic: validated.italic,
      underline: validated.underline,
      textColor: validated.color,
      alignment: validated.alignment,
      lineHeight: validated.lineHeight,
      list: validated.list,
      link: validated.link,
    };
  } catch {
    return {};
  }
}

/** Pure adapter: derives disposable renderer input from whiteboard-core canonical objects. */
export function toBoardFabricObjects(objects: readonly WhiteboardObject[]): BoardFabricObject[] {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const anchorPoint = (object: WhiteboardObject, anchor: ConnectorAnchor) => {
    const { x, y, width, height } = object.geometry;
    if (anchor === "top") return { x: x + width / 2, y };
    if (anchor === "right") return { x: x + width, y: y + height / 2 };
    if (anchor === "bottom") return { x: x + width / 2, y: y + height };
    if (anchor === "left") return { x, y: y + height / 2 };
    return { x: x + width / 2, y: y + height / 2 };
  };
  return objects.map((object) => {
    const content = readBoardContent(object);
    const contentKind: BoardFabricKind | undefined = content?.type === "shape" ? "shape" : content?.type === "drawing" ? "drawing" : content?.type === "image" ? "image" : content ? "card" : undefined;
    const supported = SUPPORTED_KINDS.has(object.kind) || Boolean(contentKind);
    const sticky = projectedSticky(object);
    const projected: Omit<BoardFabricObject, "revision"> = {
      id: object.id,
      kind: contentKind ?? (supported ? (object.kind === "frame" ? "panel" : object.kind) as BoardFabricKind : "placeholder"),
      orderKey: object.orderKey || object.id,
      geometry: { ...object.geometry },
      style: supported ? {
        fill: content?.type === "shape" ? content.fill : sticky?.fill ?? object.style.fill ?? (object.kind === "sticky" ? "#F8D76E" : object.kind === "frame" ? "rgba(248,250,252,0.76)" : ["group", "connector"].includes(object.kind) ? "transparent" : "#F4F4F5"),
        textColor: content?.type === "shape" ? content.textColor : object.style.color ?? "#29261E",
        stroke: content?.type === "shape" ? content.borderColor : object.style.stroke,
        strokeWidth: content?.type === "shape" ? content.borderWidth : undefined,
        borderStyle: content?.type === "shape" ? content.borderStyle : undefined,
        opacity: content?.type === "shape" ? content.opacity : undefined,
        radius: content?.type === "shape" ? content.radius : undefined,
        alignment: content?.type === "shape" ? content.horizontalAlign : undefined,
        verticalAlignment: content?.type === "shape" ? content.verticalAlign : undefined,
        fontSize: object.style.fontSize,
        ...projectedTextStyle(object),
      } : {
        fill: "#FEF2F2",
        textColor: "#991B1B",
        stroke: "#DC2626",
        fontSize: 14,
      },
      content: supported
        ? { text: object.text }
        : { text: `暂不支持“${object.kind}”对象，内容已安全保留。` },
      sticky: supported ? sticky?.appearance : undefined,
      boardContent: content,
      imageAssetUrl: content?.type === "image" ? getBoardSessionImageAsset(content.assetId)?.objectUrl : undefined,
      panel: object.kind === "frame" ? (() => {
        const panel = readPanelMetadata(object);
        return panel ? { title: object.text, mode: panel.mode, autoExpand: panel.autoExpand, clipContent: panel.clipContent } : undefined;
      })() : undefined,
      connector: object.kind === "connector" && object.connector ? (() => {
        const from = byId.get(object.connector!.from), to = byId.get(object.connector!.to);
        const fromAnchor = object.connector!.fromAnchor ?? "right", toAnchor = object.connector!.toAnchor ?? "left";
        if (!from || !to) return undefined;
        return {
          from: from.id, to: to.id, fromAnchor, toAnchor,
          type: object.connector!.type ?? "straight", startStyle: object.connector!.startStyle ?? "none",
          endStyle: object.connector!.endStyle ?? "arrow", lineStyle: object.connector!.lineStyle ?? "solid",
          label: object.connector!.label ?? object.text, semanticRelation: object.connector!.semanticRelation ?? "",
          start: anchorPoint(from, fromAnchor), end: anchorPoint(to, toAnchor),
        };
      })() : undefined,
      parentId: object.parentId ?? undefined,
      locked: supported ? Boolean(object.locked) : true,
      zIndex: object.zIndex ?? 0,
      projectionIssue: supported ? undefined : {
        code: "BOARD_OBJECT_UNSUPPORTED" as const,
        sourceKind: object.kind,
        message: `暂不支持“${object.kind}”对象，内容已安全保留。`,
      },
    };
    return { ...projected, revision: projectionRevision(projected) };
  });
}
