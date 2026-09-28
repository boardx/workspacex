"use client";

import { boardSelectAllIds } from './board-select-all';
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type PointerEvent } from "react";
import {useBoardFrame,boardFrameCenter,followBoardFrame} from "./use-board-frame";
import { Undo2, Redo2, Copy, Clipboard, Trash2, MoreHorizontal } from "lucide-react";
import * as Y from "yjs";
import { ContentObjectCommandPort, STICKY_COLOR_PRESETS, DEFAULT_LAYOUT_GAP, SelectionLayoutCommandPort, createContentObjectEnvelope, createLayoutPreconditions, createStickyBatchEnvelope, instantiateTemplateEnvelope, nextStickyPlacement, parseBulkStickyLines, parseThinkingPaste, readContentObject, readObjects, readPanelMetadata, resolveStickyColor, rotatedAnchorPoint, SpatialRelationshipCommandPort, validateTextAttributes, type BoardCommandEnvelope, type CanonicalContentObject, type ConnectorAnchor, type ConnectorLineStyle, type ConnectorRelationship, type ConnectorTip, type DrawingStroke, type DrawingTool, type PanelMetadata, type SpatialCommand, type StickyVariant, type TextAttributes, type TextStylePreset, type WhiteboardCommand, type WhiteboardLayoutCommand, type WhiteboardLayoutKind, type WhiteboardObject } from "@repo/whiteboard-core";
import type { WhiteboardConnectionState } from "@/lib/whiteboard-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BoardDiagramSourceExport } from "./board-diagram-source-export";
import { useBoardToolbarPosition } from "./use-board-toolbar-position";
import {useBoardChromeInsets} from "./use-board-chrome-insets";
import { showConnectionHandles } from "./connection-handle-visibility";
import { BoardToolPopover } from "./board-tool-popover";
import {useBoardOrganizeFit,type BoardOrganizeFitRequest} from "./use-board-organize-fit";
import { BoardEditorHeader } from "./board-editor-header";
import { BoardViewportControls } from "./board-viewport-controls";
import { BoardBottomDock, type BoardCreationTool } from "./board-bottom-dock";
import { BoardDrawToolPanel, fabricToolForDrawChoice, type BoardDrawAppearance, type BoardDrawChoice } from "./board-draw-tool-panel";
import { BoardFrameToolPanel, type BoardFrameChoice, type BoardFrameDimensions } from "./board-frame-tool-panel";
import { BoardFabricSurface } from "./fabric/board-fabric-surface";
import { clampBoardZoom, type BoardFabricTool, type BoardViewport, type BoardViewportSource } from "./fabric/board-fabric-object";
import { ThinkingInputEditor } from "./thinking-input-editor";
import { ObjectContextToolbar, type ObjectExperience } from "./object-context-toolbar";
import { BoardSelectedObjectPanel } from "./board-selected-object-panel";
import { BoardContentObjectInspector } from "./board-content-object-inspector";
import { toBoardFabricObjects } from "./whiteboard-fabric-projection";
import { textSplice, useWhiteboardDocument } from "./use-whiteboard-document";
import { dispatchBoardCommentCommand, listBoardCommentThreads, listBoardMentionableMembers, type BoardMentionMember } from "./board-comments";
import type { WhiteboardCommentThread } from "@repo/contracts/whiteboard-collaboration";
import { inspectRemoteImageUrl, verifyBoardImageBytes, type BoardContentData, type BoardShapeVariant, type BoardStructuredKind, type VerifiedBoardImage } from "./board-content-adapter";
import { BoardDurableImageSession, durableBoardImageMetadata } from "./board-session-image-assets";
import { drawingToolStyle } from "./drawing-tool-style";
import { drawingPointBounds, geometryForAppendedDrawingStroke, worldStrokeToDrawingSpace } from "./drawing-coordinate-space";

import { BoardMentionPicker } from "./board-mention-picker";

type Point = { x: number; y: number };
type EditSession = { id: string; initial: string };
type PasteChoice = { text: string; point: Point } | null;
type StructuredDraft = { objectId: string; title: string; details: string } | null;
type PendingConnector = { objectId: string; anchor: ConnectorAnchor } | null;
type SmartLayoutSuggestion = "grid" | "cards" | "cluster" | "journey" | "mind-map" | "flow" | "timeline";
const SMART_LAYOUTS: readonly [SmartLayoutSuggestion, string][] = [["grid", "Grid"], ["cards", "Cards"], ["cluster", "Cluster"], ["journey", "Journey"], ["mind-map", "Mind Map"], ["flow", "Flow"], ["timeline", "Timeline"]];
export interface CollaborativeThinkingEditorProps { organizeFitRequest?: BoardOrganizeFitRequest|null; dockExtension?: React.ReactNode; presentationControls?: React.ReactNode; boardId: string; clientId: string; doc: Y.Doc; readOnly: boolean; commentsReadOnly?:boolean; role?: "owner" | "editor" | "commenter" | "viewer"; title: string; status: string; lastAckSequence?:number|null; lastAckReceipt?:WhiteboardConnectionState["lastAckReceipt"]; onTitleChange?: (title: string) => void; onBack?: () => void; onImport?: () => void; onSelectionChange?: (ids: string[]) => void; onAwareness?: (cursor: Point | null, ids: string[], editingObjectId: string | null, collaboration:{viewport:{centerX:number;centerY:number;zoom:number;revision:number};presenting:boolean;followingActorId:string|null}, pointer?:{pointerType:'mouse'|'touch'|'pen';pressure:number;tiltX:number;tiltY:number;roomIdentity:null;reconnectToken:null}) => void; peers?: WhiteboardConnectionState["peers"]; currentUserId?: string; followViewport?: {x:number;y:number;zoom:number}|null; onViewportObserved?: (viewport:{x:number;y:number;zoom:number})=>void; onManualViewportChange?:()=>void; }

const stickySize = (variant: StickyVariant) => variant === "rectangle" ? { width: 240, height: 150 } : { width: 180, height: 180 };
const FRAME_SIZE_PRESETS = [{ id: "s", label: "S", width: 640, height: 480 }, { id: "m", label: "M", width: 960, height: 640 }, { id: "l", label: "L", width: 1280, height: 800 }] as const;
const topLeft = (point: Point, width: number, height: number) => ({ x: point.x - width / 2, y: point.y - height / 2, width, height, rotation: 0 });
const isEditableTarget = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')) || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
const TEXT_EDITABLE_OBJECT_KINDS: ReadonlySet<WhiteboardObject["kind"]> = new Set(["sticky", "text", "rectangle", "ellipse"]);
const isTextEditableObject = (object: WhiteboardObject) => !object.locked && TEXT_EDITABLE_OBJECT_KINDS.has(object.kind);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const DRAWING_EXTENSION_BUDGET = 14_000;

export function fitDrawingStrokeToExtensionBudget(existing: readonly DrawingStroke[], stroke: DrawingStroke): DrawingStroke {
  const sample = (points: ReadonlyArray<DrawingStroke["points"][number]>, target: number) => target >= points.length ? [...points] : Array.from({ length: target }, (_, index) => points[Math.round(index * (points.length - 1) / (target - 1))]!);
  let target = Math.min(512, stroke.points.length), points = sample(stroke.points, target);
  const size = () => new TextEncoder().encode(JSON.stringify({ contentObject: { version: 1, type: "drawing", strokes: [...existing, { ...stroke, points }] } })).length;
  while (size() > DRAWING_EXTENSION_BUDGET && points.length > 2) {
    target = Math.max(2, Math.floor(target * .72));
    points = sample(stroke.points, target);
  }
  if (size() > DRAWING_EXTENSION_BUDGET) throw new Error("DRAWING_EXTENSION_BUDGET_EXCEEDED");
  return { ...stroke, points };
}

