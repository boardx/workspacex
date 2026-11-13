"use client";

import type { ReactNode, SVGProps } from "react";
import { MINIMAP_HEIGHT, MINIMAP_WIDTH, type MinimapObject, type minimapGeometry } from "./board-minimap-geometry";

export type BoardMinimapSceneProps = SVGProps<SVGSVGElement> & {
  objects: readonly MinimapObject[];
  map: ReturnType<typeof minimapGeometry>;
  children?: ReactNode;
  wireframe?: boolean;
};

/** Shared object projection; callers own navigation and viewport/placement overlays. */
export function BoardMinimapScene({ objects, map, children, wireframe, ...svgProps }: BoardMinimapSceneProps) {
  return <svg preserveAspectRatio="none" {...svgProps} viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`}>
    {objects.filter(object => !object.hidden).map(object => wireframe
      ? <WireframeObject key={object.id} object={object} map={map} />
      : <rect key={object.id} x={object.geometry.x * map.scale + map.offsetX} y={object.geometry.y * map.scale + map.offsetY} width={Math.max(2, object.geometry.width * map.scale)} height={Math.max(2, object.geometry.height * map.scale)} transform={`rotate(${object.geometry.rotation} ${object.geometry.x * map.scale + map.offsetX} ${object.geometry.y * map.scale + map.offsetY})`} fill={object.style.fill ?? "#a1a1aa"} stroke={object.style.stroke ?? "#a1a1aa"} strokeWidth={0.5} opacity={0.8} rx={object.kind === "ellipse" ? 20 : 1} />)}
    {!objects.some(object => !object.hidden) && <text x="120" y="80" textAnchor="middle" className="fill-muted-foreground text-12">空白画布</text>}
    {children}
  </svg>;
}

function WireframeObject({ object, map }: Pick<BoardMinimapSceneProps, "map"> & { object: MinimapObject }) {
  const { geometry, kind, style, text } = object;
  const x = geometry.x * map.scale + map.offsetX;
  const y = geometry.y * map.scale + map.offsetY;
  const width = geometry.width * map.scale;
  const height = geometry.height * map.scale;
  const transform = `translate(${x} ${y}) rotate(${geometry.rotation})`;
  const stroke = style.stroke ?? "currentColor";
  const fill = style.fill ?? "none";
  const outline = { fill, stroke, strokeWidth: 0.4 };
  const fontSize = Math.min(height * 0.7, 5);
  const label = text?.trim().split(/\r?\n/)[0];
  const labelLength = Math.floor(width / fontSize);
  return (
    <g transform={transform} className="text-muted-foreground">
      {kind === "text" ? (
        label && fontSize >= 2 && labelLength >= 2 ? (
          <text y={fontSize} fontSize={fontSize} fill="currentColor">
            {label.length > labelLength ? `${label.slice(0, labelLength - 1)}…` : label}
          </text>
        ) : (
          <line x2={width * 0.7} y1={height / 2} y2={height / 2} stroke="currentColor" strokeWidth={Math.min(0.6, height)} />
        )
      ) : kind === "ellipse" ? (
        <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...outline} />
      ) : (
        <rect width={width} height={height} {...outline} />
      )}
    </g>
  );
}
