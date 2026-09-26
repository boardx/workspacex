"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import * as Y from "yjs";
import { copyObjects, readObjects, type WhiteboardCommand, type WhiteboardObject } from "@repo/whiteboard-core";
import type { WhiteboardConnectionState } from "@/lib/whiteboard-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BoardFabricSurface } from "./fabric/board-fabric-surface";
import { clampBoardZoom, type BoardFabricTool, type BoardViewport } from "./fabric/board-fabric-object";
import { toBoardFabricObjects } from "./whiteboard-fabric-projection";
import { textSplice, useWhiteboardDocument } from "./use-whiteboard-document";

type Point = { x: number; y: number };
export interface CollaborativeEditorProps {
  boardId: string; clientId: string; doc: Y.Doc; readOnly: boolean; title: string; status: string;
  onTitleChange?: (title: string) => void; onBack?: () => void;
  onSelectionChange?: (ids: string[]) => void; onAwareness?: (cursor: Point | null, ids: string[]) => void;
  peers?: WhiteboardConnectionState["peers"]; currentUserId?: string;
}
function make(kind: WhiteboardObject["kind"], x: number, y: number): WhiteboardObject {
  return { id: crypto.randomUUID(), schemaVersion: 1, kind, geometry: { x, y, width: 180, height: 140, rotation: 0 }, text: "写下一个想法", style: {}, parentId: null, orderKey: "" };
}
export function CollaborativeEditor({ boardId, clientId, doc, readOnly, title, status, onTitleChange, onBack, onSelectionChange, onAwareness, peers = [], currentUserId }: CollaborativeEditorProps) {
  const model = useWhiteboardDocument(doc, readOnly);
  const objects = useMemo(() => toBoardFabricObjects(model.objects), [model.objects]);
  const visibleObjectIdKey = objects.map((object) => object.id).join("\u0000");
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<BoardFabricTool>("select");
  const [viewport, setViewport] = useState<BoardViewport>({ zoom: 1, panX: 0, panY: 0, fitRequest: 0, fitMode: "board" });
  const [notice, setNotice] = useState("");
  const clipboard = useRef<WhiteboardObject[]>([]);
  const suppressCompositionChange = useRef<string | null>(null);
  const composition = useRef<{ id: string; before: string } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [conflictedDraft, setConflictedDraft] = useState<string | null>(null);
  useEffect(() => { onSelectionChange?.(selected); onAwareness?.(null, selected); }, [onAwareness, onSelectionChange, selected]);
  useEffect(() => {
    const ids = new Set(visibleObjectIdKey ? visibleObjectIdKey.split("\u0000") : []);
    setSelected((current) => {
      const next = current.filter((id) => ids.has(id));
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [visibleObjectIdKey]);
  const object = model.objects.find((candidate) => selected.length === 1 && candidate.id === selected[0]);
  function execute(commands: WhiteboardCommand[], gestureId = crypto.randomUUID()): boolean {
    if (readOnly) return false;
    try {
      const accepted = model.execute({ boardId, clientId, gestureId, commands });
      if (!accepted) { setNotice("操作未应用：命令通道尚未就绪，请重试。"); return false; }
      setNotice(""); return true;
    } catch { setNotice("操作未应用：请检查对象是否仍存在或内容是否超出限制。"); return false; }
  }
  function create(kind: "sticky" | "text" | "rectangle" | "ellipse") {
    const object = make(kind, (180 - viewport.panX) / viewport.zoom, (160 - viewport.panY) / viewport.zoom);
    if (execute([{ type: "create", object }])) setSelected([object.id]);
  }
  function changeText(next: string) {
    if (!object || readOnly) return;
    if (suppressCompositionChange.current === next) { suppressCompositionChange.current = null; return; }
    suppressCompositionChange.current = null;
    if (composition.current) { setDraft(next); return; }
    const current = readObjects(doc).find((candidate) => candidate.id === object.id);
    if (current) execute([{ type: "text", id: current.id, ...textSplice(current.text, next) }]);
  }
  function announceCursor(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    onAwareness?.({ x: (event.clientX - bounds.left - viewport.panX) / viewport.zoom, y: (event.clientY - bounds.top - viewport.panY) / viewport.zoom }, selected);
  }
  return <section data-testid="collaborative-editor" className="fixed inset-0 overflow-hidden bg-background text-foreground">
    <div data-testid="board-live-surface" className="absolute inset-0" onPointerMove={announceCursor} onPointerLeave={() => onAwareness?.(null, selected)}>
      <BoardFabricSurface objects={objects} selectedObjectIds={selected} readOnly={readOnly} tool={tool} viewport={viewport}
        onSelectionChange={(ids) => setSelected([...ids])}
        onObjectTransform={(id, geometry) => execute([{ type: "geometry", id, geometry }], crypto.randomUUID())}
        onViewportChange={(next) => setViewport(next)} className="absolute inset-0 overflow-hidden bg-panel-alt" />
      <div className="pointer-events-none absolute inset-0 origin-top-left" style={{ transform: `translate(${viewport.panX}px,${viewport.panY}px) scale(${viewport.zoom})` }}>
        {peers.filter((peer) => peer.actorId !== currentUserId).map((peer) => <div key={peer.actorId}>
          {peer.selected.map((id) => { const item = model.objects.find((candidate) => candidate.id === id); if (!item) return null; const geometry = item.geometry; return <div key={id} data-testid={`peer-selection-${peer.actorId}-${id}`} className="absolute rounded-control border-2 border-dashed border-primary" style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height, transform: `rotate(${geometry.rotation}deg)` }} />; })}
          {peer.cursor ? <div data-testid={`peer-cursor-${peer.actorId}`} className="absolute text-primary" style={{ left: peer.cursor.x, top: peer.cursor.y }}><span aria-hidden="true">↖</span><span className="rounded-control bg-primary px-1 text-11 text-primary-foreground">{peer.actorId}</span></div> : null}
        </div>)}
      </div>
    </div>
    <header className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 p-3 backdrop-blur">
      {onBack ? <Button onClick={onBack}>返回白板</Button> : null}<Input aria-label="白板名称" className="max-w-64" value={title} disabled={readOnly || !onTitleChange} onChange={(event) => { if (!readOnly) onTitleChange?.(event.target.value); }} /><span role="status" className="text-12">{status}{readOnly ? " · 只读" : ""}</span><span className="ml-auto text-12 text-muted-foreground">在线成员 {peers.length}</span>
    </header>
    <div className="absolute left-3 top-16 z-20 flex flex-col gap-1 rounded-xl border border-border bg-card p-1 shadow-lg">
      <Button data-testid="board-tool-select" onClick={() => setTool("select")} aria-pressed={tool === "select"}>选择</Button><Button data-testid="board-tool-hand" onClick={() => setTool("hand")} aria-pressed={tool === "hand"}>平移</Button>
      {(["sticky", "text", "rectangle", "ellipse"] as const).map((kind) => <Button key={kind} data-testid={`board-add-${kind}`} disabled={readOnly} onClick={() => create(kind)}>{({ sticky: "便利贴", text: "文字", rectangle: "矩形", ellipse: "椭圆" })[kind]}</Button>)}
      <Button disabled title="将在连接线迭代开放">连接</Button><Button disabled title="将在自由绘制迭代开放">画笔</Button>
    </div>
    <div className="absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-lg">
      <Button disabled={readOnly} onClick={() => { const result = model.undo(); setNotice(result === "undone" ? "已撤销本地修改" : result === "conflict" ? "未撤销：当前画板与这次修改存在冲突，请核对后再操作。" : result === "creation-requires-explicit-delete" ? "创建对象请使用删除；为保护其他人的修改，不撤销对象创建。" : "没有可撤销的本地修改。"); }}>撤销</Button><Button disabled={readOnly} onClick={() => { setNotice(model.redo() ? "已重做本地修改" : "未重做：没有可重做的本地修改，或当前画板存在冲突。"); }}>重做</Button>
      <Button disabled={!selected.length} onClick={() => { clipboard.current = copyObjects(doc, selected, () => crypto.randomUUID()); setNotice("已复制到当前白板剪贴板"); }}>复制</Button>
      <Button disabled={readOnly} onClick={() => { const ids = new Map(clipboard.current.map((entry) => [entry.id, crypto.randomUUID()])); const copied = clipboard.current.map((entry) => ({ ...entry, id: ids.get(entry.id)!, parentId: entry.parentId ? ids.get(entry.parentId) ?? null : null, connector: entry.connector ? { from: ids.get(entry.connector.from)!, to: ids.get(entry.connector.to)! } : undefined, geometry: { ...entry.geometry, x: entry.geometry.x + 30, y: entry.geometry.y + 30 } })); if (copied.length && execute(copied.map((entry) => ({ type: "create", object: entry })))) setSelected(copied.map((entry) => entry.id)); }}>粘贴</Button>
      <Button disabled={readOnly || !selected.length} onClick={() => { if (execute(selected.map((id) => ({ type: "delete", id })))) setSelected([]); }}>删除选中</Button>
      <Button data-testid="board-zoom-out" aria-label="缩小" onClick={() => setViewport((current) => ({ ...current, zoom: clampBoardZoom(current.zoom - .1) }))}>缩小</Button><span data-testid="board-zoom-value" className="w-14 text-center text-12">{Math.round(viewport.zoom * 100)}%</span><Button data-testid="board-zoom-in" aria-label="放大" onClick={() => setViewport((current) => ({ ...current, zoom: clampBoardZoom(current.zoom + .1) }))}>放大</Button>
      <Button data-testid="board-zoom-fit-selection" disabled={selected.length === 0} onClick={() => setViewport((current) => ({ ...current, fitMode: "selection", fitRequest: current.fitRequest + 1 }))}>适应选择</Button><Button data-testid="board-zoom-fit-board" onClick={() => setViewport((current) => ({ ...current, fitMode: "board", fitRequest: current.fitRequest + 1 }))}>适应白板</Button>
    </div>
    {object ? <aside className="absolute bottom-16 right-3 z-20 w-56 rounded-container border border-border bg-card p-3 shadow-lg"><label className="text-13">对象文字<Textarea key={object.id} aria-label="对象文字" disabled={readOnly} value={draft ?? object.text} onChange={(event) => changeText(event.target.value)} onCompositionStart={() => { composition.current = { id: object.id, before: object.text }; setDraft(object.text); }} onCompositionEnd={(event) => { const pending = composition.current; composition.current = null; suppressCompositionChange.current = event.currentTarget.value; const current = readObjects(doc).find((candidate) => candidate.id === pending?.id); if (current && current.text === pending?.before) { if (execute([{ type: "text", id: current.id, ...textSplice(current.text, event.currentTarget.value) }])) setDraft(null); } else { setConflictedDraft(event.currentTarget.value); setDraft(null); setNotice("输入期间对象已由其他人修改。已保留此次输入草稿，请核对后重新输入。"); } }} /></label>{conflictedDraft !== null ? <label className="text-12">未应用的输入草稿<Textarea aria-label="未应用的输入草稿" readOnly value={conflictedDraft} /><Button onClick={() => setConflictedDraft(null)}>关闭草稿</Button></label> : null}</aside> : null}
    <p role="status" className="absolute bottom-0 left-1/2 z-20 min-h-6 -translate-x-1/2 rounded-t-lg bg-background/90 px-3 text-12">{notice || `${selected.length} 个已选对象`}</p>
  </section>;
}