export function CollaborativeThinkingEditor({ organizeFitRequest, dockExtension, presentationControls, boardId, clientId, doc, readOnly, commentsReadOnly=false, role="viewer", title, status, lastAckSequence=null, lastAckReceipt=null, onTitleChange, onBack, onImport, onSelectionChange, onAwareness, peers = [], currentUserId, followViewport, onViewportObserved, onManualViewportChange }: CollaborativeThinkingEditorProps) {
  const frame=useBoardFrame();
  const centerPoint=useCallback((value:BoardViewport):Point=>boardFrameCenter(frame.size,value),[frame.size]);
  const model = useWhiteboardDocument(doc, readOnly);
  const contentPort = useMemo(() => new ContentObjectCommandPort(doc), [doc]);
  const spatialPort = useMemo(() => new SpatialRelationshipCommandPort(doc), [doc]);
  const [imageSession,setImageSession]=useState<BoardDurableImageSession|null>(null);
  const [imageRevision,setImageRevision]=useState(0);
  const objects = useMemo(() => { void imageRevision; return toBoardFabricObjects(model.objects,id=>imageSession?.get(id)?.objectUrl); }, [model.objects,imageSession,imageRevision]);
  const visibleObjectIdKey = objects.map((object) => object.id).join("\u0000");
  const [selected, setSelected] = useState<string[]>([]), [tool, setTool] = useState<BoardFabricTool>("select"), [creationTool, setCreationTool] = useState<BoardCreationTool>(null);
  const [drawChoice,setDrawChoice]=useState<BoardDrawChoice>("pen"), [drawAppearance,setDrawAppearance]=useState<BoardDrawAppearance>(drawingToolStyle("pen"));
  const [frameChoice,setFrameChoice]=useState<BoardFrameChoice>("rectangle"), [frameDimensions,setFrameDimensions]=useState<BoardFrameDimensions>({width:960,height:640,size:"m"});
  const [stickyColor,setStickyColor]=useState<string>(STICKY_COLOR_PRESETS.yellow);
  const [viewport, setViewport] = useState<BoardViewport>({ zoom: 1, panX: 0, panY: 0, fitRequest: 0, fitMode: "board" });
  useEffect(()=>{if(followViewport)setViewport(current=>({...current,panX:followViewport.x,panY:followViewport.y,zoom:followViewport.zoom}));},[followViewport]);
  useEffect(()=>{onViewportObserved?.({x:viewport.panX,y:viewport.panY,zoom:viewport.zoom});},[onViewportObserved,viewport.panX,viewport.panY,viewport.zoom]);
  const chromeHost=frame.ref;
  const chromeInsets=useBoardChromeInsets(chromeHost,selected.length);
  const organizeFitHost=useRef<HTMLDivElement>(null);
  const cancelOrganizeFit=useBoardOrganizeFit(organizeFitRequest,model.objects,organizeFitHost,setViewport,chromeInsets);
  const handleViewportChange=(next:BoardViewport,source:BoardViewportSource)=>{if(source==='pan'||source==='wheel'){cancelOrganizeFit();setFollowingActorId(null);onManualViewportChange?.();}setViewport(next);};
  const [presenting,setPresenting]=useState(false),[followingActorId,setFollowingActorId]=useState<string|null>(null);const viewportRevision=useRef(0),followRevision=useRef(-1);
  const [notice, setNotice] = useState(""), [editing, setEditing] = useState<EditSession | null>(null), [conflictedDraft, setConflictedDraft] = useState<string | null>(null);
  const awaitingAck=useRef<{kind:"撤销"|"重做";gestureId:string}|null>(null);
  const [bulk, setBulk] = useState<string | null>(null), [pasteChoice, setPasteChoice] = useState<PasteChoice>(null);
  const [commentObjectId, setCommentObjectId] = useState<string | null>(null), [commentBody, setCommentBody] = useState(""), [mentionIds, setMentionIds] = useState<string[]>([]);
  const [mentionMembers, setMentionMembers] = useState<BoardMentionMember[]>([]), [mentionLoading, setMentionLoading] = useState(false), [mentionError, setMentionError] = useState(false), [mentionRetry, setMentionRetry] = useState(0);
  useEffect(() => { setMentionIds([]); }, [boardId, commentObjectId]);
  useEffect(() => {
    setMentionMembers([]);
    if (!commentObjectId) return;
    const abort = new AbortController(); setMentionLoading(true); setMentionError(false);
    void listBoardMentionableMembers(boardId, abort.signal).then(items => { if (!abort.signal.aborted) setMentionMembers(items); }).catch(() => { if (!abort.signal.aborted) setMentionError(true); }).finally(() => { if (!abort.signal.aborted) setMentionLoading(false); });
    return () => abort.abort();
  }, [boardId, commentObjectId, mentionRetry]);
  const [commentThreads,setCommentThreads]=useState<WhiteboardCommentThread[]>([]),[commentPending,setCommentPending]=useState(false);
  const [imageDialog, setImageDialog] = useState<{ targetId?: string } | null>(null), [imageUrl, setImageUrl] = useState(""), [imageBusy, setImageBusy] = useState(false);
  const [structuredDraft, setStructuredDraft] = useState<StructuredDraft>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const imageRequestGeneration = useRef(0);
  const imageAbort = useRef<AbortController | null>(null);
  const [panelDropTarget, setPanelDropTarget] = useState<string | null>(null), [pendingConnector, setPendingConnector] = useState<PendingConnector>(null);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const [panelDelete, setPanelDelete] = useState<string | null>(null);
  const clipboard = useRef<string[]>([]);
  const [layoutGap, setLayoutGap] = useState(DEFAULT_LAYOUT_GAP), [layoutColumns, setLayoutColumns] = useState(3);
  const [layoutPreview, setLayoutPreview] = useState<{ id: string; suggestion: SmartLayoutSuggestion; geometries: Map<string, WhiteboardObject["geometry"]> } | null>(null);
  const displayObjects = useMemo(() => layoutPreview ? objects.map((object) => { const geometry = layoutPreview.geometries.get(object.id); return geometry ? { ...object, geometry, revision: object.revision + 1 } : object; }) : objects, [layoutPreview, objects]);
  const mutationBlocked = readOnly || Boolean(layoutPreview);
  const layoutPort = useMemo(() => new SelectionLayoutCommandPort(doc), [doc]);

  const viewportPresence=useCallback(()=>({centerX:centerPoint(viewport).x,centerY:centerPoint(viewport).y,zoom:viewport.zoom,revision:viewportRevision.current}),[centerPoint,viewport]);
  useEffect(() => { viewportRevision.current++;onSelectionChange?.(selected); onAwareness?.(null, selected, editing?.id ?? null,{viewport:viewportPresence(),presenting,followingActorId}); }, [editing?.id, followingActorId, onAwareness, onSelectionChange, presenting, selected, viewportPresence]);
  useEffect(()=>{const waiting=awaitingAck.current;if(waiting&&lastAckReceipt?.gestureId===waiting.gestureId){awaitingAck.current=null;setNotice(`${waiting.kind}已由服务器确认 · 序列 ${lastAckReceipt.seq}`);}},[lastAckReceipt]);
  useEffect(()=>{followRevision.current=-1;},[followingActorId]);
  useEffect(()=>{if(!followingActorId)return;const peer=peers.find(item=>item.actorId===followingActorId),remote=peer?.viewport;if(!remote||remote.revision<followRevision.current)return;followRevision.current=remote.revision;const next=followBoardFrame(frame.size,remote);setViewport(current=>current.zoom===next.zoom&&current.panX===next.panX&&current.panY===next.panY?current:{...current,...next});},[followingActorId,peers,frame.size]);
  useEffect(() => { const ids = new Set(visibleObjectIdKey ? visibleObjectIdKey.split("\u0000") : []); setSelected((current) => current.filter((id) => ids.has(id))); setEditing((current) => current && ids.has(current.id) ? current : null); }, [visibleObjectIdKey]);
  useEffect(()=>{const controller=new AbortController();let active=true;const refresh=()=>void listBoardCommentThreads(boardId,controller.signal).then(items=>{if(active)setCommentThreads(items.filter(item=>item.status!=="object-deleted"));}).catch(()=>{});refresh();const timer=setInterval(refresh,1000);return()=>{active=false;controller.abort();clearInterval(timer);};},[boardId]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      imageRequestGeneration.current += 1;
      imageAbort.current?.abort();
      imageAbort.current = null;
    };
  }, []);

  useEffect(()=>{if(readOnly){imageRequestGeneration.current++;imageAbort.current?.abort();imageAbort.current=null;setImageBusy(false);}},[readOnly]);
  useEffect(()=>{let active=true;const assets=new BoardDurableImageSession(boardId,()=>{if(active)setImageRevision(value=>value+1);});setImageSession(assets);return()=>{active=false;assets.dispose();};},[boardId,currentUserId]);
  useEffect(()=>{
    if(!imageSession)return;let stopped=false;
    const queue=model.objects.map(object=>durableBoardImageMetadata(readContentObject(object))).filter((value):value is NonNullable<typeof value>=>Boolean(value));
    const worker=async()=>{while(!stopped&&queue.length){const metadata=queue.shift()!;try{await imageSession.ensure(metadata);}catch{if(!stopped)setNotice('部分图片暂时无法读取，请检查连接和白板权限。');}}};
    for(let index=0;index<Math.min(4,queue.length);index++)void worker();
    return()=>{stopped=true;};
  },[imageSession,model.objects]);

  const dispatchEnvelope = useCallback((envelope: BoardCommandEnvelope): boolean => {
    if (mutationBlocked) { setNotice(layoutPreview ? "请先应用或取消当前布局预览。" : "当前白板为只读，不能修改。"); return false; }
    try { const accepted = model.execute(envelope); if (!accepted) { setNotice("操作未应用：命令通道尚未就绪，请重试。"); return false; } setNotice(""); return true; }
    catch { setNotice("操作未应用：请检查对象是否仍存在或内容是否超出限制。"); return false; }
  }, [layoutPreview, model, mutationBlocked]);
  const execute = useCallback((commands: WhiteboardCommand[], gestureId = crypto.randomUUID()) => dispatchEnvelope({ boardId, clientId, gestureId, commands }), [boardId, clientId, dispatchEnvelope]);
  const replaceContent = useCallback((id: string, content: CanonicalContentObject): boolean => {
    if (readOnly) return false;
    try { contentPort.dispatch({ boardId, clientId, gestureId: crypto.randomUUID(), command: { type: "replace-content", id, content } }); setNotice(""); return true; }
    catch { setNotice("对象属性未应用，内容已安全保留。请重试。"); return false; }
  }, [boardId, clientId, contentPort, readOnly]);
  const executeSpatial = useCallback((command: SpatialCommand): boolean => {
    if (readOnly) { setNotice("当前白板为只读，不能修改空间关系。"); return false; }
    try { const accepted = spatialPort.dispatch({ boardId, clientId, gestureId: crypto.randomUUID(), command }); if (!accepted) { setNotice("操作未应用：命令通道尚未就绪，请重试。"); return false; } setNotice(""); return true; }
    catch (error) { setNotice(error instanceof Error && error.message === "OBJECT_LOCKED" ? "对象已锁定，不能移动、调整、编辑或批量操作。" : error instanceof Error && error.message === "SPATIAL_COMMAND_REJECTED" ? "操作未应用：命令通道尚未就绪，请重试。" : "空间操作未应用：对象可能已变化，请重试。"); return false; }
  }, [boardId, clientId, readOnly, spatialPort]);
  const duplicateRoots = useCallback((rootIds: string[], offset = { x: 24, y: 24 }): boolean => {
    const roots = rootIds.filter((id) => !rootIds.some((other) => model.objects.find((object) => object.id === id)?.parentId === other));
    const closure = new Set(roots); let changed = true;
    while (changed) { changed = false; for (const object of model.objects) if (object.parentId && closure.has(object.parentId) && !closure.has(object.id)) { closure.add(object.id); changed = true; } }
    for (const object of model.objects) {
      if (!object.connector) continue;
      const attachedIds = [object.connector.from, object.connector.to].filter((id): id is string => Boolean(id));
      if (attachedIds.length > 0 && attachedIds.every((id) => closure.has(id))) closure.add(object.id);
    }
    const newIds = Object.fromEntries([...closure].map((id) => [id, crypto.randomUUID()]));
    if (!executeSpatial({ type: "duplicate-subgraph", rootIds: roots, newIds, offset })) return false;
    setSelected(roots.map((id) => newIds[id]!).filter(Boolean)); return true;
  }, [executeSpatial, model.objects]);
  const selectedLayoutObjects = useMemo(() => selected.flatMap((id) => { const object = model.objects.find((candidate) => candidate.id === id); return object ? [object] : []; }), [model.objects, selected]);
  const selectionLayoutDisabled = mutationBlocked || selectedLayoutObjects.length < 2 || selectedLayoutObjects.some((object) => object.locked || object.hidden || object.kind === "connector");
  const arrangeSelection = useCallback((kind: WhiteboardLayoutKind) => {
    if (selectionLayoutDisabled) return;
    const command: WhiteboardLayoutCommand = { type: "arrange-objects", kind, objectIds: [...selected], ...(kind === "grid" || kind === "tidy-up" ? { columns: layoutColumns } : {}), ...(["grid", "row", "column", "tidy-up"].includes(kind) ? { gap: layoutGap } : {}) };
    try {
      const preconditions = createLayoutPreconditions(model.objects, command), stateVector = Y.encodeStateVector(doc);
      layoutPort.dispatch({ boardId, clientId, gestureId: crypto.randomUUID(), command, preconditions, stateVector });
      setNotice(`已整理 ${selected.length} 个对象。`);
    }
    catch (error) { const code = error instanceof Error ? error.message : "LAYOUT_FAILED"; setNotice(code === "LAYOUT_CONFLICT" ? "布局未应用：对象已被其他协作者修改。" : code === "SELECTION_PARENT_BOUNDARY" ? "布局未应用：请选择同一容器内的对象。" : code === "DISTRIBUTION_REQUIRES_THREE" ? "等距分布至少需要 3 个对象。" : "布局未应用：选择中包含锁定对象或当前排列不可用。"); }
  }, [boardId, clientId, doc, layoutColumns, layoutGap, layoutPort, model.objects, selected, selectionLayoutDisabled]);
  const previewSmartLayout = useCallback((suggestion: SmartLayoutSuggestion = "grid") => {
    if (selectionLayoutDisabled) return;
    const columns = Math.max(1, Math.ceil(Math.sqrt(selected.length)));
    const command: WhiteboardLayoutCommand = suggestion === "journey" || suggestion === "flow" || suggestion === "timeline" ? { type: "arrange-objects", kind: "row", objectIds: [...selected], gap: suggestion === "timeline" ? 80 : 48 } : suggestion === "cluster" ? { type: "arrange-objects", kind: "tidy-up", objectIds: [...selected], columns, gap: 48 } : { type: "arrange-objects", kind: "grid", objectIds: [...selected], columns: suggestion === "mind-map" ? 2 : suggestion === "cards" ? Math.min(3, columns) : columns, gap: suggestion === "mind-map" ? 72 : layoutGap };
    try { const preview = layoutPort.preview({ boardId, clientId, gestureId: crypto.randomUUID(), command, preconditions: createLayoutPreconditions(model.objects, command), stateVector: Y.encodeStateVector(doc) }); setLayoutPreview({ id: preview.previewId, suggestion, geometries: new Map(preview.geometries.map((value) => [value.id, value.geometry])) }); setNotice("智能布局预览中；应用前不会写入白板。"); }
    catch { setNotice("无法生成智能布局预览：对象已变化。"); }
  }, [boardId, clientId, doc, layoutGap, layoutPort, model.objects, selected, selectionLayoutDisabled]);
  const beginEditing = useCallback((id: string) => { const object = readObjects(doc).find((candidate) => candidate.id === id); if (!object) return; setSelected([id]); setEditing({ id, initial: object.text }); }, [doc]);

  const createStickyAt = useCallback((point: Point, variant: StickyVariant = "square", text = "") => {
    if (readOnly) { setNotice("当前白板为只读，不能创建便利贴。"); return null; }
    const id = crypto.randomUUID(), size = stickySize(variant);
    const envelope = createStickyBatchEnvelope({ boardId, clientId, gestureId: crypto.randomUUID(), variant, color:{custom:stickyColor}, items: [{ id, text, geometry: topLeft(point, size.width, size.height) }] });
    if (!dispatchEnvelope(envelope)) return null; setSelected([id]); setEditing({ id, initial: text }); return id;
  }, [boardId, clientId, dispatchEnvelope, readOnly, stickyColor]);
  const createTextAt = useCallback((point: Point, preset: TextStylePreset = "body", text = "") => {
    if (readOnly) { setNotice("当前白板为只读，不能创建文字。"); return null; }
    const id = crypto.randomUUID(), attributes = validateTextAttributes({ preset });
    const object: WhiteboardObject = { id, schemaVersion: 1, kind: "text", geometry: topLeft(point, preset === "title" ? 480 : 320, preset === "caption" ? 56 : 96), text, style: { color: attributes.color, fontSize: attributes.fontSize }, parentId: null, orderKey: "", extensionData: { thinkingInput: { text: attributes } } };
    if (!execute([{ type: "create", object }])) return null; setSelected([id]); setEditing({ id, initial: text }); return id;
  }, [execute, readOnly]);
  const createContentAt = useCallback((point: Point, content: BoardContentData, text = "") => {
    const id = crypto.randomUUID();
    const isShape = content.type === "shape";
    const imageHeight = content.type === "image" ? Math.min(360, Math.max(96, 320 * content.intrinsicHeight / Math.max(1, content.intrinsicWidth))) : 170;
    const geometry = isShape ? topLeft(point, 220, 150) : content.type === "drawing" ? drawingPointBounds(content.strokes.flatMap((stroke) => stroke.points)) : topLeft(point, content.type === "image" ? 320 : 280, imageHeight);
    const contentTitle = content.type === "tile" || content.type === "web-tile" || content.type === "table"
      ? content.title ?? ""
      : content.type === "icon" || content.type === "template"
        ? content.name
        : "";
    const title = text || contentTitle;
    const envelope = createContentObjectEnvelope({ boardId, clientId, gestureId: crypto.randomUUID(), id, geometry, text: title, style: { fill: isShape ? "#FFFFFF" : "#FAFAFA", stroke: "#27272A", color: "#18181B", fontSize: 18 }, orderKey: `${Date.now().toString(36)}-${id}`, content });
    if (!dispatchEnvelope(envelope)) return null;
    setSelected([id]);
    return id;
  }, [boardId, clientId, dispatchEnvelope]);
  const createShapeAt = useCallback((point: Point, variant: BoardShapeVariant) => createContentAt(point, { version: 1, type: "shape", variant, fill: "#FFFFFF", borderColor: "#27272A", borderWidth: 1, borderStyle: "solid", opacity: 1, radius: variant === "rounded-rectangle" ? 20 : 0, textColor: "#18181B", horizontalAlign: "center", verticalAlign: "middle" }), [createContentAt]);
  const createStructuredAt = useCallback((point: Point, contentType: BoardStructuredKind) => {
    const defaults: Record<BoardStructuredKind, { title: string; description: string }> = {
      tile: { title: "新信息卡片", description: "双击编辑标题" }, "web-tile": { title: "网页链接", description: "粘贴 URL 后可预览" },
      table: { title: "数据表", description: "2 × 2 表格" }, icon: { title: "图标", description: "视觉标记" }, template: { title: "工作坊模板", description: "可复用的空间结构" },
    };
    const value = defaults[contentType];
    if (contentType === "template") {
      const instanceId = crypto.randomUUID();
      const tile = (title: string): Extract<CanonicalContentObject, { type: "tile" }> => ({ version: 1, type: "tile", tileType: "document", title, description: "模板实例", icon: null, coverAssetId: null, fields: [], tags: [], link: null, status: null, actions: [] });
      const content: Extract<CanonicalContentObject, { type: "template" }> = { version: 1, type: "template", templateId: "blank-workshop", name: value.title, versionId: "v1", parameters: {}, objects: ["目标", "想法", "下一步"].map((title, index) => ({ localId: `tile-${index + 1}`, geometry: { x: index * 205, y: 0, width: 180, height: 180, rotation: 0 }, text: title, content: tile(title) })) };
      const objectIds = Object.fromEntries(content.objects!.map((item) => [item.localId, `${instanceId}-${item.localId}`]));
      if (dispatchEnvelope(instantiateTemplateEnvelope({ boardId, clientId, gestureId: instanceId, instanceId, template: content, objectIds, x: point.x - 250, y: point.y - 40 }))) setSelected(Object.values(objectIds));
      return instanceId;
    }
    const content: CanonicalContentObject = contentType === "tile" ? { version: 1, type: "tile", tileType: "document", title: value.title, description: value.description, icon: null, coverAssetId: null, fields: [], tags: [], link: null, status: null, actions: [] }
      : contentType === "web-tile" ? { version: 1, type: "web-tile", url: "https://example.com/", title: value.title, description: value.description, imageUrl: null, siteName: null, fetchStatus: "pending" }
      : contentType === "table" ? { version: 1, type: "table", title: value.title, columns: [{ id: "name", name: "项目" }, { id: "status", name: "状态" }], rows: [{ id: "example", cells: { name: "示例", status: "进行中" } }] }
      : contentType === "icon" ? { version: 1, type: "icon", name: value.title, set: "lucide", color: "#18181B" }
      : { version: 1, type: "template", templateId: "blank-workshop", name: value.title, versionId: "v1", parameters: {} };
    return createContentAt(point, content, value.title);
  }, [boardId, clientId, createContentAt, dispatchEnvelope]);
  const defaultPanel = useCallback((mode: PanelMetadata["mode"]): PanelMetadata => ({ version: 1, mode, autoExpand: true, clipContent: false, padding: 24, gap: 24, columns: 3, flowDirection: "horizontal" }), []);
  const createPanelAt = useCallback((point: Point, mode: PanelMetadata["mode"] = "freeform") => {
    const id = crypto.randomUUID();
    if (executeSpatial({ type: "create-panel", id, text: "新区域", geometry: topLeft(point, frameDimensions.width, frameDimensions.height), panel: defaultPanel(mode) })) setSelected([id]);
    return id;
  }, [defaultPanel, executeSpatial, frameDimensions.height, frameDimensions.width]);
  const createFromTool = useCallback((point: Point, requested = creationTool) => { if (requested?.kind === "sticky") createStickyAt(point, requested.variant); else if (requested?.kind === "text") createTextAt(point, requested.preset); else if (requested?.kind === "shape") createShapeAt(point, requested.variant); else if (requested?.kind === "content") createStructuredAt(point, requested.contentType); else if (requested?.kind === "panel") createPanelAt(point, requested.mode); }, [createPanelAt, createShapeAt, createStickyAt, createStructuredAt, createTextAt, creationTool]);
  const createStickyBatch = useCallback((lines: readonly string[], point: Point) => {
    const items = lines.map((text, index) => ({ id: crypto.randomUUID(), text, geometry: { x: point.x + (index % 5) * 204, y: point.y + Math.floor(index / 5) * 204, width: 180, height: 180, rotation: 0 } }));
    if (!dispatchEnvelope(createStickyBatchEnvelope({ boardId, clientId, gestureId: crypto.randomUUID(), color:{custom:stickyColor}, items }))) return;
    setSelected(items.map((item) => item.id)); setNotice(`已用一次操作创建 ${items.length} 张便利贴。`);
  }, [boardId, clientId, dispatchEnvelope, stickyColor]);
  const commitEdit = useCallback((value: string, close = true): boolean => {
    if (!editing || readOnly) return false; const current = readObjects(doc).find((candidate) => candidate.id === editing.id); if (!current) { setEditing(null); return false; }
    if (current.text !== editing.initial) { setConflictedDraft(value); setEditing(null); setNotice("输入期间对象已由其他人修改。已保留此次输入草稿，请核对后重新输入。"); return false; }
    const content = readContentObject(current);
    if (current.text !== value) {
      const rich = content?.type === "tile" || content?.type === "web-tile" || content?.type === "table" ? { ...content, title: value } : content?.type === "template" ? { ...content, name: value } : content?.type === "icon" ? { ...content, name: value } : null;
      if (rich ? !replaceContent(current.id, rich) : !execute([{ type: "text", id: current.id, ...textSplice(current.text, value) }])) return false;
    }
    if (close) setEditing(null); else setEditing({ id: current.id, initial: value });
    return true;
  }, [doc, editing, execute, readOnly, replaceContent]);
  const continueSticky = useCallback((sourceId: string) => { const all = readObjects(doc), source = all.find((candidate) => candidate.id === sourceId && candidate.kind === "sticky"); if (!source) return; const next = nextStickyPlacement(source.geometry, all.filter((candidate) => candidate.kind === "sticky").map((candidate) => candidate.geometry), 24); const metadata = source.extensionData?.thinkingInput as { sticky?: { variant?: StickyVariant } } | undefined; createStickyAt({ x: next.geometry.x + next.geometry.width / 2, y: next.geometry.y + next.geometry.height / 2 }, metadata?.sticky?.variant ?? "square"); }, [createStickyAt, doc]);
  const updateSticky = useCallback((id: string, patch: { color?: string; variant?: StickyVariant; sizing?: "auto-height" | "fixed" | "auto-size" }) => {
    const current = readObjects(doc).find((candidate) => candidate.id === id && candidate.kind === "sticky"); if (!current || readOnly) return;
    const thinking = record(current.extensionData?.thinkingInput), sticky = record(thinking.sticky);
    const nextSticky = { ...sticky, ...patch };
    if (patch.color) nextSticky.color = resolveStickyColor({ custom: patch.color });
    const commands: WhiteboardCommand[] = [];
    if (patch.color) commands.push({ type: "style", id, style: { fill: nextSticky.color as string } });
    if (patch.variant) {
      const geometry = { ...current.geometry };
      if (patch.variant === "rectangle") { geometry.width = 240; geometry.height = 150; }
      else { const side = Math.max(180, Math.min(current.geometry.width, current.geometry.height)); geometry.width = side; geometry.height = side; }
      commands.push({ type: "geometry", id, geometry });
    }
    commands.push({ type: "extension", id, key: "thinkingInput", value: { ...thinking, sticky: nextSticky } });
    execute(commands);
  }, [doc, execute, readOnly]);
  const updateTextStyle = useCallback((id: string, patch: Partial<TextAttributes>, resetPreset = false) => {
    const current = readObjects(doc).find((candidate) => candidate.id === id && candidate.kind === "text"); if (!current || readOnly) return;
    const thinking = record(current.extensionData?.thinkingInput), existing = record(thinking.text);
    const known: TextAttributes = {
      preset: (["title", "heading", "subheading", "body", "caption"].includes(String(existing.preset)) ? existing.preset : "body") as TextStylePreset,
      ...(typeof existing.fontFamily === "string" ? { fontFamily: existing.fontFamily } : {}), ...(typeof existing.fontSize === "number" ? { fontSize: existing.fontSize } : {}),
      ...(typeof existing.bold === "boolean" ? { bold: existing.bold } : {}), ...(typeof existing.italic === "boolean" ? { italic: existing.italic } : {}), ...(typeof existing.underline === "boolean" ? { underline: existing.underline } : {}),
      ...(typeof existing.color === "string" ? { color: existing.color } : {}), ...(["left", "center", "right"].includes(String(existing.alignment)) ? { alignment: existing.alignment as "left" | "center" | "right" } : {}),
      ...(typeof existing.lineHeight === "number" ? { lineHeight: existing.lineHeight } : {}), ...(["none", "bullet", "number"].includes(String(existing.list)) ? { list: existing.list as "none" | "bullet" | "number" } : {}),
      ...(typeof existing.link === "string" || existing.link === null ? { link: existing.link as string | null } : {}),
    };
    const input = { ...known, ...patch };
    if (resetPreset) { delete input.fontSize; delete input.bold; delete input.lineHeight; }
    try {
      const validated = validateTextAttributes(input);
      execute([{ type: "style", id, style: { color: validated.color, fontSize: validated.fontSize } }, { type: "extension", id, key: "thinkingInput", value: { ...thinking, text: { ...existing, ...validated } } }]);
    } catch { setNotice("文字样式未应用：链接仅支持 http(s)，数值需在允许范围内。"); }
  }, [doc, execute, readOnly]);
  const updateExperience = useCallback((id: string, experience: ObjectExperience) => {
    const current = readObjects(doc).find((candidate) => candidate.id === id); if (!current || readOnly) return;
    const previous = record(current.extensionData?.objectExperience);
    execute([{ type: "extension", id, key: "objectExperience", value: {
      ...previous, ...experience,
      reactions: { ...record(previous.reactions), ...experience.reactions },
      linkPreview: experience.linkPreview ? { ...record(previous.linkPreview), ...experience.linkPreview } : null,
    } }]);
  }, [doc, execute, readOnly]);

  const handleTransforms = useCallback((items: readonly { id: string; geometry: WhiteboardObject["geometry"]; parentId?: string | null }[], options?: { duplicate: boolean }): boolean => {
    if (mutationBlocked) { setNotice(layoutPreview ? "请先应用或取消当前布局预览。" : "当前白板为只读，不能修改。"); return false; }
    const current = new Map(readObjects(doc).map((candidate) => [candidate.id, candidate]));
    const movable = items.filter((item) => current.get(item.id) && !current.get(item.id)!.locked);
    if (!movable.length) { setNotice("所选对象均已锁定，没有可变换的对象。"); return false; }
    if (options?.duplicate) {
      const first = movable[0]!, before = current.get(first.id)!.geometry;
      const duplicated = duplicateRoots(movable.map((item) => item.id), { x: first.geometry.x - before.x, y: first.geometry.y - before.y });
      if (duplicated) setNotice(`已复制并移动 ${movable.length} 个对象；锁定对象保持不变。`);
      return duplicated;
    }
    try {
      const accepted = spatialPort.dispatch({ boardId, clientId, gestureId: crypto.randomUUID(), command: { type: "transform", items: movable.map((item) => ({ ...item, geometry: { ...item.geometry } })) }, preconditions: movable.map((item) => ({ id: item.id, geometry: current.get(item.id)!.geometry, parentId: current.get(item.id)!.parentId, locked: false })) });
      if (!accepted) { setNotice("操作未应用：命令通道尚未就绪，请重试。"); return false; }
      const skipped = items.length - movable.length;
      setNotice(skipped ? `已用一次操作更新 ${movable.length} 个对象；跳过 ${skipped} 个锁定对象。` : movable.length > 1 ? `已用一次操作更新 ${movable.length} 个对象。` : "对象位置已更新。");
      return Boolean(accepted.operationId);
    } catch (error) { setNotice(error instanceof Error && error.message === "OBJECT_LOCKED" ? "选择中有对象已锁定，整次变换未应用。" : error instanceof Error && error.message === "SPATIAL_COMMAND_REJECTED" ? "操作未应用：命令通道尚未就绪，请重试。" : "空间操作未应用：对象可能已变化，请重试。"); return false; }
  }, [boardId, clientId, doc, duplicateRoots, layoutPreview, mutationBlocked, spatialPort]);
  const handleTransform = useCallback((id: string, geometry: WhiteboardObject["geometry"]): boolean => handleTransforms([{ id, geometry }]), [handleTransforms]);
  const deleteSelection = useCallback((connectors: "cascade" | "preserve-free" = "cascade") => {
    if (!selected.length) return;
    if (executeSpatial({ type: "delete-objects", ids: [...selected], connectors })) setSelected([]);
  }, [executeSpatial, selected]);

  const completeConnector = useCallback((objectId: string, anchor: ConnectorAnchor, source = pendingConnector) => {
    if (!source) { setPendingConnector({ objectId, anchor }); setNotice("选择另一个对象的连接点完成连接。"); return; }
    if (source.objectId === objectId) { setPendingConnector(null); setNotice("连接线需要两个不同对象。"); return; }
    const connectorType = creationTool?.kind === "connector" ? creationTool.connectorType : "straight";
    const relationship: ConnectorRelationship = { from: source.objectId, to: objectId, fromAnchor: source.anchor, toAnchor: anchor, type: connectorType, startStyle: "none", endStyle: "arrow", lineStyle: "solid", label: "", semanticRelation: "" };
    const id = crypto.randomUUID();
    if (executeSpatial({ type: "create-connector", id, relationship })) { setSelected([id]); setNotice("已连接对象；可在关系面板补充标签和语义。"); }
    setPendingConnector(null);
  }, [creationTool, executeSpatial, pendingConnector]);

  const selectedObjects = model.objects.filter((object) => selected.includes(object.id));
  const primary = selectedObjects[0];
  const selectedPanel = selectedObjects.length === 1 && primary?.kind === "frame" ? primary : null;
  const selectedConnector = selectedObjects.length === 1 && primary?.kind === "connector" ? primary : null;
  const panelMetadata = selectedPanel ? readPanelMetadata(selectedPanel) : null;
  const connectorRelationship: ConnectorRelationship | null = selectedConnector?.connector ? {
    ...(selectedConnector.connector.fromOffset?{fromOffset:selectedConnector.connector.fromOffset}:{}),
    ...(selectedConnector.connector.toOffset?{toOffset:selectedConnector.connector.toOffset}:{}),
    ...(selectedConnector.connector.from ? { from: selectedConnector.connector.from } : { fromPoint: selectedConnector.connector.fromPoint! }),
    ...(selectedConnector.connector.to ? { to: selectedConnector.connector.to } : { toPoint: selectedConnector.connector.toPoint! }),
    fromAnchor: selectedConnector.connector.fromAnchor ?? "right", toAnchor: selectedConnector.connector.toAnchor ?? "left",
    type: selectedConnector.connector.type ?? "straight", startStyle: selectedConnector.connector.startStyle ?? "none",
    endStyle: selectedConnector.connector.endStyle ?? "arrow", lineStyle: selectedConnector.connector.lineStyle ?? "solid",
    label: selectedConnector.connector.label ?? selectedConnector.text, semanticRelation: selectedConnector.connector.semanticRelation ?? "",
  } : null;
  const selectionLocked = selectedObjects.some((object) => object.locked);
  const allSelectionLocked = selectedObjects.length > 0 && selectedObjects.every((object) => object.locked);
  const sharedValue = <K extends keyof WhiteboardObject["geometry"]>(key: K): string => {
    const values = selectedObjects.map((object) => object.geometry[key]);
    return values.length && values.every((value) => value === values[0]) ? String(values[0]) : "混合";
  };
  const commandReason = (minimum = 1, rejectsLocked = true): string => readOnly ? "当前白板为只读" : selectedObjects.length < minimum ? `至少选择 ${minimum} 个对象` : rejectsLocked && selectionLocked ? "选择中包含锁定对象" : "";
  const updateConnector = (patch: Partial<ConnectorRelationship>) => { if (selectedConnector && connectorRelationship) executeSpatial({ type: "update-connector", id: selectedConnector.id, relationship: { ...connectorRelationship, ...patch } }); };
  const updatePanel = (patch: Partial<PanelMetadata>) => { if (selectedPanel && panelMetadata) executeSpatial({ type: "update-panel", id: selectedPanel.id, panel: { ...panelMetadata, ...patch } }); };

  useEffect(() => { const keydown = (event: KeyboardEvent) => { if (isEditableTarget(event.target) || event.altKey) return; const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "a") {
      if (event.defaultPrevented || event.isComposing || event.shiftKey || !(event.target instanceof Node) || !chromeHost.current?.contains(event.target)) return;
      event.preventDefault(); setSelected(boardSelectAllIds(model.objects, objects)); return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "c") { if (selected.length) { event.preventDefault(); clipboard.current = [...selected]; setNotice("已复制到当前白板剪贴板"); } return; }
    if ((event.metaKey || event.ctrlKey) && key === "v") { if (!readOnly && clipboard.current.length) { event.preventDefault(); duplicateRoots(clipboard.current); } return; }
    if ((event.metaKey || event.ctrlKey) && key === "d") { if (!readOnly && selected.length) { event.preventDefault(); duplicateRoots(selected); } return; }
    if ((event.metaKey || event.ctrlKey) && key === "g") { event.preventDefault(); if (event.shiftKey && selected.length === 1) executeSpatial({ type: "ungroup", id: selected[0]! }); else if (selected.length > 1) { const id = crypto.randomUUID(); if (executeSpatial({ type: "group", id, objectIds: selected })) setSelected([id]); } return; }
    if (event.metaKey || event.ctrlKey) return;
    if (key === "v") { setTool("select"); setCreationTool(null); } else if (key === "h" || event.code === "Space") { event.preventDefault(); setTool("hand"); setCreationTool(null); } else if (key === "n" && event.shiftKey) { event.preventDefault(); if (!readOnly) setBulk(""); } else if (key === "n") { event.preventDefault(); const requested = { kind: "sticky", variant: "square" } as const; setTool("select"); setCreationTool(requested); createStickyAt(centerPoint(viewport), requested.variant); } else if (key === "t") { event.preventDefault(); const requested = { kind: "text", preset: "body" } as const; setTool("select"); setCreationTool(requested); createTextAt(centerPoint(viewport), requested.preset); } else if (key === "s") { event.preventDefault(); const requested = { kind: "shape", variant: "rounded-rectangle" } as const; setTool("select"); setCreationTool(requested); createShapeAt(centerPoint(viewport), requested.variant); } else if (key === "p") { event.preventDefault(); setDrawChoice("pen"); setCreationTool(null); setTool("draw-pen"); } else if (key === "i") { event.preventDefault(); imageInput.current?.click(); } else if (key === "f") { event.preventDefault(); const requested = { kind: "panel", mode: "freeform" } as const; setTool("select"); setCreationTool(requested); createPanelAt(centerPoint(viewport), requested.mode); } else if (key === "c") { event.preventDefault(); setTool("select"); setCreationTool({ kind: "connector", connectorType: "straight" }); }
  }; window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown); }, [centerPoint, chromeHost, createPanelAt, createShapeAt, createStickyAt, createTextAt, duplicateRoots, executeSpatial, model.objects, objects, readOnly, selected, viewport]);

  const editingObject = editing ? model.objects.find((candidate) => candidate.id === editing.id) : undefined;
  const actorId = currentUserId ?? clientId;
  const commentReadOnly=commentsReadOnly||role==="viewer";
  const objectThreads = commentObjectId ? commentThreads.filter((thread) => thread.objectId === commentObjectId) : [];
  const mentions = () => mentionIds.map((userId) => ({ userId }));
  const commentAction = async (command: unknown) => { setCommentPending(true);setNotice("正在等待服务器确认评论…");try { const accepted=await dispatchBoardCommentCommand(boardId,command);setCommentThreads(current=>{const changed=new Map(accepted.threads.map(item=>[item.id,item]));return[...current.filter(item=>!changed.has(item.id)),...accepted.threads];}); setCommentBody(""); setMentionIds([]); setNotice(accepted.replayed?"评论已由服务器确认（重复请求未重复执行）。":"评论已由服务器持久化并确认。"); } catch (error) { setNotice(error instanceof Error && (error.message === "COMMENT_CONFLICT"||error.message==="http_409") ? "评论已被其他成员更新，请核对后重试。" : "评论尚未得到服务器确认，请保持内容后重试。"); }finally{setCommentPending(false);} };
  const commitVerifiedImage = useCallback(async (verified: VerifiedBoardImage, fileName: string, point: Point, targetId?: string, _sourceUrl: string | null = null, signal?:AbortSignal) => {
    if(!imageSession)throw new Error('IMAGE_ASSET_UNAVAILABLE');
    const metadata=await imageSession.upload(verified.blob,fileName,signal);
    if(!mounted.current||signal?.aborted)return false;
    const content: Extract<CanonicalContentObject, { type: "image" }> = { version: 1, type: "image", status: "ready", ...metadata, sourceUrl:null, crop: { x: 0, y: 0, width: 1, height: 1 }, opacity: 1, borderColor: "#FFFFFF", borderWidth: 0, cornerRadius: 0, fileName:fileName.replace(/[/\\\x00-\x1f]/g,'_')||'Image', replacementOf: targetId ?? null, failureCode: null, retryCount: 0 };
    const accepted = targetId ? replaceContent(targetId, content) : Boolean(createContentAt(point, content, fileName));
    if(accepted)setNotice('图片已持久化，正在同步到白板。');
    return accepted;
  }, [createContentAt, replaceContent,imageSession]);
  const importImage = useCallback(async (file: File, point = centerPoint(viewport), targetId = imageDialog?.targetId) => {
    if (!file.type.match(/^image\/(png|jpeg|webp|gif|svg\+xml)$/)) { setNotice("无法添加图片：请选择 JPG、PNG、WEBP、GIF 或 SVG 文件。"); return; }
    const generation = ++imageRequestGeneration.current;
    imageAbort.current?.abort();
    const controller = new AbortController();
    imageAbort.current = controller;
    setImageBusy(true);
    try {
      const verified = await verifyBoardImageBytes(file, file.type, undefined, controller.signal);
      if (!mounted.current || generation !== imageRequestGeneration.current) return;
      if (await commitVerifiedImage(verified, file.name, point, targetId,null,controller.signal)) setImageDialog(null);
    } catch (error) {
      if (!mounted.current || generation !== imageRequestGeneration.current) return;
      const code = error instanceof Error ? error.message : "IMAGE_DECODE_FAILED";
      setNotice(code === "IMAGE_ACCESS_DENIED" ? "无法保存图片：白板访问权限已改变。" : code === "IMAGE_ASSET_UNAVAILABLE" ? "图片未保存，请检查网络后重试。" : code === "IMAGE_TOO_LARGE" ? "图片超过 25MB，未添加。" : code === "IMAGE_MAGIC_INVALID" ? "图片内容与声明格式不一致，未添加。" : "图片无法安全解码，未添加。");
    } finally { if (imageAbort.current === controller) imageAbort.current = null; if (mounted.current && generation === imageRequestGeneration.current) setImageBusy(false); }
  }, [centerPoint, commitVerifiedImage, imageDialog?.targetId, viewport]);
  const importRemoteImage = useCallback(async () => {
    const generation = ++imageRequestGeneration.current;
    imageAbort.current?.abort();
    const controller = new AbortController();
    imageAbort.current = controller;
    setImageBusy(true);
    try {
      const inspected = await inspectRemoteImageUrl(imageUrl, fetch, controller.signal);
      if (!mounted.current || generation !== imageRequestGeneration.current) return;
      const name = new URL(inspected.url).pathname.split("/").pop() || "remote-image";
      if (await commitVerifiedImage(inspected, name, centerPoint(viewport), imageDialog?.targetId, inspected.url,controller.signal)) { setImageDialog(null); setImageUrl(""); }
    } catch (error) { if (!mounted.current || generation !== imageRequestGeneration.current) return; const code = error instanceof Error ? error.message : "IMAGE_FETCH_FAILED"; setNotice(code === "IMAGE_ACCESS_DENIED" ? "无法保存图片：白板访问权限已改变。" : code === "IMAGE_ASSET_UNAVAILABLE" ? "图片未保存，请检查网络后重试。" : code === "IMAGE_TOO_LARGE" ? "图片超过 25MB，未添加。" : code === "IMAGE_MAGIC_INVALID" ? "图片内容与声明格式不一致，未添加。" : "无法读取该 HTTPS 图片。请检查地址、跨域权限和文件格式。"); }
    finally { if (imageAbort.current === controller) imageAbort.current = null; if (mounted.current && generation === imageRequestGeneration.current) setImageBusy(false); }
  }, [centerPoint, commitVerifiedImage, imageDialog?.targetId, imageUrl, viewport]);
  const handlePaste = (event: ClipboardEvent<HTMLElement>) => { if (readOnly || isEditableTarget(event.target)) return; const image = Array.from(event.clipboardData.files ?? []).find((file) => file.type.startsWith("image/")); if (image) { event.preventDefault(); importImage(image); return; } const value = event.clipboardData.getData("text/plain"); if (!value.trim()) return; try { const parsed = parseThinkingPaste(value); event.preventDefault(); if (value.includes("\n")) setPasteChoice({ text: value, point: centerPoint(viewport) }); else createTextAt(centerPoint(viewport), "body", parsed.text); } catch { /* Preserve normal paste. */ } };
  const handleFileDrop = (event: DragEvent<HTMLElement>) => { const image = Array.from(event.dataTransfer?.files ?? []).find((file) => file.type.startsWith("image/")); if (!image || readOnly) return; event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); importImage(image, { x: (event.clientX - bounds.left - viewport.panX) / viewport.zoom, y: (event.clientY - bounds.top - viewport.panY) / viewport.zoom }); };
  const announceCursor = (event: PointerEvent<HTMLDivElement>) => { const bounds = event.currentTarget.getBoundingClientRect(); onAwareness?.({ x: (event.clientX - bounds.left - viewport.panX) / viewport.zoom, y: (event.clientY - bounds.top - viewport.panY) / viewport.zoom }, selected, editing?.id ?? null,{viewport:viewportPresence(),presenting,followingActorId},{pointerType:event.pointerType==='pen'?'pen':event.pointerType==='touch'?'touch':'mouse',pressure:event.pointerType==='mouse'?0:event.pressure,tiltX:event.tiltX,tiltY:event.tiltY,roomIdentity:null,reconnectToken:null}); };
  const selectedObject = selected.length === 1 ? model.objects.find((object) => object.id === selected[0]) : undefined;
  const selectedContent = selectedObject ? readContentObject(selectedObject) : null;
  const selectedContentLabel = selectedContent?.type === "shape" ? "形状" : selectedContent?.type === "image" ? "图片" : selectedContent?.type === "drawing" ? "绘图" : selectedContent?.type === "tile" ? "信息卡片" : selectedContent?.type === "web-tile" ? "网页卡片" : selectedContent?.type === "table" ? "表格" : selectedContent?.type === "icon" ? "图标" : "模板";
  const selectedContentQuickActions = selectedObject && selectedContent ? <div role="toolbar" aria-label={`${selectedContentLabel}快捷操作`} className="flex min-w-max items-center gap-1.5 px-1">
    <span className="px-1 text-11 font-medium text-muted-foreground">{selectedContentLabel}</span>
    {selectedContent.type === "shape" ? <div role="group" aria-label="形状快捷颜色" className="flex items-center gap-1">{["#F8D76E", "#F9A8D4", "#93C5FD", "#86EFAC", "#C4B5FD"].map((fill) => <button key={fill} type="button" aria-label={`填充色 ${fill}`} aria-pressed={selectedContent.fill === fill} className="h-7 w-7 shrink-0 rounded-full border border-border transition-transform hover:scale-110" style={{ background: fill }} onClick={() => replaceContent(selectedObject.id, { ...selectedContent, fill })} />)}</div> : null}
    {selectedContent.type === "image" ? <Button size="sm" variant="ghost" className="h-9 shrink-0" onClick={() => replaceContent(selectedObject.id, { ...selectedContent, crop: selectedContent.crop.x === 0 ? { x: .1, y: .1, width: .8, height: .8 } : { x: 0, y: 0, width: 1, height: 1 } })}>裁剪</Button> : null}
    {selectedContent.type === "drawing" ? <Button size="sm" variant="ghost" className="h-9 shrink-0" onClick={() => replaceContent(selectedObject.id, { ...selectedContent, strokes: selectedContent.strokes.map((stroke) => stroke.tool === "eraser" ? stroke : { ...stroke, color: stroke.color === "#18181B" ? "#2563EB" : "#18181B" }) })}>笔色</Button> : null}
    {selectedContent && ["tile", "web-tile", "table", "icon", "template"].includes(selectedContent.type) ? <Button size="sm" variant="ghost" className="h-9 shrink-0" onClick={() => beginStructuredEdit()}>编辑</Button> : null}
    <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label="评论" title="评论" onClick={() => setCommentObjectId(selectedObject.id)}>评论</Button>
    <Button size="icon" variant="ghost" className="ml-auto h-9 w-9 shrink-0" aria-label="复制对象" title="复制对象" disabled={mutationBlocked || selectedObject.locked} onClick={() => duplicateRoots([selectedObject.id])}><Copy className="h-4 w-4" /></Button>
    <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 text-destructive" aria-label="删除对象" title="删除对象" disabled={mutationBlocked || selectedObject.locked} onClick={() => deleteSelection()}><Trash2 className="h-4 w-4" /></Button>
  </div> : null;
  const contextObject = selected.length === 1 && !selectedContent && !selectedPanel && !selectedConnector ? model.objects.find((candidate) => candidate.id === selected[0] && !candidate.locked) : undefined;
  const commitDrawing = (drawingTool: DrawingTool, points: Array<{ x: number; y: number; pressure: number }>) => {
    const selectedDrawingTool = drawChoice === "pencil" ? "pen" : drawChoice;
    const style = drawingTool === "eraser" || selectedDrawingTool !== drawingTool ? drawingToolStyle(drawingTool) : { ...drawingToolStyle(drawingTool), ...drawAppearance };
    const draft: DrawingStroke = { id: crypto.randomUUID(), tool: drawingTool, points, ...style, ...(drawingTool === "eraser" && selectedContent?.type === "drawing" ? { erases: selectedContent.strokes.filter((item) => item.tool !== "eraser").map((item) => item.id) } : {}) };
    try {
      const existing = selectedContent?.type === "drawing" ? selectedContent.strokes : [];
      const intrinsicDraft = selectedObject && selectedContent?.type === "drawing"
        ? worldStrokeToDrawingSpace(selectedObject.geometry, existing, draft)
        : draft;
      const stroke = fitDrawingStrokeToExtensionBudget(existing, intrinsicDraft);
      if (selectedObject && selectedContent?.type === "drawing") {
        const content = { ...selectedContent, strokes: [...selectedContent.strokes, stroke] };
        const geometry = geometryForAppendedDrawingStroke(selectedObject.geometry, selectedContent.strokes, stroke);
        execute([
          { type: "geometry", id: selectedObject.id, geometry },
          { type: "extension", id: selectedObject.id, key: "contentObject", value: content },
        ]);
        return;
      }
      if (drawingTool === "eraser") { setNotice("先选择一个绘图对象，再用橡皮擦添加可撤销的矢量擦除笔画。"); return; }
      createContentAt(stroke.points[0]!, { version: 1, type: "drawing", strokes: [stroke] });
    } catch { setNotice("这条笔迹超过协作数据预算，请缩短笔画或拆成多次绘制。"); }
  };
  const beginStructuredEdit = () => {
    if (!selectedObject || !selectedContent || !["tile", "web-tile", "table", "icon", "template"].includes(selectedContent.type)) return;
    const structured = selectedContent as Extract<CanonicalContentObject, { type: BoardStructuredKind }>;
    const title = structured.type === "icon" || structured.type === "template" ? structured.name : structured.title ?? "";
    const details = structured.type === "tile" ? { description: structured.description, fields: structured.fields, tags: structured.tags, status: structured.status, link: structured.link, actions: structured.actions }
      : structured.type === "web-tile" ? { url: structured.url, description: structured.description, imageUrl: structured.imageUrl, siteName: structured.siteName, fetchStatus: structured.fetchStatus }
      : structured.type === "table" ? { columns: structured.columns, rows: structured.rows }
      : structured.type === "icon" ? { set: structured.set, color: structured.color }
      : { parameters: structured.parameters };
    setStructuredDraft({ objectId: selectedObject.id, title, details: JSON.stringify(details, null, 2) });
  };
  const saveStructuredEdit = () => {
    if (!structuredDraft) return;
    const object = readObjects(doc).find((candidate) => candidate.id === structuredDraft.objectId), content = object ? readContentObject(object) : null;
    if (!content || !["tile", "web-tile", "table", "icon", "template"].includes(content.type)) { setStructuredDraft(null); return; }
    try {
      const details = JSON.parse(structuredDraft.details) as Record<string, unknown>;
      delete details.type; delete details.version;
      const next = content.type === "tile" || content.type === "web-tile" || content.type === "table" ? { ...content, ...details, title: structuredDraft.title }
        : { ...content, ...details, name: structuredDraft.title };
      if (replaceContent(object!.id, next as CanonicalContentObject)) setStructuredDraft(null);
    } catch { setNotice("结构化字段不是有效 JSON，原内容未修改。"); }
  };
  const selectionBounds = selected.length ? model.objects.filter(object=>selected.includes(object.id)).map(object=>object.geometry) : [];
  const selectionGeometry = selectionBounds.length ? {x:Math.min(...selectionBounds.map(g=>g.x)),y:Math.min(...selectionBounds.map(g=>g.y)),width:Math.max(...selectionBounds.map(g=>g.x+g.width))-Math.min(...selectionBounds.map(g=>g.x)),height:Math.max(...selectionBounds.map(g=>g.y+g.height))-Math.min(...selectionBounds.map(g=>g.y))} : undefined;
  const selectionToolbarPosition = useBoardToolbarPosition(selectionGeometry,viewport);
  const contentToolbarPosition = useBoardToolbarPosition(selectedObject?.geometry, viewport);
  const [inspectorTab, setInspectorTab] = useState<"actions" | "properties">("actions");
  const selectionActions = <BoardToolPopover key={selected.join(":")} label="更多操作" trigger={<Button variant="ghost" data-testid="board-inspector-actions" aria-label="更多操作" title="更多操作" className="min-h-11 min-w-11"><MoreHorizontal className="h-4 w-4"/></Button>}><div className="mb-3 flex gap-2"><Button aria-pressed={inspectorTab === "actions"} onClick={() => setInspectorTab("actions")}>操作</Button><Button data-testid="board-properties-open" aria-pressed={inspectorTab === "properties"} onClick={() => setInspectorTab("properties")}>精确属性</Button></div><div hidden={inspectorTab !== "actions"}>
      {selected.length === 1 && !contextObject ? <Button onClick={() => setCommentObjectId(selected[0]!)}>评论</Button> : null}
    {selected.length ? <div data-testid="board-spatial-toolbar" aria-describedby="board-command-availability" className="grid grid-cols-2 gap-2 [&_button]:min-h-11">
      <Button title={commandReason(2)} disabled={readOnly || selectionLocked || selected.length < 2} onClick={() => { const id = crypto.randomUUID(); if (executeSpatial({ type: "group", id, objectIds: selected })) setSelected([id]); }}>组合</Button>
      <Button title={readOnly ? "当前白板为只读" : selectionLocked ? "选择中包含锁定对象" : primary?.kind !== "group" ? "请选择一个组合对象" : ""} disabled={readOnly || selectionLocked || primary?.kind !== "group"} onClick={() => { if (primary && executeSpatial({ type: "ungroup", id: primary.id })) setSelected([]); }}>取消组合</Button>
      <Button title={commandReason()} disabled={readOnly || selectionLocked} onClick={() => executeSpatial({ type: "layer", objectIds: selected, action: "bring-forward" })}>上移一层</Button>
      <Button title={commandReason()} disabled={readOnly || selectionLocked} onClick={() => executeSpatial({ type: "layer", objectIds: selected, action: "bring-to-front" })}>置于顶层</Button>
      <Button title={commandReason()} disabled={readOnly || selectionLocked} onClick={() => executeSpatial({ type: "layer", objectIds: selected, action: "send-backward" })}>下移一层</Button>
      <Button title={commandReason()} disabled={readOnly || selectionLocked} onClick={() => executeSpatial({ type: "layer", objectIds: selected, action: "send-to-back" })}>置于底层</Button>
      <Button title={readOnly ? "当前白板为只读" : ""} disabled={readOnly} onClick={() => executeSpatial({ type: "set-locked", objectIds: selected, locked: !allSelectionLocked })}>{allSelectionLocked ? "解锁" : "锁定"}</Button>
      <Button title={commandReason()} disabled={readOnly || selectionLocked} data-testid="board-spatial-duplicate" onClick={() => duplicateRoots(selected)}>复制副本</Button>
      <Button disabled={readOnly || selectionLocked || selected.some((id) => model.objects.find((object) => object.id === id)?.kind === "connector")} data-testid="board-delete-preserve-connectors" onClick={() => deleteSelection("preserve-free")}>删除并保留连接</Button>
      <Button disabled={readOnly || selectionLocked} onClick={() => { if (selectedPanel) setPanelDelete(selectedPanel.id); else deleteSelection(); }}>删除</Button>
      <span id="board-command-availability" data-testid="board-command-availability" className="sr-only">{readOnly ? "修改命令不可用：当前白板为只读。" : selectionLocked ? "部分命令不可用：选择中包含锁定对象。" : selected.length < 2 ? "组合不可用：至少选择 2 个对象。" : "当前选择可执行批量命令。"}</span>
    </div> : null}
