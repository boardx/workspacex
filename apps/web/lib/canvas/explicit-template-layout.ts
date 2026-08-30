/**
 * 组织自建模板的**显式布局**渲染 —— R1（2026-08-25），画布模板重设计第二轮。
 *
 * ## 与 `auto-template-layout.ts` 的关系：姊妹文件，不是替代
 *
 * `auto-template-layout.ts` 把「分区列表（只有 name/order/required/capacity）」
 * 算成几何——**没有人工指定坐标的入口**，分区多大、放哪全由算法决定。
 * 人类要求的新设计（`Design.pdf` + claude.ai/design「模板编辑器 拖拽版」原型）
 * 反过来：使用者在编辑器里**拖拽**决定每个分区放哪、多大——`SectionDef.layout`
 * （R0，#2058）就是「使用者放好的那个位置」。本文件把**已经有 layout 的分区**
 * 转成同一条渲染链认识的 `TemplateSpec`，`layout` 缺失的分区仍然走
 * `computeAutoLayout` 兜底（调用方判断，见 `template-editor-preview.ts` 的
 * 后续改版）——两条几何算法各管各的分区，不在一次调用里混用。
 *
 * ## 复用同一条渲染链，不碰 vendor
 *
 * 同 `auto-template-layout.ts` 文件头那句：`registerTemplate`/`TemplateSpec`/
 * `TemplateSection` 都是 `@repo/fabric-markdown` 的公开导出，模板在包外造，
 * `packages/fabric-markdown/` 一个字不改（VENDOR.md）。产出的 `TemplateSpec`
 * 与自动布局产出的形状完全一致，`CanvasStage`/`registerTemplate` 不需要知道
 * 这个 spec 是「算出来的」还是「拖出来的」。
 *
 * ## 两套坐标系，服务两件不同的事
 *
 * - **px 几何**（`computeExplicitLayout`）：喂给 fabric 渲染引擎的抽象画布坐标，
 *   复用 `auto-template-layout.ts` 反推出的同一个 `A0_FRAME` 基准画幅——两条
 *   渲染路径必须落在同一个尺度里，否则拖拽版模板与自动布局版模板在同一个
 *   chat 气泡里缩放后大小不统一。
 * - **mm 几何**（`sectionGeometryMm`）：`Design.pdf` §5「A1 与贴纸尺寸」的
 *   物理尺寸计算——贴纸是要打印/手写的实物，编辑器右栏要如实告诉使用者
 *   「这块地方贴纸实尺多少 mm、放不放得下标准 76mm 方形贴纸」。这条计算与
 *   fabric 画布坐标无关，是独立的一套数学，R5（显示设置面板）会用到。
 *   两套坐标系**不能相互换算**（px 是抽象渲染单位，不代表任何物理长度），
 *   混用会让人以为"px 大小 = 真实 mm 尺寸"，那正是 `Design.pdf` 强调
 *   「所有 mm 换算必须与屏幕渲染同源，不能两套数」想防的事——本文件的做法
 *   是"两套数各管各的输入"，不是"用同一套数假装两件事"。
 */
import { PAPER } from "@repo/fabric-markdown/theme";
import type { TemplateSpec, TemplateSection } from "@repo/fabric-markdown";
import { A0_FRAME, GRID_TOP, GUTTER } from "./auto-template-layout";

/**
 * `Design.pdf` §2.2：贴纸四色板，索引即 `layout.tone`。单一事实源（issue #2372
 * 之前只在 `template-editor-model.ts` 声明一份，给 HTML/CSS 预览网格用；现在
 * `buildExplicitTemplateSpec` 也要按 `tone` 给 fabric 贴纸取色，lib 层不能反过来
 * import 组件层，所以定义挪到这里，`template-editor-model.ts` 改成重新导出）。
 */
export const TONE_COLORS = ["#F7E96E", "#F2C6C2", "#CFE3D2", "#CBD8EE"] as const;

/** 契约 `canvas.SectionLayout` 的结构投影（本文件只读它，不重新定义契约）。 */
export interface ExplicitSectionLayout {
  readonly col: number;
  readonly row: number;
  readonly w: number;
  readonly h: number;
  readonly cols: number;
  readonly max: number;
  readonly tone: number;
  readonly overflow: "缩小字号" | "叠放" | "截断";
}

/** 契约 `canvas.SectionDef` 的结构投影，限定在「已放置」（`layout` 非空）的分区。 */
export interface ExplicitLayoutSectionInput {
  readonly sectionId: string;
  readonly name: string;
  readonly layout: ExplicitSectionLayout;
}

