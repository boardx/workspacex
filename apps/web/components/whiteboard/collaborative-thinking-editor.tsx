"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type PointerEvent } from "react";
import type * as Y from "yjs";
import { ContentObjectCommandPort, copyObjects, createContentObjectEnvelope, createStickyBatchEnvelope, instantiateTemplateEnvelope, nextStickyPlacement, parseBulkStickyLines, parseThinkingPaste, readContentObject, readObjects, validateTextAttributes, type BoardCommandEnvelope, type CanonicalContentObject, type DrawingStroke, type DrawingTool, type StickyVariant, type TextStylePreset, type WhiteboardCommand, type WhiteboardObject } from "@repo/whiteboard-core";
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
import { inspectRemoteImageUrl, verifyBoardImageBytes, type BoardContentData, type BoardShapeVariant, type BoardStructuredKind, type VerifiedBoardImage } from "./board-content-adapter";
import { getBoardSessionImageAsset, registerBoardSessionImageAsset, revokeBoardSessionImageAsset } from "./board-session-image-assets";

type Point = { x: number; y: number };
type EditSession = { id: string; initial: string };
type PasteChoice = { text: string; point: Point } | null;
type StructuredDraft = { objectId: string; title: string; details: string } | null;
export interface CollaborativeThinkingEditorProps { boardId: string; clientId: string; doc: Y.Doc; readOnly: boolean; title: string; status: string; onTitleChange?: (title: string) => void; onBack?: () => void; onSelectionChange?: (ids: string[]) => void; onAwareness?: (cursor: Point | null, ids: string[]) => void; peers?: WhiteboardConnectionState["peers"]; currentUserId?: string; }

const stickySize = (variant: StickyVariant) => variant === "rectangle" ? { width: 240, height: 150 } : { width: 180, height: 180 };
const centerPoint = (viewport: BoardViewport): Point => ({ x: (window.innerWidth / 2 - viewport.panX) / viewport.zoom, y: (window.innerHeight / 2 - viewport.panY) / viewport.zoom });
const topLeft = (point: Point, width: number, height: number) => ({ x: point.x - width / 2, y: point.y - height / 2, width, height, rotation: 0 });
const drawingBounds = (points: ReadonlyArray<Point>) => { const xs = points.map((point) => point.x), ys = points.map((point) => point.y); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y), rotation: 0 }; };
const isEditableTarget = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
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

