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
import { canvas } from "@repo/contracts";
import { getTemplate } from "@repo/fabric-markdown";
import {
  sectionGeometryMm, classifyNoteSize, contentMmFor, GRID_GAP_MM, GRID_ROWS, TONE_COLORS, STANDARD_NOTE_MM,
  type PaperSizeKey,
  type SectionGeometryMm,
} from "@/lib/canvas/explicit-template-layout";
import type { GridColsValue } from "@repo/contracts/canvas";

export { GRID_ROWS };

// 单一事实源迁到 `explicit-template-layout.ts`（issue #2372：`buildExplicitTemplateSpec`
// 现在也要按 `tone` 取贴纸颜色，lib 层需要能直接读到这份色板，不能反过来从组件层
// import）。这里重新导出，是因为三个既有组件（`template-display-panel.tsx`/
// `template-canvas-grid.tsx`/`template-a1-thumbnail.tsx`）一直从本文件取——不逼着
// 它们改 import 路径，只搬定义、不搬用法。
export { TONE_COLORS };

export type SectionFieldType = "便利贴列表" | "短文本" | "长文本" | "文本对象";

/** 「文本对象」的粗细候选——契约 `fontWeight` 是自由字符串，编辑器只暴露这两档。 */
export const FONT_WEIGHT_OPTIONS = ["normal", "bold"] as const;
export type TextFontWeight = (typeof FONT_WEIGHT_OPTIONS)[number];

/** 「文本对象」新建时的默认值——编辑器落到画布的第一眼，不是"空白等你填"。 */
export const DEFAULT_TEXT_CONTENT = "标题文字";
export const DEFAULT_TEXT_COLOR = "#14130F";
export const DEFAULT_TEXT_FONT_SIZE = 24;
export const DEFAULT_TEXT_FONT_WEIGHT: TextFontWeight = "bold";
export const TEXT_FONT_SIZE_MIN = 8;
export const TEXT_FONT_SIZE_MAX = 72;

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
  /** 「文本对象」的文字内容——其它类型不用，恒为空串。 */
  content: string;
  /** 「文本对象」的字色——其它类型不用，恒为 `null`（渲染时兜底默认色）。 */
  color: string | null;
  /**
   * 字号（px）。「文本对象」用它（缺省 `DEFAULT_TEXT_FONT_SIZE`）；2026-09-10 起
   * 「短文本」/「长文本」也用它（缺省 `DEFAULT_FIELD_FONT_SIZE`，见
   * `defaultFontSizeFor`）。「便利贴列表」不用——贴纸字号由实尺推导
   * （`noteFontSizePx`），不是这里配的。
   */
  fontSize: number;
  /** 「文本对象」的粗细——其它类型不用，恒为 `DEFAULT_TEXT_FONT_WEIGHT`。 */
  fontWeight: string;
  /** 隐藏区块标题（`{{key}}` 提示行 + 区块名），只显示内容——数据绑定型分区专用。 */
  hideFieldTitle: boolean;
  /**
   * 文字对齐（人类直接交办，2026-09-10）——「文本对象」与「短文本」/「长文本」这两种
   * 文字型数据字段用；「便利贴列表」不用（贴纸按网格排，不是一段文字）。
   * 缺省 `"left"` / `"top"`，与改动前一致。
   */
  align: TextAlign;
  valign: TextVAlign;
}

export type TextAlign = "left" | "center" | "right";
export type TextVAlign = "top" | "middle" | "bottom";
export const TEXT_ALIGNS: readonly TextAlign[] = ["left", "center", "right"];
export const TEXT_VALIGNS: readonly TextVAlign[] = ["top", "middle", "bottom"];
export const DEFAULT_TEXT_ALIGN: TextAlign = "left";
/**
 * 垂直对齐的缺省值**随类型走**——独立 review 抓到的回归（2026-09-10）：
 *
 * 「文本对象」在加 `valign` 之前，渲染节点是 `y = 格子中心, height = 格子高`，
 * 而 vendor 的 `text` 形状把文字画在**节点中心** ⇒ 它一直是**垂直居中**的；编辑器
 * 瓦片那侧也写死 `items-center`。若缺省落到 `"top"`，每一个不带 `valign` 的存量
 * 文本对象都会往上跳（实测一个 `w6/h3` 的格子：节点 y 从 233.25 变成 98.5，
 * 上移 134.75px）——**存储**确实纯增量，**渲染**却不是，那种"数据没变、画面全变"
 * 正是最难查的一类。
 *
 * 「短文本」/「长文本」走的是 2026-09-10 新加的 `fieldCells` 路径（标签在上、值在下
 * 的堆叠版式），它本来就是从框顶排下来的，`"top"` 就是它改动前的样子。
 */
