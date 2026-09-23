"use client";
/** 把 v 夹进 [lo, hi]；区间反了（页太矮）就取中点。线的端点必须落在页边上，不能飘到页外。 */
function clampTo(v: number, lo: number, hi: number): number {
  if (hi <= lo) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 迭代 4 —— 多画板画布（Claude Design 式）：所有页并排铺在一块可平移/缩放的画板上。
 *
 * 交互：滚轮平移、Ctrl/⌘ + 滚轮缩放（以指针为中心）、空白处拖拽平移、右下角 −/＋/1:1/适应 按钮，
 * 键盘 −/＝/0。点一块画板的标题 ⇒ 聚焦该页（父组件的 `frame`）。选中态与单页视图共用同一个
 * `selectedId`，只在它所在的页高亮。
 *
 * 变换只用一层 `transform: translate(x,y) scale(k)`（inline style，不是 Tailwind 任意值——`lint-design`
 * U5b 拦的是间距字面量，动态变换本来就不该写成 class）。没有惯性、没有橡皮筋，够用且可预测。
 */
import * as React from "react";
import { Minus, Plus, Maximize2, Scan } from "lucide-react";
import { cn } from "@/lib/utils";
import { PrototypeCanvas, rotated, linkKey, type PrototypeCanvasMode, type PrototypeDevicePreset } from "./prototype-canvas";
import type { designWorkbench } from "@repo/contracts";
import { linkSlotsOf, findPrototypeNodePath, type PrototypeLink, type PrototypeNode } from "@/lib/live-design-workbench";

const MIN = 0.25;
const MAX = 2.5;
const STEP = 1.2;
const GAP = 48;

const clamp = (k: number): number => Math.min(MAX, Math.max(MIN, k));

export function PrototypeBoard({
  frames, prototype, activeFrame, onFocusFrame, selectedId, onSelect, device, landscape = false, links = [], mode = "edit", onNavigate = null, theme = "dark", drawing = false, changed, accent, wireframe = false,}: {
  frames: readonly string[];
  prototype: readonly (PrototypeNode | null)[];
  activeFrame: number;
  onFocusFrame: (index: number) => void;
  selectedId: string | null;
  onSelect: ((id: string | null) => void) | null;
  device: PrototypeDevicePreset;
  /** 迭代 14：横过来看，与画布同一个开关。 */
  landscape?: boolean;
  /** 迭代 11：每页出发的跳转关系（`links[i]` 属于第 i 页）；编辑/预览；预览点跳转 ⇒ `onNavigate`。 */
  links?: readonly (readonly PrototypeLink[])[];
  mode?: PrototypeCanvasMode;
  /** 迭代 16（#3773 R2）：整份原型正在被分页生成——没树的页显示「正在画这一页…」。 */
  drawing?: boolean;
  /** 迭代 16（#3773 R5）：这一轮新增/改动的节点 id——画板上同样高亮，不然要切到单页才看得见。 */
  changed?: ReadonlySet<string>;
  /** 迭代 17：项目的强调色档位——画板上的每一块屏都跟着它，不然只有单页视图有身份。 */
  accent?: designWorkbench.PrototypeAccent;
  /** 迭代 19：低保真（线框图模板）。画板上每一块屏同样要压成灰阶，不然两个视图对不上。 */
  wireframe?: boolean;
  /** 迭代 13：原型自己的明暗主题，透传给每块画板。 */
  theme?: "light" | "dark";
  onNavigate?: ((to: number) => void) | null;
}) {
  // 每块画板占位宽高（与 `PrototypeCanvas` 的设备尺寸一致，+ 标题行），用于「适应」的估算。
  // 迭代 14：画板格子按**当前镜头**的尺寸算——换设备后并排的间距要跟着变，
  // 否则 iPad 会挤在按 iPhone 宽度算好的格子里互相重叠。
  const BOARD_W = rotated(device, landscape).w;
  const BOARD_H = rotated(device, landscape).h + 30;
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({ x: GAP, y: GAP / 2, k: 1 });
  const drag = React.useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const fit = React.useCallback(() => {
    const el = viewportRef.current;
    if (el === null) return;
    // 用真实渲染尺寸（offsetWidth/Height 不受 transform 影响）；拿不到（jsdom）再按设备尺寸估。
    const stage = stageRef.current;
    const contentW = stage !== null && stage.offsetWidth > 0 ? stage.offsetWidth : frames.length * BOARD_W + Math.max(0, frames.length - 1) * GAP;
    const contentH = stage !== null && stage.offsetHeight > 0 ? stage.offsetHeight : BOARD_H;
    // 「适应」允许低于手动缩放下限：20 页的画板本来就得缩到 25% 以下才装得下，但不小于 5%、不放大超过 1。
    const k = Math.max(0.05, Math.min((el.clientWidth - GAP * 2) / contentW, (el.clientHeight - GAP) / contentH, 1));
    setView({ x: Math.max(GAP, (el.clientWidth - contentW * k) / 2), y: Math.max(GAP / 2, (el.clientHeight - contentH * k) / 2), k });
  }, [frames.length, BOARD_W, BOARD_H]);

  /*
   * 迭代 32：首次与页数变化时适应一次——**但用户手动调过就不再动他**。
   *
   * 迭代 26 给 ResizeObserver 立过这条规矩（"屏上的比例是他自己挑的，一次窗口变化把它冲掉
   * 比不自适应更糟"），这一处却没跟上：`fit` 的依赖里有 `frames.length`，于是用户把某一页
   * 放大到 200% 盯着改，AI 画出第 4 页的那一刻，视图被整个冲回"适应"。
   * 同一条纪律不能只在一半的入口成立。
   */
  const touched = React.useRef(false);
  React.useEffect(() => { if (!touched.current) fit(); }, [fit]);

  /**
   * 迭代 26：**窗口尺寸变了也要重新适应**。
   *
   * `fit()` 原来只在挂载与页数变化时跑，于是把窗口拉大、把手机横过来、或者收起侧栏之后，
   * 画板还停在按旧尺寸算出来的比例——实测同一个页面 390 与 1440 两档量到的都是同一个
   * 百分比，"适应画板"这件事只在第一眼成立过一次。
   *
   * ⚠ 用户手动缩放/平移过就**不再**自动适应：那时屏上的比例是他自己挑的，
   * 一次窗口变化把它冲掉，比不自适应更糟。「适应画板」那颗按钮随时把他放回来。
   */
  React.useEffect(() => {
    const el = viewportRef.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (!touched.current) fit(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  /**
   * 迭代 11：页与页之间的连线。画在 stage 里（随平移缩放一起变换），坐标按 stage 的**未缩放**坐标系：
   * 从 DOM 量到的 rect 都带着 `scale(k)`，除回去即可。源点 = 可点位的右缘中点（目标在左边则取左缘），
   * 终点 = 目标页画板的左缘中点（或右缘）。jsdom 里所有 rect 都是 0 ⇒ 路径退化成点，但**数量仍等于
   * 合法 link 数**——V30 断言的正是数量，不是几何。
   */
  const [paths, setPaths] = React.useState<readonly { key: string; d: string }[]>([]);
  const kRef = React.useRef(view.k);
  kRef.current = view.k;
  const measure = React.useCallback(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const sr = stage.getBoundingClientRect();
    const k = kRef.current || 1;
    const rel = (r: DOMRect) => ({ x1: (r.left - sr.left) / k, y1: (r.top - sr.top) / k, x2: (r.right - sr.left) / k, y2: (r.bottom - sr.top) / k });
    const out: { key: string; d: string }[] = [];
    links.forEach((pageLinks, i) => {
      // 用专门的 data 属性定位，不借 testid（lint-design D-35：testid 不携带业务数据/不当查询键）。
      const frameEl = stage.querySelector(`[data-board-frame="${i}"]`);
      if (frameEl === null) return;
      for (const l of pageLinks) {
        const hit = findPrototypeNodePath(prototype, l.from);
        const multi = hit !== null && linkSlotsOf(hit.path[hit.path.length - 1]!) > 1;
        const srcEl = frameEl.querySelector(multi ? `[data-link-item="${linkKey(l.from, l.item)}"]` : `[data-node-id="${l.from}"]`);
        const dstEl = stage.querySelector(`[data-board-frame="${l.to}"]`);
        if (srcEl === null || dstEl === null) continue;
        const node = rel(srcEl.getBoundingClientRect());
        const src = rel(frameEl.getBoundingClientRect());
        const b = rel(dstEl.getBoundingClientRect());
        const rightward = l.to > i;
        /**
         * ⚠ 线**从页边出发，不从节点出发**。此前起点取的是节点自身的左右缘，而节点在手机
         * 里面，于是每条线都要横穿这一页的内容才能出来——实测图上一条线正好划过 AI 气泡
         * 「已使用按剩余天数按比例退。」。垂直位置仍取节点中心（夹在页内），所以"是哪个控件
         * 出发的"依然读得出来，只是线本身只走页与页之间的空档。
         */
        const sx = rightward ? src.x2 : src.x1;
        const sy = clampTo((node.y1 + node.y2) / 2, src.y1 + 8, src.y2 - 8);
        const tx = rightward ? b.x1 : b.x2;
        // 终点此前固定取目标页的**垂直中心**，于是两条反向的线在中间撞成一对背靠背箭头
        // （实测图 1、2 页之间就是）。改成尽量与起点同高：线走平，落点也不再互相重合。
        const ty = clampTo(sy, b.y1 + 8, b.y2 - 8);
        const dx = Math.max(24, Math.abs(tx - sx) / 2) * (rightward ? 1 : -1);
        const key = `${i}:${linkKey(l.from, l.item)}→${l.to}`;
        if (Math.abs(l.to - i) > 1) {
          /**
           * 跨页（3→1 这种）：直连必然压过中间那一页的内容，改从**上方绕行**——同流程图的画法。
           * ⚠ 控制点必须用**固定小偏移**，不能沿用上面那个"一半距离"的 dx：跨页时两点相距很远，
           *   dx 会大到让三次曲线严重过冲——实测冲出可视区又斜插回中间那页，比直连还糟。
           *   这里是"抬起来 → 顶上走直线 → 落下去"，形状可预测，与页数多少无关。
           */
          const h = rightward ? 40 : -40;
          const top = Math.min(src.y1, b.y1) - 28;
          out.push({
            key,
            d: `M ${sx} ${sy} C ${sx + h} ${sy}, ${sx + h} ${top}, ${sx + h * 2} ${top}`
              + ` L ${tx - h * 2} ${top}`
              + ` C ${tx - h} ${top}, ${tx - h} ${ty}, ${tx} ${ty}`,
          });
          continue;
        }
        out.push({ key, d: `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}` });
      }
    });
    setPaths(out);
  }, [links, prototype]);
  React.useLayoutEffect(() => {
    measure();
    // 画板/页面尺寸变了（字体加载、窗口变化）要重量；jsdom 没有 ResizeObserver，量一次即可。
    if (typeof ResizeObserver === "undefined" || stageRef.current === null) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [measure, frames, device, landscape, view.k]);

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    touched.current = true; // 见上方 ResizeObserver：手动调过就不再自动适应
    setView((v) => {
      const k = clamp(v.k * factor);
      if (cx === undefined || cy === undefined) return { ...v, k };
      // 以指针为中心：指针下的内容点保持不动。
      const r = k / v.k;
      return { x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r, k };
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.deltaY < 0 ? STEP : 1 / STEP, e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0));
    } else {
      touched.current = true;
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // 点节点 / 画板标题 / 缩放工具条（任何可交互控件）都不是拖画板——否则 pointer capture 会吃掉按钮的 click。
    if ((e.target as HTMLElement).closest("[data-node-id],[data-board-title],[data-board-controls],button,a,input,select,textarea") !== null) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); // jsdom 没有这个方法；浏览器里有
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d === null) return;
    touched.current = true;
    setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }));
  };
  const onPointerUp = () => { drag.current = null; };

  /** 迭代 32：方向键平移。此前键盘只能缩放——聚焦到画板之后，想看右边那几页只能回去摸鼠标。 */
  const PAN = 80;
  const pan = (dx: number, dy: number) => {
    touched.current = true;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "=" || e.key === "+") { e.preventDefault(); zoomAt(STEP); }
    else if (e.key === "-") { e.preventDefault(); zoomAt(1 / STEP); }
    else if (e.key === "0") { e.preventDefault(); setView((v) => ({ ...v, k: 1 })); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); pan(PAN, 0); }
    else if (e.key === "ArrowRight") { e.preventDefault(); pan(-PAN, 0); }
    else if (e.key === "ArrowUp") { e.preventDefault(); pan(0, PAN); }
    else if (e.key === "ArrowDown") { e.preventDefault(); pan(0, -PAN); }
  };

  return (
    <div
      ref={viewportRef}
      className="relative h-full w-full touch-none overflow-hidden bg-background [background-image:radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:24px_24px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      data-testid="design-detail-board"
      data-allow-x-scroll="画板需平移缩放；transform 由 pointer/wheel 驱动"
      tabIndex={0}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onSelect?.(null); }}
    >
      <div
        ref={stageRef}
        className="absolute left-0 top-0 flex origin-top-left items-start"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, gap: GAP }}
        data-testid="design-detail-board-stage"
      >
        {frames.map((label, i) => (
          <div key={`${i}-${label}`} className="flex flex-col gap-1.5" data-testid={`design-detail-board-frame-${i}`} data-board-frame={i}>
            <button
              type="button"
              data-board-title
              onClick={() => onFocusFrame(i)}
              className={cn(
                "self-start rounded-control px-1.5 py-0.5 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                i === activeFrame ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-card",
              )}
            >
              {i + 1} · {label}
            </button>
            <div className={cn("rounded-container transition-shadow duration-fast", i === activeFrame && "ring-2 ring-primary/50 ring-offset-2 ring-offset-background")}>
              <PrototypeCanvas
              theme={theme}
                label={label}
                root={prototype[i] ?? null}
                selectedId={selectedId}
                onSelect={onSelect === null ? null : (id) => { onFocusFrame(i); onSelect(id); }}
                device={device}
                landscape={landscape}
                frameIndex={i}
                /* 迭代 16（#3773 R2）：这一轮还在生成 ⇒ 还没轮到的页说「正在画」，不是一片空白。 */
                drawing={drawing && (prototype[i] ?? null) === null}
                changed={changed}
                accent={accent}
                wireframe={wireframe}
                mode={mode}
                links={links[i]}
                onNavigate={onNavigate}
              />
            </div>
          </div>
        ))}
        {paths.length > 0 && (
          <svg className="pointer-events-none absolute left-0 top-0 h-full w-full overflow-visible" aria-hidden data-testid="design-detail-board-links">
            <defs>
              <marker id="proto-link-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 0 L 8 4 L 0 8 z" className="fill-primary" />
              </marker>
            </defs>
            {paths.map((p) => (
              <path key={p.key} d={p.d} className="fill-none stroke-primary/70" strokeWidth={2} markerEnd="url(#proto-link-arrow)" data-testid="design-detail-board-link" />
            ))}
          </svg>
        )}
      </div>
      {/*
        * 迭代 32：页与页之间的箭头此前没有任何说明。做设计的人一眼知道那是跳转，
        * 而这一屏的目标读者不知道——他看到的是几条不知道从哪来的线。
        */}
      {paths.length > 0 && (
        <p className="pointer-events-none absolute left-3 top-3 rounded-control bg-card/90 px-2 py-1 text-10 text-muted-foreground" data-testid="design-detail-board-links-legend">
          箭头 = 点了这个控件会跳到那一页
        </p>
      )}
      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-card border border-border bg-card p-0.5 text-11 shadow-lg" data-testid="design-detail-board-zoom" data-board-controls>
        {/*
          * 迭代 32 三件事：
          *   · 到头了把按钮**禁用**——原来到了 25% / 250% 还能一直点，点了不动，
          *     而屏上那个百分比也不变，看起来像卡住了。
          *   · 四颗按钮原来只有 `aria-label`：用鼠标的人看到的是四个图标，猜不出是什么，
          *     也不知道有快捷键。`title` 把名字和快捷键一起说出来。
          *   · 百分比本身可点，回到 100%——所有人都会先去点那个数字。
          */}
        <button type="button" aria-label="缩小" title="缩小（快捷键 −）" disabled={view.k <= MIN + 1e-6} onClick={() => zoomAt(1 / STEP)} className="rounded-control p-1 transition-colors duration-fast hover:bg-panel disabled:text-disabled-foreground" data-testid="design-detail-zoom-out"><Minus aria-hidden className="h-3.5 w-3.5" /></button>
        <button type="button" title="回到实际大小（快捷键 0）" onClick={() => { touched.current = true; setView((v) => ({ ...v, k: 1 })); }} className="min-w-10 rounded-control text-center text-10 text-muted-foreground transition-colors duration-fast hover:bg-panel" data-testid="design-detail-zoom-level">{Math.round(view.k * 100)}%</button>
        <button type="button" aria-label="放大" title="放大（快捷键 ＝）" disabled={view.k >= MAX - 1e-6} onClick={() => zoomAt(STEP)} className="rounded-control p-1 transition-colors duration-fast hover:bg-panel disabled:text-disabled-foreground" data-testid="design-detail-zoom-in"><Plus aria-hidden className="h-3.5 w-3.5" /></button>
        <button type="button" aria-label="实际大小" title="回到实际大小（快捷键 0）" onClick={() => { touched.current = true; setView((v) => ({ ...v, k: 1 })); }} className="rounded-control p-1 transition-colors duration-fast hover:bg-panel" data-testid="design-detail-zoom-reset"><Scan aria-hidden className="h-3.5 w-3.5" /></button>
        <button type="button" aria-label="适应画板" title="缩到刚好看全所有页；方向键可以平移" onClick={() => { touched.current = false; fit(); }} className="rounded-control p-1 transition-colors duration-fast hover:bg-panel" data-testid="design-detail-zoom-fit"><Maximize2 aria-hidden className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}
