"use client";
import * as React from "react";
import { Canvas as FabricCanvas, Point, util } from "fabric";
import {
  markdownToCanvas,
  extractModel,
  getConnectionManager,
  FlowNode,
  FlowEdge,
  attachMindmapEditor,
  type DiagramModel,
  type MindmapEditor,
} from "@repo/fabric-markdown";
import { serializeCanvasMarkdown } from "@/lib/canvas/serialize-canvas-markdown";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CanvasTool } from "./canvas-toolbar";
import { ZOOM_MIN, ZOOM_MAX } from "./canvas-toolbar";

let nodeSeq = 0;
let edgeSeq = 0;

/**
 * 画布本体 —— **真实 mermaid 引擎渲染**（F103，替换此前「非 mermaid 渲染」的静态壳）。
 *
 * 数据链（D-08 硬约束）：`markdown`（含 mermaid 围栏）由父组件持有，是唯一事实来源。
 * 挂载/`markdown` 被**源码视图手改**（外部变化）时，重新走一次
 * `markdown → mermaid 文本 → DiagramModel → fabric` 完整解析并重渲染；
 * 画布内对象被**用户在这张画布上编辑**（拖动 / 加节点 / 删除）时，走反方向
 * `fabric → DiagramModel → mermaid 文本 → markdown`，只把变化点回写给父组件 ——
 * 用 `lastEmittedRef` 记录「这次 markdown 变化是不是我自己刚发出去的」，避免
 * 画布编辑触发的回写又被当成「外部改动」重新解析一遍、把 mermaid 自动布局出的
 * 新坐标覆盖用户刚拖好的位置（R7 ②「坐标不写回 Markdown」的直接推论：
 * 一份 markdown 可以对应多种画布坐标，不能拿它当„画布状态"的权威）。
 */
/**
 * 导出（人类要求："要可以下载，画布在前端要有 pdf，png 的导出"）：`exportPNG` 是
 * `CanvasStage` 唯一对外暴露的导出能力——只做「画布内容 → PNG data URL」这一件事
 * （fabric 的既有职责本就在这里），不在这个组件里引入 `jspdf`/触发浏览器下载这些
 * 与 fabric 无关的关注点。PDF 导出、下载触发都在调用方（chat 全屏编辑器）那一层，
 * 复用同一份 `exportPNG` 产出的 data URL——不是两套独立的"截当前画布"实现。
 */
export interface CanvasStageHandle {
  /**
   * 导出**完整内容**（不是当前视口截图）：临时把 viewport 复位到 zoom=1/无平移，
   * 按全部对象的并集包围盒截图，再把 viewport 还原——用户拖动/缩放过的画布状态
   * 不受导出动作影响，截出来的图也不会因为用户当前平移到别处而缺一块。空画布
   * （没有任何节点）返回 null，不产出一张空白 PNG 冒充"导出成功"。
   */
  exportPNG(opts?: { multiplier?: number }): { dataUrl: string; width: number; height: number } | null;
  /**
   * 「看到所有内容」——按全部对象的并集包围盒重算 zoom/pan，让整张画布一次性都出现
   * 在当前视口里，不需要用户再手动滚轮/拖动去找内容（人类原话：「画布默认要可以看到
   * 整体的画布，不需要经过缩放」）。与 `exportPNG` 共用同一套并集包围盒算法（那边算完
   * 拿去截图，这边算完拿去定 viewport），不是重新发明第二份"量画布内容"的逻辑。
   * 空画布（没有任何对象）什么都不做——没有内容可"看到全部"。
   */
  fitToContent(): void;
}