</div><div hidden={inspectorTab !== "properties"}>{selected.length ? <aside data-testid="board-shared-properties" className="space-y-3" aria-label="所选对象共有属性">
      <h2 className="text-16 font-semibold">{selected.length === 1 ? "对象属性" : `${selected.length} 个对象的共有属性`}</h2>
      <p className="text-12 text-muted-foreground">{selectionLocked ? allSelectionLocked ? "全部对象已锁定" : "包含锁定对象；批量变换会跳过锁定对象" : "对象均可编辑"}</p>
      <div className="grid grid-cols-2 gap-2">
        {(["x", "y", "width", "height", "rotation"] as const).map((key) => <label key={key} className="grid gap-1 text-12">{key.toUpperCase()}<Input aria-label={`共有属性 ${key.toUpperCase()}`} readOnly value={sharedValue(key)} /></label>)}
      </div>
      <label className="grid gap-1 text-12">类型<Input aria-label="共有属性 类型" readOnly value={selectedObjects.every((object) => object.kind === primary?.kind) ? primary?.kind ?? "" : "混合"} /></label>
    </aside> : null}
</div></BoardToolPopover>;
  const historyControls = <><Button variant="ghost" aria-label="撤销" title="撤销" disabled={mutationBlocked} onClick={() => { const gestureId=crypto.randomUUID(),result = model.undo(gestureId);if(result==="undone")awaitingAck.current={kind:"撤销",gestureId}; setNotice(result === "undone" ? "撤销已在本地应用，正在等待服务器确认" : result === "conflict" ? "未撤销：当前画板与这次修改存在冲突，请核对后再操作。" : "没有可撤销的本地修改。"); }}><Undo2 aria-hidden="true" className="h-4 w-4" /></Button><Button variant="ghost" aria-label="重做" title="重做" disabled={mutationBlocked} onClick={() => {const gestureId=crypto.randomUUID(),result=model.redo(gestureId);if(result)awaitingAck.current={kind:"重做",gestureId};setNotice(result ? "重做已在本地应用，正在等待服务器确认" : "未重做：没有可重做的本地修改，或当前画板存在冲突。");}}><Redo2 aria-hidden="true" className="h-4 w-4" /></Button></>;
  const editingControls = <div className="flex gap-2"><Button aria-label="复制" title="复制" disabled={!selected.length} onClick={() => { clipboard.current = [...selected]; setNotice("已复制到当前白板剪贴板"); }}><Copy aria-hidden="true" className="h-4 w-4" /></Button><Button aria-label="粘贴" title="粘贴" disabled={mutationBlocked || !clipboard.current.length} onClick={() => { duplicateRoots(clipboard.current); }}><Clipboard aria-hidden="true" className="h-4 w-4" /></Button><Button aria-label="删除选中" title="删除选中" disabled={mutationBlocked || !selected.length || selectionLocked} onClick={() => { if (selectedPanel) setPanelDelete(selectedPanel.id); else deleteSelection(); }}><Trash2 aria-hidden="true" className="h-4 w-4" /></Button></div>;
  return <section ref={chromeHost} data-testid="collaborative-editor" className="relative h-full min-h-0 w-full overflow-hidden bg-background text-foreground" onPaste={handlePaste} onDragOver={(event) => { if ([...event.dataTransfer.items].some((item) => item.kind === "file")) event.preventDefault(); }} onDrop={handleFileDrop}>
    <div ref={organizeFitHost} data-testid="board-live-surface" className="absolute inset-0" onPointerMove={announceCursor} onPointerLeave={() => onAwareness?.(null, selected, editing?.id ?? null,{viewport:viewportPresence(),presenting,followingActorId})}>
      <BoardFabricSurface fitInsets={chromeInsets} objects={displayObjects} selectedObjectIds={selected} readOnly={mutationBlocked} tool={tool} viewport={viewport} onSelectionChange={(ids, source) => { setSelected([...ids]); if (source === "outline" && ids[0]) { const object = model.objects.find((candidate) => candidate.id === ids[0]); if (object && isTextEditableObject(object)) beginEditing(ids[0]); } }} onObjectTransform={handleTransform} onObjectsTransform={handleTransforms} onObjectReparent={(id, panelId) => executeSpatial({ type: "reparent", id, parentId: panelId })} onPanelHoverChange={setPanelDropTarget} onObjectHoverChange={setHoveredObjectId} onViewportChange={handleViewportChange} onCanvasClick={createFromTool} onCanvasDoubleClick={(point) => { if (!readOnly && !creationTool && tool === "select") createStickyAt(point); }} onObjectDoubleClick={(id) => { const object = model.objects.find((candidate) => candidate.id === id); if (object && isTextEditableObject(object)) beginEditing(id); }} onToolDrop={(point, payload) => { try { const requested = JSON.parse(payload) as BoardCreationTool; createFromTool(point, requested); } catch { setNotice("无法识别拖入的白板工具。"); } }} onDrawingComplete={({ tool: drawingTool, points }) => commitDrawing(drawingTool, points)} className="absolute inset-0 overflow-hidden bg-panel-alt" />
      <div className="pointer-events-none absolute inset-0 origin-top-left" style={{ transform: `translate(${viewport.panX}px,${viewport.panY}px) scale(${viewport.zoom})` }}>{peers.filter((peer) => peer.actorId !== currentUserId).map((peer) => <div key={peer.actorId}>{peer.selected.map((id) => { const item = model.objects.find((candidate) => candidate.id === id); if (!item) return null; const g = item.geometry; const editingHere = peer.editingObjectId === id; return <div key={id} role="status" aria-label={`${peer.displayName}${editingHere ? "正在编辑" : "已选择"}${item.text || "对象"}`} data-testid={`peer-selection-${peer.actorId}-${id}`} className="absolute rounded-control border-2 border-dashed" style={{ left: g.x, top: g.y, width: g.width, height: g.height, transform: `rotate(${g.rotation}deg)`, borderColor: peer.contributorColor, boxShadow: editingHere ? `0 0 0 3px ${peer.contributorColor}55` : undefined }} />; })}{peer.cursor ? <div role="status" aria-label={`${peer.displayName}的光标`} data-testid={`peer-cursor-${peer.actorId}`} className="absolute" style={{ left: peer.cursor.x, top: peer.cursor.y, color: peer.contributorColor }}><span aria-hidden="true">↖</span><span className="rounded-control px-1 text-11 text-white" style={{ backgroundColor: peer.contributorColor }}>{peer.displayName}</span></div> : null}</div>)}</div>
      <div className="pointer-events-none absolute inset-0 origin-top-left" style={{ transform: `translate(${viewport.panX}px,${viewport.panY}px) scale(${viewport.zoom})` }}>{model.objects.map((object) => { const threads = commentThreads.filter((thread) => thread.objectId === object.id), open = threads.filter((thread) => thread.status === "open").length; if (!threads.length) return null; return <button key={object.id} type="button" aria-label={`${object.text || "对象"}有 ${threads.length} 条评论`} data-testid={`board-comment-indicator-${object.id}`} className="pointer-events-auto absolute z-10 grid h-7 min-w-7 place-items-center rounded-full bg-inverse px-2 text-11 text-inverse-foreground shadow-md" style={{ left: object.geometry.x + object.geometry.width - 8, top: object.geometry.y - 8 }} onClick={() => setCommentObjectId(object.id)}>💬 {open || threads.length}</button>; })}</div>
      <div className="pointer-events-none absolute inset-0 origin-top-left" style={{ transform: `translate(${viewport.panX}px,${viewport.panY}px) scale(${viewport.zoom})` }}>
        {objects.filter((object) => object.kind === "panel").map((panel) => panel.id === panelDropTarget ? <div key={panel.id} data-testid={`panel-drop-highlight-${panel.id}`} className="absolute rounded-2xl border-4 border-primary bg-primary/10" style={{ left: panel.geometry.x, top: panel.geometry.y, width: panel.geometry.width, height: panel.geometry.height }} /> : null)}
        {!readOnly && tool === "select" ? objects.filter((object) => showConnectionHandles({id:object.id,kind:object.kind,locked:object.locked,selected,hovered:hoveredObjectId,connecting:creationTool?.kind === "connector",sourceId:pendingConnector?.objectId ?? null,readOnly:mutationBlocked,selectTool:tool === "select"})).map((object) => {
          const handles: Array<[ConnectorAnchor, number, number]> = (["top", "right", "bottom", "left"] as const).map((anchor) => { const point = rotatedAnchorPoint(object, anchor); return [anchor, point.x, point.y]; });
          return handles.map(([anchor, x, y]) => <button key={`${object.id}-${anchor}`} type="button" draggable data-testid={`connector-handle-${object.id}-${anchor}`} aria-label={`从${anchor}连接`} className="pointer-events-auto absolute grid h-11 w-11 origin-center place-items-center rounded-full bg-transparent transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring after:h-2 after:w-2 after:rounded-full after:border after:border-background after:bg-primary after:shadow-sm" style={{ left: x, top: y, transform: `translate(-50%, -50%) scale(${1 / viewport.zoom})` }} onClick={() => completeConnector(object.id, anchor)} onDragStart={(event) => { event.dataTransfer.setData("application/x-workspacex-connector", JSON.stringify({ objectId: object.id, anchor })); setPendingConnector({ objectId: object.id, anchor }); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); try { const source = JSON.parse(event.dataTransfer.getData("application/x-workspacex-connector")) as { objectId: string; anchor: ConnectorAnchor }; completeConnector(object.id, anchor, source); } catch { setNotice("连接起点已失效，请重新拖动。"); } }} />);
        }) : null}
      </div>
      {editingObject && editing ? <ThinkingInputEditor key={editing.id} objectId={editing.id} initialValue={editingObject.text} geometry={editingObject.geometry} viewport={viewport} readOnly={readOnly} onLiveCommit={(value) => commitEdit(value, false)} onCommit={(value) => commitEdit(value, true)} onCancel={() => setEditing(null)} onContinue={() => continueSticky(editing.id)} /> : null}
      {contextObject ? <ObjectContextToolbar key={"toolbar:" + contextObject.id} panelRef={selectionToolbarPosition.ref} floatingStyle={selectionToolbarPosition.style} onDuplicate={() => duplicateRoots([contextObject.id])} onDelete={deleteSelection} object={contextObject} actions={selectionActions} readOnly={mutationBlocked} actorId={currentUserId ?? clientId} onStickyChange={(patch) => updateSticky(contextObject.id, patch)} onTextChange={(patch, reset) => updateTextStyle(contextObject.id, patch, reset)} onStyleChange={(style) => execute([{ type: "style", id: contextObject.id, style }])} onExperienceChange={(experience) => updateExperience(contextObject.id, experience)} onGeometryChange={(geometry) => handleTransform(contextObject.id, geometry)} onClose={() => setSelected([])} onFutureAction={(kind) => { if (kind === "comment") setCommentObjectId(contextObject.id); else setNotice("AI 整理将在 AI 协作迭代开放。"); }} /> : null}
    </div>
    {selectedObject && selectedContent ? <BoardSelectedObjectPanel panelRef={selectionToolbarPosition.ref} floatingStyle={selectionToolbarPosition.style} object={selectedObject} title={selectedObject.text || "对象外观"} typeLabel={selectedContentLabel} readOnly={mutationBlocked || selectedObject.locked === true} onClose={() => setSelected([])} onGeometryChange={(geometry) => handleTransform(selectedObject.id, geometry)} compactActions={selectedContentQuickActions}><BoardContentObjectInspector object={selectedObject} content={selectedContent} readOnly={mutationBlocked} onChange={(content) => replaceContent(selectedObject.id, content)} onReplaceImage={() => { setImageUrl(""); setImageDialog({ targetId: selectedObject.id }); }} onEditText={() => beginEditing(selectedObject.id)} onEditStructured={beginStructuredEdit} onDuplicate={() => duplicateRoots([selectedObject.id])} onDelete={deleteSelection} imageDownloadUrl={selectedContent.type === "image" ? imageSession?.get(selectedContent.assetId)?.objectUrl : undefined} actions={selectionActions} /></BoardSelectedObjectPanel> : null}
    {!contextObject && (selectedPanel || selectedConnector) ? <BoardSelectedObjectPanel panelRef={selectionToolbarPosition.ref} floatingStyle={selectionToolbarPosition.style} object={selectedPanel ?? selectedConnector!} title={selectedPanel?.text || connectorRelationship?.label || "连接线"} typeLabel={selectedPanel ? "Frame / 区域" : "连接线"} readOnly={mutationBlocked || Boolean((selectedPanel ?? selectedConnector)?.locked)} onClose={() => setSelected([])} onGeometryChange={(geometry) => handleTransform((selectedPanel ?? selectedConnector)!.id, geometry)} footerActions={selectionActions}>{selectedPanel && panelMetadata ? <section data-testid="board-panel-properties" className="space-y-3"><h3 className="text-13 font-semibold">Frame 设置</h3><div data-testid="board-frame-size-presets" className="space-y-2"><p className="text-12 text-muted-foreground">尺寸</p><div role="group" aria-label="Frame 尺寸" className="grid grid-cols-3 gap-2">{FRAME_SIZE_PRESETS.map((preset) => <Button key={preset.id} size="sm" variant={selectedPanel.geometry.width === preset.width && selectedPanel.geometry.height === preset.height ? "primary" : "ghost"} data-testid={`frame-size-${preset.id}`} aria-pressed={selectedPanel.geometry.width === preset.width && selectedPanel.geometry.height === preset.height} disabled={readOnly || selectedPanel.locked} onClick={() => handleTransform(selectedPanel.id, { ...selectedPanel.geometry, width: preset.width, height: preset.height })}>{preset.label}<span className="ml-1 text-11 text-muted-foreground">{preset.width} × {preset.height}</span></Button>)}</div></div><label className="grid gap-1 text-12">标题<Input aria-label="区域标题" value={selectedPanel.text} disabled={readOnly || selectedPanel.locked} onChange={(event) => executeSpatial({ type: "update-panel", id: selectedPanel.id, panel: panelMetadata, text: event.target.value })} /></label><label className="grid gap-1 text-12">布局<select aria-label="区域布局" className="h-10 rounded-control border border-border bg-background px-2" value={panelMetadata.mode} disabled={readOnly || selectedPanel.locked} onChange={(event) => updatePanel({ mode: event.target.value as PanelMetadata["mode"] })}><option value="freeform">自由布局</option><option value="grid">网格</option><option value="flow">流程</option></select></label><label className="flex items-center justify-between text-13">自动扩展<input aria-label="区域自动扩展" type="checkbox" checked={panelMetadata.autoExpand} disabled={readOnly || selectedPanel.locked || panelMetadata.clipContent} onChange={(event) => updatePanel({ autoExpand: event.target.checked })} /></label><label className="flex items-center justify-between text-13">裁剪内容<input aria-label="区域裁剪内容" type="checkbox" checked={panelMetadata.clipContent} disabled={readOnly || selectedPanel.locked || panelMetadata.autoExpand} onChange={(event) => updatePanel({ clipContent: event.target.checked })} /></label><Button disabled={readOnly || selectedPanel.locked || panelMetadata.mode === "freeform"} onClick={() => executeSpatial({ type: "arrange-panel", id: selectedPanel.id })}>重新排列内容</Button></section> : null}{selectedConnector && connectorRelationship ? <section data-testid="board-connector-properties" className="space-y-3"><h3 className="text-13 font-semibold">连接线关系</h3><label className="grid gap-1 text-12">标签<Input aria-label="连接标签" value={connectorRelationship.label} disabled={readOnly || selectedConnector.locked} onChange={(event) => updateConnector({ label: event.target.value })} /></label><label className="grid gap-1 text-12">语义关系<Input aria-label="语义关系" placeholder="例如 depends_on" value={connectorRelationship.semanticRelation} disabled={readOnly || selectedConnector.locked} onChange={(event) => updateConnector({ semanticRelation: event.target.value })} /></label><label className="grid gap-1 text-12">路径<select aria-label="连接路径" value={connectorRelationship.type} disabled={readOnly || selectedConnector.locked} onChange={(event) => updateConnector({ type: event.target.value as ConnectorRelationship["type"] })}><option value="straight">直线</option><option value="elbow">折线</option><option value="curve">曲线</option></select></label><label className="grid gap-1 text-12">线型<select aria-label="连接线型" value={connectorRelationship.lineStyle} disabled={readOnly || selectedConnector.locked} onChange={(event) => updateConnector({ lineStyle: event.target.value as ConnectorLineStyle })}><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label><div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-12">起点<select aria-label="连接起点" value={connectorRelationship.startStyle} disabled={readOnly || selectedConnector.locked} onChange={(event) => updateConnector({ startStyle: event.target.value as ConnectorTip })}><option value="none">无</option><option value="arrow">箭头</option><option value="circle">圆点</option><option value="diamond">菱形</option></select></label><label className="grid gap-1 text-12">终点<select aria-label="连接终点" value={connectorRelationship.endStyle} disabled={readOnly || selectedConnector.locked} onChange={(event) => updateConnector({ endStyle: event.target.value as ConnectorTip })}><option value="none">无</option><option value="arrow">箭头</option><option value="circle">圆点</option><option value="diamond">菱形</option></select></label></div></section> : null}</BoardSelectedObjectPanel> : null}
    <BoardEditorHeader boardId={boardId} title={title} status={status} readOnly={readOnly} onBack={onBack} onImport={onImport} onTitleChange={onTitleChange} history={historyControls} presentation={presentationControls} peers={<div className="ml-auto flex max-w-32 shrink-0 items-center -space-x-2 overflow-x-auto" aria-label={`在线成员 ${peers.length}`}>{peers.map((peer) => <button type="button" key={peer.actorId} title={`${peer.displayName}${peer.presenting?" · 正在演示":""}`} aria-label={`${followingActorId===peer.actorId?"停止跟随":"跟随"}${peer.displayName}（${peer.principalKind==='agent'?"AI Agent":"成员"}）`} onClick={()=>setFollowingActorId(value=>value===peer.actorId?null:peer.actorId)} className="grid h-8 w-8 place-items-center rounded-full border-2 border-background bg-cover text-11 font-semibold text-white" style={{ backgroundColor: peer.contributorColor,backgroundImage:peer.avatarUrl?`url(${peer.avatarUrl})`:undefined }}>{peer.avatarUrl?null:peer.principalKind==='agent'?"AI":peer.displayName.slice(0, 1).toUpperCase()}</button>)}</div>} more={<><BoardDiagramSourceExport objects={model.objects}/>{editingControls}<Button className="shrink-0 whitespace-nowrap" data-testid="board-present-viewport" onClick={()=>{setPresenting(value=>!value);setFollowingActorId(null);}}>{presenting?"停止演示":"演示视图"}</Button></>} />
    <BoardViewportControls zoom={viewport.zoom} hasSelection={selected.length>0} onZoom={zoom=>setViewport(current=>({...current,zoom:clampBoardZoom(zoom)}))} onFitBoard={()=>setViewport(current=>({...current,fitMode:"board",fitRequest:current.fitRequest+1}))} onFitSelection={()=>setViewport(current=>({...current,fitMode:"selection",fitRequest:current.fitRequest+1}))}/>

    <input ref={imageInput} data-testid="board-image-input" className="sr-only" type="file" aria-label="上传图片" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml" onChange={(event) => { const file = event.target.files?.[0]; if (file) importImage(file); event.target.value = ""; }} />
    {selected.length >= 2 ? <div role="toolbar" aria-label="多选布局" data-testid="board-selection-layout-toolbar" ref={selectionToolbarPosition.ref as React.RefObject<HTMLDivElement>} style={selectionToolbarPosition.style} className="absolute z-30 flex max-w-[calc(100vw-2rem)] items-center justify-center gap-1 rounded-2xl border border-border bg-card/95 p-1 shadow-lg backdrop-blur"><Button variant="ghost" className="min-h-11" data-testid="board-layout-quick-grid" disabled={selectionLayoutDisabled} onClick={() => arrangeSelection("grid")}>网格</Button><Button variant="ghost" className="min-h-11" data-testid="board-layout-quick-tidy" disabled={selectionLayoutDisabled} onClick={() => arrangeSelection("tidy-up")}>整理</Button><BoardToolPopover label="布局"><div className="grid grid-cols-2 gap-2 [&_button]:min-h-11">
      {([["align-left", "左对齐"], ["align-center", "水平居中"], ["align-right", "右对齐"], ["align-top", "顶对齐"], ["align-middle", "垂直居中"], ["align-bottom", "底对齐"], ["distribute-horizontal", "水平分布"], ["distribute-vertical", "垂直分布"], ["equal-width", "等宽"], ["equal-height", "等高"], ["equal-size", "等尺寸"], ["grid", "网格"], ["row", "横排"], ["column", "竖排"], ["tidy-up", "整理"]] as const).map(([kind, label]) => <Button key={kind} size="sm" data-testid={`board-layout-${kind}`} disabled={selectionLayoutDisabled || (kind.startsWith("distribute-") && selected.length < 3)} onClick={() => arrangeSelection(kind)}>{label}</Button>)}
      <Button size="sm" data-testid="board-layout-smart-preview" disabled={selectionLayoutDisabled} onClick={() => previewSmartLayout("grid")}>智能预览</Button>
      {SMART_LAYOUTS.map(([suggestion, label]) => <Button key={suggestion} size="sm" variant="outline" data-testid={`board-smart-${suggestion}`} disabled={selectionLayoutDisabled} onClick={() => previewSmartLayout(suggestion)}>{label}</Button>)}
      <label className="ml-1 flex items-center gap-1 text-12">间距<Input data-testid="board-layout-gap" aria-label="布局间距" className="h-8 w-16" type="number" min={0} max={400} value={layoutGap} disabled={selectionLayoutDisabled} onChange={(event) => setLayoutGap(Math.max(0, Math.min(400, Number(event.target.value) || 0)))} /></label>
      <label className="flex items-center gap-1 text-12">列数<Input data-testid="board-layout-columns" aria-label="网格列数" className="h-8 w-16" type="number" min={1} max={20} value={layoutColumns} disabled={selectionLayoutDisabled} onChange={(event) => setLayoutColumns(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
    </div></BoardToolPopover>{dockExtension}{selectionActions}</div> : null}
    {layoutPreview ? <div className="absolute left-1/2 top-20 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-xl" data-testid="board-layout-preview"><span>{SMART_LAYOUTS.find(([key]) => key === layoutPreview.suggestion)?.[1]} 预览</span><Button data-testid="board-layout-preview-apply" onClick={() => { try { layoutPort.applyPreview(layoutPreview.id); setNotice("智能布局已应用。"); } catch { setNotice("应用失败：预览后对象已被其他协作者修改。"); } finally { setLayoutPreview(null); } }}>应用</Button><Button data-testid="board-layout-preview-cancel" onClick={() => { layoutPort.cancelPreview(layoutPreview.id); setLayoutPreview(null); setNotice("已取消预览；白板未修改。"); }}>取消</Button></div> : null}
    {selected.length === 1 && !contextObject && !selectedPanel && !selectedConnector && !(selectedObject && selectedContent && !readOnly) ? <div className="absolute right-4 top-16 z-30 rounded-xl border border-border bg-card shadow-sm">{selectionActions}</div> : null}
    {(tool.startsWith("draw-")||tool==="erase")&&!creationTool?<BoardDrawToolPanel choice={drawChoice} appearance={drawAppearance} readOnly={mutationBlocked} onChoiceChange={(choice)=>{setDrawChoice(choice);setCreationTool(null);setTool(fabricToolForDrawChoice(choice));}} onAppearanceChange={setDrawAppearance} onSelect={()=>{setTool("select");setCreationTool(null);}} onClose={()=>{setTool("select");setCreationTool(null);}}/>:null}
    {creationTool?.kind==="panel"?<BoardFrameToolPanel choice={frameChoice} dimensions={frameDimensions} readOnly={mutationBlocked} onChoiceChange={(choice,mode)=>{setFrameChoice(choice);setTool("select");setCreationTool({kind:"panel",mode});}} onDimensionsChange={setFrameDimensions} onClose={()=>setCreationTool(null)}/>:null}
    <BoardBottomDock stickyColor={stickyColor} onStickyColorChange={setStickyColor} extension={selected.length<2?dockExtension:null} activeTool={tool} creationTool={creationTool} readOnly={mutationBlocked} onToolChange={(next)=>{setTool(next);if(next.startsWith("draw-"))setDrawChoice(next.slice(5) as BoardDrawChoice);else if(next==="erase")setDrawChoice("eraser");}} onCreationToolChange={setCreationTool} onQuickCreate={(requested) => { if (requested.kind === "sticky") createStickyAt(centerPoint(viewport), requested.variant, "写下一个想法"); else if (requested.kind === "text") createTextAt(centerPoint(viewport), requested.preset); else if (requested.kind === "shape") createShapeAt(centerPoint(viewport), requested.variant); else if (requested.kind === "content") createStructuredAt(centerPoint(viewport), requested.contentType); else if (requested.kind === "panel") createPanelAt(centerPoint(viewport), requested.mode); }} onBulkSticky={() => setBulk("")} onImageRequest={() => { setImageUrl(""); setImageDialog({}); }} />
    {conflictedDraft !== null ? <aside className="absolute right-4 top-20 z-30 w-72 rounded-xl border border-border bg-card p-3 shadow-xl"><label className="text-12">未应用的输入草稿<Textarea aria-label="未应用的输入草稿" readOnly value={conflictedDraft} /></label><Button onClick={() => setConflictedDraft(null)}>关闭草稿</Button></aside> : null}<p role="status" className="absolute bottom-0 left-1/2 z-20 min-h-5 -translate-x-1/2 rounded-t-lg bg-background/90 px-3 text-12">{notice || `${selected.length} 个已选对象`}</p>
    {commentObjectId ? <aside data-testid="board-comments-panel" aria-label="对象评论" className="absolute right-4 top-20 z-40 flex max-h-[calc(100%-7rem)] w-80 flex-col gap-3 overflow-auto rounded-2xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur"><div className="flex items-center justify-between"><h2 className="text-16 font-semibold">对象评论</h2><Button onClick={() => setCommentObjectId(null)}>关闭</Button></div>{objectThreads.length ? objectThreads.map((thread) => <article key={thread.id} className="space-y-2 rounded-xl border border-border p-3" data-testid={`board-comment-thread-${thread.id}`}><div className="flex justify-between text-11 text-muted-foreground"><span>{thread.status === "resolved" ? "已解决" : "讨论中"}</span><span>#{thread.revision}</span></div>{thread.comments.filter((comment) => !comment.deletedAt).map((comment) => <p key={comment.id} className="text-13"><strong>{peers.find((peer) => peer.actorId === comment.authorId)?.displayName ?? (comment.authorId === actorId ? "我" : mentionMembers.find(member => member.userId === comment.authorId)?.displayName ?? "成员信息暂不可用")}</strong>：{comment.body}{comment.mentions.length ? <span className="ml-1 text-primary">{comment.mentions.map((item) => `@${mentionMembers.find(member => member.userId === item.userId)?.displayName ?? "成员信息暂不可用"}`).join(" ")}</span> : null}</p>)}<div className="flex gap-2"><Button disabled={commentReadOnly || commentPending || thread.status === "resolved" || !commentBody.trim()} onClick={() => void commentAction({ type: "reply", requestId: crypto.randomUUID(), commentId: crypto.randomUUID(), threadId: thread.id, body: commentBody, mentions: mentions(), expectedRevision: thread.revision })}>回复</Button><Button disabled={commentReadOnly || commentPending} onClick={() => void commentAction({ type: "resolve", requestId: crypto.randomUUID(), threadId: thread.id, resolved: thread.status !== "resolved", expectedRevision: thread.revision })}>{thread.status === "resolved" ? "重新打开" : "标记解决"}</Button></div></article>) : <p className="text-13 text-muted-foreground">还没有评论，写下第一条讨论。</p>}<Textarea aria-label="评论内容" value={commentBody} maxLength={4000} onChange={(event) => setCommentBody(event.target.value)} placeholder="写评论或回复…"/><BoardMentionPicker members={mentionMembers} selected={mentionIds} onChange={setMentionIds} disabled={commentReadOnly || commentPending} loading={mentionLoading} error={mentionError} onRetry={() => setMentionRetry(value => value + 1)}/><Button variant="primary" disabled={commentReadOnly || commentPending || !commentBody.trim()} onClick={() => void commentAction({ type: "create-comment", requestId: crypto.randomUUID(), threadId: crypto.randomUUID(), commentId: crypto.randomUUID(), objectId: commentObjectId, worldPosition: null, body: commentBody, mentions: mentions(), expectedRevision: 0 })}>发布评论</Button></aside> : null}
    <Dialog open={bulk !== null} onOpenChange={(open) => { if (!open) setBulk(null); }}><DialogContent closeTestId="board-bulk-close"><DialogTitle>批量创建便利贴</DialogTitle><DialogDescription>每行一个想法，单次最多 100 行；整批只产生一个可协作操作。</DialogDescription><Textarea autoFocus data-testid="board-bulk-text" aria-label="批量便利贴文字" rows={10} value={bulk ?? ""} onChange={(event) => setBulk(event.target.value)} /><div className="flex justify-end gap-2"><Button onClick={() => setBulk(null)}>取消</Button><Button variant="primary" data-testid="board-bulk-apply" onClick={() => { try { createStickyBatch(parseBulkStickyLines(bulk ?? ""), centerPoint(viewport)); setBulk(null); } catch (error) { setNotice(error instanceof Error && error.message === "BULK_STICKY_LIMIT_EXCEEDED" ? "一次最多创建 100 张便利贴。" : "请输入至少一行内容。"); } }}>创建便利贴</Button></div></DialogContent></Dialog>
    <Dialog open={pasteChoice !== null} onOpenChange={(open) => { if (!open) setPasteChoice(null); }}><DialogContent closeTestId="board-paste-close"><DialogTitle>如何放入这些内容？</DialogTitle><DialogDescription>检测到多行文字。你可以保留为一段文字，或把每一行变成独立便利贴。</DialogDescription><div className="grid gap-2"><Button onClick={() => { if (pasteChoice) { createTextAt(pasteChoice.point, "body", parseThinkingPaste(pasteChoice.text).text); setPasteChoice(null); } }}>粘贴为文字</Button><Button variant="primary" data-testid="board-paste-stickies" onClick={() => { if (pasteChoice) { const parsed = parseThinkingPaste(pasteChoice.text); createStickyBatch(parsed.stickies, pasteChoice.point); setPasteChoice(null); } }}>创建 {pasteChoice ? parseThinkingPaste(pasteChoice.text).stickies.length : 0} 张便利贴</Button><Button onClick={() => { if (pasteChoice) { const parsed = parseThinkingPaste(pasteChoice.text); createTextAt(pasteChoice.point, "body", parsed.list.map((line) => `• ${line}`).join("\n")); setPasteChoice(null); } }}>创建列表</Button></div></DialogContent></Dialog>
    <Dialog open={structuredDraft !== null} onOpenChange={(open) => { if (!open) setStructuredDraft(null); }}><DialogContent closeTestId="board-structured-close"><DialogTitle>编辑结构化对象</DialogTitle><DialogDescription>标题与字段会一起写回 canonical 对象；字段 JSON 必须符合当前对象类型。</DialogDescription><Input data-testid="board-structured-title" aria-label="结构标题" value={structuredDraft?.title ?? ""} onChange={(event) => setStructuredDraft((current) => current ? { ...current, title: event.target.value } : current)} /><Textarea data-testid="board-structured-details" aria-label="结构字段 JSON" rows={10} value={structuredDraft?.details ?? ""} onChange={(event) => setStructuredDraft((current) => current ? { ...current, details: event.target.value } : current)} /><div className="flex justify-end gap-2"><Button onClick={() => setStructuredDraft(null)}>取消</Button><Button variant="primary" data-testid="board-structured-save" onClick={saveStructuredEdit}>保存字段</Button></div></DialogContent></Dialog>
    <Dialog open={imageDialog !== null} onOpenChange={(open) => { if (!open) setImageDialog(null); }}><DialogContent closeTestId="board-image-close"><DialogTitle>{imageDialog?.targetId ? "替换图片" : "添加图片"}</DialogTitle><DialogDescription>使用可长期访问的 HTTPS 图片地址，或选择本地文件。地址与本地文件都会校验大小、格式、文件签名和真实尺寸。文件先保存在当前浏览器会话；连接资产服务后可持久化给其他成员。</DialogDescription><Input data-testid="board-image-url" aria-label="HTTPS 图片地址" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…/image.png" /><div className="flex justify-end gap-2"><Button onClick={() => imageInput.current?.click()}>选择本地图片</Button><Button variant="primary" disabled={imageBusy || !imageUrl} data-testid="board-image-url-apply" onClick={() => void importRemoteImage()}>{imageBusy ? "验证中" : "添加图片"}</Button></div></DialogContent></Dialog>
    <Dialog open={panelDelete !== null} onOpenChange={(open) => { if (!open) setPanelDelete(null); }}><DialogContent closeTestId="board-panel-delete-close"><DialogTitle>删除区域</DialogTitle><DialogDescription>选择如何处理区域里的对象。保留内容会把直接子对象移回上一级；级联删除会删除所有嵌套内容和关联连接线。</DialogDescription><div className="grid gap-2"><Button data-testid="board-panel-delete-preserve" onClick={() => { if (panelDelete && executeSpatial({ type: "delete-panel", id: panelDelete, children: "preserve" })) { setSelected([]); setPanelDelete(null); } }}>删除区域，保留内容</Button><Button variant="primary" data-testid="board-panel-delete-cascade" onClick={() => { if (panelDelete && executeSpatial({ type: "delete-panel", id: panelDelete, children: "cascade" })) { setSelected([]); setPanelDelete(null); } }}>删除区域及所有内容</Button></div></DialogContent></Dialog>
  </section>;
}
