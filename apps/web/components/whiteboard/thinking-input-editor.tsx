"use client";

import { useEffect, useRef, useState } from "react";
import { beginComposition, beginTextInput, commitComposition, updateTextInput, type TextInputIntent } from "@repo/whiteboard-core";
import type { BoardViewport } from "./fabric/board-fabric-object";

interface ThinkingInputEditorProps {
  objectId: string;
  initialValue: string;
  geometry: { x: number; y: number; width: number; height: number };
  viewport: BoardViewport;
  readOnly: boolean;
  onLiveCommit: (value: string) => boolean;
  onCommit: (value: string, reason: "blur" | "enter" | "tab") => boolean;
  onCancel: () => void;
  onContinue: (value: string) => void;
}

export function ThinkingInputEditor({ objectId, initialValue, geometry, viewport, readOnly, onLiveCommit, onCommit, onCancel, onContinue }: ThinkingInputEditorProps) {
  const [intent, setIntent] = useState<TextInputIntent>(() => beginTextInput(initialValue));
  const intentRef = useRef(intent);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suppressCompositionChangeRef = useRef<string | null>(null);
  intentRef.current = intent;
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, [objectId]);
  useEffect(() => {
    setIntent((current) => current.composition || current.draft === initialValue ? current : beginTextInput(initialValue));
  }, [initialValue]);
  const finish = (reason: "blur" | "enter" | "tab") => {
    if (intentRef.current.composition) return false;
    return onCommit(intentRef.current.draft, reason);
  };
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
      else if (!next.composition) onLiveCommit(next.draft);
    }}
    onCompositionStart={() => { suppressCompositionChangeRef.current = null; const next = beginComposition(intentRef.current); intentRef.current = next; setIntent(next); }}
    onCompositionEnd={(event) => {
      const value = event.currentTarget.value;
      const next = commitComposition(updateTextInput(intentRef.current, value), value);
      intentRef.current = next;
      setIntent(next);
      suppressCompositionChangeRef.current = next.draft;
      onLiveCommit(next.draft);
    }}
    onBlur={() => { if (!intentRef.current.composition) finish("blur"); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || intentRef.current.composition) return;
      if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
      if (event.key === "Tab") { event.preventDefault(); if (finish("tab")) onContinue(intentRef.current.draft); return; }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); finish("enter"); }
    }}
    className="absolute z-40 resize-none rounded-md border-2 border-primary bg-card/95 p-3 text-center text-18 text-foreground shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    style={{
      left: geometry.x * viewport.zoom + viewport.panX,
      top: geometry.y * viewport.zoom + viewport.panY,
      width: Math.max(96, geometry.width * viewport.zoom),
      height: Math.max(64, geometry.height * viewport.zoom),
      transform: `rotate(${0}deg)`,
    }}
  />;
}
