"use client";

import { FabricImage, Group, StaticCanvas, type FabricObject } from "fabric";
import type { WhiteboardObject } from "@repo/whiteboard-core";
import { readBoardContent } from "./board-content-adapter";
import { BoardDurableImageSession, durableBoardImageMetadata } from "./board-session-image-assets";
import { toBoardFabricObjects } from "./whiteboard-fabric-projection";
import { applyBoardParentClip } from "./fabric/board-projection-parent";
import { applyCanonicalObject, createFabricObject } from "./fabric/board-fabric-surface";

export interface BoardImageBounds { x: number; y: number; width: number; height: number }
export interface CanonicalBoardImageOptions {
  boardId: string;
  objects: readonly WhiteboardObject[];
  maxWidth?: number;
  maxHeight?: number;
  padding?: number;
  signal?: AbortSignal;
}

/** Full canonical content, independent of interactive viewport, selections and chrome. */
export async function renderCanonicalBoardImage({ boardId, objects, maxWidth = 8192, maxHeight = 8192, padding = 24, signal }: CanonicalBoardImageOptions): Promise<{ blob: Blob; width: number; height: number; bounds: BoardImageBounds }> {
  if (![maxWidth, maxHeight, padding].every(Number.isFinite) || maxWidth < 1 || maxHeight < 1 || padding < 0) throw new Error("BOARD_EXPORT_INVALID_SIZE");
  signal?.throwIfAborted();
  const assets = new BoardDurableImageSession(boardId, () => {});
  const canvas = new StaticCanvas(document.createElement("canvas"), { enableRetinaScaling: false, renderOnAddRemove: false, backgroundColor: "#FFFFFF" });
  try {
    await document.fonts?.ready;
    const byId = new Map(objects.map(object => [object.id, object]));
    const visible = objects.filter(object => {
      const seen = new Set<string>();
      let current: WhiteboardObject | undefined = object;
      while (current) {
        if (current.hidden || seen.has(current.id)) return false;
        seen.add(current.id); current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return true;
    });
    await Promise.all(visible.map(async object => {
      const content = readBoardContent(object);
      if (content?.type !== "image") return;
      const metadata = durableBoardImageMetadata(content);
      if (!metadata) throw new Error("BOARD_EXPORT_IMAGE_UNAVAILABLE");
      await assets.ensure(metadata, signal);
    }));
    signal?.throwIfAborted();
    const projected = toBoardFabricObjects(visible, assetId => assets.get(assetId)?.objectUrl);
    const kindOrder = (kind: string) => kind === "panel" ? 0 : kind === "connector" ? 3 : kind === "group" ? 2 : 1;
    projected.sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0) || kindOrder(left.kind) - kindOrder(right.kind) || left.orderKey.localeCompare(right.orderKey));
    const projectedById = new Map(projected.map(object => [object.id, object]));
    for (const object of projected) {
      const member = createFabricObject(object);
      applyCanonicalObject(member, object, true);
      applyBoardParentClip(member, object.parentId ? projectedById.get(object.parentId) : undefined);
      canvas.add(member);
    }
    const decodeImages = async (object: FabricObject): Promise<void> => {
      if (object instanceof FabricImage) {
        const element = object.getElement();
        if (element instanceof HTMLImageElement) await element.decode();
      }
      if (object instanceof Group) await Promise.all(object.getObjects().map(decodeImages));
    };
    await Promise.all(canvas.getObjects().map(decodeImages));
    signal?.throwIfAborted();
    const envelope = (object: FabricObject) => {
      const rect = object.getBoundingRect();
      const shadows: FabricObject[] = [object];
      if (object instanceof Group) shadows.push(...object.getObjects());
      // Fabric bounding boxes include strokes, but exclude the shadow raster.
      const extent = shadows.reduce((result, child) => {
        const shadow = child.shadow;
        return shadow ? Math.max(result, shadow.blur * 2 + Math.abs(shadow.offsetX) + Math.abs(shadow.offsetY)) : result;
      }, 0);
      return { left: rect.left - extent, top: rect.top - extent, width: rect.width + extent * 2, height: rect.height + extent * 2 };
    };
    const rectangles = canvas.getObjects().filter(object => object.visible).map(envelope);
    const left = rectangles.length ? Math.min(...rectangles.map(rect => rect.left)) : 0;
    const top = rectangles.length ? Math.min(...rectangles.map(rect => rect.top)) : 0;
    const right = rectangles.length ? Math.max(...rectangles.map(rect => rect.left + rect.width)) : 320;
    const bottom = rectangles.length ? Math.max(...rectangles.map(rect => rect.top + rect.height)) : 180;
    const bounds = { x: left - padding, y: top - padding, width: Math.max(1, right - left + padding * 2), height: Math.max(1, bottom - top + padding * 2) };
    const scale = Math.min(1, maxWidth / bounds.width, maxHeight / bounds.height);
    const width = Math.max(1, Math.ceil(bounds.width * scale)), height = Math.max(1, Math.ceil(bounds.height * scale));
    canvas.setDimensions({ width, height });
    canvas.setViewportTransform([scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale]);
    canvas.renderAll();
    const blob = await new Promise<Blob>((resolve, reject) => canvas.getElement().toBlob(value => value ? resolve(value) : reject(new Error("BOARD_EXPORT_ENCODING_FAILED")), "image/png"));
    signal?.throwIfAborted();
    return { blob, width, height, bounds };
  } finally {
    assets.dispose();
    await Promise.allSettled([canvas.dispose()]);
  }
}
