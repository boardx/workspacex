"use client";
import * as React from "react";
import { Canvas as FabricCanvas, Point, util } from "fabric";
import {
  markdownToCanvas,
  extractModel,
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
export function CanvasStage({
  readOnly,
  tool,
  zoom,
  onZoomChange,
  markdown,
  onMarkdownChange,
}: {
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
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasElRef = React.useRef<HTMLCanvasElement>(null);
  const fabricRef = React.useRef<FabricCanvas | null>(null);
  const mindmapEditorRef = React.useRef<MindmapEditor | null>(null);
  const selectedNodeIdRef = React.useRef<string | null>(null);
  const lastEmittedRef = React.useRef<string>(markdown);
  const toolRef = React.useRef(tool);
  const readOnlyRef = React.useRef(readOnly);
  const markdownRef = React.useRef(markdown);
  const onMarkdownChangeRef = React.useRef(onMarkdownChange);
  const onZoomChangeRef = React.useRef(onZoomChange);
  const inlineEditorRef = React.useRef<HTMLTextAreaElement>(null);
  const editingTargetRef = React.useRef<FlowNode | FlowEdge | null>(null);
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

  const emit = React.useCallback((next: string) => {
    lastEmittedRef.current = next;
    onMarkdownChangeRef.current(next);
  }, []);

  const syncFromCanvas = React.useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    // `serializeCanvasMarkdown`，不是上游 `canvasToMarkdown`：后者对 `kind:'template'`
    // 模型序列化用错了函数（见该文件文件头注释），会把画布模板编辑结果拼成乱码。
    const next = serializeCanvasMarkdown(canvas, markdownRef.current);
    emit(next);
  }, [emit]);

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
    canvas.on("selection:created", (e) => {
      const obj = e.selected?.[0];
      const node = obj instanceof FlowNode ? obj : null;
      setSelectedLabel(node?.label ?? null);
      selectedNodeIdRef.current = node?.nodeId ?? null;
      setMindmapActive(mindmapEditorRef.current?.isActive() ?? false);
    });
    canvas.on("selection:updated", (e) => {
      const obj = e.selected?.[0];
      const node = obj instanceof FlowNode ? obj : null;
      setSelectedLabel(node?.label ?? null);
      selectedNodeIdRef.current = node?.nodeId ?? null;
      setMindmapActive(mindmapEditorRef.current?.isActive() ?? false);
    });
    canvas.on("selection:cleared", () => {
      setSelectedLabel(null);
      selectedNodeIdRef.current = null;
    });

    // #1453：选中一个 mindmap 节点后 Tab 加子节点 / Enter 加兄弟节点，复用
    // packages/fabric-markdown 现成的 attachMindmapEditor（未改包内任何逻辑，
    // 只接线）。它只在 isMindmap() 为真时生效，非 mindmap 图不受影响，也不会
    // 拦截其他场景下的 Tab/Enter（内部按 isEditableTarget 放行输入框）。
    const mindmapEditor = attachMindmapEditor(canvas, { onChange: syncFromCanvas });
    mindmapEditorRef.current = mindmapEditor;

    // Delete/Backspace 删除当前选中节点（含子树）——attachMindmapEditor 只暴露
    // removeSubtree 命令 API，不自带 Delete 键绑定（Tab/Enter 才是它内部处理的），
    // 键位由这里接。只读态下 selection 被禁用（见下方 readOnly effect），
    // selectedNodeIdRef 始终为 null，天然无副作用，不需要额外判断 readOnly。
    const onDeleteKey = (ev: KeyboardEvent): void => {
      if (ev.key !== "Delete" && ev.key !== "Backspace") return;
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const nodeId = selectedNodeIdRef.current;
      if (!nodeId) return;
      if (mindmapEditorRef.current?.removeSubtree(nodeId)) {
        selectedNodeIdRef.current = null;
        setSelectedLabel(null);
      }
    };
    document.addEventListener("keydown", onDeleteKey);

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
    const isEditableTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);
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
      }
    });
    canvas.on("mouse:move", (opt) => {
      if (!panning || !panLast) return;
      const e = opt.e as MouseEvent;
      const vpt = canvas.viewportTransform;
      if (vpt) {
        vpt[4] += e.clientX - panLast.x;
        vpt[5] += e.clientY - panLast.y;
        canvas.setViewportTransform(vpt);
      }
      panLast = { x: e.clientX, y: e.clientY };
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
        return;
      }
      if (t !== "sticky" && t !== "node") return;
      // 模板模式下只认「＋便签」——「＋节点」是给自由画布加任意矩形节点的，模板的
      // 分区结构是固定的，不接受新增结构节点。
      if (isTemplate && t !== "sticky") return;
      const pointer = canvas.getScenePoint(opt.e);
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
                  : `选中：${selectedLabel} · 双击改文字 · ${PAN_ZOOM_HINT} · 缩放 ${Math.round(zoom * 100)}%`
                : tool === "sticky" || tool === "node"
                  ? `点画布空白处落一个${tool === "sticky" ? "便签" : "节点"} · ${PAN_ZOOM_HINT} · 缩放 ${Math.round(zoom * 100)}%`
                  : tool === "delete"
                    ? "点任意节点将其删除"
                    : tool === "edge"
                      ? "连线：按住 shift 点两个节点"
                      : `点选/双击一个对象查看或改文字 · ${PAN_ZOOM_HINT} · 缩放 ${Math.round(zoom * 100)}%`}
        </p>
      </div>
    </div>
  );
}

/** 底部提示条复用的平移/缩放操作说明——三种输入设备都要能发现（人类 2026-08-19 明确要求）。 */
const PAN_ZOOM_HINT = "双指捏合/Ctrl+滚轮缩放 · 双指或滚轮平移 · 空格/Alt/中键拖拽平移";

const TOOL_LABEL: Record<CanvasTool, string> = {
  select: "选择",
  sticky: "＋便签",
  node: "＋节点",
  edge: "连线",
  delete: "删除",
};

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
