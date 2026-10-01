import { clampBoardZoom } from './board-fabric-object';

/** Coordinates are CSS pixels relative to the canvas, never world coordinates. */
export type BoardPinchPoint = Readonly<{ pointerId: number; x: number; y: number }>;
export type PinchViewport = Readonly<{ zoom: number; panX: number; panY: number }>;
export type BoardPinchSession = Readonly<{
  pointerIds: readonly [number, number]; distance: number; initialZoom: number;
  worldAnchor: Readonly<{ x: number; y: number }>;
}>;
function pair(points: readonly BoardPinchPoint[]) {
  const [a, b] = points;
  if (points.length !== 2 || !a || !b || a.pointerId === b.pointerId ||
      ![a.pointerId,b.pointerId,a.x,a.y,b.x,b.y].every(Number.isFinite)) return null;
  const distance = Math.hypot(b.x-a.x,b.y-a.y);
  const x = a.x/2+b.x/2, y = a.y/2+b.y/2;
  return distance > 0 && [distance,x,y].every(Number.isFinite) ? {a,b,distance,x,y} : null;
}
export function beginBoardPinch(points: readonly BoardPinchPoint[], viewport: PinchViewport): BoardPinchSession | null {
  const p = pair(points);
  if (!p || ![viewport.zoom,viewport.panX,viewport.panY].every(Number.isFinite) || viewport.zoom <= 0) return null;
  const x = (p.x-viewport.panX)/viewport.zoom, y = (p.y-viewport.panY)/viewport.zoom;
  if (![x,y].every(Number.isFinite)) return null;
  return {pointerIds:[p.a.pointerId,p.b.pointerId],distance:p.distance,initialZoom:viewport.zoom,worldAnchor:{x,y}};
}
/** Null ends the gesture: no stale session may resume after cancel, replacement or finger loss.
 * Integration must suspend single-pointer pan/draw until a NEW pointerdown after pinch ends.
 */
export function updateBoardPinch(session: BoardPinchSession | null, points: readonly BoardPinchPoint[], cancelled = false): {session: BoardPinchSession; viewport: PinchViewport} | null {
  const p = pair(points);
  if (cancelled || !session || !p || !session.pointerIds.includes(p.a.pointerId) || !session.pointerIds.includes(p.b.pointerId) ||
      ![session.distance,session.initialZoom,session.worldAnchor.x,session.worldAnchor.y].every(Number.isFinite) || session.distance<=0 || session.initialZoom<=0) return null;
  const requestedZoom = session.initialZoom*(p.distance/session.distance);
  if (!Number.isFinite(requestedZoom) || requestedZoom <= 0) return null;
  const zoom = clampBoardZoom(requestedZoom);
  const panX = p.x-session.worldAnchor.x*zoom, panY = p.y-session.worldAnchor.y*zoom;
  if (![zoom,panX,panY].every(Number.isFinite)) return null;
  return {session,viewport:{zoom,panX,panY}};
}
