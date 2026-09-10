"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  COLS_OPTIONS, MAX_COUNT_MIN, MAX_COUNT_MAX, OVERFLOW_OPTIONS, TONE_COLORS,
  classifyNoteSize, sectionGeometryMmOf, clamp, maxFreeW, maxFreeH, collidesWithOthers, GRID_ROWS,
  isTextual, TEXT_ALIGNS, TEXT_VALIGNS, DEFAULT_FIELD_FONT_SIZE,
  type TextAlign, type TextVAlign,
  FONT_WEIGHT_OPTIONS, TEXT_FONT_SIZE_MIN, TEXT_FONT_SIZE_MAX,
  type SectionDraft, type SectionLayoutDraft, type TemplateHealth,
} from "./template-editor-model";
import { sectionGeometryMm, type PaperSizeKey } from "@/lib/canvas/explicit-template-layout";

/**
 * 第三步 · 显示方式（R5，2026-08-26）——`Design.pdf` §4.3 右栏逐条实现。
 *
 * 未选中区块时显示**模板体检**（同 §4.3 末条），选中时显示这一块的显示设置。
 * 所有 mm 数字都来自 `sectionGeometryMm`（R1 的纯函数），与画布渲染**同源**——
 * `Design.pdf` §5 开头那句「所有 mm 换算必须与屏幕渲染同源，不能两套数」。
 */
