"use client";

import { useEffect, useRef, useState } from "react";
import { beginComposition, beginTextInput, commitComposition, updateTextInput, type TextInputIntent } from "@repo/whiteboard-core";
import { BOARD_FABRIC_VISUAL } from "./fabric/board-fabric-visual";
import type { BoardFabricObject, BoardViewport } from "./fabric/board-fabric-object";

interface ThinkingInputEditorProps {
  object: Pick<BoardFabricObject, "id" | "kind" | "geometry" | "style">;
  initialValue: string;
  viewport: BoardViewport;
  readOnly: boolean;
  onLiveCommit: (value: string) => boolean;
  onCommit: (value: string, reason: "blur" | "enter" | "tab") => boolean;
  onCancel: () => void;
  onContinue: (value: string) => void;
}

function estimatedLineCount(value: string, contentWidth: number, fontSize: number): number {
  const columns = Math.max(1, Math.floor(contentWidth / (fontSize * .72)));
  return Math.max(1, value.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil([...line].length / columns)), 0));
}

export function ThinkingInputEditor({ object, initialValue, viewport, readOnly, onLiveCommit, onCommit, onCancel, onContinue }: ThinkingInputEditorProps) {
  const [intent, setIntent] = useState<TextInputIntent>(() => beginTextInput(initialValue));
  const intentRef = useRef(intent);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suppressCompositionChangeRef = useRef<string | null>(null);
  const liveCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLiveValueRef = useRef<string | null>(null);
  intentRef.current = intent;
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, [object.id]);
  useEffect(() => () => { if (liveCommitTimerRef.current) clearTimeout(liveCommitTimerRef.current); }, []);
  useEffect(() => {
    setIntent((current) => current.composition || current.draft === initialValue ? current : beginTextInput(initialValue));
  }, [initialValue]);
  const cancelScheduledLiveCommit = () => {
    if (liveCommitTimerRef.current) clearTimeout(liveCommitTimerRef.current);
    liveCommitTimerRef.current = null;
    pendingLiveValueRef.current = null;
  };
  const flushScheduledLiveCommit = () => {
    const value = pendingLiveValueRef.current;
    cancelScheduledLiveCommit();
    if (value !== null) onLiveCommit(value);
  };
  const scheduleLiveCommit = (value: string) => {
    if (liveCommitTimerRef.current) clearTimeout(liveCommitTimerRef.current);
    pendingLiveValueRef.current = value;
    liveCommitTimerRef.current = setTimeout(flushScheduledLiveCommit, 100);
  };
  const finish = (reason: "blur" | "enter" | "tab") => {
    if (intentRef.current.composition) return false;
    cancelScheduledLiveCommit();
    return onCommit(intentRef.current.draft, reason);
  };
  const { geometry, style } = object;
  const zoom = viewport.zoom;
  const sticky = object.kind === "sticky";
  const inset = sticky ? BOARD_FABRIC_VISUAL.sticky.padding : object.kind === "text" ? 0 : 16;
  const fontSize = style.fontSize ?? (object.kind === "text" ? 24 : 20);
  const lineHeight = style.lineHeight ?? 1.3;
  const contentWidth = Math.max(fontSize, geometry.width - inset * 2);
  const textHeight = estimatedLineCount(intent.draft, contentWidth, fontSize) * fontSize * lineHeight;
  const verticalAlignment = object.kind === "text" ? "top" : style.verticalAlignment ?? "middle";
  const verticalSpace = Math.max(inset, geometry.height - textHeight - inset);
  const paddingTop = verticalAlignment === "bottom" ? verticalSpace : verticalAlignment === "middle" ? Math.max(inset, (geometry.height - textHeight) / 2) : inset;
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
      onLiveCommit(next.draft);
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
      left: geometry.x * zoom + viewport.panX,
      top: geometry.y * zoom + viewport.panY,
      width: Math.max(1, geometry.width * zoom),
      height: Math.max(1, geometry.height * zoom),
      transform: `rotate(${geometry.rotation}deg)`,
      transformOrigin: "center center",
      borderRadius: sticky ? BOARD_FABRIC_VISUAL.sticky.radius * zoom : 0,
      paddingLeft: inset * zoom,
      paddingRight: inset * zoom,
      paddingTop: paddingTop * zoom,
      paddingBottom: inset * zoom,
      overflow: "hidden",
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
