"use client";
import * as React from "react";
import type { SectionDraft } from "./template-editor-model";
import { TONE_COLORS, noteFontSizePx, sectionGeometryMmOf } from "./template-editor-model";

/**
 * 拖拽式 A1 画布（R4，2026-08-26）——`Design.pdf` §4.2「第二步 · 拖到画布」。
 *
 * ## 为什么是原生 HTML5 drag + CSS grid，不是 fabric
 *
 * 本仓的 `CanvasStage`（fabric）在模板渲染路径上把分区框声明为 `locked`
 * （`selectable:false, evented:false`，见 `canvas-io.ts`），**对象级拖拽在那条路径上
 * 结构性不可行**，而 vendor 纪律不许改包。设计稿要的正是"拖着字段丢到网格上、
 * 拖着已放置的区块换位置"——所以编辑器这一屏用原生 DOM 实现，不经过 fabric。
 *
 * ⚠ 这**不是**第二套渲染：真正给使用者看的成品画布仍然只有一条链
 * （`explicit-template-layout.ts` → `registerTemplate` → `CanvasStage`，R1）。
 * 这里是**编辑态**的直接操作界面，产出的是 `layout`（col/row/w/h）这份数据；
 * 数据一旦存下来，渲染仍然走那条唯一的链。编辑态与渲染态用不同技术是刻意的
 * 分工，不是同一件事做了两遍。
 *
 * ## 落点即位置
 *
 * `Design.pdf` §4.2 原话：「按指针相对内容区的比例换算成 col/row」。所以命中计算
 * 用的是 `getBoundingClientRect()` 的**比例**，不是像素常量——网格 12/6 列可切、
 * 画布宽度随窗口变，比例换算是唯一不会随这两者漂移的算法。
 */

const GRID_ROWS = 8;