export function defaultValignFor(type: SectionFieldType): TextVAlign {
  return type === "文本对象" ? "middle" : "top";
}
/** ⚠ 只是「短文本/长文本」那一档的值，**不要**拿它当所有类型的缺省——用 `defaultValignFor`。 */
export const DEFAULT_TEXT_VALIGN: TextVAlign = "top";
/**
 * 「短文本」/「长文本」没配字号时用多大——比文本对象（装帧大字）小得多，取
 * vendor 画字段值用的那个 13px（`template-engine.ts` 的表头字段与 `fieldCells`
 * 分支都是这个数），这样"没动过字号"的字段在编辑器与真实画布上是同一个大小。
 */
export const DEFAULT_FIELD_FONT_SIZE = 13;

/** 这个类型的文字没配字号时用多大。 */
export function defaultFontSizeFor(type: SectionFieldType): number {
  return type === "文本对象" ? DEFAULT_TEXT_FONT_SIZE : DEFAULT_FIELD_FONT_SIZE;
}

/**
 * 这个类型的文字没配粗细时是粗是细。
 *
 * 「文本对象」是装帧大字（标题），默认粗体——这是它上线时就有的行为。
 * 「短文本」/「长文本」是**字段值**，默认常规：vendor 画字段时标签粗、值不粗，
 * 默认给粗体会让整张画布的字段值全部变重，与改动前不一致。
 */
export function defaultFontWeightFor(type: SectionFieldType): TextFontWeight {
  return type === "文本对象" ? "bold" : "normal";
}
/** 这个类型的文字有没有对齐/字号可言（便利贴列表没有）。 */
export function isTextual(type: SectionFieldType): boolean {
  return type === "文本对象" || type === "短文本" || type === "长文本";
}

/**
 * 列数候选与「最多条数」区间——**从契约 `canvas.SECTION_LAYOUT_BOUNDS` 派生**，不在
 * 这里第二次写数字（issue #2535：此前这里是 1–8 / 1–99、契约是 3–8 / 3–9，两处各
 * 写一份、只改了一处，使用者选 1/2 列保存就 HTTP 400）。
 *
 * 历史：列数原先是 `[3,4,5,6,8]`（2026-08-26 人类反馈「列数现在不能是 1 列、2 列……
 * 也要改正」→ 1–8 全量：一条数据一张贴纸，列数纯粹是排版偏好）；「最多条数」原先是
 * `[3,4,6,9]` 四个固定档（2026-08-30 反馈「要改为可以支持 1 条，到更多条」→ 步进器
 * 覆盖区间内全部整数）。两次放开的**取值**现在都由契约那一处决定。
 */
const LAYOUT_BOUNDS = canvas.SECTION_LAYOUT_BOUNDS;
export const COLS_OPTIONS: readonly number[] = Array.from(
  { length: LAYOUT_BOUNDS.cols.max - LAYOUT_BOUNDS.cols.min + 1 },
  (_, i) => LAYOUT_BOUNDS.cols.min + i,
);
export const MAX_COUNT_MIN: number = LAYOUT_BOUNDS.max.min;
export const MAX_COUNT_MAX: number = LAYOUT_BOUNDS.max.max;
export const WIDTH_OPTIONS = [3, 4, 6, 12] as const;
export const HEIGHT_OPTIONS = [1, 2, 3, 4] as const;
export const OVERFLOW_OPTIONS = ["缩小字号", "叠放", "截断"] as const;
export const FIELD_TYPES: readonly SectionFieldType[] = ["便利贴列表", "短文本", "长文本"];

