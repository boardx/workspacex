"use client";
import * as React from "react";
import type { CanvasTemplate } from "@/lib/live-canvas";

/**
 * 模板库卡片顶部的 **A1 缩略图**（R2，2026-08-25）。
 *
 * `Design.pdf` §3.1「卡片」原话：「A1 缩略图（比例 841/594，按 block 的 col/row/w/h
 * 画出色块，贴纸色沿用 tone，文本类区块用浅灰）」。
 *
 * ## 为什么是 CSS grid 而不是复用 `CanvasStage`
 *
 * `CanvasStage` 会真的起一个 fabric canvas（WebGL/2D context + 一整棵对象树）。
 * 模板库一屏可能有几十张卡片，每张都挂一个 fabric 实例是不可接受的开销，而缩略图
 * 需要表达的信息只有「哪块地方有内容、什么颜色」——一个 12×8 的 CSS grid 就够了。
 * 这不是"两套渲染各画各的"：真实渲染仍然只有 `explicit-template-layout.ts` 那一条
 * （R1），缩略图只是同一份 `layout` 数据的另一种**降级**表达，不参与任何几何计算，
 * 也因此不可能与真实渲染算出不同的结果——它压根不算。
 *
 * ## `layout` 缺失的模板画什么
 *
 * R0 起 `layout` 是可选字段：19 个内置模板与存量 org 模板都没有它。这些模板在画布上
 * 走 `computeAutoLayout` 自动排布，缩略图这里**不去复算一遍自动布局**（那就成了第二
 * 处几何声明），而是如实画一个"未排版"的占位态——分区数量仍然真实反映出来，
 * 只是不假装知道它们的位置。
 */

/** `Design.pdf` §2.2：贴纸四色板，索引即 `layout.tone`。 */
const TONE_COLORS = ["#F7E96E", "#F2C6C2", "#CFE3D2", "#CBD8EE"] as const;
/** 文本类区块（短文本/长文本）用浅灰——它们不是贴纸，没有 tone 语义。 */
const TEXT_BLOCK_COLOR = "#FAF9F6";

export function TemplateA1Thumbnail({ template }: { readonly template: CanvasTemplate }) {
  const placed = template.sections.filter((s) => s.layout != null);
  const hasLayout = placed.length > 0;

  return (
    <div
      className="rounded-md border border-border-subtle bg-panel p-2"
      data-testid={`tpladmin-thumb-${template.key}-${template.version}`}
    >
      <div
        className="grid gap-[3px] rounded-sm border border-border bg-background p-1.5"
        style={{
          // 841/594 是 A1 横版的真实比值（不是 √2 ≈ 1.4142，见 Design.pdf §5「纸面」
          // 那行的强调），缩略图沿用同一个比值，卡片上看到的形状就是纸的形状。
          aspectRatio: "841 / 594",
          gridTemplateColumns: "repeat(12, 1fr)",
          gridTemplateRows: "repeat(8, 1fr)",
        }}
        aria-hidden
      >
        {hasLayout
          ? placed.map((s, i) => {
            const layout = s.layout!;
            const isList = s.type === "便利贴列表";
            return (
              <div
                key={s.sectionId || i}
                className="rounded-[2px] border border-border-subtle"
                style={{
                  gridColumn: `${layout.col} / span ${layout.w}`,
                  gridRow: `${layout.row} / span ${layout.h}`,
                  background: isList ? TONE_COLORS[layout.tone] ?? TONE_COLORS[0] : TEXT_BLOCK_COLOR,
                }}
              />
            );
          })
          : null}
      </div>
      {!hasLayout && (
        // 如实说明：这些模板确实有分区，只是还没有人在拖拽编辑器里给它们排过版
        // ——不画一个编出来的版式冒充"它长这样"。
        <p className="mt-1 text-9 text-muted-foreground" data-testid={`tpladmin-thumb-unplaced-${template.key}-${template.version}`}>
          {template.sections.length > 0
            ? `${template.sections.length} 个分区 · 尚未在画布上排版（按自动布局渲染）`
            : "空模板 · 还没有分区"}
        </p>
      )}
    </div>
  );
}