export const CanvasStage = React.forwardRef<CanvasStageHandle, {
  readOnly: boolean;
  tool: CanvasTool;
  zoom: number;
  /**
   * 滚轮/trackpad 缩放（下面 `mouse:wheel` 那段）直接改的是 fabric 自己的 zoom，
   * 不经过 `zoom` 这个受控 prop——不回填就会出现「双指缩放了，但工具条的 100%
   * label 和 +/− 按钮的下一档还停在旧值」这种画布状态和 UI 显示对不上的漂移。
   * 可选：不传（老调用点）时滚轮缩放仍生效，只是不回填百分比显示，行为不倒退。
   */
  onZoomChange?: (next: number) => void;
  markdown: string;
  onMarkdownChange: (next: string) => void;
  /**
   * 2026-08-23（模板编辑面板要求「真正的可视化编辑器」）：只读模式下点击画布空白处
   * 触发，回传**场景坐标**（`canvas.getPointer()`，已经按当前 viewport 换算过，
   * 不是原始屏幕像素）。
   *
   * ⚠ 为什么不是"点中了哪个分区框"这种更高层的事件：分区框在 `fabric-markdown`
   *   引擎里是 `locked: true`（`evented: false`），fabric **不会**在它们身上触发任何
   *   对象级事件（vendor 纪律不许改这一点，见 `VENDOR.md`）。真正可行的做法是画布级
   *   `mouse:down`（这一级事件不看 `evented`，画布本身永远收得到）配合调用方自己算的
   *   分区矩形做命中测试——`onCanvasClick` 只负责把场景坐标原样递出去，命中测试是
   *   调用方的事（它知道自己刚拿什么分区数据生成的这份 markdown，`CanvasStage` 不知道）。
   */
  onCanvasClick?: (point: { x: number; y: number }) => void;
  /**
   * 迭代 4——同 `onCanvasClick`，但在**点击之前**：鼠标移动到分区框范围内时触发，
   * 光标移出画布（或移到任何框外的空白处）时以 `null` 触发一次清空。分区框是
   * `locked`（同上，fabric 不认 hover），这里同样是画布级 `mouse:move`/`mouse:out`
   * 自己转发场景坐标，命中测试仍然是调用方的事——`CanvasStage` 不需要知道
   * "框"是什么形状，只负责把指针在哪原样递出去。
   */
  onCanvasHover?: (point: { x: number; y: number } | null) => void;
  /**
   * 首次渲染出内容、以及此后每次外部 markdown 变化重渲染完成后，自动跑一次
   * `fitToContent`——「chat 模拟」结果预览要求默认就能看到整个画布，不需要用户先手动
   * 缩放一次（人类原话，见文件头 `CanvasStageHandle.fitToContent`）。可选，默认关闭：
   * 既有调用点（正式编辑画布、模板编辑器②栏）默认 zoom=1/无平移是刻意的既有行为，
   * 不因为加了这个能力而被动改变。
   */
  fitOnLoad?: boolean;
}>(function CanvasStage({
  readOnly,
  tool,
  zoom,
  onZoomChange,
  markdown,
  onMarkdownChange,
  onCanvasClick,
  onCanvasHover,
  fitOnLoad,
}, ref) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasElRef = React.useRef<HTMLCanvasElement>(null);
  const fabricRef = React.useRef<FabricCanvas | null>(null);
  const mindmapEditorRef = React.useRef<MindmapEditor | null>(null);
  const selectedNodeIdRef = React.useRef<string | null>(null);
  // 「最近一次真的选中过的节点」——只在 selection:created/updated 时更新，
  // selection:cleared 不清它（那正是 selectedNodeIdRef 会被清的时机）。用途：
  // 思维导图模式下点空白处用"+节点"工具加子节点时，那次点击本身会先把当前
  // 选中清空（fabric 自己的空白点击行为），到我们的 mouse:down 处理跑到时
  // selectedNodeIdRef 已经是 null 了——用这个"上一次选中"的记忆代替，效果等价于
  // "先选中节点，再按 Tab"，只是鼠标点了两步操作也不会丢上下文。
  const lastSelectedNodeIdRef = React.useRef<string | null>(null);
  // 选中一条连线时记它的 edgeId——同 selectedNodeIdRef 平行的一份状态，不是复用
  // 同一个 ref：节点和边是两种不同的可删除对象，`onDeleteKey`/删除工具需要分开
  // 判断「选中的是节点还是边」，混成一个 ref 会让"选中边却按节点 id 去找"这类
  // 错误在类型层面查不出来（人类实测反馈：选中一条连线后 Delete/删除工具对它
  // 完全没反应——这两处此前都硬编码只认 FlowNode）。
  const selectedEdgeIdRef = React.useRef<string | null>(null);
  // 「连线」工具（两次点击连两个节点）的进行中状态——点了第一个节点后记它的
  // nodeId，等第二次点击；再点同一个节点 = 取消这次连线。工具切走时清空
  // （下面单独一个 effect），避免切到别的工具后这个"半成品"状态还悬着。
  const pendingEdgeSourceRef = React.useRef<string | null>(null);
  const [pendingEdgeSourceLabel, setPendingEdgeSourceLabel] = React.useState<string | null>(null);
  const lastEmittedRef = React.useRef<string>(markdown);
  const toolRef = React.useRef(tool);
  const readOnlyRef = React.useRef(readOnly);
  const onCanvasClickRef = React.useRef(onCanvasClick);
  onCanvasClickRef.current = onCanvasClick;
  const onCanvasHoverRef = React.useRef(onCanvasHover);
  onCanvasHoverRef.current = onCanvasHover;
  const markdownRef = React.useRef(markdown);
  const onMarkdownChangeRef = React.useRef(onMarkdownChange);
  const onZoomChangeRef = React.useRef(onZoomChange);
  const fitOnLoadRef = React.useRef(fitOnLoad);
  fitOnLoadRef.current = fitOnLoad;
  const inlineEditorRef = React.useRef<HTMLTextAreaElement>(null);
  const editingTargetRef = React.useRef<FlowNode | FlowEdge | null>(null);
  // 撤销/重做（人类实测反馈：此前拖歪/删错一个节点没有任何挽回手段，只能关掉
  // 整个弹窗放弃这次编辑）。历史栈存的是每次编辑后 `syncFromCanvas` emit 出的
  // markdown 快照——这条画布已经有的、从 fabric 状态推 markdown 的唯一路径，
  // 撤销/重做不发明第二套"画布对象级"历史，只是在同一条快照序列里前后移动，
  // 与「保存」看到的是同一份数据。
  const historyRef = React.useRef<string[]>([markdown]);
  const historyCursorRef = React.useRef(0);
  const restoringRef = React.useRef(false);
  const [ignoredCount, setIgnoredCount] = React.useState(0);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selectedLabel, setSelectedLabel] = React.useState<string | null>(null);
  const [mindmapActive, setMindmapActive] = React.useState(false);

  toolRef.current = tool;
  readOnlyRef.current = readOnly;
  markdownRef.current = markdown;
  onMarkdownChangeRef.current = onMarkdownChange;
  onZoomChangeRef.current = onZoomChange;

  // 切走「连线」工具时清掉进行中的"已点了起点，等第二次点击"状态——不然切到
  // 别的工具再切回来，第一次点击会被当成"这是刚才那条连线的终点"，凭空连出一条
  // 用户根本没打算连的线。
  React.useEffect(() => {
    if (tool !== "edge") {
      pendingEdgeSourceRef.current = null;
      setPendingEdgeSourceLabel(null);
    }
  }, [tool]);

  const emit = React.useCallback((next: string) => {
    lastEmittedRef.current = next;
    onMarkdownChangeRef.current(next);
    // 撤销/重做触发的 emit（见挂载 effect 的 undo/redo 处理）不再记一次历史——
    // 那是"回放旧快照"，不是"新编辑"，记了会把撤销自己变成需要撤销的操作，
    // 历史栈会在原地反复横跳。
    if (restoringRef.current) return;
    const hist = historyRef.current;
    if (hist[historyCursorRef.current] === next) return;
    hist.splice(historyCursorRef.current + 1);
    hist.push(next);
    if (hist.length > 100) hist.shift();
    historyCursorRef.current = hist.length - 1;
  }, []);

  const syncFromCanvas = React.useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    // `serializeCanvasMarkdown`，不是上游 `canvasToMarkdown`：后者对 `kind:'template'`
    // 模型序列化用错了函数（见该文件文件头注释），会把画布模板编辑结果拼成乱码。
    const next = serializeCanvasMarkdown(canvas, markdownRef.current);
    emit(next);
  }, [emit]);

  // 见 `CanvasStageHandle.fitToContent` 头注——与 `exportPNG` 共用同一套并集包围盒
  // 算法，只是拿算出来的框去定 viewport（zoom+pan）而不是去截图。定义成一个不依赖
  // 组件其它 state 的稳定函数（只读 fabricRef/containerRef/onZoomChangeRef 三个 ref），
  // 好处是挂载 effect 与"markdown 变化"effect 都能直接调用它，不必把它塞进各自的
  // 依赖数组、也不必等它们的 effect 重新跑一遍。
  const fitToContent = React.useCallback(() => {
    const canvas = fabricRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const objects = canvas.getObjects();
    if (objects.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of objects) {
      const r = obj.getBoundingRect();
      minX = Math.min(minX, r.left);
      minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.left + r.width);
      maxY = Math.max(maxY, r.top + r.height);
    }
    const PADDING = 32;
    const contentW = maxX - minX + PADDING * 2;
    const contentH = maxY - minY + PADDING * 2;
    if (contentW <= 0 || contentH <= 0) return;
    const viewW = canvas.getWidth();
    const viewH = canvas.getHeight();
    // 只缩小、不放大超过 100%——一张只有一两个便签的小模板"看到全部"不该被硬拉到
    // 铺满整屏放大好几倍，那看起来像出了故障而不是"刚好看到全部"。
    const nextZoom = Math.max(ZOOM_MIN, Math.min(1, viewW / contentW, viewH / contentH));
    const panX = (viewW - contentW * nextZoom) / 2 - (minX - PADDING) * nextZoom;
    const panY = (viewH - contentH * nextZoom) / 2 - (minY - PADDING) * nextZoom;
    canvas.setViewportTransform([nextZoom, 0, 0, nextZoom, panX, panY]);
    canvas.requestRenderAll();
    onZoomChangeRef.current?.(nextZoom);
  }, []);

  // 挂载：创建真实 fabric.Canvas（一次）。
  React.useEffect(() => {
    const el = canvasElRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const rect = container.getBoundingClientRect();
    const canvas = new FabricCanvas(el, {
      width: Math.max(600, rect.width),
      height: Math.max(400, rect.height),
      selection: true,
    });
    fabricRef.current = canvas;

    // 焦点是否落在一个"这里应该由浏览器原生编辑行为接管"的输入控件上——
    // 内联便签编辑器、以及任何将来加进画布容器的输入框。Delete/撤销/空格平移
    // 三处键盘快捷键共用同一条判断，不各写一份（写第二份的下场是改一处漏一处）。
    const isEditableTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    // ── 内联编辑器：双击对象直接改文字（参照 projects/fabric-markdown demo 的
    //    openInlineEditor/closeInlineEditor 模式）。一个 <textarea> 浮层贴在对象
    //    的屏幕矩形上，不用 window.prompt，也不需要为 sticky/node/field 分别写
    //    三套编辑 UI——它们都是 FlowNode，label 都走同一个 setLabel。 ──
    const closeInlineEditor = (commit: boolean): void => {
      const target = editingTargetRef.current;
      const editor = inlineEditorRef.current;
      if (!target || !editor) return;
      editingTargetRef.current = null; // 先清空，避免 blur 事件重入
      if (commit) {
        const next = editor.value;
        if (next !== (target.label ?? "")) {
          target.setLabel(next);
          canvas.requestRenderAll();
          syncFromCanvas();
        }
      }
      editor.style.display = "none";
      editor.value = "";
    };

    const screenRectOf = (target: FlowNode | FlowEdge) => {
      target.setCoords();
      const vpt = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
      const pts = target.getCoords().map((p) => util.transformPoint(p, vpt));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return { left: minX, top: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
    };

    const openInlineEditor = (target: FlowNode | FlowEdge): void => {
      const editor = inlineEditorRef.current;
      if (!editor || readOnlyRef.current) return;
      closeInlineEditor(true); // 已经开着的先提交，不能同时编辑两个对象
      const rect = screenRectOf(target);
      const w = Math.max(90, rect.width);
      const h = Math.max(32, rect.height);
      editor.style.left = `${rect.left + rect.width / 2 - w / 2}px`;
      editor.style.top = `${rect.top + rect.height / 2 - h / 2}px`;
      editor.style.width = `${w}px`;
      editor.style.height = `${h}px`;
      editor.value = target.label ?? "";
      editor.style.display = "block";
      editingTargetRef.current = target;
      editor.focus();
      editor.select();
    };

    const editorEl = inlineEditorRef.current;
    const onEditorKeydown = (ev: KeyboardEvent): void => {
      ev.stopPropagation(); // 不让 Delete/Backspace 等画布快捷键在编辑文字时触发
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeInlineEditor(false);
      } else if (ev.key === "Enter" && !ev.shiftKey) {
        // Shift+Enter 换行（便签可以多行），Enter 提交并关闭
        ev.preventDefault();
        closeInlineEditor(true);
      }
    };
    const onEditorBlur = (): void => closeInlineEditor(true);
    editorEl?.addEventListener("keydown", onEditorKeydown);
    editorEl?.addEventListener("blur", onEditorBlur);

    canvas.on("object:modified", syncFromCanvas);
    const onSelection = (e: { selected?: unknown[] }): void => {
      const obj = e.selected?.[0];
      const node = obj instanceof FlowNode ? obj : null;
      const edge = obj instanceof FlowEdge ? obj : null;
      setSelectedLabel(node?.label ?? (edge ? edge.label ?? "连线" : null));
      selectedNodeIdRef.current = node?.nodeId ?? null;
      selectedEdgeIdRef.current = edge?.edgeId ?? null;
      if (node) lastSelectedNodeIdRef.current = node.nodeId;
      setMindmapActive(mindmapEditorRef.current?.isActive() ?? false);
      // 选中一条边时重绘一次——vendored `FlowEdge._render` 按「自己是不是当前
      // active object」画高亮描边（见该文件改动），选中态本身不会自动触发重绘。
      if (edge) canvas.requestRenderAll();
    };
    canvas.on("selection:created", onSelection);
    canvas.on("selection:updated", onSelection);
    canvas.on("selection:cleared", () => {
      setSelectedLabel(null);
      selectedNodeIdRef.current = null;
      selectedEdgeIdRef.current = null;
      canvas.requestRenderAll();
    });

    // #1453：选中一个 mindmap 节点后 Tab 加子节点 / Enter 加兄弟节点，复用
    // packages/fabric-markdown 现成的 attachMindmapEditor（未改包内任何逻辑，
    // 只接线）。它只在 isMindmap() 为真时生效，非 mindmap 图不受影响，也不会
    // 拦截其他场景下的 Tab/Enter（内部按 isEditableTarget 放行输入框）。
    const mindmapEditor = attachMindmapEditor(canvas, { onChange: syncFromCanvas });
    mindmapEditorRef.current = mindmapEditor;

    // Delete/Backspace 删除当前选中对象——分节点/边两条路径：
    //   · 节点 + mindmap：走 attachMindmapEditor 的 removeSubtree（含子树，它自己管
    //     派生的树结构一致性，不能绕过它直接 canvas.remove）；
    //   · 节点 + 其它图（flowchart/类图/…）：此前这条键完全没接，选中节点按 Delete
    //     悄悄什么都不发生——唯一能删除节点的路径是切到工具条「删除」工具再点一下，
    //     选中了却删不掉是常见画布编辑器都不会有的体验断层（人类实测反馈）。
    //     这里补上：直接 canvas.remove 选中的 FlowNode，同一条"模板模式下分区/
    //     字段等结构节点不可删"的角色守卫（见下方 mouse:down 那段）在这里复用，
    //     不写第二份判断。
    //   · 边（非 mindmap）：同样此前完全没接——选中一条连线按 Delete 也什么都不
    //     发生（人类实测反馈）。这里补上：直接 canvas.remove 选中的 FlowEdge。
    //     mindmap 模式下边是树结构的派生物（父子关系＝边），单独删一条边而不删
    //     它连着的子树会留下一个不再挂在树上却还画在画布上的孤儿节点——mindmap
    //     模式下删边这个操作没有意义，交给用户改用选中节点整棵子树删（Delete 已
    //     经支持），这里显式跳过，不是漏做。
    const onDeleteKey = (ev: KeyboardEvent): void => {
      if (readOnlyRef.current) return;
      if (ev.key !== "Delete" && ev.key !== "Backspace") return;
      if (isEditableTarget(ev.target)) return;
      const nodeId = selectedNodeIdRef.current;
      const edgeId = selectedEdgeIdRef.current;
      if (!nodeId && !edgeId) return;
      if (mindmapEditorRef.current?.isActive()) {
        if (!nodeId) return; // 选中的是边：mindmap 模式下不支持单独删边，见上方注释。
        if (mindmapEditorRef.current.removeSubtree(nodeId)) {
          selectedNodeIdRef.current = null;
          setSelectedLabel(null);
        }
        return;
      }
      if (edgeId) {
        const edgeTarget = canvas.getObjects().find((o) => o instanceof FlowEdge && o.edgeId === edgeId);
        if (!(edgeTarget instanceof FlowEdge)) return;
        canvas.remove(edgeTarget);
        canvas.fire("object:modified", { target: edgeTarget });
        selectedEdgeIdRef.current = null;
        setSelectedLabel(null);
        syncFromCanvas();
        return;
      }
      const target = canvas.getObjects().find((o) => o instanceof FlowNode && o.nodeId === nodeId);
      if (!(target instanceof FlowNode)) return;
      const isTemplate = extractModel(canvas).kind === "template";
      const role = (target.data as { role?: string } | undefined)?.role;
      if (isTemplate && role !== "sticky") return;
      canvas.remove(target);
      canvas.fire("object:modified", { target });
      selectedNodeIdRef.current = null;
      setSelectedLabel(null);
      syncFromCanvas();
    };
    document.addEventListener("keydown", onDeleteKey);

    // ── 撤销/重做：Cmd/Ctrl+Z 撤销，Cmd/Ctrl+Shift+Z 或 Cmd/Ctrl+Y 重做——在编辑
    //    框（内联便签编辑器/其它输入框）里放行，交给浏览器原生的文本撤销，不抢
    //    键位（人类正在打字时按 Cmd+Z 期待的是"撤销这个字"，不是"撤销上一次
    //    拖拽"）。restore 复用挂载/markdown-prop-变化那条既有的
    //    `markdownToCanvas` 重渲染路径，不是第二套"按对象回放操作"的实现——
    //    历史栈存的本来就是完整快照，回到某一帧只需要把画布按那帧重画一遍。 ──
    const restoreHistoryAt = (index: number): void => {
      const hist = historyRef.current;
      const snap = hist[index];
      if (snap === undefined) return;
      historyCursorRef.current = index;
      restoringRef.current = true;
      closeInlineEditor(false);
      canvas.discardActiveObject();
      selectedNodeIdRef.current = null;
      setSelectedLabel(null);
      void markdownToCanvas(snap, canvas)
        .then(() => {
          canvas.requestRenderAll();
          emit(snap);
        })
        .finally(() => {
          restoringRef.current = false;
        });
    };
    const onUndoRedoKey = (ev: KeyboardEvent): void => {
      if (readOnlyRef.current) return;
      if (!(ev.metaKey || ev.ctrlKey) || ev.key.toLowerCase() !== "z" && ev.key.toLowerCase() !== "y") return;
      if (isEditableTarget(ev.target)) return;
      const redo = ev.key.toLowerCase() === "y" || ((ev.metaKey || ev.ctrlKey) && ev.shiftKey);
      ev.preventDefault();
      const hist = historyRef.current;
      if (redo) {
        if (historyCursorRef.current >= hist.length - 1) return;
        restoreHistoryAt(historyCursorRef.current + 1);
      } else {
        if (historyCursorRef.current <= 0) return;
        restoreHistoryAt(historyCursorRef.current - 1);
      }
    };
    document.addEventListener("keydown", onUndoRedoKey);

    // ── 滚轮 / trackpad 缩放 + 平移（人类 2026-08-19 明确要求两种输入设备都要支持）。
    //
    //    浏览器把 trackpad 手势翻成同一个 wheel 事件，靠 `ctrlKey` 区分是哪种手势
    //    （这是浏览器自己的约定，不是我们发明的）：
    //      · 双指捏合（pinch）⇒ wheel 事件 ctrlKey=true —— 缩放，以指针为中心
    //        （同 projects/fabric-markdown demo 的 mouse:wheel 处理）。
    //      · 双指平移（two-finger scroll）⇒ wheel 事件 ctrlKey=false，deltaX/deltaY
    //        就是位移量 —— 平移画布（挪 viewportTransform 的位移分量，不动缩放）。
    //    真实鼠标滚轮同样落在「ctrlKey=false」分支，deltaY 当垂直平移量——与
    //    Figma/Miro 等常见画布编辑器同一套手感，不需要用户先记住"滚轮=缩放"
    //    这条本文件早先（未验证）的假设。
    //
    //    缩放会改 fabric 自己的 zoom，回填给 onZoomChange 让工具条的 % 与 +/− 不漂移。 ──
    canvas.on("mouse:wheel", (opt) => {
      closeInlineEditor(true);
      const e = opt.e as WheelEvent;
      if (e.ctrlKey) {
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, canvas.getZoom() * Math.pow(0.999, e.deltaY)));
        canvas.zoomToPoint(new Point(e.offsetX, e.offsetY), next);
        onZoomChangeRef.current?.(next);
      } else {
        const vpt = canvas.viewportTransform;
        if (vpt) {
          vpt[4] -= e.deltaX;
          vpt[5] -= e.deltaY;
          canvas.setViewportTransform(vpt);
        }
      }
      canvas.requestRenderAll();
      e.preventDefault();
      e.stopPropagation();
    });

    canvas.on("mouse:dblclick", (opt) => {
      if (readOnlyRef.current) return;
      const target = opt.target;
      if (target instanceof FlowNode || target instanceof FlowEdge) {
        openInlineEditor(target);
      }
    });

    // ── 鼠标拖拽平移：按住空格键、或按住 Alt、或按住鼠标中键拖动（三选一，同
    //    projects/fabric-markdown demo 的 Alt/空格 平移手感，中键是常见画布编辑器
    //    的另一条约定路径，供没有 Alt 键习惯的用户）。平移期间关掉 selection，
    //    避免拖出一个框选矩形；松手恢复原 selection 状态（只读态本就是 false，
    //    这里如实保存/恢复，不会把只读态误开成可选）。 ──
    let spaceDown = false;
    let panning = false;
    let panLast: { x: number; y: number } | null = null;
    let selectionBeforePan = canvas.selection ?? true;
    const onPanKeydown = (ev: KeyboardEvent): void => {
      if (ev.code === "Space" && !isEditableTarget(ev.target)) {
        spaceDown = true;
        ev.preventDefault();
      }
    };
    const onPanKeyup = (ev: KeyboardEvent): void => {
      if (ev.code === "Space") spaceDown = false;
    };
    document.addEventListener("keydown", onPanKeydown);
    document.addEventListener("keyup", onPanKeyup);

    canvas.on("mouse:down", (opt) => {
      const e = opt.e as MouseEvent;
      if (e.altKey || spaceDown || e.button === 1) {
        closeInlineEditor(true);
        panning = true;
        panLast = { x: e.clientX, y: e.clientY };
        selectionBeforePan = canvas.selection ?? true;
        canvas.selection = false;
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        e.preventDefault();
        return;
      }
      // 只读模式下的画布点击——分区框是 `locked`（`evented: false`），fabric 不会
      // 在它们身上触发对象级事件，所以这里用**画布级** `mouse:down`（永远收得到，
      // 不看 evented）+ `canvas.getPointer()` 把场景坐标原样递给调用方，命中测试
      // 交给调用方自己做（见 prop 文档）。
      if (readOnlyRef.current && onCanvasClickRef.current) {
        // fabric v7：`getPointer()` 已废弃，`getScenePoint()` 是场景坐标（不受
        // viewport 平移/缩放影响）版本——分区框的 x/y 就是场景坐标，两边同一套系。
        const p = canvas.getScenePoint(e);
        onCanvasClickRef.current({ x: p.x, y: p.y });
      }
    });
    canvas.on("mouse:move", (opt) => {
      const e = opt.e as MouseEvent;
      if (panning && panLast) {
        const vpt = canvas.viewportTransform;
        if (vpt) {
          vpt[4] += e.clientX - panLast.x;
          vpt[5] += e.clientY - panLast.y;
          canvas.setViewportTransform(vpt);
        }
        panLast = { x: e.clientX, y: e.clientY };
        return;
      }
      if (readOnlyRef.current && onCanvasHoverRef.current) {
        const p = canvas.getScenePoint(e);
        onCanvasHoverRef.current({ x: p.x, y: p.y });
      }
    });
    // 指针整个离开画布——同一件事之前只有"移到某个框范围外"能清空（上面
    // mouse:move 自己算），指针直接飞出画布边界那次移动不落在画布上，不会
    // 触发 mouse:move，悬停高亮会卡在最后一个框上不消失。
    canvas.on("mouse:out", () => {
      if (readOnlyRef.current && onCanvasHoverRef.current) onCanvasHoverRef.current(null);
    });
    canvas.on("mouse:up", () => {
      if (!panning) return;
      panning = false;
      panLast = null;
      canvas.selection = selectionBeforePan && !readOnlyRef.current;
    });

    canvas.on("mouse:down", (opt) => {
      if (readOnlyRef.current) return;
      // 正在拖拽平移（空格/Alt/中键）时，不要再触发下面的工具逻辑（放便签/删除等）——
      // 平移是"移动视口"，不是"操作画布内容"，两者必须互斥，否则空格平移途中
      // 松手瞬间会在指针底下的空白处意外落一个便签/节点。
      if (panning) return;
      closeInlineEditor(true);
      const t = toolRef.current;
      // 画布模板（`kind:'template'`）的分区框/字段/标题都是结构节点，不是内容——
      // 只有 `data.role === 'sticky'` 的便签是协作产出，可加可删。误删分区框会
      // 破坏模板结构（序列化时依赖分区名匹配便签归属），所以模板模式下的删除
      // 只对便签生效，其它角色的节点点了也不动。非模板画布（mermaid/mindmap）
      // 行为不变——那类图从不产出带 `role` 的节点，判断天然放行。
      const isTemplate = extractModel(canvas).kind === "template";
      if (opt.target) {
        if (t === "delete" && opt.target instanceof FlowNode) {
          const role = (opt.target.data as { role?: string } | undefined)?.role;
          if (isTemplate && role !== "sticky") return;
          canvas.remove(opt.target);
          canvas.fire("object:modified", { target: opt.target });
          syncFromCanvas();
        }
        // 「删除」工具点一条连线——同 Delete 键那条路径同一条规则：mindmap 模式下
        // 边是树结构派生物，单独删边没有意义，不接（见 onDeleteKey 注释）。
        if (t === "delete" && opt.target instanceof FlowEdge && !mindmapEditorRef.current?.isActive()) {
          canvas.remove(opt.target);
          canvas.fire("object:modified", { target: opt.target });
          syncFromCanvas();
        }
        // 「连线」工具点第二个节点——两点连线的核心逻辑。mindmap 模式下父子关系
        // 就是边，自由加边会破坏 attachMindmapEditor 依赖的树形结构，这里不接
        // （同一条"mindmap 边是结构不是内容"的规则）。
        if (t === "edge" && opt.target instanceof FlowNode && !mindmapEditorRef.current?.isActive()) {
          const targetNode = opt.target;
          const sourceId = pendingEdgeSourceRef.current;
          if (sourceId === null) {
            pendingEdgeSourceRef.current = targetNode.nodeId;
            setPendingEdgeSourceLabel(targetNode.label ?? "起点");
          } else if (sourceId === targetNode.nodeId) {
            // 点了同一个节点两次＝取消这次连线，不是"连到自己"。
            pendingEdgeSourceRef.current = null;
            setPendingEdgeSourceLabel(null);
          } else {
            edgeSeq += 1;
            const edge = new FlowEdge({
              edgeId: `local-edge-${edgeSeq}`,
              source: sourceId,
              target: targetNode.nodeId,
              kind: "open",
            });
            canvas.add(edge);
            getConnectionManager(canvas).updateAllEdges();
            canvas.requestRenderAll();
            pendingEdgeSourceRef.current = null;
            setPendingEdgeSourceLabel(null);
            canvas.fire("object:modified", { target: edge });
            syncFromCanvas();
          }
        }
        return;
      }
      // 「连线」工具点空白处＝取消进行中的连线（同大多数画布编辑器的手感：点哪都
      // 能取消，不用非找到刚才点过的那个节点再点一次）。
      if (t === "edge") {
        pendingEdgeSourceRef.current = null;
        setPendingEdgeSourceLabel(null);
        return;
      }
      if (t !== "sticky" && t !== "node") return;
      // 模板模式下只认「＋便签」——「＋节点」是给自由画布加任意矩形节点的，模板的
      // 分区结构是固定的，不接受新增结构节点。
      if (isTemplate && t !== "sticky") return;
      // 思维导图模式：点空白处不再落一个跟树结构没有任何连线的孤立方块——
      // 那不是"加了个节点"，是画了一个看起来像节点、实际不属于这棵树的贴纸
      // （人类实测反馈）。mindmap 的节点位置本来就是自动布局算出来的，点击坐标
      // 在这里没有意义；改成给"最近选中过的节点"（没选过就是根）加一个真子节点，
      // 等价于按一次 Tab，只是鼠标可点。
      //
      // ⚠ 不能传 `undefined` 让 `addChild` 自己兜底——它兜底兜的是 fabric 当前的
      //   活动对象（`canvas.getActiveObject()`），而点空白处这个动作本身就会先把
      //   活动对象清空（fabric 内建行为，先于这段 mouse:down 处理跑），
      //   实测复现：undefined 传进去等于"没有父节点"，`addChild` 直接返回 null，
      //   什么都不会发生。`lastSelectedNodeIdRef` 是专门为这个场景留的、
      //   不随 selection:cleared 清空的记忆（见该 ref 声明处注释）。
      if (mindmapEditorRef.current?.isActive()) {
        const parentId = lastSelectedNodeIdRef.current ?? findMindmapRootId(canvas);
        if (parentId) mindmapEditorRef.current.addChild(parentId);
        return;
      }
      let pointer = canvas.getScenePoint(opt.e);
      // 模板模式下，新便签落点必须真的在某个分区框内——`serializeTemplate` 按
      // "离哪个分区框中心最近"把便签分到那个分区（模板序列化的既有规则，非本文件
      // 定的），点在分区框外的空白处看起来是"没有分区"，保存后却被悄悄计进最近
      // 那个分区，画面看到的和存下来的对不上（人类实测踩到）。这里让画面如实
      // 反映保存结果：落点不在任何分区框内时，夹到最近那个分区框的可用范围里。
      if (isTemplate && t === "sticky") {
        const sections = canvas
          .getObjects()
          .filter((o): o is FlowNode => o instanceof FlowNode && (o.data as { role?: string } | undefined)?.role === "section");
        const inside = sections.some((s) => {
          const c = s.center();
          return Math.abs(pointer.x - c.x) <= s.width / 2 && Math.abs(pointer.y - c.y) <= s.height / 2;
        });
        if (!inside && sections.length > 0) {
          let nearest = sections[0]!;
          let bestDist = Infinity;
          for (const s of sections) {
            const c = s.center();
            // 平方距离写成乘法，不用指数运算符——两个星号挨着写会被设计 lint
            // 的朴素正则误判成 Markdown 加粗残留，换个等价写法绕开。
            const dx = pointer.x - c.x;
            const dy = pointer.y - c.y;
            const d = dx * dx + dy * dy;
            if (d < bestDist) {
              bestDist = d;
              nearest = s;
            }
          }
          const c = nearest.center();
          const padX = Math.min(nearest.width / 2 - 10, 68);
          const padY = Math.min(nearest.height / 2 - 20, 46);
          pointer = new Point(
            Math.min(Math.max(pointer.x, c.x - padX), c.x + padX),
            Math.min(Math.max(pointer.y, c.y - padY), c.y + padY),
          );
        }
      }
      nodeSeq += 1;
      const id = `local-${t}-${nodeSeq}`;
      const node = isTemplate
        // 形状/尺寸/`data.role` 对齐 `template-engine.ts` 自己产出的便签节点
        // （`DEFAULT_STICKY = { w: 136, h: 92 }`，`shape: 'sticky'`，
        // `data: { role: 'sticky' }`）——用别的形状/不带 role 加进去的节点，
        // `serializeTemplate` 认不出它是便签，保存时会被悄悄丢掉。
        ? new FlowNode({
            nodeId: id,
            label: "新便签（点选可改标签）",
            shape: "sticky",
            x: pointer.x,
            y: pointer.y,
            width: 136,
            height: 92,
            data: { role: "sticky" },
          })
        : new FlowNode({
            nodeId: id,
            label: t === "sticky" ? "新便签（点选可改标签）" : "新节点",
            shape: t === "sticky" ? "stadium" : "rect",
            x: pointer.x,
            y: pointer.y,
            width: 200,
            height: 60,
          });
      canvas.add(node);
      canvas.setActiveObject(node);
      syncFromCanvas();
    });

    return () => {
      document.removeEventListener("keydown", onDeleteKey);
      document.removeEventListener("keydown", onUndoRedoKey);
      document.removeEventListener("keydown", onPanKeydown);
      document.removeEventListener("keyup", onPanKeyup);
      editorEl?.removeEventListener("keydown", onEditorKeydown);
      editorEl?.removeEventListener("blur", onEditorBlur);
      mindmapEditor.dispose();
      mindmapEditorRef.current = null;
      canvas.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFromCanvas]);

  // markdown 变化：只有「不是我自己刚发出的那次」才重新解析并重渲染（源码手改 / 首次挂载）。
  React.useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (markdown === lastEmittedRef.current) return;
    let cancelled = false;
    setLoading(true);
    setParseError(null);
    markdownToCanvas(markdown, canvas)
      .then(({ model }: { model: DiagramModel }) => {
        if (cancelled) return;
        lastEmittedRef.current = markdown;
        const ignored = countIgnoredFences(markdown);
        setIgnoredCount(ignored);
        setLoading(false);
        if (fitOnLoadRef.current) fitToContent();
        void model;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setParseError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // fabricRef.current is stable after mount; re-run only when markdown text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown]);

  // 首次挂载后立即解析一次初始 markdown（上面的 effect 依赖 markdown 不变时不会触发）。
  React.useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    let cancelled = false;
    markdownToCanvas(markdown, canvas)
      .then(() => {
        if (cancelled) return;
        setIgnoredCount(countIgnoredFences(markdown));
        setLoading(false);
        if (fitOnLoadRef.current) fitToContent();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setParseError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 缩放：工具条 +/−/⤢ 改 zoom prop 时同步到 fabric。滚轮/trackpad 缩放走上面
  // 挂载 effect 里的 `mouse:wheel` 处理（直接改 fabric 的 zoom 再回填 zoom prop），
  // 这里只是把「prop 变了」的那一半接上——两条路径最终都收敛到同一个 zoom 状态，
  // 不会因为走了哪条路径而出现两套不同步的缩放读数。
  React.useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.setZoom(zoom);
    canvas.requestRenderAll();
  }, [zoom]);

  // 只读态：禁用所有对象的写操作。
  React.useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.selection = !readOnly;
    canvas.forEachObject((obj) => {
      obj.selectable = !readOnly;
      obj.evented = !readOnly;
    });
    canvas.requestRenderAll();
  }, [readOnly, loading]);

  React.useImperativeHandle(ref, () => ({
    exportPNG: (opts) => {
      const canvas = fabricRef.current;
      if (!canvas) return null;
      const objects = canvas.getObjects();
      if (objects.length === 0) return null;
      // 并集包围盒——用 `getBoundingRect()`（fabric v7 起恒返回绝对坐标）而不是
      // 直接读每个对象的 left/top/width/height，因为 FlowNode/FlowEdge 内部
      // 可能是 fabric Group，裸读那四个属性对旋转/弯曲边这类对象算出来的框会偏。
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const obj of objects) {
        const r = obj.getBoundingRect();
        minX = Math.min(minX, r.left);
        minY = Math.min(minY, r.top);
        maxX = Math.max(maxX, r.left + r.width);
        maxY = Math.max(maxY, r.top + r.height);
      }
      const EXPORT_PADDING = 24;
      const left = minX - EXPORT_PADDING;
      const top = minY - EXPORT_PADDING;
      const width = maxX - minX + EXPORT_PADDING * 2;
      const height = maxY - minY + EXPORT_PADDING * 2;

      // 导出的是"内容"，不是"用户当前看到的这一屏"——临时把 viewport 复位到
      // zoom=1/无平移再截图，截完照原样还原，用户拖动/缩放过的画布状态不受
      // 这次导出影响（截图动作本身不该是一次有副作用的操作）。
      const prevTransform = canvas.viewportTransform ? [...canvas.viewportTransform] as typeof canvas.viewportTransform : undefined;
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      const dataUrl = canvas.toDataURL({
        format: "png",
        left,
        top,
        width,
        height,
        multiplier: opts?.multiplier ?? 2,
      });
      if (prevTransform) canvas.setViewportTransform(prevTransform);
      canvas.requestRenderAll();
      return { dataUrl, width, height };
    },
    fitToContent,
  }), [fitToContent]);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-auto bg-panel-alt"
      data-testid="canvas-stage"
      data-allow-x-scroll="画布需平移；真实引擎会做 pan/zoom"
    >
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1.5">
        <Badge tone="outline">mermaid 引擎渲染</Badge>
        <Badge tone={tool === "delete" ? "danger" : tool === "select" ? "neutral" : "primary"} data-testid="canvas-active-tool">
          当前工具：{TOOL_LABEL[tool]}
        </Badge>
        {ignoredCount > 0 && (
          <Badge tone="warning" data-testid="canvas-ignored-syntax">
            有 {ignoredCount} 条语法被忽略
          </Badge>
        )}
      </div>

      {parseError && (
        <div
          className="absolute inset-x-2 top-10 z-10 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-11 text-destructive"
          data-testid="canvas-parse-error"
        >
          源码解析失败，画布保留上一次成功渲染的内容：{parseError}
        </div>
      )}

      <div
        data-testid="canvas-surface"
        className={cn(
          "relative h-full min-h-96 w-full",
          tool === "sticky" || tool === "node" ? (readOnly ? "" : "cursor-crosshair") : "",
          tool === "delete" && !readOnly && "cursor-not-allowed",
          // 迭代 4——只读+可点击画布（模板编辑面板的分区框联动）此前没有任何鼠标态
          // 提示：光标停在分区框上和停在空白背景上看起来一模一样，使用者只能靠
          // 试错才知道"这块能点"。改成 pointer——同一块画布区域现在既是"预览"
          // 也是"可交互控件"，光标应该说出这件事，不该假装自己只是一张静态截图。
          readOnly && onCanvasClick && "cursor-pointer",
        )}
      >
        <canvas ref={canvasElRef} data-testid="canvas-fabric-surface" />
        {/* 双击对象打开的内联编辑器（见挂载 effect 的 openInlineEditor/closeInlineEditor）。
            默认隐藏，只有编辑中才 display:block——不占布局、不吃 pointer 事件。 */}
        <textarea
          ref={inlineEditorRef}
          data-testid="canvas-inline-editor"
          className="absolute resize-none rounded-md border-2 border-primary bg-card p-1 text-12 leading-snug text-card-foreground shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          style={{ display: "none" }}
          spellCheck={false}
        />
      </div>

      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md border border-border-subtle bg-card/90 px-2 py-1">
        <p className="text-10 text-muted-foreground" data-testid="canvas-tool-hint">
          {loading
            ? "渲染中…"
            : readOnly
              ? `只读，写操作已禁用 · ${PAN_ZOOM_HINT} · 缩放 ${Math.round(zoom * 100)}%`
              : selectedLabel
                ? mindmapActive
                  ? `选中：${selectedLabel} · 双击改文字 · Tab 加子节点 · Enter 加兄弟 · Delete 删除 · ${PAN_ZOOM_HINT} · 缩放 ${Math.round(zoom * 100)}%`
                  // 节点/连线都可能被选中，Delete 现在两种都接了（此前只有工具条的
                  // 「删除」工具能删连线，键盘 Delete 对连线毫无反应——人类实测反馈）。
                  : `选中：${selectedLabel} · 双击改文字 · Delete 删除 · ${PAN_ZOOM_HINT} · 缩放 ${Math.round(zoom * 100)}%`
                : tool === "sticky" || tool === "node"
                  ? `点画布空白处落一个${tool === "sticky" ? "便签" : "节点"} · ${PAN_ZOOM_HINT} · 缩放 ${Math.round(zoom * 100)}%`
                  : tool === "delete"
                    ? "点任意节点或连线将其删除"
                    : tool === "edge"
                      ? pendingEdgeSourceLabel
                        ? `连线：已选「${pendingEdgeSourceLabel}」为起点，点终点节点完成连线（点同一个节点可取消）`
                        : "连线：先点起点节点，再点终点节点"
                      : `点选/双击一个对象查看或改文字 · ${PAN_ZOOM_HINT} · 缩放 ${Math.round(zoom * 100)}%`}
        </p>
      </div>
    </div>
  );
});