export function TemplateDisplayPanel({
  section, sections, gridCols, health, editable, onPatch, onPatchSection, onRemove, paperSize = "A1",
}: {
  readonly section: SectionDraft | null;
  /**
   * 全部分区——issue #2564：「在 A1 上占多大」的宽/高步进器上限此前只夹画布边界，
   * 不管相邻分区，现在要用 `maxFreeW`/`maxFreeH` 算出「不会撞上别的已放置分区」的
   * 真实上限，因此需要看到整份分区列表，不能只看选中的这一个。
   */
  readonly sections: readonly SectionDraft[];
  readonly gridCols: 6 | 12;
  readonly health: TemplateHealth;
  readonly editable: boolean;
  readonly onPatch: (patch: Partial<SectionLayoutDraft>) => void;
  /**
   * 改分区自身的字段（非 `layout`）——「文本对象」的文字内容/颜色/字号/粗细、
   * 数据字段的「隐藏字段名」都落在这里，不是 `onPatch`（那个只碰 `layout`）。
   */
  readonly onPatchSection: (patch: Partial<SectionDraft>) => void;
  readonly onRemove: () => void;
  /** 纸张尺寸——决定这里显示的 mm 数。缺省 `"A1"`，兼容既有调用方。 */
  readonly paperSize?: PaperSizeKey;
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
              className="h-full bg-inverse transition-[width] duration-slow"
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
          {/* §6 规则③：提示词里写了字段表没有的占位符（画布那一半构造上不可能，
              见 `TemplateHealth.danglingPlaceholders` 文档）。 */}
          {health.danglingPlaceholders.length > 0 && (
            <span className="text-11 text-warning-foreground" data-testid="tpladmin-editor-health-dangling">
              提示词里有字段表没有的占位符：{health.danglingPlaceholders.map((k) => `{{${k}}}`).join("、")}
              {" "}—— 这部分数据生成后会被丢弃
            </span>
          )}
          {/* §6 规则⑥：max > 容量不阻止保存，但要显式提示按 overflow 策略处理。 */}
          {health.overflowing.length > 0 && (
            <span className="text-11 text-warning-foreground" data-testid="tpladmin-editor-health-overflow">
              {health.overflowing.map((o) => `${o.section.key}（最多 ${o.max} 条 > 放得下 ${o.fits} 条）`).join("；")}
            </span>
          )}
          {/* issue #2564：两个分区在网格上重叠——正常操作现在已经产生不了这种状态，
              这里报的是存量数据（回填/本修复上线前手工拖出来的模板）。重叠会让
              标题条/便签互相压住，必须挪开才能发布干净。 */}
          {health.overlapping.length > 0 && (
            <span className="text-11 text-destructive" data-testid="tpladmin-editor-health-overlap">
              区块位置重叠：{health.overlapping.map((s) => s.key).join("、")} —— 请在画布上把它们挪开
            </span>
          )}
        </div>
      </div>
    );
  }

  const layout = section.layout;

  // 「文本对象」是静态装帧文字，没有数据来源/列数/最多条数/超出策略这些概念——
  // 自成一套右栏（用户直接交办，2026-09-08：文字内容/颜色/字号/粗细四项），
  // 只与数据字段共用「在 A1 上占多大」（下面单独渲染）与移除按钮。
  if (section.type === "文本对象") {
    return (
      <div className="flex flex-1 flex-col gap-3.5 overflow-auto p-3.5" data-testid="tpladmin-editor-display-text">
        <Group label="文本内容">
          <textarea
            className="min-h-[64px] rounded-card border border-border bg-background px-2 py-1.5 text-12 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            value={section.content}
            disabled={!editable}
            onChange={(e) => onPatchSection({ content: e.target.value })}
            data-testid="tpladmin-editor-text-content-input"
          />
        </Group>
        <Group label="颜色">
          <input
            type="color"
            className="h-8 w-14 cursor-pointer rounded-control border border-border bg-background disabled:cursor-default"
            value={section.color ?? "#14130F"}
            disabled={!editable}
            onChange={(e) => onPatchSection({ color: e.target.value })}
            data-testid="tpladmin-editor-text-color"
          />
        </Group>
        <Group label="字号">
          <div className="flex items-center gap-2">
            <Stepper
              value={section.fontSize} min={TEXT_FONT_SIZE_MIN} max={TEXT_FONT_SIZE_MAX} editable={editable}
              onChange={(fontSize) => onPatchSection({ fontSize })} testIdPrefix="tpladmin-editor-text-fontsize"
            />
            <span className="text-11 text-muted-foreground">px</span>
          </div>
        </Group>
        <Group label="粗细">
          <Chips
            options={FONT_WEIGHT_OPTIONS}
            value={(section.fontWeight === "bold" ? "bold" : "normal") as (typeof FONT_WEIGHT_OPTIONS)[number]}
            editable={editable}
            onPick={(fontWeight) => onPatchSection({ fontWeight })}
            format={(v) => (v === "bold" ? "粗体" : "常规")}
            testIdPrefix="tpladmin-editor-text-weight"
          />
        </Group>
        <AlignGroups section={section} editable={editable} onPatchSection={onPatchSection} />

        {layout && (
          <Group label="在 A1 上占多大">
            <div className="flex items-center gap-2">
              <span className="w-6 text-11 text-muted-foreground">宽</span>
              <Stepper
                value={layout.w} min={1}
                max={Math.max(layout.w, maxFreeW(sections, section.sectionId, layout.col, layout.row, layout.h, gridCols))}
                editable={editable}
                onChange={(w) => onPatch({ w })} testIdPrefix="tpladmin-editor-w"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-6 text-11 text-muted-foreground">高</span>
              <Stepper
                value={layout.h} min={1}
                max={Math.max(layout.h, maxFreeH(sections, section.sectionId, layout.col, layout.row, layout.w))}
                editable={editable}
                onChange={(h) => onPatch({ h })} testIdPrefix="tpladmin-editor-h"
              />
            </div>
          </Group>
        )}

        {editable && (
          <Button
            size="sm"
            variant="outline"
            className="mt-auto border-destructive/40 text-destructive"
            onClick={onRemove}
            data-testid="tpladmin-editor-remove-block"
          >
            从画布移除
          </Button>
        )}
      </div>
    );
  }

  const isList = section.type === "便利贴列表";
  const geom = sectionGeometryMmOf(section, gridCols, paperSize);
  /**
   * 「宽/高加不动」的真实原因（见下方步进器旁那行提示的注释）。`null` = 还能加，
   * 或者这个字段还没放到画布上。
   *
   * 三种情况分开说，因为出路完全不同：**已经压住邻居**（历史数据留下的坏状态，
   * 出路是把它缩小）、**被邻居挡住**（出路是挪走谁）、**顶到纸边**（没有出路，
   * 那就是画布边界）。三种都只表现为一个置灰的加号，不说清楚就只剩"点不动"。
   */
  const blockedBy: string | null = (() => {
    const layout = section.layout;
    if (!layout) return null;
    if (collidesWithOthers(sections, section.sectionId, layout)) {
      return "这块地方正压住旁边的分区 —— 先把宽或高调小，或把它拖到空位上";
    }
    const freeW = maxFreeW(sections, section.sectionId, layout.col, layout.row, layout.h, gridCols);
    const freeH = maxFreeH(sections, section.sectionId, layout.col, layout.row, layout.w);
    const wStuck = layout.w >= freeW;
    const hStuck = layout.h >= freeH;
    if (!wStuck && !hStuck) return null;
    // 顶到纸边 vs 被邻居挡住：夹到画布边界的那个数就是纸边的上限。
    const edgeW = gridCols - layout.col + 1;
    const edgeH = GRID_ROWS - layout.row + 1;
    const blocked: string[] = [];
    if (wStuck && freeW < edgeW) blocked.push("右边");
    if (hStuck && freeH < edgeH) blocked.push("下面");
    if (blocked.length === 0) return "已经顶到纸边了";
    return `${blocked.join("和")}被别的分区占住了 —— 挪开它，或把这块拖到空位上`;
  })();
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
            {/* flex-wrap，不是 flex-1 平分：8 个候选（1–8 列）挤在 276px 定宽栏里
                平分会窄到点不准，换行成两排更好按。 */}
            <div className="flex flex-wrap gap-1.5">
              {COLS_OPTIONS.map((n) => {
                const mm = sectionGeometryMm({ w: layout.w, h: layout.h, cols: n, max: layout.max, gridCols, size: paperSize }).noteMm;
                const on = layout.cols === n;
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={!editable}
                    onClick={() => onPatch({ cols: n })}
                    className={`flex w-[63px] flex-col items-center gap-1 rounded-card border py-1.5 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "border-inverse bg-warning/10" : "border-border hover:bg-muted"}`}
                    data-testid={`tpladmin-editor-cols-${n}`}
                  >
                    <span className="flex gap-px">
                      {Array.from({ length: Math.min(n, 6) }, (_, i) => (
                        <span
                          key={i}
                          className={`h-3 rounded-sm ${on ? "bg-inverse" : "bg-border"}`}
                          style={{ width: Math.max(2, Math.round(24 / Math.min(n, 6))) }}
                        />
                      ))}
                    </span>
                    <span className={`text-10 font-bold ${on ? "text-foreground" : "text-muted-foreground"}`}>{n} 列</span>
                    {/* 每个候选各标各的 mm 数——贴纸实尺随列数缩放（`sectionGeometryMm`
                        的 `noteMm = min(MAX_NOTE_MM, wMm/cols)`），列数越多单张贴纸越小，
                        2026-09-01 推翻了 2026-08-30「固定不变」的约定，理由见
                        `explicit-template-layout.ts` 的 `MAX_NOTE_MM` 文档。 */}
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
            {/*
              2026-08-30 人类反馈：「这个要改为可以支持 1 条，到更多条」——原先是
              Chips（固定候选 [3,4,6,9]），1/2/5/7 这类常见条数都选不到。换成与
              「在 A1 上占多大」同一种步进器：覆盖 `[MAX_COUNT_MIN, MAX_COUNT_MAX]`
              全部整数，不再是候选子集。
            */}
            <div className="flex items-center gap-2">
              <Stepper
                value={layout.max} min={MAX_COUNT_MIN} max={MAX_COUNT_MAX} editable={editable}
                onChange={(max) => onPatch({ max })} testIdPrefix="tpladmin-editor-max"
              />
              <span className="text-11 text-muted-foreground">条</span>
            </div>
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
                  className="h-6 w-7 rounded-md transition-transform duration-fast hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ background: color, border: `2px solid ${layout.tone === i ? "#14130F" : "transparent"}` }}
                  data-testid={`tpladmin-editor-tone-${i}`}
                />
              ))}
            </div>
          </Group>

          {/*
            「隐藏字段名」（用户直接交办，2026-09-08）——列表型（行为/触点/痛点/机会……）
            专属：只隐藏区块标题/`{{key}}` 提示行，贴纸内容照常渲染。渲染端唯一事实源
            是 `section.hideFieldTitle`，`template-canvas-grid.tsx`/`explicit-template-layout.ts`
            都只读它，这里只负责写。
          */}
          <Group label="标题显示">
            <label className="flex cursor-pointer items-center gap-2 text-11">
              <input
                type="checkbox"
                checked={section.hideFieldTitle}
                disabled={!editable}
                onChange={(e) => onPatchSection({ hideFieldTitle: e.target.checked })}
                data-testid="tpladmin-editor-hide-field-title"
              />
              隐藏字段名（只显示内容）
            </label>
          </Group>
        </>
      )}

      {/*
        文字型数据字段（短文本/长文本）的字号与对齐——人类直接交办（2026-09-10）：
        「对于 text 的字段，可以指定，居中，靠左，靠右，靠上，靠下」「还可以指定 font
        的大小」。便利贴列表不出这两栏：贴纸是一格一格排的，字号由贴纸实尺推导
        （`noteFontSizePx`），对齐由贴纸网格决定，都不是"一段文字"的属性。
      */}
      {isTextual(section.type) && (
        <>
          <Group label="字号">
            <div className="flex items-center gap-2">
              <Stepper
                value={section.fontSize} min={TEXT_FONT_SIZE_MIN} max={TEXT_FONT_SIZE_MAX} editable={editable}
                onChange={(fontSize) => onPatchSection({ fontSize })} testIdPrefix="tpladmin-editor-field-fontsize"
              />
              <span className="text-11 text-muted-foreground">px</span>
            </div>
          </Group>
          <AlignGroups section={section} editable={editable} onPatchSection={onPatchSection} />
        </>
      )}

      <Group label="在 A1 上占多大">
        {/*
          人类 2026-08-26 实测反馈：「宽和高要有更多的选项，目前高 1 到 4 不够，要有所有的
          选项」——原先是 Chips（固定候选 [3,4,6,12] / [1,2,3,4]），网格明明是 12×8，
          却挑不出「宽 8」「高 6」这类合法值。

          ⚠ 换成步进器而不是把 Chips 的候选塞满 1..12：这一栏在右栏固定 276px 里，
            12 个 chip 每个只有 ~15px 宽，数字挤成一团点不准。步进器覆盖「全部」合法值
            （不再是候选子集），上限跟着当前列/行位置与画布列数动态收窄——与原来
            `clamp(w, 1, gridCols - layout.col + 1)` 同一条规则，只是交互换了个形状。

          ⚠ issue #2564：上限不能只看画布边界——`gridCols - layout.col + 1`/
            `8 - layout.row + 1` 只保证不越出 A1 纸，不保证不撞上旁边「已放置」的
            分区。用 `maxFreeW`/`maxFreeH` 换成「不会与相邻分区重叠」的真实上限，
            步进器因此永远停在合法、且不会画出重叠版式的范围内（`onPatch` 那边的
            `patchLayout` 仍然会再查一次重叠兜底，两处不是同一份检查的两次声明——
            这里决定「能不能点」，那边决定「点了要不要生效」，各管各的层）。

          ⚠ 2026-09-10 人类实测「什么也改不了」：上限必须再兜一道 `Math.max(当前值, …)`。
            分区一旦已经处于重叠状态（历史数据，或 `changeFieldType` 修好之前那条绕过
            门控的路径留下的），`maxFreeW`/`maxFreeH` 从 w=1 起探就撞，直接返回 1；
            `Stepper` 又把显示值 `clamp` 到上限，于是面板显示「宽 1 / 高 1」——这是假的，
            真实布局是 6×3——加号减号还双双置灰，既看不出真实尺寸，也没有任何出路。
            上限至少等于当前值之后：显示的是真实数字，减号可用，使用者能把分区缩小、
            自己走出重叠。下面那行提示负责说清楚"为什么加不动"。
        */}
        <div className="flex items-center gap-2">
          <span className="w-6 text-11 text-muted-foreground">宽</span>
          <Stepper
            value={layout.w} min={1}
            max={Math.max(layout.w, maxFreeW(sections, section.sectionId, layout.col, layout.row, layout.h, gridCols))}
            editable={editable}
            onChange={(w) => onPatch({ w })} testIdPrefix="tpladmin-editor-w"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-6 text-11 text-muted-foreground">高</span>
          <Stepper
            value={layout.h} min={1}
            max={Math.max(layout.h, maxFreeH(sections, section.sectionId, layout.col, layout.row, layout.w))}
            editable={editable}
            onChange={(h) => onPatch({ h })} testIdPrefix="tpladmin-editor-h"
          />
        </div>
        {/*
          「为什么加不动」——步进器停下来有两种完全不同的原因：撞到纸边（没救，那是
          画布本身的边界），还是被旁边已放置的分区挡住（有救：挪走邻居、或把这块挪个
          位置）。两种都只表现为一个置灰的加号，使用者无从分辨——2026-09-10 人类实测
          反馈「我什么也改不了」，一半是真的改不了（上面那条重叠 bug），另一半是改不动
          却不说为什么。这里如实交代是哪一种。
        */}
        {editable && blockedBy !== null && (
          <span className="text-10 text-destructive" data-testid="tpladmin-editor-size-blocked">
            {blockedBy}
          </span>
        )}
        <span className="text-10 text-muted-foreground" data-testid="tpladmin-editor-mm-note">
          {geom.wMm} × {geom.hMm} mm 实尺（{paperSize} 纸，四边留 10mm）
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

