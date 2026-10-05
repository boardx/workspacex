import type { WhiteboardObject } from "@repo/whiteboard-core";
/** Distance is measured on screen so the useful neighborhood stays constant while zooming. */
export function nearbyStickyPlacement(point: {x:number;y:number}, objects: readonly WhiteboardObject[], zoom: number, gap = 24): { source: WhiteboardObject; geometry: WhiteboardObject["geometry"] } | null {
  const candidates = objects.filter(object => object.kind === "sticky" && !object.hidden && !object.locked && object.geometry.rotation === 0).map(source => {
    const g = source.geometry;
    const dx = Math.max(g.x-point.x, 0, point.x-g.x-g.width), dy = Math.max(g.y-point.y, 0, point.y-g.y-g.height);
    return {source, distance: Math.hypot(dx,dy)*zoom};
  }).filter(value => value.distance > 0 && value.distance <= 120).sort((a,b) => a.distance-b.distance);
  for (const {source} of candidates) {
    const g=source.geometry, dx=(point.x-g.x-g.width/2)/g.width, dy=(point.y-g.y-g.height/2)/g.height;
    const geometry={...g, x:g.x, y:g.y};
    if(Math.abs(dx)>=Math.abs(dy)) geometry.x += Math.sign(dx)*(g.width+gap); else geometry.y += Math.sign(dy)*(g.height+gap);
    if(objects.some(object => !object.hidden && object.geometry.x < geometry.x+geometry.width && object.geometry.x+object.geometry.width > geometry.x && object.geometry.y < geometry.y+geometry.height && object.geometry.y+object.geometry.height > geometry.y)) continue;
    return {source,geometry};
  }
  return null;
}
