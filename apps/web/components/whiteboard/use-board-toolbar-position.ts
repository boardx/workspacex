"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { BoardViewport } from "./fabric/board-fabric-object";

type Geometry = { x: number; y: number; width: number; height: number };
type Rect = Geometry;
type Size = { width: number; height: number };
const EDGE = 16;
const HEADER = 72;
const DOCK = 112;
const GAP = 12;

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** Geometry, obstacles and returned style all use the toolbar's offset-parent coordinates. */
export function boardToolbarPosition(geometry: Geometry, viewport: BoardViewport, windowSize: Size, toolbarSize: Size, chrome: readonly Rect[] = []): CSSProperties {
  const maxWidth = Math.max(1, windowSize.width - EDGE * 2);
  const width = Math.min(toolbarSize.width, maxWidth);
  const height = Math.min(toolbarSize.height, Math.max(1, windowSize.height - EDGE * 2));
  const minTop = Math.min(HEADER, Math.max(EDGE, windowSize.height - height - EDGE));
  const maxTop = Math.max(minTop, windowSize.height - DOCK - height);
  const object = { x: geometry.x * viewport.zoom + viewport.panX, y: geometry.y * viewport.zoom + viewport.panY, width: geometry.width * viewport.zoom, height: geometry.height * viewport.zoom };
  const centered = object.x + (object.width - width) / 2;
  const clamp = (x: number, y: number): Rect => ({ x: Math.max(EDGE, Math.min(windowSize.width - width - EDGE, x)), y: Math.max(minTop, Math.min(maxTop, y)), width, height });
  const preferred = clamp(centered, object.y - height - GAP >= minTop ? object.y - height - GAP : object.y + object.height + GAP);
  const candidates = [preferred, clamp(centered, object.y + object.height + GAP), clamp(object.x + object.width + GAP, object.y), clamp(object.x - width - GAP, object.y)];
  // Every obstacle edge contributes a candidate. This handles chrome relocation and
  // font/viewport changes without duplicating control dimensions in the layout model.
  const anchors = [...candidates];
  for (const obstacle of chrome) {
    for (const point of anchors) {
      candidates.push(clamp(obstacle.x + obstacle.width + GAP, point.y), clamp(obstacle.x - width - GAP, point.y), clamp(point.x, obstacle.y + obstacle.height + GAP), clamp(point.x, obstacle.y - height - GAP));
    }
  }
  candidates.push(clamp(EDGE, minTop), clamp(windowSize.width - width - EDGE, minTop), clamp(EDGE, maxTop), clamp(windowSize.width - width - EDGE, maxTop));
  const score = (rect: Rect) => ({ chrome: chrome.reduce((sum, obstacle) => sum + overlapArea(rect, obstacle), 0), object: overlapArea(rect, object), distance: Math.hypot(rect.x - preferred.x, rect.y - preferred.y) });
  candidates.sort((a, b) => { const sa = score(a), sb = score(b); return sa.chrome - sb.chrome || sa.object - sb.object || sa.distance - sb.distance; });
  const position = candidates[0]!;
  return { left: position.x, top: position.y, maxWidth, maxHeight: Math.max(1, windowSize.height - minTop - EDGE) };
}

export function useBoardToolbarPosition(geometry: Geometry | undefined, viewport: BoardViewport) {
  const ref = useRef<HTMLElement>(null);
  const [windowSize, setWindowSize] = useState<Size>({ width: 1024, height: 768 });
  const [chrome, setChrome] = useState<Rect[]>([]);
  const [toolbarSize, setToolbarSize] = useState<Size>({ width: 460, height: 54 });
  useLayoutEffect(() => {
    const update = () => {
      const parent = ref.current?.offsetParent ?? ref.current?.closest('[data-testid="collaborative-editor"]');
      const frame = parent?.getBoundingClientRect();
      setWindowSize({ width: frame?.width || window.innerWidth, height: frame?.height || window.innerHeight });
      const boundsInFrame = Array.from(document.querySelectorAll<HTMLElement>("[data-board-chrome]")).map((element) => { const rect = element.getBoundingClientRect(); return { x: rect.left - (frame?.left ?? 0), y: rect.top - (frame?.top ?? 0), width: rect.width, height: rect.height }; }).filter((rect) => rect.width > 0 && rect.height > 0);
      setChrome((current) => JSON.stringify(current) === JSON.stringify(boundsInFrame) ? current : boundsInFrame);
      const bounds = ref.current?.getBoundingClientRect();
      if (bounds && bounds.width > 0 && bounds.height > 0) setToolbarSize((current) => current.width === bounds.width && current.height === bounds.height ? current : { width: bounds.width, height: bounds.height });
    };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (ref.current) observer?.observe(ref.current);
    document.querySelectorAll("[data-board-chrome]").forEach((element) => observer?.observe(element));
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [Boolean(geometry)]);
  return { ref, style: geometry ? boardToolbarPosition(geometry, viewport, windowSize, toolbarSize, chrome) : undefined };
}
