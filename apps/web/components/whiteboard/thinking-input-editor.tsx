"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { beginComposition, beginTextInput, commitComposition, scenePointFromLocal, updateTextInput, type TextInputIntent } from "@repo/whiteboard-core";
import { BOARD_FABRIC_VISUAL } from "./fabric/board-fabric-visual";
import type { BoardFabricObject, BoardViewport } from "./fabric/board-fabric-object";
import { fabricStickyTextMeasure, layoutStickyText, stickyMinimumFontSize } from "./fabric/sticky-text-layout";
import { useStickyFontRevision } from "./use-sticky-font-revision";

interface ThinkingInputEditorProps {
  object: Pick<BoardFabricObject, "id" | "kind" | "geometry" | "style" | "sticky">;
  initialValue: string;
  viewport: BoardViewport;
  readOnly: boolean;
  onLiveCommit: (value: string) => boolean;
  onCommit: (value: string, reason: "blur" | "enter" | "tab") => boolean;
  onCancel: () => void;
  onContinue: (value: string) => void;
  onPreserveDraft?: (value: string) => void;
}

function estimatedLineCount(value: string, contentWidth: number, fontSize: number): number {
  const columns = Math.max(1, Math.floor(contentWidth / (fontSize * .72)));
  return Math.max(1, value.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil([...line].length / columns)), 0));
}

