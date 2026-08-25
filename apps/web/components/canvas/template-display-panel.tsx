"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  COLS_OPTIONS, MAX_OPTIONS, WIDTH_OPTIONS, HEIGHT_OPTIONS, OVERFLOW_OPTIONS, TONE_COLORS,
  classifyNoteSize, sectionGeometryMmOf, clamp,
  type SectionDraft, type SectionLayoutDraft, type TemplateHealth,
} from "./template-editor-model";
import { sectionGeometryMm } from "@/lib/canvas/explicit-template-layout";

/**
 * 第三步 · 显示方式（R5，2026-08-26）——`Design.pdf` §4.3 右栏逐条实现。
 *
 * 未选中区块时显示**模板体检**（同 §4.3 末条），选中时显示这一块的显示设置。
 * 所有 mm 数字都来自 `sectionGeometryMm`（R1 的纯函数），与画布渲染**同源**——
 * `Design.pdf` §5 开头那句「所有 mm 换算必须与屏幕渲染同源，不能两套数」。
 */
export function TemplateDisplayPanel({
  section, gridCols, health, editable, onPatch, onRemove,
}: {
  readonly section: SectionDraft | null;
  readonly gridCols: 6 | 12;
  readonly health: TemplateHealth;
  readonly editable: boolean;
  readonly onPatch: (patch: Partial<SectionLayoutDraft>) => void;
  readonly onRemove: () => void;
}) {
  if (!section || !section.layout) {
    return (
      <div className="flex flex-1 flex-col gap-2.5 overflow-auto p-3.5" data-testid="tpladmin-editor-health">
        <div className="rounded-card border border-dashed border-border p-3.5 text-11 leading-relaxed text-muted-foreground">
          先在画布上点一个区块，这里会出现它的显示设置：列数、最多条数、颜色、在 A1 上的占位。
        </div>
        <div className="flex flex-col gap-2 rounded-card border border-border p-3">
          <span className="text-11 font-bold">模板体检</span>
          <div className="h-1.5 overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-foreground transition-[width] duration-slow"
              style={{ width: `${health.fieldCount === 0 ? 0 : Math.round((health.placedCount / health.fieldCount) * 100)}%` }}
              data-testid="tpladmin-editor-health-bar"
            />
          </div>
          <span className="text-11 text-muted-foreground" data-testid="tpladmin-editor-health-line">
            {health.fieldCount} 个字段 · {health.placedCount} 个已放到画布
          </span>
          {/* §6 规则②：字段没有对应 block ⇒ 报「未放置/未绑定，生成后会被丢弃」。 */}
          {health.unplaced.length > 0 ? (
            <span className="text-11 text-warning-foreground" data-testid="tpladmin-editor-health-unplaced">
              未放置：{health.unplaced.map((s) => s.key).join("、")} —— 生成后会被丢弃
            </span>
          ) : (
            <span className="text-11 text-muted-foreground" data-testid="tpladmin-editor-health-all-placed">
              全部字段都有画布位置 ✓
            </span>
          )}
          {/* §6 规则①：key 模板内唯一。 */}
          {health.duplicateKeys.length > 0 && (
            <span className="text-11 text-destructive" data-testid="tpladmin-editor-health-dup-keys">
              key 重复：{health.duplicateKeys.join("、")} —— AI 返回的 JSON 会互相覆盖
            </span>
          )}
          {/* §6 规则⑥：max > 容量不阻止保存，但要显式提示按 overflow 策略处理。 */}
          {health.overflowing.length > 0 && (
            <span className="text-11 text-warning-foreground" data-testid="tpladmin-editor-health-overflow">
              {health.overflowing.map((o) => `${o.section.key}（最多 ${o.max} 条 > 放得下 ${o.fits} 条）`).join("；")}
            </span>
          )}
        </div>
      </div>
    );
  }

  const layout = section.layout;
  const isList = section.type === "便利贴列表";
  const geom = sectionGeometryMmOf(section, gridCols);
  const sizeClass = classifyNoteSize(geom.noteMm);
  const sizeNote = sizeClass === "standard" ? "≈ 标准 76mm 方形贴纸 ✓"
    : sizeClass === "compact" ? "≈ 小号 51mm 贴纸"
      : sizeClass === "oversized" ? "比标准贴纸大，会显空"
        : "比 51mm 还小，现场写不下";

  return (
    <div className="flex flex-1 flex-col gap-3.5 overflow-auto p-3.5" data-testid="tpladmin-editor-display">
      <Group label="数据来源">
        <div className="flex flex-col gap-0.5 rounded-card border border-border bg-panel px-2.5 py-2">
          <span className="font-mono text-11 font-bold text-primary" data-testid="tpladmin-editor-display-token">
            {`{{${section.key}${isList ? "[]" : ""}}}`}
          </span>
          <span className="text-11 text-muted-foreground">
            {isList ? "列表型 · 一条数据一张贴纸" : `${section.type} · 单值`}
          </span>
        </div>
      </Group>

      {isList && (
        <>
          <Group label="列数 —— 一条数据一张方形贴纸（76mm 标准）">
            <div className="flex gap-1.5">
              {COLS_OPTIONS.map((n) => {
                const mm = sectionGeometryMm({ w: layout.w, h: layout.h, cols: n, gridCols }).noteMm;
                const on = layout.cols === n;
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={!editable}
                    onClick={() => onPatch({ cols: n })}
                    className={`flex flex-1 flex-col items-center gap-1 rounded-card border py-1.5 transition-colors duration-fast ${on ? "border-foreground bg-warning/10" : "border-border hover:bg-muted"}`}
                    data-testid={`tpladmin-editor-cols-${n}`}
                  >
                    <span className="flex gap-px">
                      {Array.from({ length: Math.min(n, 6) }, (_, i) => (
                        <span
                          key={i}
                          className={`h-3 rounded-sm ${on ? "bg-foreground" : "bg-border"}`}
                          style={{ width: Math.max(2, Math.round(24 / Math.min(n, 6))) }}
                        />
                      ))}
                    </span>
                    <span className={`text-10 font-bold ${on ? "text-foreground" : "text-muted-foreground"}`}>{n} 列</span>
                    {/* 每个选项标出该选择下的**贴纸实尺 mm**（§4.3 原话）。 */}
                    <span className="text-9 text-muted-foreground">{mm}mm</span>
                  </button>
                );
              })}
            </div>
            <span className="text-10 leading-relaxed text-muted-foreground" data-testid="tpladmin-editor-col-note">
              贴纸实尺 {geom.noteMm}×{geom.noteMm}mm —— {sizeNote}；这块地方 {layout.cols} 列 × {geom.rows} 行 = 放得下 {geom.fits} 条
            </span>
            <span
              className={`text-10 leading-relaxed ${layout.max > geom.fits ? "text-warning-foreground" : "text-muted-foreground"}`}
              data-testid="tpladmin-editor-overflow-note"
            >
              {layout.max > geom.fits
                ? `⚠ 最多 ${layout.max} 条 > 放得下 ${geom.fits} 条：按「${layout.overflow}」处理`
                : `容量够用：最多 ${layout.max} 条 ≤ ${geom.fits} 条`}
            </span>
          </Group>

          <Group label="最多条数">
            <Chips options={MAX_OPTIONS} value={layout.max} editable={editable} format={(n) => `${n} 条`} onPick={(max) => onPatch({ max })} testIdPrefix="tpladmin-editor-max" />
          </Group>

          <Group label="贴纸颜色">
            <div className="flex gap-1.5">
              {TONE_COLORS.map((color, i) => (
                <button
                  key={color}
                  type="button"
                  disabled={!editable}
                  aria-label={`贴纸颜色 ${i + 1}`}
                  onClick={() => onPatch({ tone: i })}
                  className="h-6 w-7 rounded-md transition-transform duration-fast hover:scale-105"
                  style={{ background: color, border: `2px solid ${layout.tone === i ? "#14130F" : "transparent"}` }}
                  data-testid={`tpladmin-editor-tone-${i}`}
                />
              ))}
            </div>
          </Group>
        </>
      )}

      <Group label="在 A1 上占多大">
        <div className="flex items-center gap-2">
          <span className="w-6 text-11 text-muted-foreground">宽</span>
          <Chips options={WIDTH_OPTIONS} value={layout.w} editable={editable} onPick={(w) => onPatch({ w: clamp(w, 1, gridCols - layout.col + 1) })} testIdPrefix="tpladmin-editor-w" />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-6 text-11 text-muted-foreground">高</span>
          <Chips options={HEIGHT_OPTIONS} value={layout.h} editable={editable} onPick={(h) => onPatch({ h: clamp(h, 1, 8 - layout.row + 1) })} testIdPrefix="tpladmin-editor-h" />
        </div>
        <span className="text-10 text-muted-foreground" data-testid="tpladmin-editor-mm-note">
          {geom.wMm} × {geom.hMm} mm 实尺（A1 841×594，四边留 10mm）
        </span>
      </Group>

      <Group label="超出时">
        <Chips options={OVERFLOW_OPTIONS} value={layout.overflow} editable={editable} onPick={(overflow) => onPatch({ overflow })} testIdPrefix="tpladmin-editor-ov" />
      </Group>

      {editable && (
        <Button
          size="sm"
          variant="outline"
          className="mt-auto border-destructive/40 text-destructive"
          onClick={onRemove}
          data-testid="tpladmin-editor-remove-block"
        >
          从画布移除（字段保留）
        </Button>
      )}
    </div>
  );
}

function Group({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-9 font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Chips<T extends string | number>({
  options, value, editable, onPick, format, testIdPrefix,
}: {
  readonly options: readonly T[];
  readonly value: T;
  readonly editable: boolean;
  readonly onPick: (v: T) => void;
  readonly format?: (v: T) => string;
  readonly testIdPrefix: string;
}) {
  return (
    <div className="flex flex-1 gap-1.5">
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          disabled={!editable}
          onClick={() => onPick(o)}
          className={`flex-1 whitespace-nowrap rounded-lg border px-1 py-1.5 text-10 font-semibold transition-colors duration-fast ${
            value === o ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted"
          }`}
          data-testid={`${testIdPrefix}-${o}`}
        >
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}