/**
 * 服务端的一行 → 编辑器草稿。补齐 R0 之前存量数据缺的 `key`/`type`。
 *
 * `key` 缺失时从 `sectionId` 兜底（而不是从中文名音译——那会产出不稳定的 key，
 * 同一个分区两次进编辑器可能得到两个不同的 key）。
 *
 * ⚠ `type` 缺失时的兜底**不能**无脑落到 `"便利贴列表"`——这是一个真实复现过的 bug
 *   （2026-08-30，人类实测「chat 模拟」跑用户画像模板，表头姓名/性别/年龄一片空白）。
 *   根因链：`backfill-canvas-builtin-templates.ts` 2026-08-26 之前写入的行（或从未被
 *   幂等升级路径追上过的存量行）里，persona 的 9 个表头字段作为 section 落库时没有
 *   `type`；一旦兜底成 `"便利贴列表"`，它们就从"表头字段"错分类成"正文分区"——
 *   `canvas-template-guidance.ts` 按 `type === "短文本"` 切分表头/正文，于是系统提示词
 *   里完全不再出现"表头字段〔姓名/…〕"这一句，模型无从得知要填这些字段；同时它们又被
 *   当成正文分区让模型写成 `## 姓名` 之类的空标题——而真正渲染用的是内置几何（`persona.ts`
 *   写死的 `headerRect`/`sections`），认不出名叫"姓名"的分区框，这段内容被悄悄丢弃。
 *   两处症状（表头空白 + 内容被吞）看起来毫不相关，实际是同一个"`type` 缺失时兜底选错"
 *   的根因。
 *
 *   所以：`type` 缺失时，先查这个 key 是不是内置模板（`@repo/fabric-markdown` 的
 *   `getTemplate`）——是的话，这个分区名如果落在 `spec.fields` 里，就是表头字段
 *   （`"短文本"`），不是正文分区；只有查不到内置 spec，或分区名不在 `fields` 里，
 *   才落回原来的 `"便利贴列表"` 默认值。这是**读时**的兼容桥接，不改库里那一行历史
 *   数据本身——存量行该走 `backfill-canvas-builtin-templates.ts` 的升级路径把
 *   `type` 真正落到库里，这里只保证在那之前，编辑器与"chat 模拟"至少不会把表头字段
 *   错当正文分区。
 */
export function toDraft(row: CanvasTemplate): SectionDraft[] {
  const builtinFields = new Set(getTemplate(row.key)?.fields ?? []);
  return row.sections.map((s, i) => ({
    sectionId: s.sectionId,
    key: s.key ?? fallbackKey(s.sectionId, i),
    name: s.name,
    type: (s.type ?? (builtinFields.has(s.name) ? "短文本" : "便利贴列表")) as SectionFieldType,
    aiHint: s.aiHint ?? null,
    order: s.order,
    required: s.required,
    capacity: s.capacity,
    layout: s.layout ? { ...s.layout } : null,
    content: s.content ?? "",
    color: s.color ?? null,
    fontSize: s.fontSize ?? defaultFontSizeFor((s.type ?? (builtinFields.has(s.name) ? "短文本" : "便利贴列表")) as SectionFieldType),
    fontWeight: s.fontWeight ?? defaultFontWeightFor((s.type ?? (builtinFields.has(s.name) ? "短文本" : "便利贴列表")) as SectionFieldType),
    hideFieldTitle: s.hideFieldTitle ?? false,
    align: s.align ?? DEFAULT_TEXT_ALIGN,
    valign: s.valign ?? defaultValignFor((s.type ?? (builtinFields.has(s.name) ? "短文本" : "便利贴列表")) as SectionFieldType),
  }));
}

/**
 * 新建一个「文本对象」草稿（未放置，落在字段列表之外的独立入口，见
 * `template-editor-panel.tsx` 的「标题 / 文本对象」栏）。`sectionId` 用时间戳而不是
 * 序号——同 `addField`/`addExtracted` 既有的生成方式，保证在同一次会话里不撞车。
 */