/**
 * −/+ 步进器，覆盖 [min, max] 全部整数——用于「在 A1 上占多大」的宽/高。
 *
 * ⚠ 不是文本输入框：数字输入允许打出界外值（如宽=99），要么静默夹紧（用户以为生效了
 *   实际被改写）要么报错打断输入。步进器每次只挪一格，永远停在合法范围内，两种坏结果
 *   都不会发生。
 */
function Stepper({
  value, min, max, editable, onChange, testIdPrefix,
}: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly editable: boolean;
  readonly onChange: (v: number) => void;
  readonly testIdPrefix: string;
}) {
  const clamped = clamp(value, min, max);
  return (
    <div className="flex flex-1 items-center gap-1">
      <button
        type="button"
        disabled={!editable || clamped <= min}
        onClick={() => onChange(clamped - 1)}
        className="flex h-7 w-7 items-center justify-center rounded-control border border-border text-12 font-bold text-muted-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-disabled disabled:bg-disabled disabled:text-disabled-foreground"
        data-testid={`${testIdPrefix}-dec`}
        aria-label="减小"
      >
        −
      </button>
      <span
        className="flex-1 text-center text-11 font-semibold tabular-nums"
        data-testid={`${testIdPrefix}-value`}
      >
        {clamped}
      </span>
      <button
        type="button"
        disabled={!editable || clamped >= max}
        onClick={() => onChange(clamped + 1)}
        className="flex h-7 w-7 items-center justify-center rounded-control border border-border text-12 font-bold text-muted-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-disabled disabled:bg-disabled disabled:text-disabled-foreground"
        data-testid={`${testIdPrefix}-inc`}
        aria-label="增大"
      >
        +
      </button>
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
          className={`flex-1 whitespace-nowrap rounded-control border px-1 py-1.5 text-10 font-semibold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            value === o ? "border-inverse bg-inverse text-inverse-foreground" : "border-border text-muted-foreground hover:bg-muted"
          }`}
          data-testid={`${testIdPrefix}-${o}`}
        >
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

/**
 * 「对齐」两栏（水平 + 垂直）——人类直接交办（2026-09-10）：「对于 text 的字段，
 * 可以指定，居中，靠左，靠右，靠上，靠下也就是左右上下要可以居中靠两边」。
 *
 * 文本对象与文字型数据字段共用同一个组件：两者对齐的语义完全一样（一段文字在它
 * 自己那个框里怎么摆），没有理由写两份长得一样、日后各改各的 JSX。
 */
function AlignGroups({
  section, editable, onPatchSection,
}: {
  readonly section: SectionDraft;
  readonly editable: boolean;
  readonly onPatchSection: (patch: Partial<SectionDraft>) => void;
}) {
  return (
    <>
      <Group label="水平对齐">
        <Chips
          options={TEXT_ALIGNS}
          value={section.align}
          editable={editable}
          onPick={(align: TextAlign) => onPatchSection({ align })}
          format={(v) => (v === "left" ? "靠左" : v === "center" ? "居中" : "靠右")}
          testIdPrefix="tpladmin-editor-align"
        />
      </Group>
      <Group label="垂直对齐">
        <Chips
          options={TEXT_VALIGNS}
          value={section.valign}
          editable={editable}
          onPick={(valign: TextVAlign) => onPatchSection({ valign })}
          format={(v) => (v === "top" ? "靠上" : v === "middle" ? "居中" : "靠下")}
          testIdPrefix="tpladmin-editor-valign"
        />
      </Group>
    </>
  );
}