/** 底部提示条复用的平移/缩放操作说明——三种输入设备都要能发现（人类 2026-08-19 明确要求）。 */
const PAN_ZOOM_HINT = "双指捏合/Ctrl+滚轮缩放 · 双指或滚轮平移 · 空格/Alt/中键拖拽平移 · ⌘Z 撤销 · ⌘⇧Z 重做";

const TOOL_LABEL: Record<CanvasTool, string> = {
  select: "选择",
  sticky: "＋便签",
  node: "＋节点",
  edge: "连线",
  delete: "删除",
};

/**
 * 思维导图的根节点 id——用户从没选过任何节点时，「+节点」/「+便签」工具落点在
 * 空白处该给谁加子节点。根 = 从没在任何边里当过 target 的那个 FlowNode
 * （树结构定义本身：根没有父）。找不到（异常态：空画布/非树结构）时返回 null，
 * 调用方原样跳过这次添加——不瞎猜一个节点当父节点。
 */
function findMindmapRootId(canvas: FabricCanvas): string | null {
  const nodes = canvas.getObjects().filter((o): o is FlowNode => o instanceof FlowNode);
  const edges = canvas.getObjects().filter((o): o is FlowEdge => o instanceof FlowEdge);
  const targets = new Set(edges.map((e) => e.target));
  return nodes.find((n) => !targets.has(n.nodeId))?.nodeId ?? null;
}

/** R7 ③ 白名单忽略计数：mermaid/persona/canvas/usecase 以外的围栏语言按段计数（近似——精确名单在 F101/F102）。 */
function countIgnoredFences(markdown: string): number {
  const re = /^```(\w+)/gm;
  const known = new Set(["mermaid", "persona", "canvas", "usecase"]);
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    if (!known.has(m[1] ?? "")) count += 1;
  }
  return count;
}