export interface ExplicitLayoutCell {
  readonly sectionId: string;
  readonly name: string;
  readonly layout: ExplicitSectionLayout;
  /** 中心点 + 尺寸（px），与 `TemplateSection` 同型。 */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ExplicitLayout {
  readonly gridCols: 6 | 12;
  readonly cells: readonly ExplicitLayoutCell[];
  readonly bounds: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
}

const GRID_ROWS = 8;

/**
 * 网格坐标（1 起的 col/row + 跨度 w/h）→ px 几何。
 *
 * 复用 `auto-template-layout.ts` 的 `A0_FRAME`/`GRID_TOP`/`GUTTER`，但**不预留
 * 右侧便签暂存区**——那是自动布局给"待归类便签"发明的装饰区，拖拽版模板由
 * 使用者自己决定怎么用满整个画幅，没有这个概念（`Design.pdf` 通篇没有提到
 * 暂存区）。可用宽度因此是 `A0_FRAME` 的全宽，不减 `PARKING_WIDTH`。
 *
 * ⚠ 纯函数，没有 fabric/DOM 依赖，可单测——同 `computeAutoLayout` 的既有约定。
 */
export function computeExplicitLayout(
  sections: readonly ExplicitLayoutSectionInput[],
  gridCols: 6 | 12,
): ExplicitLayout {
  const areaW = A0_FRAME.right - A0_FRAME.left;
  const areaH = A0_FRAME.bottom - GRID_TOP;
  const cellW = (areaW - (gridCols - 1) * GUTTER) / gridCols;
  const cellH = (areaH - (GRID_ROWS - 1) * GUTTER) / GRID_ROWS;

  const cells: ExplicitLayoutCell[] = sections.map((s) => {
    const { col, row, w, h } = s.layout;
    // col/row 是 1 起的网格左上角坐标（同 `Design.pdf` §2.2 Block），换算成
    // 0 起的像素偏移。
    const cellLeft = A0_FRAME.left + (col - 1) * (cellW + GUTTER);
    const cellTop = GRID_TOP + (row - 1) * (cellH + GUTTER);
    const widthPx = w * cellW + (w - 1) * GUTTER;
    const heightPx = h * cellH + (h - 1) * GUTTER;
    return {
      sectionId: s.sectionId,
      name: s.name,
      layout: s.layout,
      x: cellLeft + widthPx / 2,
      y: cellTop + heightPx / 2,
      w: widthPx,
      h: heightPx,
    };
  });

  return {
    gridCols,
    cells,
    bounds: { left: A0_FRAME.left, top: A0_FRAME.top, right: A0_FRAME.right, bottom: A0_FRAME.bottom },
  };
}

export interface ExplicitTemplateInput {
  readonly key: string;
  readonly displayName: string;
  readonly sections: readonly ExplicitLayoutSectionInput[];
  readonly gridCols: 6 | 12;
}

export interface ExplicitTemplateResult {
  readonly spec: TemplateSpec;
  readonly layout: ExplicitLayout;
}

/**
 * issue #2372：调用方（chat 模拟 / 真实 chat）用这个决定要不要走
 * `buildExplicitTemplateSpec`——目前只在**每个分区都已放置**（`layout` 非空）
 * 时才用；只要有一个分区还没放，整体退回 `buildAutoTemplateSpec`。
 *
 * ⚠ 不做"部分合并"（已放置的走显式坐标、未放置的另外塞进自动布局算出的空位）：
 *   两条几何算法各算各的，混用会互相压叠（自动布局不知道哪些坐标已经被显式占用）。
 *   契约 `SectionDef.layout` 的文件头注释"缺失就按既有的自动布局兜底渲染"，本函数
 *   把它读成**整体**退回，不是逐分区退回——发布前置检查本就会点名"未放置字段"
 *   （`Design.pdf` §6 规则⑦），常态下发布过的模板不会落进这个混合态。
 */
export function allSectionsPlaced(sections: readonly { readonly layout?: unknown }[]): boolean {
  return sections.length > 0 && sections.every((s) => s.layout != null);
}

/**
 * 已放置的分区 → 可渲染的 `TemplateSpec`。
 *
 * 刻意**不产出装饰**（标题分隔线之外）：必填强调框、便签暂存区都是
 * `auto-template-layout.ts` 给自动布局发明的视觉补偿，拖拽版画布由使用者
 * 自己在网格上摆放，位置本身就是可见的，不需要额外的必填框强调——
 * `Design.pdf` 的原型截图里也没有这类装饰。
 *
 * ⚠ issue #2372：本函数此前定义了但从未真正接进 chat 模拟/真实 chat 的渲染
 *   路径——那两处一直把每个分区手动降维成 `{sectionId,name,order,required,
 *   capacity}` 喂给 `buildAutoTemplateSpec`，`layout.col/row/w/h/cols/tone`
 *   在半路就被丢了，编辑器右栏「③显示方式」（列数/颜色/占多大）配了等于白配。
 *   接线见 `template-simulate-dialog.tsx`/`fence-template-resolver.ts`；本函数
 *   自己只负责"给定已放置的分区，产出一份忠实的 spec"，不关心调用方怎么决定
 *   "要不要用这条链路"（那是各调用方自己的 `layoutSource`/`sectionsDirty` 判据）。
 *   列数（`layout.cols`）与贴纸颜色（`layout.tone` → `TONE_COLORS`）现在通过
 *   `TemplateSection.sticky`/`stickyColor` 传给 fabric-markdown（vendor 侧配套
 *   扩展，见其 `VENDOR.md` 2026-08-30 回流记录）——位置/尺寸从来就在 `x/y/w/h`
 *   里，唯独这两项此前连 vendor 的类型都接不住。
 */
export function buildExplicitTemplateSpec(input: ExplicitTemplateInput): ExplicitTemplateResult {
  const layout = computeExplicitLayout(input.sections, input.gridCols);
  const sections: TemplateSection[] = layout.cells.map((c) => ({
    name: c.name,
    x: c.x,
    y: c.y,
    w: c.w,
    h: c.h,
    fill: PAPER,
    sticky: { perRow: c.layout.cols },
    stickyColor: TONE_COLORS[c.layout.tone] ?? TONE_COLORS[0],
  }));
  return {
    spec: {
      key: input.key,
      title: input.displayName,
      sections,
      titleBars: true,
      decorations: [],
    },
    layout,
  };
}

// ---------------------------------------------------------------------------
// mm 几何 —— `Design.pdf` §5「A1 与贴纸尺寸」，独立于上面的 px 渲染坐标系。
// ---------------------------------------------------------------------------

/** A1 横版纸面与内容区常量，逐字对应 `Design.pdf` §5 表格。 */
export const A1_PAPER_MM = { w: 841, h: 594 } as const;
export const A1_MARGIN_MM = 10;
export const A1_CONTENT_MM = {
  w: A1_PAPER_MM.w - A1_MARGIN_MM * 2, // 821
  h: A1_PAPER_MM.h - A1_MARGIN_MM * 2, // 574
} as const;

/**
 * 纸张尺寸预设——2026-08-27 人类原话：「模板可以选择 A1，A3，A4 等大小」。
 * ISO 216 标准值，横版（宽 > 高）。首批只落这三档，不含自定义宽高（人类裁决
 * 「先只加预设」，见契约 `canvas.PaperSize` 文件头）。
 *
 * ⚠ **页边距固定 10mm，不随纸张尺寸缩放**——这是刻意的，不是漏改：现实世界的印刷/
 *   装订安全边距通常是一个固定物理量，不会因为纸变小而跟着缩小（A4 影印件的边距
 *   与 A1 海报的边距，业界惯例都是"看装订/打孔需要"，不是按纸面比例算）。所以三档
 *   共用同一个 `A1_MARGIN_MM` 常量，内容区 = 纸面 - 2×10mm，不是纸面 × 固定比例。
 *
 * ⚠ A1/A3/A4 恰好共享同一个宽高比（√2:1，ISO 系列的定义性质），所以画布的
 *   `aspectRatio` 视觉上三档几乎不变——但仍从这张表算，不手写字面量，理由见
 *   `template-canvas-grid.tsx`/`template-a1-thumbnail.tsx` 引用处的注释。
 */
export const PAPER_SIZE_MM = {
  A1: A1_PAPER_MM,
  A3: { w: 420, h: 297 },
  A4: { w: 297, h: 210 },
} as const;

export type PaperSizeKey = keyof typeof PAPER_SIZE_MM;

/** 给定尺寸的内容区 mm（纸面 - 四边页边距）。`sectionGeometryMm` 用它替代硬编码的 `A1_CONTENT_MM`。 */
export function contentMmFor(size: PaperSizeKey): { readonly w: number; readonly h: number } {
  const paper = PAPER_SIZE_MM[size];
  return { w: paper.w - A1_MARGIN_MM * 2, h: paper.h - A1_MARGIN_MM * 2 };
}

/** 网格间距，`Design.pdf` 原话「间距 6mm（gap: 0.72%）」。 */
export const GRID_GAP_MM = 6;
/** 标题占位高度，容量公式的 22mm 来源见 `Design.pdf` §5「容量」行。 */
export const TITLE_RESERVE_MM = 22;
/**
 * 贴纸边长上限，issue #2368：`noteMm` 此前只会随列数变小单调变大、没有上限，
 * 列数选到 1 时贴纸能吃满整个区块宽度（比如 268mm），一旦超过区块可用高度就让
 * `rows` 直接归零、整块区域画不出任何内容——`rows` 有 `Math.max(0, …)` 下限保护，
 * `noteMm` 却没有对应的上限保护，这个不对称就是空白区块的根因。
 *
 * 封顶取 `classifyNoteSize` 自己定义的 "oversized" 分界线（82mm，`Design.pdf` §5
 * 「尺寸判定」行原文档位）——这条线本来就是该函数用来判"会显空"的界，贴纸边长永远
 * 不越过它，多出来的区块空间留白，不再继续把贴纸撑大到显示失败。
 */
export const MAX_NOTE_MM = 82;

export interface SectionGeometryMmInput {
  readonly w: number;
  readonly h: number;
  readonly cols: number;
  readonly gridCols: 6 | 12;
  /** 纸张尺寸——决定内容区物理 mm 数。缺省 `"A1"`，兼容既有调用方（历史数据的默认尺寸）。 */
  readonly size?: PaperSizeKey;
}

export interface SectionGeometryMm {
  /** 区块实尺（mm）。`wMm = w/列数 × 821 - 6`，`hMm = h/8 × 574 - 6`。 */
  readonly wMm: number;
  readonly hMm: number;
  /** 贴纸实尺（mm），固定 1:1 方形。`noteMm = min(MAX_NOTE_MM, (wMm - 6×(cols-1)) / cols)`。 */
  readonly noteMm: number;
  /** 这块地方竖着放得下几行贴纸。`rows = floor((hMm - 22) / (noteMm + 6))`。 */
  readonly rows: number;
  /** 容量 = cols × rows——放得下的贴纸总条数。 */
  readonly fits: number;
}

/**
 * `Design.pdf` §5 表格逐字实现：区块跨度（网格单位）→ mm 实尺 → 贴纸实尺 → 容量。
 *
 * ⚠ 与 `computeExplicitLayout` 的 px 几何**共享同一份输入**（`w/h/cols/gridCols`），
 *   但算法完全独立——这里的除数是 821/574（mm 常量），px 那边除数是 A0_FRAME
 *   算出来的 cellW/cellH（渲染画布的抽象单位）。两条链路对同一个网格坐标各自
 *   给出正确答案，不是同一个数字的两种写法。
 */
export function sectionGeometryMm(input: SectionGeometryMmInput): SectionGeometryMm {
  const rowSpanDenominator = 8; // 网格恒 8 行，列数才切 6/12。
  const contentMm = contentMmFor(input.size ?? "A1");
  const wMm = (input.w / input.gridCols) * contentMm.w - GRID_GAP_MM;
  const hMm = (input.h / rowSpanDenominator) * contentMm.h - GRID_GAP_MM;
  const noteMm = Math.min(MAX_NOTE_MM, (wMm - GRID_GAP_MM * (input.cols - 1)) / input.cols);
  const rows = Math.max(0, Math.floor((hMm - TITLE_RESERVE_MM) / (noteMm + GRID_GAP_MM)));
  return {
    wMm: Math.round(wMm),
    hMm: Math.round(hMm),
    noteMm: Math.round(noteMm),
    rows,
    fits: input.cols * rows,
  };
}

export type NoteSizeClass = "too-small" | "compact" | "standard" | "oversized";

/**
 * 贴纸实尺判定，`Design.pdf` §5「尺寸判定」行原文档位：
 * 70–82mm=标准76mm✓；46–70mm=小号51mm；>82mm=偏大会显空；<46mm=现场写不下。
 */
export function classifyNoteSize(noteMm: number): NoteSizeClass {
  if (noteMm < 46) return "too-small";
  if (noteMm < 70) return "compact";
  if (noteMm <= 82) return "standard";
  return "oversized";
}