export function ThinkingInputEditor({ object, initialValue, viewport, readOnly, onLiveCommit, onCommit, onCancel, onContinue, onPreserveDraft }: ThinkingInputEditorProps) {
  const [intent, setIntent] = useState<TextInputIntent>(() => beginTextInput(initialValue));
  const intentRef = useRef(intent);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suppressCompositionChangeRef = useRef<string | null>(null);
  const liveCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLiveValueRef = useRef<string | null>(null);
  const acceptedValueRef = useRef(initialValue);
  const initialValueRef = useRef(initialValue);
  const preserveDraftRef = useRef(onPreserveDraft);
  preserveDraftRef.current = onPreserveDraft;
  intentRef.current = intent;
  useEffect(() => {
    // Creation starts from Fabric's pointer-down callback. Focusing during that
    // same pointer dispatch lets the browser/Fabric restore focus to the canvas
    // afterwards, which immediately blurs and closes the editor. Enter editing
    // on the next frame so the caret owns the final focus, like a paper note.
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [object.id]);
  useEffect(() => () => {
    if (liveCommitTimerRef.current) clearTimeout(liveCommitTimerRef.current);
    if (intentRef.current.draft !== acceptedValueRef.current) preserveDraftRef.current?.(intentRef.current.draft);
  }, []);
  useEffect(() => {
    const previous = initialValueRef.current;
    initialValueRef.current = initialValue;
    setIntent((current) => {
      if (current.composition || current.draft !== previous) return current;
      acceptedValueRef.current = initialValue;
      const next = beginTextInput(initialValue); intentRef.current = next; return next;
    });
  }, [initialValue]);
  useEffect(() => {
    if (!readOnly) return;
    if (liveCommitTimerRef.current) clearTimeout(liveCommitTimerRef.current);
    liveCommitTimerRef.current = null;
    pendingLiveValueRef.current = null;
    if (intentRef.current.draft !== acceptedValueRef.current) preserveDraftRef.current?.(intentRef.current.draft);
    onCancel();
  }, [readOnly, onCancel]);
  const cancelScheduledLiveCommit = () => {
    if (liveCommitTimerRef.current) clearTimeout(liveCommitTimerRef.current);
    liveCommitTimerRef.current = null;
    pendingLiveValueRef.current = null;
  };
  const flushScheduledLiveCommit = () => {
    const value = pendingLiveValueRef.current;
    cancelScheduledLiveCommit();
    if (value !== null) {
      if (onLiveCommit(value)) acceptedValueRef.current = value;
      else preserveDraftRef.current?.(value);
    }
  };
  const scheduleLiveCommit = (value: string) => {
    if (liveCommitTimerRef.current) clearTimeout(liveCommitTimerRef.current);
    pendingLiveValueRef.current = value;
    liveCommitTimerRef.current = setTimeout(flushScheduledLiveCommit, 100);
  };
  const finish = (reason: "blur" | "enter" | "tab") => {
    if (intentRef.current.composition) return false;
    cancelScheduledLiveCommit();
    const value = intentRef.current.draft, accepted = onCommit(value, reason);
    if (accepted) acceptedValueRef.current = value;
    else preserveDraftRef.current?.(value);
    return accepted;
  };
  const { geometry, style } = object;
  const fontRevision = useStickyFontRevision();
  const measureStickyText = useMemo(() => { void fontRevision; return fabricStickyTextMeasure({ fontFamily: style.fontFamily ?? BOARD_FABRIC_VISUAL.fontFamily, fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? "italic" : "normal", lineHeight: style.lineHeight ?? 1.3 }); }, [style.fontFamily, style.bold, style.italic, style.lineHeight, fontRevision]);
  const zoom = viewport.zoom;
  const sticky = object.kind === "sticky";
  const inset = sticky ? BOARD_FABRIC_VISUAL.sticky.padding : object.kind === "text" ? 0 : 16;
  const nominalFontSize = style.fontSize ?? (object.kind === "text" ? 24 : 20);
  const stickyLayout = sticky ? layoutStickyText({ text: intent.draft, width: geometry.width, height: geometry.height, variant: object.sticky?.variant ?? "square", padding: inset, fontSize: nominalFontSize, minimumFontSize: stickyMinimumFontSize(), verticalAlignment: style.verticalAlignment }, measureStickyText) : null;
  const fontSize = stickyLayout?.fontSize ?? nominalFontSize;
  const lineHeight = style.lineHeight ?? 1.3;
  const contentWidth = stickyLayout?.width ?? Math.max(fontSize, geometry.width - inset * 2);
  const textHeight = stickyLayout?.measuredHeight ?? estimatedLineCount(intent.draft, contentWidth, fontSize) * fontSize * lineHeight;
  const contentHeight = stickyLayout ? Math.min(stickyLayout.measuredHeight, stickyLayout.height) : Math.min(textHeight, Math.max(fontSize * lineHeight, geometry.height - inset * 2));
  const verticalAlignment = object.kind === "text" ? "top" : style.verticalAlignment ?? "middle";
  const verticalSpace = Math.max(inset, geometry.height - contentHeight - inset);
  const textTop = verticalAlignment === "bottom" ? verticalSpace : verticalAlignment === "middle" ? Math.max(inset, (geometry.height - contentHeight) / 2) : inset;
  const position = scenePointFromLocal(geometry, stickyLayout ? { x: (geometry.width - stickyLayout.width) / 2, y: stickyLayout.overflow ? (geometry.height - stickyLayout.height) / 2 : geometry.height / 2 + stickyLayout.top - contentHeight / 2 } : { x: inset, y: textTop });
  return <textarea
    ref={inputRef}
    data-testid="board-thinking-editor"
    aria-label="对象文字"
    disabled={readOnly}
    value={intent.draft}
    onChange={(event) => {
      const next = updateTextInput(intentRef.current, event.target.value);
      intentRef.current = next;
      setIntent(next);
      if (suppressCompositionChangeRef.current === next.draft) suppressCompositionChangeRef.current = null;
      else if (!next.composition) scheduleLiveCommit(next.draft);
    }}
    onCompositionStart={() => { flushScheduledLiveCommit(); suppressCompositionChangeRef.current = null; const next = beginComposition(intentRef.current); intentRef.current = next; setIntent(next); }}
    onCompositionEnd={(event) => {
      const value = event.currentTarget.value;
      const next = commitComposition(updateTextInput(intentRef.current, value), value);
      intentRef.current = next;
      setIntent(next);
      suppressCompositionChangeRef.current = next.draft;
      cancelScheduledLiveCommit();
      if (onLiveCommit(next.draft)) acceptedValueRef.current = next.draft;
      else preserveDraftRef.current?.(next.draft);
    }}
    onBlur={() => { if (!intentRef.current.composition) finish("blur"); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || intentRef.current.composition) return;
      if (event.key === "Escape") { event.preventDefault(); flushScheduledLiveCommit(); onCancel(); return; }
      if (event.key === "Tab") { event.preventDefault(); if (finish("tab")) onContinue(intentRef.current.draft); return; }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); finish("enter"); }
    }}
    className="absolute z-40 m-0 appearance-none resize-none border-0 bg-transparent p-0 shadow-none outline-none focus-visible:outline-none focus-visible:ring-0"
    style={{
      boxSizing: "border-box",
      left: position.x * zoom + viewport.panX,
      top: position.y * zoom + viewport.panY,
      width: Math.max(1, contentWidth * zoom),
      height: Math.max(1, contentHeight * zoom),
      transform: `rotate(${geometry.rotation}deg)`,
      transformOrigin: "0 0",
      borderRadius: sticky ? BOARD_FABRIC_VISUAL.sticky.radius * zoom : 0,
      padding: 0,
      overflow: textHeight > contentHeight ? "auto" : "hidden",
      fontFamily: style.fontFamily ?? BOARD_FABRIC_VISUAL.fontFamily,
      fontSize: fontSize * zoom,
      fontWeight: style.bold ? 700 : 400,
      fontStyle: style.italic ? "italic" : "normal",
      textDecoration: style.underline ? "underline" : "none",
      textAlign: style.alignment ?? (sticky ? "center" : "left"),
      lineHeight,
      color: style.textColor,
      caretColor: style.textColor,
    }}
  />;
}
