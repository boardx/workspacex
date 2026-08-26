"use client";
import * as React from "react";
import type { CanvasTemplate } from "@/lib/live-canvas";
import { computeAutoLayout } from "@/lib/canvas/auto-template-layout";
import { TONE_COLORS } from "./template-editor-model";

/**
 * 模板库卡片顶部的 **A1 缩略图**（R2；R8 2026-08-26 补上"所有模板都有真实预览"）。
 *
 * `Design.pdf` §3.1「卡片」原话：「A1 缩略图（比例 841/594，按 block 的 col/row/w/h
 * 画出色块，贴纸色沿用 tone，文本类区块用浅灰）」。
 *
 * ## 两条几何来源，一个渲染出口
 *
 * · **已排版的模板**（`section.layout` 有值）→ 直接用它的 col/row/w/h 落在 12×8 网格上。
 * · **未排版的模板**（19 个内置 + R0 之前的存量 org 模板，`layout` 恒为空）→ 用
 *   `computeAutoLayout` 算出它们**在画布上真实会呈现的**位置，再按比例映射进缩略图。
 *
 * ⚠ 第二条是 R8 补的，起因是人类实测反馈「card 必须有可视化模板的预览」：此前未排版的
 *   模板只显示一行文字「N 个分区 · 尚未排版」——那不是预览，是一句解释。而这些模板在
 *   chat 里**确实会被渲染出来**（走 `computeAutoLayout` 那条既有路径），所以"它长什么样"
 *   这件事是已知的，缩略图没有理由不画。
 *
 * ⚠ 这**不是第二套布局算法**：这里调的就是渲染时用的那一个 `computeAutoLayout`，
 *   只是把它输出的 px 坐标按比例缩进缩略图的框里。缩略图与真实渲染因此不可能不一致——
 *   它们读同一个函数的同一份输出。
 *
 * ## 为什么整个组件不复用 `CanvasStage`
 *
 * `CanvasStage` 会真起一个 fabric canvas（2D context + 一整棵对象树）。模板库一屏几十
 * 张卡片，每张挂一个 fabric 实例不可接受；而缩略图要表达的只有「哪块地方有内容、什么
 * 颜色」——绝对定位的色块就够了。
 */

/** 文本类区块（短文本/长文本）用浅灰——它们不是贴纸，没有 tone 语义。 */
const TEXT_BLOCK_COLOR = "#FAF9F6";

interface ThumbBox {
  readonly key: string;
  /** 百分比定位（0-100），与容器尺寸无关——缩略图多大都对。 */
  readonly leftPct: number;
  readonly topPct: number;
  readonly widthPct: number;
  readonly heightPct: number;
  readonly color: string;
}

export function TemplateA1Thumbnail({ template }: { readonly template: CanvasTemplate }) {
  const boxes = React.useMemo(() => thumbBoxesOf(template), [template]);

  return (
    <div
      className="border-b border-border-subtle bg-panel p-3"
      data-testid={`tpladmin-thumb-${template.key}-${template.version}`}
    >
      <div
        className="relative overflow-hidden rounded-control border border-border bg-background"
        style={{
          // A1 横版真实比值（`Design.pdf` §5 特意强调不是 √2）。
          aspectRatio: "841 / 594",
          // 四边 10mm 页边距按比例实现：10/841 = 1.189%。
          padding: "1.189%",
        }}
        aria-hidden
      >
        {boxes.map((b) => (
          <div
            key={b.key}
            className="absolute rounded-control border border-border-subtle"
            style={{
              left: `${b.leftPct}%`,
              top: `${b.topPct}%`,
              width: `${b.widthPct}%`,
              height: `${b.heightPct}%`,
              background: b.color,
            }}
          />
        ))}
        {boxes.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <span className="text-9 text-muted-foreground" data-testid={`tpladmin-thumb-empty-${template.key}-${template.version}`}>
              空模板 · 还没有分区
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 一行模板 → 缩略图色块。**两条来源共用一个出口**，见组件文件头。
 *
 * 导出供单测直接断言几何，不必渲染 DOM 再量像素。
 */
export function thumbBoxesOf(template: CanvasTemplate): ThumbBox[] {
  const placed = template.sections.filter((s) => s.layout != null);

  // ── ① 已排版：12×8 网格 → 百分比 ──────────────────────────────────────
  if (placed.length > 0) {
    return placed.map((s, i) => {
      const l = s.layout!;
      const isList = s.type === "便利贴列表";
      return {
        key: s.sectionId || `s${i}`,
        leftPct: ((l.col - 1) / 12) * 100,
        topPct: ((l.row - 1) / 8) * 100,
        widthPct: (l.w / 12) * 100,
        heightPct: (l.h / 8) * 100,
        color: isList ? TONE_COLORS[l.tone] ?? TONE_COLORS[0] : TEXT_BLOCK_COLOR,
      };
    });
  }

  // ── ② 未排版：走渲染时用的同一个自动布局，再按其自身外接框归一化 ──────
  if (template.sections.length === 0) return [];
  const layout = computeAutoLayout(template.sections.map((s) => ({
    sectionId: s.sectionId,
    name: s.name,
    order: s.order,
    required: s.required,
    capacity: s.capacity,
  })));
  const { left, top, right, bottom } = layout.bounds;
  const frameW = right - left;
  const frameH = bottom - top;
  if (frameW <= 0 || frameH <= 0) return [];

  return layout.cells.map((c, i) => ({
    key: c.sectionId || `c${i}`,
    // `AutoLayoutCell` 的 x/y 是**中心点**（与 `TemplateSection` 同型），换成左上角。
    leftPct: ((c.x - c.w / 2 - left) / frameW) * 100,
    topPct: ((c.y - c.h / 2 - top) / frameH) * 100,
    widthPct: (c.w / frameW) * 100,
    heightPct: (c.h / frameH) * 100,
    // 自动布局的模板没有 tone（`SectionDef.layout` 为空就没有这一栏），统一用
    // 第一档贴纸色——不编一个"看起来像是它自己选的"颜色。
    color: TONE_COLORS[0],
  }));
}
