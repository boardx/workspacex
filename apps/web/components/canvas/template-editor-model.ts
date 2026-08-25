/**
 * 模板编辑器的**本地草稿模型**（R3-R5，2026-08-26）。
 *
 * 编辑器里正在改的那份数据——与契约的 `SectionDef` 同形，但所有字段都是**已归一**的
 * （契约里 `key`/`type`/`layout` 是 `.optional()`，为了兼容 R0 之前的存量数据；
 * 编辑器界面上每个字段都必须有 key 与类型，否则渲染不出 `{{token}}`，所以进编辑器
 * 时统一补齐，出编辑器时原样提交）。
 *
 * 纯数据 + 纯函数，没有 React/DOM 依赖 —— 与 `explicit-template-layout.ts` 同样可单测。
 */
import type { CanvasTemplate } from "@/lib/live-canvas";
import {
  sectionGeometryMm, classifyNoteSize, A1_CONTENT_MM, GRID_GAP_MM,
  type SectionGeometryMm,
} from "@/lib/canvas/explicit-template-layout";

export type SectionFieldType = "便利贴列表" | "短文本" | "长文本";

export interface SectionLayoutDraft {
  col: number;
  row: number;
  w: number;
  h: number;
  cols: number;
  max: number;
  tone: number;
  overflow: "缩小字号" | "叠放" | "截断";
}

export interface SectionDraft {
  sectionId: string;
  key: string;
  name: string;
  type: SectionFieldType;
  aiHint: string | null;
  order: number;
  required: boolean;
  capacity: number | null;
  /** `null` = 未放置到画布上。 */
  layout: SectionLayoutDraft | null;
}

/** `Design.pdf` §2.2：贴纸四色板，索引即 `layout.tone`。 */
export const TONE_COLORS = ["#F7E96E", "#F2C6C2", "#CFE3D2", "#CBD8EE"] as const;

/** 契约允许的档位，逐字对应 `Design.pdf` §2.2 的取值列。 */
export const COLS_OPTIONS = [3, 4, 5, 6, 8] as const;
export const MAX_OPTIONS = [3, 4, 6, 9] as const;
export const WIDTH_OPTIONS = [3, 4, 6, 12] as const;
export const HEIGHT_OPTIONS = [1, 2, 3, 4] as const;
export const OVERFLOW_OPTIONS = ["缩小字号", "叠放", "截断"] as const;
export const FIELD_TYPES: readonly SectionFieldType[] = ["便利贴列表", "短文本", "长文本"];

/**
 * 服务端的一行 → 编辑器草稿。补齐 R0 之前存量数据缺的 `key`/`type`。
 *
 * `key` 缺失时从 `sectionId` 兜底（而不是从中文名音译——那会产出不稳定的 key，
 * 同一个分区两次进编辑器可能得到两个不同的 key）。
 */
export function toDraft(row: CanvasTemplate): SectionDraft[] {
  return row.sections.map((s, i) => ({
    sectionId: s.sectionId,
    key: s.key ?? fallbackKey(s.sectionId, i),
    name: s.name,
    type: (s.type ?? "便利贴列表") as SectionFieldType,
    aiHint: s.aiHint ?? null,
    order: s.order,
    required: s.required,
    capacity: s.capacity,
    layout: s.layout ? { ...s.layout } : null,
  }));
}

function fallbackKey(sectionId: string, index: number): string {
  const cleaned = sectionId.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(cleaned) ? cleaned : `field_${index + 1}`;
}

/** 编辑器草稿 → 提交给契约的 `sections`。顺序按数组下标重排，不信草稿里的 `order`。 */
export function toContractSections(drafts: readonly SectionDraft[]): CanvasTemplate["sections"] {
  return drafts
    .filter((d) => d.name.trim().length > 0)
    .map((d, i) => ({
      sectionId: d.sectionId,
      key: d.key,
      name: d.name.trim(),
      type: d.type,
      aiHint: d.aiHint,
      order: i,
      required: d.required,
      capacity: d.capacity,
      layout: d.layout ? { ...d.layout } : null,
    }));
}

/** 新放到画布上的区块的默认布局（`Design.pdf` §4.2「落点即位置」那几条）。 */
export function defaultLayoutAt(
  type: SectionFieldType, col: number, row: number, gridCols: 6 | 12,
): SectionLayoutDraft {
  // 新区块默认宽度为半幅（12 列制下 6 列），越界时夹回画布内。
  const w = Math.min(gridCols === 12 ? 6 : 3, gridCols - col + 1);
  // 列表型默认高 3 行、短文本 1 行。
  const h = Math.min(type === "便利贴列表" ? 3 : 1, 8 - row + 1);
  return {
    col, row, w, h,
    // 默认 cols 由物理宽度推出：round(区块宽mm / 82)，夹在 3-8，
    // 使贴纸落在 76mm 标准附近（`Design.pdf` §4.2 原话）。
    cols: type === "便利贴列表" ? clamp(Math.round(blockWidthMm(w, gridCols) / 82), 3, 8) : 3,
    max: 6,
    tone: 0,
    overflow: "缩小字号",
  };
}

