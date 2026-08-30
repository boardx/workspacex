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
  sectionGeometryMm, classifyNoteSize, contentMmFor, GRID_GAP_MM, TONE_COLORS,
  type PaperSizeKey,
  type SectionGeometryMm,
} from "@/lib/canvas/explicit-template-layout";

// 单一事实源迁到 `explicit-template-layout.ts`（issue #2372：`buildExplicitTemplateSpec`
// 现在也要按 `tone` 取贴纸颜色，lib 层需要能直接读到这份色板，不能反过来从组件层
// import）。这里重新导出，是因为三个既有组件（`template-display-panel.tsx`/
// `template-canvas-grid.tsx`/`template-a1-thumbnail.tsx`）一直从本文件取——不逼着
// 它们改 import 路径，只搬定义、不搬用法。
export { TONE_COLORS };

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

/** 契约允许的档位，逐字对应 `Design.pdf` §2.2 的取值列。 */
/**
 * 列数候选。⚠ 2026-08-26 实测反馈：「列数现在不能是 1 列、2 列，只能三列起也要改正」——
 * 原先是 `[3,4,5,6,8]`，1/2/7 都选不到。改成 1–8 全量：一条数据一张贴纸，列数纯粹是
 * 排版偏好（1 列＝竖排长列表，8 列＝密集小方格），没有理由从 3 起。
 */
export const COLS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
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
  type: SectionFieldType, col: number, row: number, gridCols: 6 | 12, size: PaperSizeKey = "A1",
): SectionLayoutDraft {
  // 新区块默认宽度为半幅（12 列制下 6 列），越界时夹回画布内。
  const w = Math.min(gridCols === 12 ? 6 : 3, gridCols - col + 1);
  // 列表型默认高 3 行、短文本 1 行。
  const h = Math.min(type === "便利贴列表" ? 3 : 1, 8 - row + 1);
  return {
    col, row, w, h,
    // 默认 cols 由物理宽度推出：round(区块宽mm / 82)，夹在 3-8，
    // 使贴纸落在 76mm 标准附近（`Design.pdf` §4.2 原话）。
    cols: type === "便利贴列表" ? clamp(Math.round(blockWidthMm(w, gridCols, size) / 82), 3, 8) : 3,
    max: 6,
    tone: 0,
    overflow: "缩小字号",
  };
}

function blockWidthMm(w: number, gridCols: 6 | 12, size: PaperSizeKey = "A1"): number {
  return (w / gridCols) * contentMmFor(size).w - GRID_GAP_MM;
}

const AUTO_LAYOUT_GRID_ROWS = 8;

/**
 * 「不要手工排版」——2026-08-27 人类原话：「在编辑界面因该有一个按钮，可以根据字段
 * 一键生成，中间的模板，而不需要人来手工排版」。
 *
 * ## 全量重排，不是「补齐未放置的」
 *
 * 一键生成替代的是手工拖拽本身，不是拖拽的补充——所以这里**忽略**所有已有 `layout`，
 * 按当前字段顺序重新铺满整张画布。想保留某个区块的手动位置，就不点这个按钮，改单独
 * 拖它；点了就是「这版我全交给算法」。
 *
 * ## 铺满是构造出来的，不是碰运气凑出来的
 *
 * 后端 `backfill-canvas-builtin-templates.ts` 的 `fillGrid`/`grow` 组合是从**既有的
 * px 坐标**反推 12×8 网格，天然带着"压缩空带 + 尽量长满"两步，且自己承认
 * "不保证 100%"（交错版式会剩零散格）。这里没有任何既有坐标要保留——从空白开始，
 * 于是可以选一种**保证** 100% 覆盖、零重叠的构造法：
 *
 *   ① 表头字段（`短文本`）铺一条顶带，每个占 1 行、宽度在 `gridCols` 里**整除分配**
 *      （余数分给最后几个，误差最多 1 格，不会累加）。字段数超过一行能放的数量时
 *      顺延到下一条表头带。
 *   ② 剩下的行全部给正文分区（`便利贴列表`/`长文本`）。选一个「每行几个」的份数，
 *      分区按顺序分组进每一行，行数 = ⌈正文数 / 每行个数⌉，且行数不会超过剩余可用行数
 *      （行数超限时改为按「剩余行数」反推每行份数，保证放得下）。
 *   ③ 每一行内部：宽度在 `gridCols` 里整除分配给这一行的各个分区；行之间：高度在
 *      「剩余行数」里整除分配给各行。两处分配都用同一个 `distribute()`，性质相同：
 *      和恒等于总量，因此**不会**在网格里凭空多出或少掉一格。
 *
 * 这不是"抽象上更优雅"，是这道题在"从空白构造"这个前提下唯一不需要事后补洞的做法——
 * 后端那条路径事后要补洞，恰恰是因为它被约束在"保留已有坐标的相对版式"，这里没有
 * 这条约束。
 */
