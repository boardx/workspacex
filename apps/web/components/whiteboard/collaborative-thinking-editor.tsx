"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type PointerEvent } from "react";
import * as Y from "yjs";
import { DEFAULT_LAYOUT_GAP, SelectionLayoutCommandPort, copyObjects, createLayoutPreconditions, createStickyBatchEnvelope, nextStickyPlacement, parseBulkStickyLines, parseThinkingPaste, readObjects, validateTextAttributes, type BoardCommandEnvelope, type StickyVariant, type TextStylePreset, type WhiteboardCommand, type WhiteboardLayoutCommand, type WhiteboardLayoutKind, type WhiteboardObject } from "@repo/whiteboard-core";
import type { WhiteboardConnectionState } from "@/lib/whiteboard-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BoardBottomDock, type BoardCreationTool } from "./board-bottom-dock";
import { BoardFabricSurface } from "./fabric/board-fabric-surface";
import { clampBoardZoom, type BoardFabricTool, type BoardViewport } from "./fabric/board-fabric-object";
import { ThinkingInputEditor } from "./thinking-input-editor";
import { toBoardFabricObjects } from "./whiteboard-fabric-projection";
import { textSplice, useWhiteboardDocument } from "./use-whiteboard-document";

type Point = { x: number; y: number };
type EditSession = { id: string; initial: string };
type PasteChoice = { text: string; point: Point } | null;
type SmartLayoutSuggestion = "grid" | "cards" | "cluster" | "journey" | "mind-map" | "flow" | "timeline";
const SMART_LAYOUTS: readonly [SmartLayoutSuggestion, string][] = [["grid", "Grid"], ["cards", "Cards"], ["cluster", "Cluster"], ["journey", "Journey"], ["mind-map", "Mind Map"], ["flow", "Flow"], ["timeline", "Timeline"]];
export interface CollaborativeThinkingEditorProps { boardId: string; clientId: string; doc: Y.Doc; readOnly: boolean; title: string; status: string; onTitleChange?: (title: string) => void; onBack?: () => void; onSelectionChange?: (ids: string[]) => void; onAwareness?: (cursor: Point | null, ids: string[]) => void; peers?: WhiteboardConnectionState["peers"]; currentUserId?: string; }

