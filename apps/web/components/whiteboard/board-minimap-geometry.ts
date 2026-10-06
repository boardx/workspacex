import type { BoardFabricObject } from "./fabric/board-fabric-object";
export type MinimapObject = Pick<BoardFabricObject, "id" | "kind" | "geometry" | "style" | "hidden">;
import type { BoardViewport } from "./fabric/board-fabric-object";
import type { BoardFrameSize } from "./use-board-frame";

export const MINIMAP_WIDTH = 240;
export const MINIMAP_HEIGHT = 160;
export function minimapGeometry(objects: readonly MinimapObject[], viewport: BoardViewport, frame: BoardFrameSize) {
  const visible = { x: -viewport.panX / viewport.zoom, y: -viewport.panY / viewport.zoom, width: frame.width / viewport.zoom, height: frame.height / viewport.zoom };
  const bounds = objects.filter(object => !object.hidden).map(({ geometry: g }) => {
    const angle = g.rotation * Math.PI / 180;
    const corners = [[0, 0], [g.width, 0], [g.width, g.height], [0, g.height]].map(([x, y]) => ({ x: g.x + x! * Math.cos(angle) - y! * Math.sin(angle), y: g.y + x! * Math.sin(angle) + y! * Math.cos(angle) }));
    const x = Math.min(...corners.map(point => point.x)), y = Math.min(...corners.map(point => point.y));
    return { x, y, width: Math.max(...corners.map(point => point.x)) - x, height: Math.max(...corners.map(point => point.y)) - y };
  });
  const rectangles = [visible, ...bounds];
  const left = Math.min(...rectangles.map(g => g.x)), top = Math.min(...rectangles.map(g => g.y));
  const width = Math.max(1, ...rectangles.map(g => g.x + g.width - left));
  const height = Math.max(1, ...rectangles.map(g => g.y + g.height - top));
  const scale = Math.min((MINIMAP_WIDTH - 24) / width, (MINIMAP_HEIGHT - 24) / height);
  const offsetX = (MINIMAP_WIDTH - width * scale) / 2 - left * scale;
  const offsetY = (MINIMAP_HEIGHT - height * scale) / 2 - top * scale;
  return { visible, scale, offsetX, offsetY };
}
export function minimapPan(point: { x: number; y: number }, map: ReturnType<typeof minimapGeometry>, viewport: BoardViewport, frame: BoardFrameSize): BoardViewport {
  return { ...viewport, panX: frame.width / 2 - (point.x - map.offsetX) / map.scale * viewport.zoom, panY: frame.height / 2 - (point.y - map.offsetY) / map.scale * viewport.zoom };
}