export function CollaborativeThinkingEditor({ boardId, clientId, doc, readOnly, title, status, onTitleChange, onBack, onSelectionChange, onAwareness, peers = [], currentUserId }: CollaborativeThinkingEditorProps) {
  const model = useWhiteboardDocument(doc, readOnly);
  const contentPort = useMemo(() => new ContentObjectCommandPort(doc), [doc]);
  const objects = useMemo(() => toBoardFabricObjects(model.objects), [model.objects]);
  const visibleObjectIdKey = objects.map((object) => object.id).join("\u0000");
  const [selected, setSelected] = useState<string[]>([]), [tool, setTool] = useState<BoardFabricTool>("select"), [creationTool, setCreationTool] = useState<BoardCreationTool>(null);
  const [viewport, setViewport] = useState<BoardViewport>({ zoom: 1, panX: 0, panY: 0, fitRequest: 0, fitMode: "board" });
  const [notice, setNotice] = useState(""), [editing, setEditing] = useState<EditSession | null>(null), [conflictedDraft, setConflictedDraft] = useState<string | null>(null);
  const [bulk, setBulk] = useState<string | null>(null), [pasteChoice, setPasteChoice] = useState<PasteChoice>(null);
  const [imageDialog, setImageDialog] = useState<{ targetId?: string } | null>(null), [imageUrl, setImageUrl] = useState(""), [imageBusy, setImageBusy] = useState(false);
  const [structuredDraft, setStructuredDraft] = useState<StructuredDraft>(null);
  const clipboard = useRef<WhiteboardObject[]>([]);
  const imageInput = useRef<HTMLInputElement>(null);
  const ownedImageAssets = useRef(new Set<string>());
  const mounted = useRef(true);
  const imageRequestGeneration = useRef(0);
  const remoteImageAbort = useRef<AbortController | null>(null);

  useEffect(() => { onSelectionChange?.(selected); onAwareness?.(null, selected); }, [onAwareness, onSelectionChange, selected]);
  useEffect(() => { const ids = new Set(visibleObjectIdKey ? visibleObjectIdKey.split("\u0000") : []); setSelected((current) => current.filter((id) => ids.has(id))); setEditing((current) => current && ids.has(current.id) ? current : null); }, [visibleObjectIdKey]);
  useEffect(() => {
    mounted.current = true;
    const sessionAssets = ownedImageAssets.current;
    return () => {
      mounted.current = false;
      imageRequestGeneration.current += 1;
      remoteImageAbort.current?.abort();
      remoteImageAbort.current = null;
      for (const assetId of sessionAssets) revokeBoardSessionImageAsset(assetId);
      sessionAssets.clear();
    };
  }, []);

  const dispatchEnvelope = useCallback((envelope: BoardCommandEnvelope): boolean => {
    if (readOnly) { setNotice("当前白板为只读，不能修改。"); return false; }
    try { const accepted = model.execute(envelope); if (!accepted) { setNotice("操作未应用：命令通道尚未就绪，请重试。"); return false; } setNotice(""); return true; }
    catch { setNotice("操作未应用：请检查对象是否仍存在或内容是否超出限制。"); return false; }
  }, [model, readOnly]);
  const execute = useCallback((commands: WhiteboardCommand[], gestureId = crypto.randomUUID()) => dispatchEnvelope({ boardId, clientId, gestureId, commands }), [boardId, clientId, dispatchEnvelope]);
  const replaceContent = useCallback((id: string, content: CanonicalContentObject): boolean => {
    if (readOnly) return false;
    try { contentPort.dispatch({ boardId, clientId, gestureId: crypto.randomUUID(), command: { type: "replace-content", id, content } }); setNotice(""); return true; }
    catch { setNotice("对象属性未应用，内容已安全保留。请重试。"); return false; }
  }, [boardId, clientId, contentPort, readOnly]);
  const beginEditing = useCallback((id: string) => { const object = readObjects(doc).find((candidate) => candidate.id === id); if (!object) return; setSelected([id]); setEditing({ id, initial: object.text }); }, [doc]);

  const createStickyAt = useCallback((point: Point, variant: StickyVariant = "square", text = "") => {
    if (readOnly) { setNotice("当前白板为只读，不能创建便利贴。"); return null; }
    const id = crypto.randomUUID(), size = stickySize(variant);
    const envelope = createStickyBatchEnvelope({ boardId, clientId, gestureId: crypto.randomUUID(), variant, items: [{ id, text, geometry: topLeft(point, size.width, size.height) }] });
    if (!dispatchEnvelope(envelope)) return null; setSelected([id]); setEditing({ id, initial: text }); return id;
  }, [boardId, clientId, dispatchEnvelope, readOnly]);
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
    const geometry = isShape ? topLeft(point, 220, 150) : content.type === "drawing" ? drawingBounds(content.strokes.flatMap((stroke) => stroke.points)) : topLeft(point, content.type === "image" ? 320 : 280, imageHeight);
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
  const createFromTool = useCallback((point: Point, requested = creationTool) => { if (requested?.kind === "sticky") createStickyAt(point, requested.variant); else if (requested?.kind === "text") createTextAt(point, requested.preset); else if (requested?.kind === "shape") createShapeAt(point, requested.variant); else if (requested?.kind === "content") createStructuredAt(point, requested.contentType); }, [createShapeAt, createStickyAt, createStructuredAt, createTextAt, creationTool]);
  const createStickyBatch = useCallback((lines: readonly string[], point: Point) => {
    const items = lines.map((text, index) => ({ id: crypto.randomUUID(), text, geometry: { x: point.x + (index % 5) * 204, y: point.y + Math.floor(index / 5) * 204, width: 180, height: 180, rotation: 0 } }));
    if (!dispatchEnvelope(createStickyBatchEnvelope({ boardId, clientId, gestureId: crypto.randomUUID(), items }))) return;
    setSelected(items.map((item) => item.id)); setNotice(`已用一次操作创建 ${items.length} 张便利贴。`);
  }, [boardId, clientId, dispatchEnvelope]);
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

  useEffect(() => { const keydown = (event: KeyboardEvent) => { if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return; const key = event.key.toLowerCase(); if (key === "v") { setTool("select"); setCreationTool(null); } else if (key === "h" || event.code === "Space") { event.preventDefault(); setTool("hand"); setCreationTool(null); } else if (key === "n" && event.shiftKey) { event.preventDefault(); if (!readOnly) setBulk(""); } else if (key === "n") { event.preventDefault(); const requested = { kind: "sticky", variant: "square" } as const; setTool("select"); setCreationTool(requested); createStickyAt(centerPoint(viewport), requested.variant); } else if (key === "t") { event.preventDefault(); const requested = { kind: "text", preset: "body" } as const; setTool("select"); setCreationTool(requested); createTextAt(centerPoint(viewport), requested.preset); } else if (key === "s") { event.preventDefault(); const requested = { kind: "shape", variant: "rounded-rectangle" } as const; setTool("select"); setCreationTool(requested); createShapeAt(centerPoint(viewport), requested.variant); } else if (key === "p") { event.preventDefault(); setCreationTool(null); setTool("draw-pen"); } else if (key === "i") { event.preventDefault(); imageInput.current?.click(); } }; window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown); }, [createShapeAt, createStickyAt, createTextAt, readOnly, viewport]);

  const editingObject = editing ? model.objects.find((candidate) => candidate.id === editing.id) : undefined;
  const commitVerifiedImage = useCallback((verified: VerifiedBoardImage, fileName: string, point: Point, targetId?: string, sourceUrl: string | null = null) => {
    const asset = registerBoardSessionImageAsset({ blob: verified.blob, mimeType: verified.mimeType, byteSize: verified.byteSize, contentDigest: verified.contentDigest, intrinsicWidth: verified.intrinsicWidth, intrinsicHeight: verified.intrinsicHeight });
    const content: Extract<CanonicalContentObject, { type: "image" }> = { version: 1, type: "image", status: "ready", assetId: asset.assetId, sourceUrl, mimeType: verified.mimeType, intrinsicWidth: verified.intrinsicWidth, intrinsicHeight: verified.intrinsicHeight, crop: { x: 0, y: 0, width: 1, height: 1 }, opacity: 1, borderColor: "#FFFFFF", borderWidth: 0, cornerRadius: 0, fileName, replacementOf: targetId ?? null, failureCode: null, byteSize: verified.byteSize, contentDigest: verified.contentDigest, magicMimeType: verified.magicMimeType, retryCount: 0, persistence: "local-session" };
    const accepted = targetId ? replaceContent(targetId, content) : Boolean(createContentAt(point, content, fileName));
    if (!accepted) { revokeBoardSessionImageAsset(asset.assetId); return false; }
    ownedImageAssets.current.add(asset.assetId);
    setNotice("图片已在当前浏览器会话中验证并显示；连接资产服务后可持久化供其他成员使用。");
    return true;
  }, [createContentAt, replaceContent]);
  const importImage = useCallback(async (file: File, point = centerPoint(viewport), targetId = imageDialog?.targetId) => {
    if (!file.type.match(/^image\/(png|jpeg|webp|gif|svg\+xml)$/)) { setNotice("无法添加图片：请选择 JPG、PNG、WEBP、GIF 或 SVG 文件。"); return; }
    const generation = ++imageRequestGeneration.current;
    remoteImageAbort.current?.abort();
    remoteImageAbort.current = null;
    setImageBusy(true);
    try {
      const verified = await verifyBoardImageBytes(file, file.type);
      if (!mounted.current || generation !== imageRequestGeneration.current) return;
      if (commitVerifiedImage(verified, file.name, point, targetId)) setImageDialog(null);
    } catch (error) {
      if (!mounted.current || generation !== imageRequestGeneration.current) return;
      const code = error instanceof Error ? error.message : "IMAGE_DECODE_FAILED";
      setNotice(code === "IMAGE_TOO_LARGE" ? "图片超过 25MB，未添加。" : code === "IMAGE_MAGIC_INVALID" ? "图片内容与声明格式不一致，未添加。" : "图片无法安全解码，未添加。");
    } finally { if (mounted.current && generation === imageRequestGeneration.current) setImageBusy(false); }
  }, [commitVerifiedImage, imageDialog?.targetId, viewport]);
  const importRemoteImage = useCallback(async () => {
    const generation = ++imageRequestGeneration.current;
    remoteImageAbort.current?.abort();
    const controller = new AbortController();
    remoteImageAbort.current = controller;
    setImageBusy(true);
    try {
      const inspected = await inspectRemoteImageUrl(imageUrl, fetch, controller.signal);
      if (!mounted.current || generation !== imageRequestGeneration.current) return;
      const name = new URL(inspected.url).pathname.split("/").pop() || "remote-image";
      if (commitVerifiedImage(inspected, name, centerPoint(viewport), imageDialog?.targetId, inspected.url)) { setImageDialog(null); setImageUrl(""); }
    } catch (error) { if (!mounted.current || generation !== imageRequestGeneration.current) return; const code = error instanceof Error ? error.message : "IMAGE_FETCH_FAILED"; setNotice(code === "IMAGE_TOO_LARGE" ? "图片超过 25MB，未添加。" : code === "IMAGE_MAGIC_INVALID" ? "图片内容与声明格式不一致，未添加。" : "无法读取该 HTTPS 图片。请检查地址、跨域权限和文件格式。"); }
    finally { if (remoteImageAbort.current === controller) remoteImageAbort.current = null; if (mounted.current && generation === imageRequestGeneration.current) setImageBusy(false); }
  }, [commitVerifiedImage, imageDialog?.targetId, imageUrl, viewport]);
  const handlePaste = (event: ClipboardEvent<HTMLElement>) => { if (readOnly || isEditableTarget(event.target)) return; const image = Array.from(event.clipboardData.files ?? []).find((file) => file.type.startsWith("image/")); if (image) { event.preventDefault(); importImage(image); return; } const value = event.clipboardData.getData("text/plain"); if (!value.includes("\n")) return; try { parseThinkingPaste(value); event.preventDefault(); setPasteChoice({ text: value, point: centerPoint(viewport) }); } catch { /* Preserve normal paste. */ } };
  const handleFileDrop = (event: DragEvent<HTMLElement>) => { const image = [...event.dataTransfer.files].find((file) => file.type.startsWith("image/")); if (!image || readOnly) return; event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); importImage(image, { x: (event.clientX - bounds.left - viewport.panX) / viewport.zoom, y: (event.clientY - bounds.top - viewport.panY) / viewport.zoom }); };
  const announceCursor = (event: PointerEvent<HTMLDivElement>) => { const bounds = event.currentTarget.getBoundingClientRect(); onAwareness?.({ x: (event.clientX - bounds.left - viewport.panX) / viewport.zoom, y: (event.clientY - bounds.top - viewport.panY) / viewport.zoom }, selected); };
  const selectedObject = selected.length === 1 ? model.objects.find((object) => object.id === selected[0]) : undefined;
  const selectedContent = selectedObject ? readContentObject(selectedObject) : null;
  const commitDrawing = (drawingTool: DrawingTool, points: Array<{ x: number; y: number; pressure: number }>) => {
    const styles: Record<DrawingTool, { color: string; width: number; opacity: number }> = { pen: { color: "#18181B", width: 3, opacity: 1 }, marker: { color: "#2563EB", width: 8, opacity: .9 }, highlighter: { color: "#FACC15", width: 20, opacity: .35 }, eraser: { color: "#FFFFFF", width: 24, opacity: 1 } };
    const draft: DrawingStroke = { id: crypto.randomUUID(), tool: drawingTool, points, ...styles[drawingTool], ...(drawingTool === "eraser" && selectedContent?.type === "drawing" ? { erases: selectedContent.strokes.filter((item) => item.tool !== "eraser").map((item) => item.id) } : {}) };
    try {
      const existing = selectedContent?.type === "drawing" ? selectedContent.strokes : [];
      const stroke = fitDrawingStrokeToExtensionBudget(existing, draft);
      if (selectedObject && selectedContent?.type === "drawing") { replaceContent(selectedObject.id, { ...selectedContent, strokes: [...selectedContent.strokes, stroke] }); return; }
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
  return <section data-testid="collaborative-editor" className="fixed inset-0 overflow-hidden bg-background text-foreground" onPaste={handlePaste} onDragOver={(event) => { if ([...event.dataTransfer.items].some((item) => item.kind === "file")) event.preventDefault(); }} onDrop={handleFileDrop}>
    <div data-testid="board-live-surface" className="absolute inset-0" onPointerMove={announceCursor} onPointerLeave={() => onAwareness?.(null, selected)}>
      <BoardFabricSurface objects={objects} selectedObjectIds={selected} readOnly={readOnly} tool={tool} viewport={viewport} onSelectionChange={(ids, source) => { setSelected([...ids]); if (source === "outline" && ids[0]) beginEditing(ids[0]); }} onObjectTransform={(id, geometry) => execute([{ type: "geometry", id, geometry }])} onViewportChange={setViewport} onCanvasClick={createFromTool} onCanvasDoubleClick={(point) => { if (!readOnly && !creationTool && tool === "select") createStickyAt(point); }} onObjectDoubleClick={beginEditing} onToolDrop={(point, payload) => { try { const requested = JSON.parse(payload) as BoardCreationTool; createFromTool(point, requested); } catch { setNotice("无法识别拖入的白板工具。"); } }} onDrawingComplete={({ tool: drawingTool, points }) => commitDrawing(drawingTool, points)} className="absolute inset-0 overflow-hidden bg-panel-alt" />
      {editingObject && editing ? <ThinkingInputEditor key={editing.id} objectId={editing.id} initialValue={editingObject.text} geometry={editingObject.geometry} viewport={viewport} readOnly={readOnly} onLiveCommit={(value) => commitEdit(value, false)} onCommit={(value) => commitEdit(value, true)} onCancel={() => setEditing(null)} onContinue={() => continueSticky(editing.id)} /> : null}
      <div className="pointer-events-none absolute inset-0 origin-top-left" style={{ transform: `translate(${viewport.panX}px,${viewport.panY}px) scale(${viewport.zoom})` }}>{peers.filter((peer) => peer.actorId !== currentUserId).map((peer) => <div key={peer.actorId}>{peer.selected.map((id) => { const item = model.objects.find((candidate) => candidate.id === id); if (!item) return null; const g = item.geometry; return <div key={id} data-testid={`peer-selection-${peer.actorId}-${id}`} className="absolute rounded-control border-2 border-dashed border-primary" style={{ left: g.x, top: g.y, width: g.width, height: g.height, transform: `rotate(${g.rotation}deg)` }} />; })}{peer.cursor ? <div data-testid={`peer-cursor-${peer.actorId}`} className="absolute text-primary" style={{ left: peer.cursor.x, top: peer.cursor.y }}><span aria-hidden="true">↖</span><span className="rounded-control bg-primary px-1 text-11 text-primary-foreground">{peer.actorId}</span></div> : null}</div>)}</div>
    </div>
    {selectedObject && !readOnly ? <div data-testid="board-context-toolbar" className="absolute z-30 flex items-center gap-1 rounded-xl border border-border bg-card/95 p-1 shadow-xl backdrop-blur" style={{ left: selectedObject.geometry.x * viewport.zoom + viewport.panX, top: Math.max(64, selectedObject.geometry.y * viewport.zoom + viewport.panY - 52) }}><button type="button" className="rounded-lg px-2 py-1 text-12 transition-colors hover:bg-accent" onClick={() => beginEditing(selectedObject.id)}>编辑</button>{["#F8D76E", "#F9A8D4", "#93C5FD", "#86EFAC", "#C4B5FD"].map((fill) => <button key={fill} type="button" aria-label={`填充色 ${fill}`} className="h-7 w-7 rounded-full border border-border transition-transform hover:scale-110" style={{ background: fill }} onClick={() => selectedContent?.type === "shape" ? replaceContent(selectedObject.id, { ...selectedContent, fill }) : execute([{ type: "style", id: selectedObject.id, style: { ...selectedObject.style, fill } }])} />)}{selectedContent?.type === "shape" ? <><button type="button" onClick={() => replaceContent(selectedObject.id, { ...selectedContent, borderStyle: selectedContent.borderStyle === "solid" ? "dashed" : "solid", borderWidth: selectedContent.borderWidth ? selectedContent.borderWidth : 2 })}>边框样式</button><button type="button" onClick={() => replaceContent(selectedObject.id, { ...selectedContent, opacity: selectedContent.opacity === 1 ? .6 : 1 })}>形状透明度</button><button type="button" onClick={() => replaceContent(selectedObject.id, { ...selectedContent, radius: selectedContent.radius ? 0 : 24 })}>圆角</button><button type="button" onClick={() => replaceContent(selectedObject.id, { ...selectedContent, horizontalAlign: selectedContent.horizontalAlign === "center" ? "left" : "center", verticalAlign: selectedContent.verticalAlign === "middle" ? "top" : "middle" })}>文字对齐</button></> : null}{selectedContent?.type === "drawing" ? <><button type="button" onClick={() => replaceContent(selectedObject.id, { ...selectedContent, strokes: selectedContent.strokes.map((stroke) => stroke.tool === "eraser" ? stroke : { ...stroke, color: stroke.color === "#18181B" ? "#2563EB" : "#18181B" }) })}>笔色</button><button type="button" onClick={() => replaceContent(selectedObject.id, { ...selectedContent, strokes: selectedContent.strokes.map((stroke) => ({ ...stroke, width: Math.min(1000, stroke.width + 2) })) })}>加粗</button><button type="button" onClick={() => replaceContent(selectedObject.id, { ...selectedContent, strokes: selectedContent.strokes.map((stroke) => ({ ...stroke, opacity: stroke.opacity === 1 ? .5 : 1 })) })}>笔迹透明度</button></> : null}{selectedContent && ["tile", "web-tile", "table", "icon", "template"].includes(selectedContent.type) ? <button type="button" onClick={beginStructuredEdit}>编辑字段</button> : null}{selectedContent?.type === "image" ? <><button type="button" onClick={() => replaceContent(selectedObject.id, { ...selectedContent, crop: selectedContent.crop.x === 0 ? { x: .1, y: .1, width: .8, height: .8 } : { x: 0, y: 0, width: 1, height: 1 } })}>裁剪</button><button type="button" onClick={() => replaceContent(selectedObject.id, { ...selectedContent, opacity: selectedContent.opacity === 1 ? .6 : 1 })}>透明度</button><button type="button" onClick={() => replaceContent(selectedObject.id, { ...selectedContent, borderWidth: selectedContent.borderWidth ? 0 : 2, borderColor: "#18181B" })}>边框</button><button type="button" onClick={() => replaceContent(selectedObject.id, { ...selectedContent, cornerRadius: selectedContent.cornerRadius ? 0 : 20 })}>圆角</button><button type="button" onClick={() => { setImageUrl(""); setImageDialog({ targetId: selectedObject.id }); }}>替换</button>{getBoardSessionImageAsset(selectedContent.assetId) ? <a className="px-2 py-1 text-12" href={getBoardSessionImageAsset(selectedContent.assetId)!.objectUrl} download={selectedContent.fileName}>下载</a> : null}</> : null}<button type="button" aria-label="复制对象" className="rounded-lg px-2 py-1 text-12 transition-colors hover:bg-accent" onClick={() => { const [copy] = copyObjects(doc, [selectedObject.id], () => crypto.randomUUID()); if (copy && execute([{ type: "create", object: { ...copy, geometry: { ...copy.geometry, x: copy.geometry.x + 24, y: copy.geometry.y + 24 } } }])) setSelected([copy.id]); }}>复制</button><button type="button" className="rounded-lg px-2 py-1 text-12 text-destructive transition-colors hover:bg-accent" onClick={() => { if (execute([{ type: "delete", id: selectedObject.id }])) setSelected([]); }}>删除</button></div> : null}
    <header className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 p-3 backdrop-blur">{onBack ? <Button onClick={onBack}>返回白板</Button> : null}<Input aria-label="白板名称" className="max-w-64" value={title} disabled={readOnly || !onTitleChange} onChange={(event) => { if (!readOnly) onTitleChange?.(event.target.value); }} /><span role="status" className="text-12">{status}{readOnly ? " · 只读" : ""}</span><span className="ml-auto text-12 text-muted-foreground">在线成员 {peers.length}</span></header>
    <div className="absolute bottom-5 left-5 z-20 flex items-center gap-1 rounded-xl border border-border bg-card/95 p-1 shadow-lg backdrop-blur"><Button disabled={readOnly} onClick={() => { const result = model.undo(); setNotice(result === "undone" ? "已撤销本地修改" : result === "conflict" ? "未撤销：当前画板与这次修改存在冲突，请核对后再操作。" : result === "creation-requires-explicit-delete" ? "创建对象请使用删除；为保护其他人的修改，不撤销对象创建。" : "没有可撤销的本地修改。"); }}>撤销</Button><Button disabled={readOnly} onClick={() => setNotice(model.redo() ? "已重做本地修改" : "未重做：没有可重做的本地修改，或当前画板存在冲突。")}>重做</Button><Button disabled={!selected.length} onClick={() => { clipboard.current = copyObjects(doc, selected, () => crypto.randomUUID()); setNotice("已复制到当前白板剪贴板"); }}>复制</Button><Button disabled={readOnly || !clipboard.current.length} onClick={() => { const ids = new Map(clipboard.current.map((entry) => [entry.id, crypto.randomUUID()])); const copied = clipboard.current.map((entry) => ({ ...entry, id: ids.get(entry.id)!, parentId: entry.parentId ? ids.get(entry.parentId) ?? null : null, connector: entry.connector ? { from: ids.get(entry.connector.from)!, to: ids.get(entry.connector.to)! } : undefined, geometry: { ...entry.geometry, x: entry.geometry.x + 24, y: entry.geometry.y + 24 } })); if (copied.length && execute(copied.map((entry) => ({ type: "create", object: entry })))) setSelected(copied.map((entry) => entry.id)); }}>粘贴</Button><Button disabled={readOnly || !selected.length} onClick={() => { if (execute(selected.map((id) => ({ type: "delete", id })))) setSelected([]); }}>删除选中</Button><Button data-testid="board-zoom-out" aria-label="缩小" onClick={() => setViewport((current) => ({ ...current, zoom: clampBoardZoom(current.zoom - .1) }))}>缩小</Button><span data-testid="board-zoom-value" className="w-12 text-center text-12">{Math.round(viewport.zoom * 100)}%</span><Button data-testid="board-zoom-in" aria-label="放大" onClick={() => setViewport((current) => ({ ...current, zoom: clampBoardZoom(current.zoom + .1) }))}>放大</Button><Button data-testid="board-zoom-fit-selection" disabled={!selected.length} onClick={() => setViewport((current) => ({ ...current, fitMode: "selection", fitRequest: current.fitRequest + 1 }))}>适应选择</Button><Button data-testid="board-zoom-fit-board" onClick={() => setViewport((current) => ({ ...current, fitMode: "board", fitRequest: current.fitRequest + 1 }))}>适应白板</Button></div>
    <input ref={imageInput} data-testid="board-image-input" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml" onChange={(event) => { const file = event.target.files?.[0]; if (file) importImage(file); event.target.value = ""; }} />
    <BoardBottomDock activeTool={tool} creationTool={creationTool} readOnly={readOnly} onToolChange={setTool} onCreationToolChange={setCreationTool} onQuickCreate={(requested) => requested.kind === "sticky" ? createStickyAt(centerPoint(viewport), requested.variant, "写下一个想法") : requested.kind === "text" ? createTextAt(centerPoint(viewport), requested.preset) : requested.kind === "shape" ? createShapeAt(centerPoint(viewport), requested.variant) : createStructuredAt(centerPoint(viewport), requested.contentType)} onBulkSticky={() => setBulk("")} onImageRequest={() => { setImageUrl(""); setImageDialog({}); }} />
    {conflictedDraft !== null ? <aside className="absolute right-4 top-20 z-30 w-72 rounded-xl border border-border bg-card p-3 shadow-xl"><label className="text-12">未应用的输入草稿<Textarea aria-label="未应用的输入草稿" readOnly value={conflictedDraft} /></label><Button onClick={() => setConflictedDraft(null)}>关闭草稿</Button></aside> : null}<p role="status" className="absolute bottom-0 left-1/2 z-20 min-h-5 -translate-x-1/2 rounded-t-lg bg-background/90 px-3 text-12">{notice || `${selected.length} 个已选对象`}</p>
    <Dialog open={bulk !== null} onOpenChange={(open) => { if (!open) setBulk(null); }}><DialogContent closeTestId="board-bulk-close"><DialogTitle>批量创建便利贴</DialogTitle><DialogDescription>每行一个想法，单次最多 100 行；整批只产生一个可协作操作。</DialogDescription><Textarea autoFocus data-testid="board-bulk-text" aria-label="批量便利贴文字" rows={10} value={bulk ?? ""} onChange={(event) => setBulk(event.target.value)} /><div className="flex justify-end gap-2"><Button onClick={() => setBulk(null)}>取消</Button><Button variant="primary" data-testid="board-bulk-apply" onClick={() => { try { createStickyBatch(parseBulkStickyLines(bulk ?? ""), centerPoint(viewport)); setBulk(null); } catch (error) { setNotice(error instanceof Error && error.message === "BULK_STICKY_LIMIT_EXCEEDED" ? "一次最多创建 100 张便利贴。" : "请输入至少一行内容。"); } }}>创建便利贴</Button></div></DialogContent></Dialog>
    <Dialog open={pasteChoice !== null} onOpenChange={(open) => { if (!open) setPasteChoice(null); }}><DialogContent closeTestId="board-paste-close"><DialogTitle>如何放入这些内容？</DialogTitle><DialogDescription>检测到多行文字。你可以保留为一段文字，或把每一行变成独立便利贴。</DialogDescription><div className="grid gap-2"><Button onClick={() => { if (pasteChoice) { createTextAt(pasteChoice.point, "body", parseThinkingPaste(pasteChoice.text).text); setPasteChoice(null); } }}>粘贴为文字</Button><Button variant="primary" data-testid="board-paste-stickies" onClick={() => { if (pasteChoice) { const parsed = parseThinkingPaste(pasteChoice.text); createStickyBatch(parsed.stickies, pasteChoice.point); setPasteChoice(null); } }}>创建 {pasteChoice ? parseThinkingPaste(pasteChoice.text).stickies.length : 0} 张便利贴</Button><Button onClick={() => { if (pasteChoice) { const parsed = parseThinkingPaste(pasteChoice.text); createTextAt(pasteChoice.point, "body", parsed.list.map((line) => `• ${line}`).join("\n")); setPasteChoice(null); } }}>创建列表</Button></div></DialogContent></Dialog>
    <Dialog open={structuredDraft !== null} onOpenChange={(open) => { if (!open) setStructuredDraft(null); }}><DialogContent closeTestId="board-structured-close"><DialogTitle>编辑结构化对象</DialogTitle><DialogDescription>标题与字段会一起写回 canonical 对象；字段 JSON 必须符合当前对象类型。</DialogDescription><Input data-testid="board-structured-title" aria-label="结构标题" value={structuredDraft?.title ?? ""} onChange={(event) => setStructuredDraft((current) => current ? { ...current, title: event.target.value } : current)} /><Textarea data-testid="board-structured-details" aria-label="结构字段 JSON" rows={10} value={structuredDraft?.details ?? ""} onChange={(event) => setStructuredDraft((current) => current ? { ...current, details: event.target.value } : current)} /><div className="flex justify-end gap-2"><Button onClick={() => setStructuredDraft(null)}>取消</Button><Button variant="primary" data-testid="board-structured-save" onClick={saveStructuredEdit}>保存字段</Button></div></DialogContent></Dialog>
    <Dialog open={imageDialog !== null} onOpenChange={(open) => { if (!open) setImageDialog(null); }}><DialogContent closeTestId="board-image-close"><DialogTitle>{imageDialog?.targetId ? "替换图片" : "添加图片"}</DialogTitle><DialogDescription>使用可长期访问的 HTTPS 图片地址，或选择本地文件。地址与本地文件都会校验大小、格式、文件签名和真实尺寸。文件先保存在当前浏览器会话；连接资产服务后可持久化给其他成员。</DialogDescription><Input data-testid="board-image-url" aria-label="HTTPS 图片地址" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…/image.png" /><div className="flex justify-end gap-2"><Button onClick={() => imageInput.current?.click()}>选择本地图片</Button><Button variant="primary" disabled={imageBusy || !imageUrl} data-testid="board-image-url-apply" onClick={() => void importRemoteImage()}>{imageBusy ? "验证中" : "添加图片"}</Button></div></DialogContent></Dialog>
  </section>;
}