export function newTextDraft(order: number): SectionDraft {
  const id = `text${Date.now()}`;
  return {
    sectionId: id,
    key: id,
    name: "文本",
    type: "文本对象",
    aiHint: null,
    order,
    required: false,
    capacity: null,
    layout: null,
    content: DEFAULT_TEXT_CONTENT,
    color: DEFAULT_TEXT_COLOR,
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    fontWeight: DEFAULT_TEXT_FONT_WEIGHT,
    hideFieldTitle: false,
    align: DEFAULT_TEXT_ALIGN,
    valign: defaultValignFor("文本对象"),
  };
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
      ...(d.type === "文本对象"
        ? { content: d.content, color: d.color, fontSize: d.fontSize, fontWeight: d.fontWeight }
        // 文字型数据字段只带自己配过的那一栏：字号缺省时**不写**这一栏，存量模板
        // 的输出逐字节不变（同 `hideFieldTitle` 那条纯增量纪律）。
        : d.type === "短文本" || d.type === "长文本"
          ? {
            ...(d.fontSize !== DEFAULT_FIELD_FONT_SIZE ? { fontSize: d.fontSize } : {}),
            // 加粗（人类 2026-09-10：「text，还需要是否加粗」）——同字号那条纪律：
            // 只有配过（≠ 缺省常规）才写这一栏，存量模板的输出逐字节不变。
            ...(d.fontWeight !== defaultFontWeightFor(d.type) ? { fontWeight: d.fontWeight } : {}),
          }
          : {}),
      ...(d.hideFieldTitle ? { hideFieldTitle: true } : {}),
      ...(isTextual(d.type) && d.align !== DEFAULT_TEXT_ALIGN ? { align: d.align } : {}),
      ...(isTextual(d.type) && d.valign !== defaultValignFor(d.type) ? { valign: d.valign } : {}),
    }));
}

/** 新区块落到画布上时占几格（宽与高同一个数）——见 `defaultLayoutAt` 里的理由。 */
export const DEFAULT_BLOCK_SPAN = 2;

/**
 * 给定类型与宽度，贴纸默认摆几列。
 *
 * 由物理宽度推出：`round(区块宽mm / 贴纸格距)`，夹在 3-8——贴纸格距用标准贴纸边长
 * （`STANDARD_NOTE_MM`=76）加一道网格间距做参考，不是随手写的数（`Design.pdf` §4.2
 * 原话「使贴纸落在 76mm 标准附近」）。这只是猜一个默认摆几列——贴纸实际渲染尺寸会按
 * 这个列数与区块宽度反推（`sectionGeometryMm`），不是这里就把大小定死；摆多了/摆少了
 * 使用者都能在右栏用步进器改。
 *
 * ⚠ 单独抽出来是因为有两个调用方：`defaultLayoutAt`（新块）与 `changeFieldType`
 *   （换类型、宽度不变）。`cols` 是从 `w` 推出来的，谁改了 w 就得重算它，两处各写
 *   一份公式就是「同一事实两处声明」。
 */
export function defaultStickyColsFor(
  type: SectionFieldType, w: number, gridCols: GridColsValue, size: PaperSizeKey = "A1",
): number {
  return type === "便利贴列表"
    ? clamp(Math.round(blockWidthMm(w, gridCols, size) / (STANDARD_NOTE_MM + GRID_GAP_MM)), 3, 8)
    : 3;
}

/**
 * 新放到画布上的区块的默认布局（`Design.pdf` §4.2「落点即位置」那几条）。
 *
 * `limits` 是可选的「最多长到这么大」——调用方已经知道右边/下边被别的分区占住时
 * 传进来（`maxFreeW`/`maxFreeH` 的结果）。⚠ 必须由本函数收口，不能让调用方拿到
 * 结果再自己改 `w`/`h`：`cols`（默认摆几列）是从 `w` 推出来的，外面改宽度不改列数
 * 就会得到一份自相矛盾的布局。
 */