const stickySize = (variant: StickyVariant) => variant === "rectangle" ? { width: 240, height: 150 } : { width: 180, height: 180 };
const centerPoint = (viewport: BoardViewport): Point => ({ x: (window.innerWidth / 2 - viewport.panX) / viewport.zoom, y: (window.innerHeight / 2 - viewport.panY) / viewport.zoom });
const topLeft = (point: Point, width: number, height: number) => ({ x: point.x - width / 2, y: point.y - height / 2, width, height, rotation: 0 });
const isEditableTarget = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function CollaborativeThinkingEditor({ boardId, clientId, doc, readOnly, title, status, onTitleChange, onBack, onSelectionChange, onAwareness, peers = [], currentUserId }: CollaborativeThinkingEditorProps) {
  const model = useWhiteboardDocument(doc, readOnly);
  const objects = useMemo(() => toBoardFabricObjects(model.objects), [model.objects]);
  const visibleObjectIdKey = objects.map((object) => object.id).join("\u0000");
  const [selected, setSelected] = useState<string[]>([]), [tool, setTool] = useState<BoardFabricTool>("select"), [creationTool, setCreationTool] = useState<BoardCreationTool>(null);
  const [viewport, setViewport] = useState<BoardViewport>({ zoom: 1, panX: 0, panY: 0, fitRequest: 0, fitMode: "board" });
  const [notice, setNotice] = useState(""), [editing, setEditing] = useState<EditSession | null>(null), [conflictedDraft, setConflictedDraft] = useState<string | null>(null);
  const [bulk, setBulk] = useState<string | null>(null), [pasteChoice, setPasteChoice] = useState<PasteChoice>(null);
  const [layoutGap, setLayoutGap] = useState(DEFAULT_LAYOUT_GAP), [layoutColumns, setLayoutColumns] = useState(3);
  const [layoutPreview, setLayoutPreview] = useState<{ id: string; suggestion: SmartLayoutSuggestion; geometries: Map<string, WhiteboardObject["geometry"]> } | null>(null);
  const displayObjects = useMemo(() => layoutPreview ? objects.map((object) => {
    const geometry = layoutPreview.geometries.get(object.id);
    return geometry ? { ...object, geometry, revision: object.revision + 1 } : object;
  }) : objects, [layoutPreview, objects]);
  const mutationBlocked = readOnly || Boolean(layoutPreview);
  const clipboard = useRef<WhiteboardObject[]>([]);
  const layoutPort = useMemo(() => new SelectionLayoutCommandPort(doc), [doc]);

  useEffect(() => { onSelectionChange?.(selected); onAwareness?.(null, selected); }, [onAwareness, onSelectionChange, selected]);
  useEffect(() => { const ids = new Set(visibleObjectIdKey ? visibleObjectIdKey.split("\u0000") : []); setSelected((current) => current.filter((id) => ids.has(id))); setEditing((current) => current && ids.has(current.id) ? current : null); }, [visibleObjectIdKey]);

  const dispatchEnvelope = useCallback((envelope: BoardCommandEnvelope): boolean => {
    if (mutationBlocked) { setNotice(layoutPreview ? "请先应用或取消当前布局预览。" : "当前白板为只读，不能修改。"); return false; }
    try { const accepted = model.execute(envelope); if (!accepted) { setNotice("操作未应用：命令通道尚未就绪，请重试。"); return false; } setNotice(""); return true; }
    catch { setNotice("操作未应用：请检查对象是否仍存在或内容是否超出限制。"); return false; }
  }, [layoutPreview, model, mutationBlocked]);
  const execute = useCallback((commands: WhiteboardCommand[], gestureId = crypto.randomUUID()) => dispatchEnvelope({ boardId, clientId, gestureId, commands }), [boardId, clientId, dispatchEnvelope]);
  const selectedObjects = useMemo(() => selected.flatMap((id) => {
    const object = model.objects.find((candidate) => candidate.id === id);
    return object ? [object] : [];
  }), [model.objects, selected]);
  const selectionLayoutDisabled = mutationBlocked || selectedObjects.length < 2 || selectedObjects.some((object) => object.locked || object.hidden || object.kind === "connector");
  const arrangeSelection = useCallback((kind: WhiteboardLayoutKind) => {
    if (selectionLayoutDisabled) return;
    try {
      const command: WhiteboardLayoutCommand = {
        type: "arrange-objects",
        kind,
        objectIds: [...selected],
        ...(kind === "grid" || kind === "tidy-up" ? { columns: layoutColumns } : {}),
        ...(["grid", "row", "column", "tidy-up"].includes(kind) ? { gap: layoutGap } : {}),
      };
      layoutPort.dispatch({
        boardId,
        clientId,
        gestureId: crypto.randomUUID(),
        command,
        preconditions: createLayoutPreconditions(model.objects, command),
        stateVector: Y.encodeStateVector(doc),
      });
      setNotice(`已${kind.startsWith("align-") ? "对齐" : kind.startsWith("distribute-") ? "等距分布" : "整理"} ${selected.length} 个对象。`);
    } catch (error) {
      const code = error instanceof Error ? error.message : "LAYOUT_FAILED";
      setNotice(code === "LAYOUT_CONFLICT" ? "布局未应用：对象已被其他协作者修改。" : code === "SELECTION_PARENT_BOUNDARY" ? "布局未应用：请选择同一容器内的对象。" : code === "DISTRIBUTION_REQUIRES_THREE" ? "等距分布至少需要 3 个对象。" : "布局未应用：选择中包含锁定对象或当前排列不可用。");
    }
  }, [boardId, clientId, doc, layoutColumns, layoutGap, layoutPort, model.objects, selected, selectionLayoutDisabled]);
  const previewSmartLayout = useCallback((suggestion: SmartLayoutSuggestion = "grid") => {
    if (selectionLayoutDisabled) return;
    const columns = Math.max(1, Math.ceil(Math.sqrt(selected.length)));
    const command: WhiteboardLayoutCommand = suggestion === "journey" || suggestion === "flow" || suggestion === "timeline"
      ? { type: "arrange-objects", kind: "row", objectIds: [...selected], gap: suggestion === "timeline" ? 80 : 48 }
      : suggestion === "cluster"
        ? { type: "arrange-objects", kind: "tidy-up", objectIds: [...selected], columns, gap: 48 }
        : { type: "arrange-objects", kind: "grid", objectIds: [...selected], columns: suggestion === "mind-map" ? 2 : suggestion === "cards" ? Math.min(3, columns) : columns, gap: suggestion === "mind-map" ? 72 : layoutGap };
    try {
      const preview = layoutPort.preview({ boardId, clientId, gestureId: crypto.randomUUID(), command, preconditions: createLayoutPreconditions(model.objects, command), stateVector: Y.encodeStateVector(doc) });
      setLayoutPreview({ id: preview.previewId, suggestion, geometries: new Map(preview.geometries.map(value => [value.id, value.geometry])) });
      setNotice("智能布局预览中；应用前不会写入白板。");
    } catch { setNotice("无法生成智能布局预览：对象已变化。"); }
  }, [boardId, clientId, doc, layoutGap, layoutPort, model.objects, selected, selectionLayoutDisabled]);
  const beginEditing = useCallback((id: string) => { const object = readObjects(doc).find((candidate) => candidate.id === id); if (!object) return; setSelected([id]); setEditing({ id, initial: object.text }); }, [doc]);

  const createStickyAt = useCallback((point: Point, variant: StickyVariant = "square", text = "") => {
    if (mutationBlocked) { setNotice("当前预览结束前不能创建对象。"); return null; }
    const id = crypto.randomUUID(), size = stickySize(variant);
    const envelope = createStickyBatchEnvelope({ boardId, clientId, gestureId: crypto.randomUUID(), variant, items: [{ id, text, geometry: topLeft(point, size.width, size.height) }] });
    if (!dispatchEnvelope(envelope)) return null; setSelected([id]); setEditing({ id, initial: text }); return id;
  }, [boardId, clientId, dispatchEnvelope, mutationBlocked]);
  const createTextAt = useCallback((point: Point, preset: TextStylePreset = "body", text = "") => {
    if (mutationBlocked) { setNotice("当前预览结束前不能创建对象。"); return null; }
    const id = crypto.randomUUID(), attributes = validateTextAttributes({ preset });
    const object: WhiteboardObject = { id, schemaVersion: 1, kind: "text", geometry: topLeft(point, preset === "title" ? 480 : 320, preset === "caption" ? 56 : 96), text, style: { color: attributes.color, fontSize: attributes.fontSize }, parentId: null, orderKey: "", extensionData: { thinkingInput: { text: attributes } } };
    if (!execute([{ type: "create", object }])) return null; setSelected([id]); setEditing({ id, initial: text }); return id;
  }, [execute, mutationBlocked]);
  const createFromTool = useCallback((point: Point, requested = creationTool) => { if (requested?.kind === "sticky") createStickyAt(point, requested.variant); else if (requested?.kind === "text") createTextAt(point, requested.preset); }, [createStickyAt, createTextAt, creationTool]);
  const createStickyBatch = useCallback((lines: readonly string[], point: Point) => {
    const items = lines.map((text, index) => ({ id: crypto.randomUUID(), text, geometry: { x: point.x + (index % 5) * 204, y: point.y + Math.floor(index / 5) * 204, width: 180, height: 180, rotation: 0 } }));
    if (!dispatchEnvelope(createStickyBatchEnvelope({ boardId, clientId, gestureId: crypto.randomUUID(), items }))) return;
    setSelected(items.map((item) => item.id)); setNotice(`已用一次操作创建 ${items.length} 张便利贴。`);
  }, [boardId, clientId, dispatchEnvelope]);
  const commitEdit = useCallback((value: string, close = true): boolean => {
    if (!editing || mutationBlocked) return false; const current = readObjects(doc).find((candidate) => candidate.id === editing.id); if (!current) { setEditing(null); return false; }
    if (current.text !== editing.initial) { setConflictedDraft(value); setEditing(null); setNotice("输入期间对象已由其他人修改。已保留此次输入草稿，请核对后重新输入。"); return false; }
    if (current.text !== value && !execute([{ type: "text", id: current.id, ...textSplice(current.text, value) }])) return false;
    if (close) setEditing(null); else setEditing({ id: current.id, initial: value });
    return true;
  }, [doc, editing, execute, mutationBlocked]);
  const continueSticky = useCallback((sourceId: string) => { const all = readObjects(doc), source = all.find((candidate) => candidate.id === sourceId && candidate.kind === "sticky"); if (!source) return; const next = nextStickyPlacement(source.geometry, all.filter((candidate) => candidate.kind === "sticky").map((candidate) => candidate.geometry), 24); const metadata = source.extensionData?.thinkingInput as { sticky?: { variant?: StickyVariant } } | undefined; createStickyAt({ x: next.geometry.x + next.geometry.width / 2, y: next.geometry.y + next.geometry.height / 2 }, metadata?.sticky?.variant ?? "square"); }, [createStickyAt, doc]);

  useEffect(() => { const keydown = (event: KeyboardEvent) => { if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return; const key = event.key.toLowerCase(); if (key === "v") { setTool("select"); setCreationTool(null); } else if (key === "h" || event.code === "Space") { event.preventDefault(); setTool("hand"); setCreationTool(null); } else if (key === "n" && event.shiftKey) { event.preventDefault(); if (!mutationBlocked) setBulk(""); } else if (key === "n") { event.preventDefault(); if (mutationBlocked) return; const requested = { kind: "sticky", variant: "square" } as const; setTool("select"); setCreationTool(requested); createStickyAt(centerPoint(viewport), requested.variant); } else if (key === "t") { event.preventDefault(); if (mutationBlocked) return; const requested = { kind: "text", preset: "body" } as const; setTool("select"); setCreationTool(requested); createTextAt(centerPoint(viewport), requested.preset); } }; window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown); }, [createStickyAt, createTextAt, mutationBlocked, viewport]);

  const editingObject = editing ? model.objects.find((candidate) => candidate.id === editing.id) : undefined;
  const handlePaste = (event: ClipboardEvent<HTMLElement>) => { if (mutationBlocked || isEditableTarget(event.target)) return; const value = event.clipboardData.getData("text/plain"); if (!value.includes("\n")) return; try { parseThinkingPaste(value); event.preventDefault(); setPasteChoice({ text: value, point: centerPoint(viewport) }); } catch { /* Preserve normal paste. */ } };
  const announceCursor = (event: PointerEvent<HTMLDivElement>) => { const bounds = event.currentTarget.getBoundingClientRect(); onAwareness?.({ x: (event.clientX - bounds.left - viewport.panX) / viewport.zoom, y: (event.clientY - bounds.top - viewport.panY) / viewport.zoom }, selected); };
  return <section data-testid="collaborative-editor" className="fixed inset-0 overflow-hidden bg-background text-foreground" onPaste={handlePaste}>
    <div data-testid="board-live-surface" className="absolute inset-0" onPointerMove={announceCursor} onPointerLeave={() => onAwareness?.(null, selected)}>
      <BoardFabricSurface objects={displayObjects} selectedObjectIds={selected} readOnly={mutationBlocked} tool={tool} viewport={viewport} onSelectionChange={(ids, source) => { setSelected([...ids]); if (source === "outline" && ids[0]) beginEditing(ids[0]); }} onObjectTransform={(id, geometry) => execute([{ type: "geometry", id, geometry }])} onObjectsTransform={(changes) => execute(changes.map(({ id, geometry }) => ({ type: "geometry" as const, id, geometry })))} onViewportChange={setViewport} onCanvasClick={createFromTool} onCanvasDoubleClick={(point) => { if (!readOnly && !creationTool) createStickyAt(point); }} onObjectDoubleClick={beginEditing} onToolDrop={(point, payload) => { try { const requested = JSON.parse(payload) as BoardCreationTool; createFromTool(point, requested); } catch { setNotice("无法识别拖入的白板工具。"); } }} className="absolute inset-0 overflow-hidden bg-panel-alt" />
      {editingObject && editing ? <ThinkingInputEditor key={editing.id} objectId={editing.id} initialValue={editingObject.text} geometry={editingObject.geometry} viewport={viewport} readOnly={mutationBlocked} onLiveCommit={(value) => commitEdit(value, false)} onCommit={(value) => commitEdit(value, true)} onCancel={() => setEditing(null)} onContinue={() => continueSticky(editing.id)} /> : null}
      <div className="pointer-events-none absolute inset-0 origin-top-left" style={{ transform: `translate(${viewport.panX}px,${viewport.panY}px) scale(${viewport.zoom})` }}>{peers.filter((peer) => peer.actorId !== currentUserId).map((peer) => <div key={peer.actorId}>{peer.selected.map((id) => { const item = model.objects.find((candidate) => candidate.id === id); if (!item) return null; const g = item.geometry; return <div key={id} data-testid={`peer-selection-${peer.actorId}-${id}`} className="absolute rounded-control border-2 border-dashed border-primary" style={{ left: g.x, top: g.y, width: g.width, height: g.height, transform: `rotate(${g.rotation}deg)` }} />; })}{peer.cursor ? <div data-testid={`peer-cursor-${peer.actorId}`} className="absolute text-primary" style={{ left: peer.cursor.x, top: peer.cursor.y }}><span aria-hidden="true">↖</span><span className="rounded-control bg-primary px-1 text-11 text-primary-foreground">{peer.actorId}</span></div> : null}</div>)}</div>
    </div>
    <header className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 p-3 backdrop-blur">{onBack ? <Button onClick={onBack}>返回白板</Button> : null}<Input aria-label="白板名称" className="max-w-64" value={title} disabled={mutationBlocked || !onTitleChange} onChange={(event) => { if (!mutationBlocked) onTitleChange?.(event.target.value); }} /><span role="status" className="text-12">{status}{readOnly ? " · 只读" : ""}</span><span className="ml-auto text-12 text-muted-foreground">在线成员 {peers.length}</span></header>
    <div className="absolute bottom-5 left-5 z-20 flex items-center gap-1 rounded-xl border border-border bg-card/95 p-1 shadow-lg backdrop-blur"><Button disabled={mutationBlocked} onClick={() => { const result = model.undo(); setNotice(result === "undone" ? "已撤销本地修改" : result === "conflict" ? "未撤销：当前画板与这次修改存在冲突，请核对后再操作。" : result === "creation-requires-explicit-delete" ? "创建对象请使用删除；为保护其他人的修改，不撤销对象创建。" : "没有可撤销的本地修改。"); }}>撤销</Button><Button disabled={mutationBlocked} onClick={() => setNotice(model.redo() ? "已重做本地修改" : "未重做：没有可重做的本地修改，或当前画板存在冲突。")}>重做</Button><Button disabled={!selected.length} onClick={() => { clipboard.current = copyObjects(doc, selected, () => crypto.randomUUID()); setNotice("已复制到当前白板剪贴板"); }}>复制</Button><Button disabled={mutationBlocked || !clipboard.current.length} onClick={() => { const ids = new Map(clipboard.current.map((entry) => [entry.id, crypto.randomUUID()])); const copied = clipboard.current.map((entry) => ({ ...entry, id: ids.get(entry.id)!, parentId: entry.parentId ? ids.get(entry.parentId) ?? null : null, connector: entry.connector ? { from: ids.get(entry.connector.from)!, to: ids.get(entry.connector.to)! } : undefined, geometry: { ...entry.geometry, x: entry.geometry.x + 24, y: entry.geometry.y + 24 } })); if (copied.length && execute(copied.map((entry) => ({ type: "create", object: entry })))) setSelected(copied.map((entry) => entry.id)); }}>粘贴</Button><Button disabled={mutationBlocked || !selected.length} onClick={() => { if (execute(selected.map((id) => ({ type: "delete", id })))) setSelected([]); }}>删除选中</Button><Button disabled title="将在自由绘制迭代开放">画笔</Button><Button data-testid="board-zoom-out" aria-label="缩小" onClick={() => setViewport((current) => ({ ...current, zoom: clampBoardZoom(current.zoom - .1) }))}>缩小</Button><span data-testid="board-zoom-value" className="w-12 text-center text-12">{Math.round(viewport.zoom * 100)}%</span><Button data-testid="board-zoom-in" aria-label="放大" onClick={() => setViewport((current) => ({ ...current, zoom: clampBoardZoom(current.zoom + .1) }))}>放大</Button><Button data-testid="board-zoom-fit-selection" disabled={!selected.length} onClick={() => setViewport((current) => ({ ...current, fitMode: "selection", fitRequest: current.fitRequest + 1 }))}>适应选择</Button><Button data-testid="board-zoom-fit-board" onClick={() => setViewport((current) => ({ ...current, fitMode: "board", fitRequest: current.fitRequest + 1 }))}>适应白板</Button></div>
    {selected.length >= 2 ? <div role="toolbar" aria-label="多选布局" data-testid="board-selection-layout-toolbar" className="absolute bottom-24 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-2xl border border-border bg-card/95 p-2 shadow-xl backdrop-blur">
      {([['align-left', '左对齐'], ['align-center', '水平居中'], ['align-right', '右对齐'], ['align-top', '顶对齐'], ['align-middle', '垂直居中'], ['align-bottom', '底对齐'], ['distribute-horizontal', '水平分布'], ['distribute-vertical', '垂直分布'], ['equal-width', '等宽'], ['equal-height', '等高'], ['equal-size', '等尺寸'], ['grid', '网格'], ['row', '横排'], ['column', '竖排'], ['tidy-up', '整理']] as const).map(([kind, label]) => <Button key={kind} size="sm" data-testid={`board-layout-${kind}`} disabled={selectionLayoutDisabled || (kind.startsWith('distribute-') && selected.length < 3)} onClick={() => arrangeSelection(kind)}>{label}</Button>)}
      <Button size="sm" data-testid="board-layout-smart-preview" disabled={selectionLayoutDisabled} onClick={() => previewSmartLayout("grid")}>智能预览</Button>
      {SMART_LAYOUTS.map(([suggestion, label]) => <Button key={suggestion} size="sm" variant="outline" data-testid={`board-smart-${suggestion}`} disabled={selectionLayoutDisabled} onClick={() => previewSmartLayout(suggestion)}>{label}</Button>)}
      <label className="ml-1 flex items-center gap-1 text-12">间距<Input data-testid="board-layout-gap" aria-label="布局间距" className="h-8 w-16" type="number" min={0} max={400} value={layoutGap} disabled={selectionLayoutDisabled} onChange={(event) => setLayoutGap(Math.max(0, Math.min(400, Number(event.target.value) || 0)))} /></label>
      <label className="flex items-center gap-1 text-12">列数<Input data-testid="board-layout-columns" aria-label="网格列数" className="h-8 w-16" type="number" min={1} max={20} value={layoutColumns} disabled={selectionLayoutDisabled} onChange={(event) => setLayoutColumns(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
    </div> : null}
    {layoutPreview ? <div className="absolute left-1/2 top-20 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-xl" data-testid="board-layout-preview"><span>{SMART_LAYOUTS.find(([key]) => key === layoutPreview.suggestion)?.[1]} 预览</span><Button data-testid="board-layout-preview-apply" onClick={() => { try { layoutPort.applyPreview(layoutPreview.id); setNotice("智能布局已应用。"); } catch { setNotice("应用失败：预览后对象已被其他协作者修改。"); } finally { setLayoutPreview(null); } }}>应用</Button><Button data-testid="board-layout-preview-cancel" onClick={() => { layoutPort.cancelPreview(layoutPreview.id); setLayoutPreview(null); setNotice("已取消预览；白板未修改。"); }}>取消</Button></div> : null}
    <BoardBottomDock activeTool={tool} creationTool={creationTool} readOnly={mutationBlocked} onToolChange={setTool} onCreationToolChange={setCreationTool} onQuickCreate={(requested) => requested.kind === "sticky" ? createStickyAt(centerPoint(viewport), requested.variant, "写下一个想法") : createTextAt(centerPoint(viewport), requested.preset)} onBulkSticky={() => setBulk("")} />
    {conflictedDraft !== null ? <aside className="absolute right-4 top-20 z-30 w-72 rounded-xl border border-border bg-card p-3 shadow-xl"><label className="text-12">未应用的输入草稿<Textarea aria-label="未应用的输入草稿" readOnly value={conflictedDraft} /></label><Button onClick={() => setConflictedDraft(null)}>关闭草稿</Button></aside> : null}<p role="status" className="absolute bottom-0 left-1/2 z-20 min-h-5 -translate-x-1/2 rounded-t-lg bg-background/90 px-3 text-12">{notice || `${selected.length} 个已选对象`}</p>
    <Dialog open={bulk !== null} onOpenChange={(open) => { if (!open) setBulk(null); }}><DialogContent closeTestId="board-bulk-close"><DialogTitle>批量创建便利贴</DialogTitle><DialogDescription>每行一个想法，单次最多 100 行；整批只产生一个可协作操作。</DialogDescription><Textarea autoFocus data-testid="board-bulk-text" aria-label="批量便利贴文字" rows={10} value={bulk ?? ""} onChange={(event) => setBulk(event.target.value)} /><div className="flex justify-end gap-2"><Button onClick={() => setBulk(null)}>取消</Button><Button variant="primary" data-testid="board-bulk-apply" onClick={() => { try { createStickyBatch(parseBulkStickyLines(bulk ?? ""), centerPoint(viewport)); setBulk(null); } catch (error) { setNotice(error instanceof Error && error.message === "BULK_STICKY_LIMIT_EXCEEDED" ? "一次最多创建 100 张便利贴。" : "请输入至少一行内容。"); } }}>创建便利贴</Button></div></DialogContent></Dialog>
    <Dialog open={pasteChoice !== null} onOpenChange={(open) => { if (!open) setPasteChoice(null); }}><DialogContent closeTestId="board-paste-close"><DialogTitle>如何放入这些内容？</DialogTitle><DialogDescription>检测到多行文字。你可以保留为一段文字，或把每一行变成独立便利贴。</DialogDescription><div className="grid gap-2"><Button onClick={() => { if (pasteChoice) { createTextAt(pasteChoice.point, "body", parseThinkingPaste(pasteChoice.text).text); setPasteChoice(null); } }}>粘贴为文字</Button><Button variant="primary" data-testid="board-paste-stickies" onClick={() => { if (pasteChoice) { const parsed = parseThinkingPaste(pasteChoice.text); createStickyBatch(parsed.stickies, pasteChoice.point); setPasteChoice(null); } }}>创建 {pasteChoice ? parseThinkingPaste(pasteChoice.text).stickies.length : 0} 张便利贴</Button><Button onClick={() => { if (pasteChoice) { const parsed = parseThinkingPaste(pasteChoice.text); createTextAt(pasteChoice.point, "body", parsed.list.map((line) => `• ${line}`).join("\n")); setPasteChoice(null); } }}>创建列表</Button></div></DialogContent></Dialog>
  </section>;
}
