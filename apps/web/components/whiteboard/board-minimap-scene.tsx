"use client";

import type { ReactNode, SVGProps } from "react";
import { MINIMAP_HEIGHT, MINIMAP_WIDTH, type MinimapObject, type minimapGeometry } from "./board-minimap-geometry";

export type BoardMinimapSceneProps = SVGProps<SVGSVGElement> & {
  objects: readonly MinimapObject[];
  map: ReturnType<typeof minimapGeometry>;
  children?: ReactNode;
};

/** Shared object projection; callers own navigation and viewport/placement overlays. */
export function BoardMinimapScene({ objects, map, children, ...svgProps }: BoardMinimapSceneProps) {
  return <svg {...svgProps} viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`} preserveAspectRatio="none">
    {objects.filter(object => !object.hidden).map(object => <rect key={object.id} x={object.geometry.x * map.scale + map.offsetX} y={object.geometry.y * map.scale + map.offsetY} width={Math.max(2, object.geometry.width * map.scale)} height={Math.max(2, object.geometry.height * map.scale)} transform={`rotate(${object.geometry.rotation} ${object.geometry.x * map.scale + map.offsetX} ${object.geometry.y * map.scale + map.offsetY})`} fill={object.style.fill ?? "#a1a1aa"} stroke={object.style.stroke ?? "#a1a1aa"} strokeWidth={0.5} opacity={0.8} rx={object.kind === "ellipse" ? 20 : 1} />)}
    {!objects.some(object => !object.hidden) && <text x="120" y="80" textAnchor="middle" className="fill-muted-foreground text-12">空白画布</text>}
    {children}
  </svg>;
}