export function defaultLayoutAt(
  type: SectionFieldType, col: number, row: number, gridCols: GridColsValue, size: PaperSizeKey = "A1",
  limits?: { readonly maxW?: number; readonly maxH?: number },
): SectionLayoutDraft {
  // 落到画布上的默认尺寸：**一律 2×2**，不按类型分档。
  //
  // 人类直接交办（2026-09-10）：「by default all the field size should be 2*2 not
  // bigger」。此前是按类型各给各的（便利贴列表半幅 × 3 行、短文本六分之一幅 × 1 行、
  // 文本对象半幅 × 1 行），后果是每拖一个字段进来都得先把它改小——默认值越大，
  // 越容易一落地就压住邻居，也就越容易撞上「长不动」。小起点 + 右栏随手调大，
  // 比大起点 + 每次都要缩，少一步手工。
  //
  // ⚠ 与网格制式无关：2 就是 2 格，不随 6/12/24 列缩放。使用者说的是「2×2」这个
  //   格数，不是「六分之一幅」这种比例——按比例算会让 24 列制下的默认块又变回四格宽。
  const w = Math.max(1, Math.min(DEFAULT_BLOCK_SPAN, gridCols - col + 1, limits?.maxW ?? Number.POSITIVE_INFINITY));
  const h = Math.max(1, Math.min(DEFAULT_BLOCK_SPAN, GRID_ROWS - row + 1, limits?.maxH ?? Number.POSITIVE_INFINITY));
  return {
    col, row, w, h,
    cols: defaultStickyColsFor(type, w, gridCols, size),
    max: 6,
    tone: 0,
    overflow: "缩小字号",
  };
}

function blockWidthMm(w: number, gridCols: GridColsValue, size: PaperSizeKey = "A1"): number {
  return (w / gridCols) * contentMmFor(size).w - GRID_GAP_MM;
}

/** 自动排版用的行数——与画布网格是同一个数（`GRID_ROWS` 是唯一声明处）。 */
const AUTO_LAYOUT_GRID_ROWS = GRID_ROWS;

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
  gridCols: GridColsValue,
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
          cols: isList ? clamp(Math.round(blockWidthMm(w, gridCols, size) / (STANDARD_NOTE_MM + GRID_GAP_MM)), 3, 8) : 3,
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
export function clampLayout(layout: SectionLayoutDraft, gridCols: GridColsValue): SectionLayoutDraft {
  const w = clamp(layout.w, 1, gridCols);
  const h = clamp(layout.h, 1, GRID_ROWS);
  return {
    ...layout,
    w, h,
    col: clamp(layout.col, 1, gridCols - w + 1),
    row: clamp(layout.row, 1, GRID_ROWS - h + 1),
  };
}

/** 网格矩形（1 起的 col/row + 跨度 w/h）——`SectionLayoutDraft` 的几何投影。 */
export interface GridRect {
  readonly col: number;
  readonly row: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 两个网格矩形是否有交集（半开区间比较，边挨边不算重叠）。
 *
 * issue #2564：「AI 商业模型画布」编辑「显示方式 · 列数」（宽/高步进器）后，chat 模拟
 * 渲染出标题条与便签互相压住、内容溢出——根因是编辑器此前允许把一个分区的宽/高
 * （`col`/`row`/`w`/`h`）改到与另一个**已放置**的分区在网格上重叠：`clampLayout`
 * 只夹画布边界，`place`/`move`/「在 A1 上占多大」的步进器上限都不检查相邻分区，
 * `buildExplicitTemplateSpec`（`explicit-template-layout.ts`）对重叠的分区也没有
 * 任何去重/避让——两块几何区间重叠时，两个 `TemplateSection` 的 `x/y/w/h` 直接落在
 * 同一块画布上，后放置/后渲染的标题条盖住前一个分区的便签，便签本身也会被相邻
 * 分区的贴纸挤出边界，读出来就是「排版内容错乱、内容溢出」。
 */
export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

/** `rect` 是否与 `sections` 里除 `sectionId` 自己外的其它**已放置**分区重叠。 */
export function collidesWithOthers(
  sections: readonly SectionDraft[], sectionId: string, rect: GridRect,
): boolean {
  return sections.some((s) => s.sectionId !== sectionId && s.layout != null && rectsOverlap(rect, s.layout));
}

/**
 * 已放置分区里，两两重叠的那些（体检 & 发布前置检查用，见 `checkTemplateHealth`）。
 * 只报告实际重叠的那些区块，不报告只是紧挨着（不重叠）的正常版式。
 */
export function findOverlappingSections(
  sections: readonly SectionDraft[],
): readonly SectionDraft[] {
  const placed = sections.filter((s) => s.layout != null);
  const bad = new Set<string>();
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      if (rectsOverlap(placed[i]!.layout!, placed[j]!.layout!)) {
        bad.add(placed[i]!.sectionId);
        bad.add(placed[j]!.sectionId);
      }
    }
  }
  return placed.filter((s) => bad.has(s.sectionId));
}

