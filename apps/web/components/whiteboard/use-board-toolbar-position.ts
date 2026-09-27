"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { BoardViewport } from "./fabric/board-fabric-object";

type Geometry = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
const EDGE = 16;
const HEADER = 72;
const DOCK = 112;
const GAP = 12;

/** Both object toolbar paths use screen coordinates and the same reserved chrome area. */
export function boardToolbarPosition(geometry: Geometry, viewport: BoardViewport, windowSize: Size, toolbarSize: Size): CSSProperties {
  const maxWidth = Math.max(1, windowSize.width - EDGE * 2);
  const width = Math.min(toolbarSize.width, maxWidth);
  const height = Math.min(toolbarSize.height, Math.max(1, windowSize.height - EDGE * 2));
  const minTop = Math.min(HEADER, Math.max(EDGE, windowSize.height - height - EDGE));
  const maxTop = Math.max(minTop, windowSize.height - DOCK - height);
  const objectTop = geometry.y * viewport.zoom + viewport.panY;
  const objectBottom = (geometry.y + geometry.height) * viewport.zoom + viewport.panY;
  const above = objectTop - height - GAP;
  const preferredTop = above >= minTop ? above : objectBottom + GAP;
  return {
    left: Math.max(EDGE, Math.min(windowSize.width - width - EDGE, (geometry.x + geometry.width / 2) * viewport.zoom + viewport.panX - width / 2)),
    top: Math.max(minTop, Math.min(maxTop, preferredTop)),
    maxWidth,
    maxHeight: Math.max(1, windowSize.height - minTop - EDGE),
  };
}

export function useBoardToolbarPosition(geometry: Geometry | undefined, viewport: BoardViewport) {
  const ref = useRef<HTMLElement>(null);
  const [windowSize, setWindowSize] = useState<Size>({ width: 1024, height: 768 });
  const [toolbarSize, setToolbarSize] = useState<Size>({ width: 460, height: 54 });
  useLayoutEffect(() => {
    const update = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
      const bounds = ref.current?.getBoundingClientRect();
      if (bounds && bounds.width > 0 && bounds.height > 0) setToolbarSize((current) => current.width === bounds.width && current.height === bounds.height ? current : { width: bounds.width, height: bounds.height });
    };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (ref.current) observer?.observe(ref.current);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [Boolean(geometry)]);
  return { ref, style: geometry ? boardToolbarPosition(geometry, viewport, windowSize, toolbarSize) : undefined };
}
