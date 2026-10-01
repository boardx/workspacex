"use client";

import { useCallback, useEffect, useRef, type PointerEvent, type MouseEvent, type RefObject } from "react";
import { clampBoardZoom, type BoardViewport } from "./fabric/board-fabric-object";

const overlaySelector = "[data-testid='board-connector-handles'],[data-testid^='connector-handle-']";

function isCanvasOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && !target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']") && Boolean(target.closest(overlaySelector));
}

/** DOM canvas controls must preserve secondary-button viewport navigation. */
export function useBoardOverlayNavigation(viewport: BoardViewport, onChange: (viewport: BoardViewport, source: "pan" | "wheel") => void, host: RefObject<HTMLElement | null>) {
  const latest = useRef({ viewport, onChange });
  latest.current = { viewport, onChange };
  const publish = useCallback((next: BoardViewport, source: "pan" | "wheel") => {
    // Native wheel bursts may arrive before React commits the preceding update.
    latest.current.viewport = next;
    latest.current.onChange(next, source);
  }, []);
  const session = useRef<{ pointerId: number; x: number; y: number; initial: BoardViewport; host: HTMLElement } | null>(null);
  const release = useCallback(() => {
    const previous = session.current;
    session.current = null;
    if (previous?.host.hasPointerCapture?.(previous.pointerId)) previous.host.releasePointerCapture(previous.pointerId);
  }, []);
  const cancel = useCallback(() => {
    const previous = session.current;
    release();
    if (previous) publish(previous.initial, "pan");
  }, [publish, release]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("blur", cancel);
    document.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("blur", cancel); document.removeEventListener("keydown", onKey, true); release(); };
  }, [cancel, release]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!isCanvasOverlay(event.target) || ![event.deltaX, event.deltaY].every(Number.isFinite)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (session.current) return;
      const initial = latest.current.viewport;
      const stage = element.querySelector<HTMLElement>("[data-testid='board-live-surface']") ?? element;
      const rect = stage.getBoundingClientRect();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight || rect.height || 720 : 1;
      if (!event.ctrlKey && !event.metaKey) {
        publish({ ...initial, panX: initial.panX-event.deltaX*scale, panY: initial.panY-event.deltaY*scale }, "pan");
        return;
      }
      if (![event.clientX, event.clientY].every(Number.isFinite)) return;
      const zoom = clampBoardZoom(initial.zoom*Math.pow(.998, event.deltaY*scale));
      const x = event.clientX-rect.left, y = event.clientY-rect.top;
      const sceneX = (x-initial.panX)/initial.zoom, sceneY = (y-initial.panY)/initial.zoom;
      publish({ ...initial, zoom, panX: x-sceneX*zoom, panY: y-sceneY*zoom }, "wheel");
    };
    element.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => element.removeEventListener("wheel", wheel, true);
  }, [host, publish]);
  const move = (event: PointerEvent<HTMLElement>) => {
    const previous = session.current;
    if (!previous || previous.pointerId !== event.pointerId || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
    publish({ ...previous.initial, panX: previous.initial.panX + event.clientX - previous.x, panY: previous.initial.panY + event.clientY - previous.y }, "pan");
  };
  return { events: {
    onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
      if (session.current || (event.button !== 1 && event.button !== 2) || !isCanvasOverlay(event.target) || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
      event.preventDefault();
      event.stopPropagation();
      session.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, initial: latest.current.viewport, host: event.currentTarget };
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Native pointer may have ended before capture. */ }
      return true;
    },
    onPointerMoveCapture: move,
    onPointerUpCapture: (event: PointerEvent<HTMLElement>) => { if (session.current?.pointerId === event.pointerId) { move(event); release(); } },
    onPointerCancelCapture: (event: PointerEvent<HTMLElement>) => { if (session.current?.pointerId === event.pointerId) { event.stopPropagation(); cancel(); } },
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => { if (session.current?.pointerId === event.pointerId) cancel(); },
    onContextMenuCapture: (event: MouseEvent<HTMLElement>) => { if (isCanvasOverlay(event.target)) event.preventDefault(); },
  } };
}
