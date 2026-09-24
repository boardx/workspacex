'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { readObjects, WhiteboardUndo, type WhiteboardCommand } from '@repo/whiteboard-core';
/** Only local commands enter this origin's undo history; the host owns doc and transport. */
export function useWhiteboardDocument(doc: Y.Doc, readOnly: boolean) {
  const [objects, setObjects] = useState(() => readObjects(doc));
  const undo = useRef<WhiteboardUndo | null>(null);
  useEffect(() => { const update = () => setObjects(readObjects(doc)); update(); doc.on('update', update); return () => { doc.off('update', update); }; }, [doc]);
  useEffect(() => { const local = new WhiteboardUndo(doc); undo.current = local; return () => { local.destroy(); if (undo.current === local) undo.current = null; }; }, [doc]);
  return { objects, execute(commands: WhiteboardCommand[]) { if (!readOnly && commands.length) undo.current?.execute(commands); },
    undo: () => readOnly ? 'empty' : undo.current?.undo() ?? 'empty', redo: () => !readOnly && (undo.current?.redo() ?? false) };
}
export function textSplice(before: string, after: string) {
  let start = 0; while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0; while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { index: start, deleteCount: before.length - start - end, insert: after.slice(start, after.length - end) };
}