function blockWidthMm(w: number, gridCols: 6 | 12): number {
  return (w / gridCols) * A1_CONTENT_MM.w - GRID_GAP_MM;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** 把一个区块夹回画布内（拖到越界时用，`Design.pdf` §4.2「越界时自动夹到画布内」）。 */
export function clampLayout(layout: SectionLayoutDraft, gridCols: 6 | 12): SectionLayoutDraft {
  const w = clamp(layout.w, 1, gridCols);
  const h = clamp(layout.h, 1, 8);
  return {
    ...layout,
    w, h,
    col: clamp(layout.col, 1, gridCols - w + 1),
    row: clamp(layout.row, 1, 8 - h + 1),
  };
}

export function sectionGeometryMmOf(s: SectionDraft, gridCols: 6 | 12): SectionGeometryMm {
  const layout = s.layout;
  if (!layout) return { wMm: 0, hMm: 0, noteMm: 0, rows: 0, fits: 0 };
  return sectionGeometryMm({ w: layout.w, h: layout.h, cols: layout.cols, gridCols });
}

/**
 * 贴纸预览的字号——**由贴纸实尺推导**，不是固定值。
 * `Design.pdf` §5 末段原话：约 `clamp(6.5, noteMm × 0.115, 10.5)`，写成固定值小贴纸会裁字。
 */
export function noteFontSizePx(noteMm: number, isList: boolean): number {
  if (!isList) return 9;
  return Number(clamp(noteMm * 0.115, 6.5, 10.5).toFixed(1));
}

export { classifyNoteSize };

/**
 * 模板体检（`Design.pdf` §4.3 末条 + §6 校验规则）。
 *
 * ⚠ 体检与发布前检查**同源计算**（§6 规则⑤原话：「与它相关的警告必须从*所有*面板
 *   消失……体检、发布检查同源计算，不得留静态文案」）——所以只有这一个函数，
 *   两处面板都调它，不各写一份。
 */
export interface TemplateHealth {
  readonly fieldCount: number;
  readonly placedCount: number;
  readonly unplaced: readonly SectionDraft[];
  /** 容量不够的区块：`max > fits`，按 overflow 策略处理（§6 规则⑥：不阻止保存）。 */
  readonly overflowing: readonly { readonly section: SectionDraft; readonly max: number; readonly fits: number }[];
  /** key 重复的分区（§6 规则①：模板内唯一）。 */
  readonly duplicateKeys: readonly string[];
  /** 可以发布吗（§6 规则⑦：无溢出、无未放置字段——不满足时允许强制发布但要二次确认）。 */
  readonly publishClean: boolean;
}

export function checkTemplateHealth(
  drafts: readonly SectionDraft[], gridCols: 6 | 12,
): TemplateHealth {
  const named = drafts.filter((d) => d.name.trim().length > 0);
  const unplaced = named.filter((d) => d.layout === null);
  const overflowing: { section: SectionDraft; max: number; fits: number }[] = [];
  for (const d of named) {
    if (!d.layout || d.type !== "便利贴列表") continue;
    const geom = sectionGeometryMmOf(d, gridCols);
    if (d.layout.max > geom.fits) overflowing.push({ section: d, max: d.layout.max, fits: geom.fits });
  }
  const seen = new Set<string>();
  const duplicateKeys: string[] = [];
  for (const d of named) {
    if (seen.has(d.key)) duplicateKeys.push(d.key);
    seen.add(d.key);
  }
  return {
    fieldCount: named.length,
    placedCount: named.length - unplaced.length,
    unplaced,
    overflowing,
    duplicateKeys,
    publishClean: unplaced.length === 0 && overflowing.length === 0 && duplicateKeys.length === 0,
  };
}

/**
 * 输出结构（`Design.pdf` §4.1 第 3 条「只读，自动生成」）。
 *
 * 「键名来自字段表，列表型的条数上限取对应 block 的 max。顾问永不手写 JSON。」
 * ——所以这个函数是**派生**的，不接受任何手写输入；界面上那块 JSON 是它的输出，
 * 不是一个可编辑的文本框。
 */
export function buildOutputSchemaText(drafts: readonly SectionDraft[]): string {
  const named = drafts.filter((d) => d.name.trim().length > 0);
  if (named.length === 0) return "{\n  // 还没有字段——先写提示词并提取字段\n}";
  const lines = named.map((d, i) => {
    const tail = i === named.length - 1 ? "" : ",";
    if (d.type === "便利贴列表") {
      const max = d.layout?.max ?? 6;
      return `  "${d.key}": [{"text": 短句}] × ${max}${tail}`;
    }
    return `  "${d.key}": ${d.type === "长文本" ? "长文本" : "短文本"}${tail}`;
  });
  return `{\n${lines.join("\n")}\n}`;
}