export function autoFillLayout(
  drafts: readonly SectionDraft[],
  gridCols: 6 | 12,
  size: PaperSizeKey = "A1",
): SectionDraft[] {
  const named = drafts.filter((d) => d.name.trim().length > 0);
  const header = named.filter((d) => d.type === "短文本");
  const body = named.filter((d) => d.type !== "短文本");

  const placements = new Map<string, SectionLayoutDraft>();
  let row = 1;

  // ① 表头带：每行最多 gridCols 个（每个至少 1 列宽），需要几行铺几行。
  for (let i = 0; i < header.length; i += gridCols) {
    const rowFields = header.slice(i, i + gridCols);
    const widths = distribute(gridCols, rowFields.length);
    let col = 1;
    rowFields.forEach((d, j) => {
      const w = widths[j]!;
      placements.set(d.sectionId, {
        col, row, w, h: 1, cols: 3, max: 6, tone: 0, overflow: "缩小字号",
      });
      col += w;
    });
    row += 1;
  }

  // ② 正文：剩余的行全部铺满，不留白带。
  const remainingRows = Math.max(1, AUTO_LAYOUT_GRID_ROWS - (row - 1));
  if (body.length > 0) {
    // 每行份数：优先 3 个一行（与内置模板的常见版式一致），但不能让所需行数
    // 超过剩余可用行数——超过时改为「按剩余行数反推」，保证放得下。
    const perRowByDefault = Math.min(gridCols, body.length, 3);
    const rowsNeeded = Math.ceil(body.length / perRowByDefault);
    const bodyRows = Math.min(remainingRows, rowsNeeded);
    const perRow = Math.ceil(body.length / bodyRows);

    const rowHeights = distribute(remainingRows, bodyRows);
    let bodyRow = row;
    for (let r = 0; r < bodyRows; r += 1) {
      const items = body.slice(r * perRow, (r + 1) * perRow);
      if (items.length === 0) continue;
      const h = rowHeights[r]!;
      const widths = distribute(gridCols, items.length);
      let col = 1;
      items.forEach((d, j) => {
        const w = widths[j]!;
        const isList = d.type === "便利贴列表";
        placements.set(d.sectionId, {
          col, row: bodyRow, w, h,
          cols: isList ? clamp(Math.round(blockWidthMm(w, gridCols, size) / 82), 3, 8) : 3,
          max: 6,
          tone: r % 4,
          overflow: "缩小字号",
        });
        col += w;
      });
      bodyRow += h;
    }
  }

  return drafts.map((d) => (placements.has(d.sectionId) ? { ...d, layout: placements.get(d.sectionId)! } : d));
}