export function TemplateCanvasGrid({
  sections, gridCols, showSample, selectedId, editable,
  onSelect, onPlace, onMove,
}: {
  readonly sections: readonly SectionDraft[];
  readonly gridCols: 6 | 12;
  readonly showSample: boolean;
  readonly selectedId: string | null;
  readonly editable: boolean;
  readonly onSelect: (sectionId: string) => void;
  /** 从左栏拖一个未放置的字段进来。 */
  readonly onPlace: (sectionId: string, col: number, row: number) => void;
  /** 拖动一个已放置的区块换位置。 */
  readonly onMove: (sectionId: string, col: number, row: number) => void;
}) {
  const [dragging, setDragging] = React.useState<{ id: string; kind: "field" | "block" } | null>(null);
  const paperRef = React.useRef<HTMLDivElement>(null);

  const placed = sections.filter((s) => s.layout !== null);

  /** 指针 → 网格坐标。按比例换算（见文件头），不是像素常量。 */
  function cellFrom(e: React.DragEvent): { col: number; row: number } | null {
    const el = paperRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const ratioX = (e.clientX - r.left) / r.width;
    const ratioY = (e.clientY - r.top) / r.height;
    return {
      col: Math.min(gridCols, Math.max(1, 1 + Math.floor(ratioX * gridCols))),
      row: Math.min(GRID_ROWS, Math.max(1, 1 + Math.floor(ratioY * GRID_ROWS))),
    };
  }

  function onDrop(e: React.DragEvent): void {
    e.preventDefault();
    if (!editable) return;
    // 拖的是什么由 dataTransfer 带过来——不靠组件内部的 `dragging` state，
    // 那个 state 在跨组件拖拽（左栏字段卡片 → 这里）时不一定同步得上。
    const raw = e.dataTransfer.getData("application/x-tpl-drag");
    const payload = raw !== "" ? JSON.parse(raw) as { id: string; kind: "field" | "block" } : dragging;
    setDragging(null);
    if (!payload) return;
    const cell = cellFrom(e);
    if (!cell) return;
    if (payload.kind === "field") onPlace(payload.id, cell.col, cell.row);
    else onMove(payload.id, cell.col, cell.row);
  }

  return (
    <div
      ref={paperRef}
      className="relative grid w-full shadow-sm"
      style={{
        // A1 横版真实比值，同缩略图与 mm 计算共用一个来源（`Design.pdf` §5「纸面」）。
        aspectRatio: "841 / 594",
        background: "#fff",
        border: "1px solid var(--border, #D6D3CA)",
        // 四边 10mm 页边距，按比例实现：10/841 = 1.189%（`Design.pdf` §5「页边距」原话）。
        padding: "1.189%",
        gridTemplateColumns: "1fr",
        gridTemplateRows: "1fr",
      }}
      onDragOver={(e) => { if (editable) e.preventDefault(); }}
      onDrop={onDrop}
      data-testid="tpladmin-editor-canvas"
    >
      {/* 网格幽灵层：拖动中才显形（`Design.pdf` §4.2「拖动中画布网格线显形」）。 */}
      <div
        className="pointer-events-none"
        style={{
          gridArea: "1 / 1",
          display: "grid",
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
          gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
          // 6mm 间距 ÷ 821mm 内容区宽 = 0.72%（`Design.pdf` §5「网格」原话）。
          gap: "0.72%",
        }}
      >
        {Array.from({ length: gridCols * GRID_ROWS }, (_, i) => (
          <div
            key={i}
            className="rounded-[6px] border border-dashed transition-colors duration-150"
            style={{ borderColor: dragging ? "#C9C5BB" : "#F0EEE7" }}
          />
        ))}
      </div>

      {/* 区块层 */}
      <div
        style={{
          gridArea: "1 / 1",
          display: "grid",
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
          gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
          gap: "0.72%",
        }}
      >
        {placed.map((s) => {
          const layout = s.layout!;
          const geom = sectionGeometryMmOf(s, gridCols);
          const isList = s.type === "便利贴列表";
          // 实际渲染几条：受"最多条数"与"这块地方放得下几条"双重约束——
          // 画出来的东西不能比物理上放得下的还多，那是在骗人。
          const noteCount = isList ? Math.min(layout.max, Math.max(0, geom.fits)) : 1;
          return (
            <div
              key={s.sectionId}
              draggable={editable}
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-tpl-drag", JSON.stringify({ id: s.sectionId, kind: "block" }));
                setDragging({ id: s.sectionId, kind: "block" });
              }}
              onDragEnd={() => setDragging(null)}
              onClick={() => onSelect(s.sectionId)}
              className="flex cursor-pointer flex-col gap-1.5 overflow-hidden rounded-[10px] bg-white p-2"
              style={{
                gridColumn: `${layout.col} / span ${layout.w}`,
                gridRow: `${layout.row} / span ${layout.h}`,
                border: `2px solid ${selectedId === s.sectionId ? "#1F5FD0" : "#14130F"}`,
              }}
              data-testid={`tpladmin-editor-block-${s.sectionId}`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-11 font-bold">{s.name || "未命名"}</span>
                <span className="font-mono text-9 text-[#1F5FD0]">
                  {`{{${s.key}${isList ? "[]" : ""}}}`}
                </span>
                <span className="ml-auto whitespace-nowrap text-9 text-muted-foreground">
                  {isList ? `${layout.cols} 列 · 最多 ${layout.max} 条` : "文本"}
                </span>
              </div>
              <div
                className="grid flex-1 content-start gap-1 overflow-hidden"
                style={{ gridTemplateColumns: `repeat(${isList ? layout.cols : 1}, 1fr)` }}
              >
                {Array.from({ length: noteCount }, (_, i) => (
                  <div
                    key={i}
                    className="overflow-hidden rounded-[3px] px-1 py-0.5 leading-tight"
                    style={{
                      background: showSample && isList ? TONE_COLORS[layout.tone] ?? TONE_COLORS[0] : "transparent",
                      border: showSample && isList ? "none" : "1px dashed #C9C5BB",
                      // 字号由贴纸实尺推导（`Design.pdf` §5 末段：不能写成固定值，
                      // 否则小贴纸会裁字）。
                      fontSize: `${noteFontSizePx(geom.noteMm, isList)}px`,
                      aspectRatio: isList ? "1" : "auto",
                      minHeight: isList ? 0 : 18,
                    }}
                  >
                    {showSample ? sampleTextFor(s, i) : ""}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {placed.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-12 text-muted-foreground" data-testid="tpladmin-editor-canvas-empty">
            把左侧字段拖到这里 —— 落点就是它在 A1 纸上的位置
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * 样例数据（`Design.pdf` §4.2「样例数据开关在真实文案与空贴纸骨架之间切换」）。
 *
 * ⚠ 这是**排版占位**，不是"AI 会写出来的东西"：真实内容由运行时的模型产出，模板
 *   编辑器不可能知道。占位文本刻意写成「示例条目 N」这种一眼可辨的形状，
 *   而不是编一句像真话的业务文案——后者会让人以为模板里预置了内容。
 */
function sampleTextFor(s: SectionDraft, index: number): string {
  if (s.type === "便利贴列表") return `${s.name || "条目"} 示例 ${index + 1}`;
  if (s.type === "长文本") return `${s.name || "段落"} 的示例段落文字……`;
  return `${s.name || "字段"} 示例`;
}
