"use client";
import { useRef, type PointerEvent } from "react";
import type { MinimapObject } from "./board-minimap-geometry";
import type { BoardViewport } from "./fabric/board-fabric-object";
import type { BoardFrameSize } from "./use-board-frame";
import { minimapGeometry, minimapPan, MINIMAP_HEIGHT, MINIMAP_WIDTH } from "./board-minimap-geometry";

export function BoardMinimap({ objects, viewport, frame, onViewportChange }: { objects: readonly MinimapObject[]; viewport: BoardViewport; frame: BoardFrameSize; onViewportChange: (next: BoardViewport) => void }) {
  const map = minimapGeometry(objects, viewport, frame);
  const dragging = useRef<number | null>(null);
  const dragMap = useRef(map);
  const navigate = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    onViewportChange(minimapPan({ x: (event.clientX - bounds.left) / bounds.width * MINIMAP_WIDTH, y: (event.clientY - bounds.top) / bounds.height * MINIMAP_HEIGHT }, dragMap.current, viewport, frame));
  };
  return <svg data-testid="board-minimap" aria-label="白板缩略图，点击或拖动定位" role="application" tabIndex={0} viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`} preserveAspectRatio="none" className="aspect-[3/2] h-auto w-60 max-w-full touch-none rounded-xl border border-border bg-panel-alt outline-none focus-visible:ring-2 focus-visible:ring-ring" onPointerDown={event => { if (event.button !== 0) return; event.stopPropagation(); dragging.current = event.pointerId; dragMap.current = map; event.currentTarget.setPointerCapture?.(event.pointerId); navigate(event); }} onPointerMove={event => { if (dragging.current === event.pointerId) { event.stopPropagation(); navigate(event); } }} onPointerUp={event => { dragging.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId); }} onPointerCancel={() => { dragging.current = null; }} onLostPointerCapture={() => { dragging.current = null; }} onKeyDown={event => { const moves: Record<string, [number, number]> = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] }; const move = moves[event.key]; if (!move) return; event.preventDefault(); event.stopPropagation(); onViewportChange({ ...viewport, panX: viewport.panX + move[0], panY: viewport.panY + move[1] }); }}>
    {objects.filter(object => !object.hidden).map(object => <rect key={object.id} x={object.geometry.x * map.scale + map.offsetX} y={object.geometry.y * map.scale + map.offsetY} width={Math.max(2, object.geometry.width * map.scale)} height={Math.max(2, object.geometry.height * map.scale)} transform={`rotate(${object.geometry.rotation} ${object.geometry.x * map.scale + map.offsetX} ${object.geometry.y * map.scale + map.offsetY})`} fill={object.style.fill ?? "#a1a1aa"} stroke={object.style.stroke ?? "#a1a1aa"} strokeWidth={0.5} opacity={0.8} rx={object.kind === "ellipse" ? 20 : 1} />)}
    {!objects.some(object => !object.hidden) && <text x="120" y="80" textAnchor="middle" className="fill-muted-foreground text-12">空白画布</text>}
    <rect data-testid="board-minimap-viewport" x={map.visible.x * map.scale + map.offsetX} y={map.visible.y * map.scale + map.offsetY} width={map.visible.width * map.scale} height={map.visible.height * map.scale} fill="currentColor" fillOpacity={0.06} stroke="currentColor" strokeWidth={2} className="text-primary" />
  </svg>;
}