/**
 * 给定分区固定在 `col`/`row`，朝右/朝下最多能长到多宽/多高而不撞上另一个已放置分区
 * （画布边界仍然是硬上限）。逐格探测——网格恒 12×8，代价可忽略。
 *
 * 「显示方式 · 在 A1 上占多大」的宽/高步进器用它当上限，取代此前「只夹画布边界」
 * 的 `gridCols - col + 1` / `8 - row + 1`——步进器因此永远停在不会与相邻分区重叠的
 * 合法范围内，同 `Stepper` 组件既有的「每次只挪一格、永远合法」的交互约定。
 */
export function maxFreeW(
  sections: readonly SectionDraft[], sectionId: string, col: number, row: number, h: number, gridCols: GridColsValue,
): number {
  const bound = gridCols - col + 1;
  let w = 1;
  while (w < bound && !collidesWithOthers(sections, sectionId, { col, row, w: w + 1, h })) w += 1;
  return w;
}

/** 同 `maxFreeW`，朝下的方向。 */
export function maxFreeH(
  sections: readonly SectionDraft[], sectionId: string, col: number, row: number, w: number,
): number {
  const bound = GRID_ROWS - row + 1;
  let h = 1;
  while (h < bound && !collidesWithOthers(sections, sectionId, { col, row, w, h: h + 1 })) h += 1;
  return h;
}

export function sectionGeometryMmOf(
  s: SectionDraft, gridCols: GridColsValue, size: PaperSizeKey = "A1",
): SectionGeometryMm {
  const layout = s.layout;
  if (!layout) return { wMm: 0, hMm: 0, noteMm: 0, rows: 0, fits: 0 };
  return sectionGeometryMm({ w: layout.w, h: layout.h, cols: layout.cols, max: layout.max, gridCols, size });
}

/**
 * 贴纸预览的字号——**由贴纸实尺推导**，不是固定值。
 * `Design.pdf` §5 末段原话：约 `clamp(6.5, noteMm × 0.115, 10.5)`，写成固定值小贴纸会裁字。
 *
 * ⚠ 2026-09-01 人类反馈「便利贴太大，装不进区块里」：根因链见
 *   `explicit-template-layout.ts` 的 `MAX_NOTE_MM` 文档——`noteMm` 现在随区块宽度/
 *   列数缩放（推翻了 2026-08-30「固定不变」的约定），但这只解决贴纸*本身*装不装得
 *   进区块；贴纸*内部*的文字还是可能比缩放后的这张贴纸能舒服放下的字数长，那是另一层
 *   问题——编辑器右栏本来就有、却从没被任何渲染代码读过的「超出时」三选一
 *   （`layout.overflow`）就是管这层的：之前不管选哪个，字号算法都只看 `noteMm`，
 *   `overflow` 只用来拼一句警告文案，配了等于白配。
 *
 *   现在选「缩小字号」时，字号额外按**这张贴纸实际要放的文字长度**继续收缩
 *   （超过 `NOTE_COMFORTABLE_CHARS` 个字才开始缩，短文字不受影响、行为与改动前
 *   逐字一致）；选「截断」/「叠放」时字号维持原样，改由调用方（`template-canvas-grid`）
 *   用 line-clamp 硬截断或堆叠 tile 处理，不在这里悄悄缩字号——三个选项要长得不一样，
 *   不能都退化成同一种「一律缩小」。
 */
const NOTE_COMFORTABLE_CHARS = 16;
const MIN_SHRUNK_FONT_PX = 5.5;

