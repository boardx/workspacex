import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';

export interface WhiteboardViewport { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

function intersects(object: WhiteboardObject, viewport: WhiteboardViewport, margin: number): boolean {
  const g = object.geometry;
  return g.x + g.width >= viewport.x - margin && g.x <= viewport.x + viewport.width + margin
    && g.y + g.height >= viewport.y - margin && g.y <= viewport.y + viewport.height + margin;
}

/** Linear viewport projection; connector lookup is indexed once rather than scanning per edge. */
export function selectVisibleObjects(objects: readonly WhiteboardObject[], viewport: WhiteboardViewport,
  selected: ReadonlySet<string> = new Set(), margin = 300): WhiteboardObject[] {
  const byId = new Map(objects.map(object => [object.id, object]));
  const visible = new Set(objects.filter(object => object.kind !== 'connector'
    && (selected.has(object.id) || intersects(object, viewport, margin))).map(object => object.id));
  return objects.filter(object => {
    if (object.kind !== 'connector') return visible.has(object.id);
    const from = object.connector ? byId.get(object.connector.from) : undefined;
    const to = object.connector ? byId.get(object.connector.to) : undefined;
    if (!from || !to) return false;
    const bounds: WhiteboardObject = { ...object, geometry: {
      x: Math.min(from.geometry.x, to.geometry.x), y: Math.min(from.geometry.y, to.geometry.y),
      width: Math.max(1, Math.abs(from.geometry.x - to.geometry.x) + Math.max(from.geometry.width, to.geometry.width)),
      height: Math.max(1, Math.abs(from.geometry.y - to.geometry.y) + Math.max(from.geometry.height, to.geometry.height)),
      rotation: 0,
    } };
    return selected.has(object.id) || intersects(bounds, viewport, margin);
  });
}