/** 把 `total` 拆成 `count` 份正整数，和恒等于 `total`——余数分给靠前的几份。 */
function distribute(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const rem = total % count;
  return Array.from({ length: count }, (_, i) => base + (i < rem ? 1 : 0));
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

export function sectionGeometryMmOf(
  s: SectionDraft, gridCols: 6 | 12, size: PaperSizeKey = "A1",
): SectionGeometryMm {
  const layout = s.layout;
  if (!layout) return { wMm: 0, hMm: 0, noteMm: 0, rows: 0, fits: 0 };
  return sectionGeometryMm({ w: layout.w, h: layout.h, cols: layout.cols, gridCols, size });
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
  /**
   * 提示词正文里写了、但字段表里没有的占位符（§6 规则③）。
   *
   * ⚠ 规则③ 的字面表述是「**画布上**出现字段表里没有的占位符」——那一半在本实现里
   *   **构造上不可能**：设计稿 §2.2 把 `fields[]` 与 `blocks[]` 分成两个数组、block
   *   用 `fieldKey` 引用字段，于是「删了字段没删 block」会留下悬空引用；本实现把两者
   *   合并成同一个对象（`SectionDraft` + 可选 `layout`），区块不可能没有字段——
   *   非法状态在类型上就表达不出来，这比运行时报警更强。
   *
   *   但**同一个失效模式**在这里另有一条真实可达的路径：顾问在提示词正文（§4.1 那个
   *   自由文本框）里写 `{{gains}}`，而字段表里没有 `gains`。后果与规则③ 描述的完全
   *   一致——AI 被要求产出这个键，而输出结构（由字段表派生）不声明它，数据静默丢失。
   *   所以规则③ 落在这里，不落在画布上。
   */
  readonly danglingPlaceholders: readonly string[];
  /** 可以发布吗（§6 规则⑦：无溢出、无未放置字段——不满足时允许强制发布但要二次确认）。 */
  readonly publishClean: boolean;
}

/**
 * 从提示词正文里抽出所有 `{{token}}` / `{{token[]}}` 占位符的 key。
 *
 * 只认 §2.1 规定的 key 形状（小写英文 + 下划线）——顾问在正文里写的 `{{注意}}`
 * 这类中文花括号内容不是占位符，不该被当成"未定义字段"来报警。
 */
export function extractPromptPlaceholders(promptText: string): string[] {
  const found = new Set<string>();
  for (const m of promptText.matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*(?:\[\s*\])?\s*\}\}/g)) {
    const key = m[1];
    if (key !== undefined) found.add(key);
  }
  return [...found];
}

export function checkTemplateHealth(
  drafts: readonly SectionDraft[], gridCols: 6 | 12, promptText = "", size: PaperSizeKey = "A1",
): TemplateHealth {
  const named = drafts.filter((d) => d.name.trim().length > 0);
  const unplaced = named.filter((d) => d.layout === null);
  const overflowing: { section: SectionDraft; max: number; fits: number }[] = [];
  for (const d of named) {
    if (!d.layout || d.type !== "便利贴列表") continue;
    const geom = sectionGeometryMmOf(d, gridCols, size);
    if (d.layout.max > geom.fits) overflowing.push({ section: d, max: d.layout.max, fits: geom.fits });
  }
  const seen = new Set<string>();
  const duplicateKeys: string[] = [];
  for (const d of named) {
    if (seen.has(d.key)) duplicateKeys.push(d.key);
    seen.add(d.key);
  }
  // §6 规则③：提示词里提到、字段表里没有的占位符（见 `danglingPlaceholders` 文档）。
  const knownKeys = new Set(named.map((d) => d.key));
  const danglingPlaceholders = extractPromptPlaceholders(promptText).filter((k) => !knownKeys.has(k));

  return {
    fieldCount: named.length,
    placedCount: named.length - unplaced.length,
    unplaced,
    overflowing,
    duplicateKeys,
    danglingPlaceholders,
    publishClean: unplaced.length === 0 && overflowing.length === 0
      && duplicateKeys.length === 0 && danglingPlaceholders.length === 0,
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