export function noteFontSizePx(noteMm: number, isList: boolean, textLength = 0): number {
  if (!isList) return 9;
  const base = clamp(noteMm * 0.115, 6.5, 10.5);
  if (textLength <= NOTE_COMFORTABLE_CHARS) return Number(base.toFixed(1));
  // 文字比"舒适字数"长——按字数比例继续缩小，下限 5.5px（低于此不可读，交给
  // 「截断」/「叠放」两个选项兜底，不能无限缩到看不见）。
  const shrink = Math.sqrt(NOTE_COMFORTABLE_CHARS / textLength);
  return Number(clamp(base * shrink, MIN_SHRUNK_FONT_PX, base).toFixed(1));
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
  /**
   * 网格上两两重叠的分区（issue #2564）——正常的拖拽/步进器操作现在已经不会产生
   * 这种状态（见 `rectsOverlap` 文档），这里仍然要查一遍：存量数据（回填脚本跑
   * 过、或本修复上线前手工拖出来的模板）可能已经带着重叠落库，体检要能如实报出来，
   * 不能假装"新代码不再产生 = 旧数据也没有"。
   */
  readonly overlapping: readonly SectionDraft[];
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
  drafts: readonly SectionDraft[], gridCols: GridColsValue, promptText = "", size: PaperSizeKey = "A1",
): TemplateHealth {
  const named = drafts.filter((d) => d.name.trim().length > 0);
  // 「文本对象」是静态装帧文字，不绑定 `{{key}}`、不进 AI 输出结构——字段计数/
  // key 唯一性/占位符校验都只看数据绑定型分区（同 `canvas-template-guidance.ts`
  // 的 `bodySections` 排除法，两处判据一致）。放置检查（`unplaced`）与网格重叠检查
  // 仍然覆盖文本对象——它也占画布空间，摆漏了/叠在别的区块上同样是要报的问题。
  const dataFields = named.filter((d) => d.type !== "文本对象");
  // `unplaced`（发布前置检查「N 个字段没放到画布上」）只看数据字段——文本对象没有
  // "AI 生成后被丢弃"这回事，混进这句提示会说不通。
  const unplaced = dataFields.filter((d) => d.layout === null);
  const overflowing: { section: SectionDraft; max: number; fits: number }[] = [];
  for (const d of dataFields) {
    if (!d.layout || d.type !== "便利贴列表") continue;
    const geom = sectionGeometryMmOf(d, gridCols, size);
    if (d.layout.max > geom.fits) overflowing.push({ section: d, max: d.layout.max, fits: geom.fits });
  }
  const seen = new Set<string>();
  const duplicateKeys: string[] = [];
  for (const d of dataFields) {
    if (seen.has(d.key)) duplicateKeys.push(d.key);
    seen.add(d.key);
  }
  // §6 规则③：提示词里提到、字段表里没有的占位符（见 `danglingPlaceholders` 文档）。
  const knownKeys = new Set(dataFields.map((d) => d.key));
  const danglingPlaceholders = extractPromptPlaceholders(promptText).filter((k) => !knownKeys.has(k));
  const overlapping = findOverlappingSections(named);

  return {
    fieldCount: dataFields.length,
    placedCount: dataFields.length - dataFields.filter((d) => d.layout === null).length,
    unplaced,
    overflowing,
    duplicateKeys,
    danglingPlaceholders,
    overlapping,
    publishClean: unplaced.length === 0 && overflowing.length === 0
      && duplicateKeys.length === 0 && danglingPlaceholders.length === 0 && overlapping.length === 0,
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
  // issue #3337：「文本对象」是编辑器里直接打好字的静态装帧文字（标题/说明牌），
  // 内容来自 `content` 字段，不是模型要填的数据——同 `auto-template-layout.ts`／
  // `fence-template-resolver.ts` 早就把它从「便利贴列表」布局与自动排版里摘出去的
  // 同一条判据（`s.type !== "文本对象"`）。此前这里漏摘，导致这些纯装饰的标题字段
  // 也混进了「输出结构」JSON，让顾问以为模型要对着它们生成内容。
  const named = drafts.filter((d) => d.name.trim().length > 0 && d.type !== "文本对象");
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
