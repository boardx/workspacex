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
import {
  A0_FRAME, ENGINE_STICKY, ENGINE_STICKY_GAP, ENGINE_STICKY_INSET, ENGINE_STICKY_TOP_OFFSET, GRID_TOP, GUTTER,
  HEADER_ROW_PITCH,
} from "./auto-template-layout";

/**
 * `Design.pdf` §2.2：贴纸四色板，索引即 `layout.tone`。单一事实源（issue #2372
 * 之前只在 `template-editor-model.ts` 声明一份，给 HTML/CSS 预览网格用；现在
 * `buildExplicitTemplateSpec` 也要按 `tone` 给 fabric 贴纸取色，lib 层不能反过来
 * import 组件层，所以定义挪到这里，`template-editor-model.ts` 改成重新导出）。
 *
 * 2026-08-30 人类反馈「贴纸颜色模拟 3M 的颜色」：原先四色偏浅灰、不像实物便利贴
 * （尤其粉/蓝两档接近同一种灰调，现场很难一眼分清）。改成对应 3M Post-it 经典
 * 色系里最常见的四色——Canary 黄、Poptimistic 粉、Rio 绿、Aqua 蓝——饱和度更接近
 * 真实贴纸，同时仍留在能让深色字保持可读的亮度区间（沿用同一批产品线里偏亮的档位，
 * 不用霓虹饱和色，避免文字读不清）。
 */
export const TONE_COLORS = ["#FFE066", "#FF8FAB", "#8CE196", "#6EC6FF"] as const;

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
  /**
   * 契约 `canvas.SectionFieldType`（本文件不 import 组件层的
   * `template-editor-model.ts`，就地镜像同一个字面量联合，理由同该文件顶部
   * `TONE_COLORS` 挪家的注释——lib 层不能反过来依赖组件层）。
   *
   * 2026-08-30 人类反馈「用户画像 chat 模拟测不出表头字段」根因：本函数此前对
   * 每个分区一律当「便利贴列表」处理，`type === "短文本"` 的表头字段（姓名/性别/
   * 年龄……）被塞进了跟其它分区一样的贴纸 box，模型按 guidance
   * （`canvas-template-guidance.ts`）写出的 `字段名: 字段值` 行没有落点——引擎
   * （`template-engine.ts`）把这些值放进 `fields` map，但 spec 没有
   * `fields`/`headerRect`，值被静默丢弃。见 `buildExplicitTemplateSpec` 下方注释。
   */
  readonly type?: "便利贴列表" | "短文本" | "长文本";
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
  /** 页脚署名（编辑器「页脚署名」栏）。空串/缺省 = 不画（issue #2527）。 */
  readonly footer?: string;
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
 *
 * ⚠ 2026-08-30 追加：`type === "短文本"` 的分区（表头字段，如用户画像的姓名/性别/
 *   年龄）**不**当贴纸 box 处理——合并成引擎原生支持的单个 `headerRect` + `fields`
 *   （`packages/fabric-markdown` 的 `TemplateSpec.fields`/`headerRect`，见
 *   `template-engine.ts` 285-336 行的渲染分支，早已支持，只是这条链路此前从没喂给它）。
 *   没有任何 `短文本` 分区时（绝大多数组织自建模板）`fields`/`headerRect` 都不设，
 *   字节级兼容改动前的输出。
 *
 * ⚠ 2026-08-31 修正：`fieldsPerRow` **不能**直接取"表头第一行放了几个字段"——那是
 *   编辑器网格的列数，与引擎渲染表头字段实际要用的**固定像素宽度**是两回事。人类实测
 *   截图（用户画像 9 个字段被 `autoFillLayout` 一次性铺进一整行，`fieldsPerRow=9`）：
 *   `template-engine.ts` 给每个字段留死的 `LABEL_W(96) + 6 + VALUE_W(150) = 252px`，
 *   `cellW = hr.w / fieldsPerRow`——`fieldsPerRow` 一旦超过 `hr.w / 252` 能放下的个数，
 *   相邻字段的文字框就会互相压住，画出来是文字糊在一起，不是"表头空白"那类静默丢失，
 *   而是**看得见但读不出来**。改法：按 `headerRect` 的**实际宽度**反算这一行最多放几个
 *   （`HEADER_FIELD_MIN_W` 镜像自引擎那两个常量），放不下时自动换行（`rows` 增多），
 *   `headerRect.h` 跟着要放的行数一起长高（`HEADER_ROW_PITCH` 镜像 persona.ts 内置
 *   spec 的比例：`110mm ÷ (2 行+1) ≈ 36.7`，取整数 40 留一点余量）。
 *
 * ⚠ 2026-09-02 修正（人类实测截图：用户画像在 chat 里"画框和上方框重叠"）：上一条
 *   修正让 `headerRect` 按行数长高，但**正文分区没有跟着下移**——2026-08-31 的注释把
 *   "长高的表头压到下一个网格行"当成可接受的代价，人类看到真实渲染后否掉了这个判断。
 *   用户画像的真实几何：表头格子只占 1 个网格行（`cellH ≈ 83.5px`），9 个字段按
 *   `hr.w / 252` 换算成每行 6 个 → 2 行 → `minH = 120px`，表头带底边比正文第一行
 *   的顶边低 12.5px，三个分区框的标题条被表头框压住。改法：表头带比它的网格格子高出
 *   多少（`delta`），**所有位于表头带下方**的正文格子整体下移 `delta`，`layout.bounds.bottom`
 *   同步下移——正文之间的相对版式一字不改，只是整体让位。与表头同一行、并排的格子
 *   （理论上可能，`短文本` 字段习惯上独占第 1 行）不动，因为表头带在水平方向上只覆盖
 *   表头格子自己的外接矩形，压不到它们。
 */
/** 镜像 `template-engine.ts` 的 `LABEL_W(96) + 6px 间距 + VALUE_W(150)`——见上方 2026-08-31 注释。 */
const HEADER_FIELD_MIN_W = 96 + 6 + 150;

/**
 * issue #2585：「汉堡沟通模型」chat 模拟里「开场引入」「行动闭环」两个分区完全无
 * 内容、无颜色。
 *
 * ## 根因：这两个分区的网格格子太矮，连一张默认尺寸的贴纸都放不下
 *
 * 汉堡的 5 个分区被 `deriveTemplateLayouts` 摊到 8 行网格后，首尾两带（开场引入/
 * 行动闭环）各只分到 1 行（`layout.h = 1`），中间三带各 2 行——5 个等高带映射到
 * 8 行网格，`fillGrid` 的压缩-摊开算法必然产出这种首尾窄、中间宽的结果。
 *
 * 本函数此前对每个分区一律用引擎默认贴纸尺寸（`ENGINE_STICKY`，未设 `sticky.h`
 * 时合并自 `template-engine.ts` 的 `DEFAULT_STICKY`，92px 高），`sectionRenderCapacities`
 * 反过来读这同一份 `sticky.h` 算容量（`renderStickyCapacity` 的逆运算，见该文件）。
 * `h=1` 格子的实际像素高只有约 83.5px，扣掉标题条（`ENGINE_STICKY_TOP_OFFSET`,44px）
 * 和内边距（`ENGINE_STICKY_INSET`,14px）后只剩约 25.5px 可用——比默认贴纸的 92px
 * 矮得多，`renderStickyCapacity` 算出容量 0，`cap-fence-bullets.ts` 的
 * `capFenceBulletsToCapacity` 就把这个分区下的全部要点整段丢弃：没有便签 = 没有
 * 内容，也没有颜色（`stickyColor` 只画在便签上，没有便签就看不见色）。
 *
 * ## 修法：贴纸尺寸随格子高度收缩，而不是保持默认尺寸硬套
 *
 * 与 `sectionGeometryMm`（mm 几何那条姊妹路径，`heightConstrainedNoteMm`）同一个
 * 思路：格子放不下默认尺寸的贴纸、但格子本身还有正的可用高度时，把贴纸压到「这个
 * 格子物理放得下一行」的尺寸，而不是保持默认尺寸算出容量 0 后把内容整段丢光——
 * 一张收缩了的贴纸，比完全没有贴纸更接近使用者的预期（`Design.pdf` 的三种溢出
 * 策略里，「缩小字号」本就优先于「截断」）。`sectionRenderCapacities` 读的是这里
 * 写回 `sticky.h` 的实际值，两处不会算出两个不同的答案。
 *
 * 格子本身矮到连收缩后的贴纸都放不下（可用高度 ≤ 0）时不做任何覆盖——那是真的
 * 一寸空间都没有，容量为 0 是如实的，不是这个函数能解决的（会在别处被当成布局
 * 需要修的信号，而不是在这里硬造一张看不见的贴纸）。
 */
function stickyHeightOverride(cellH: number): { h?: number } {
  const available = cellH - ENGINE_STICKY_TOP_OFFSET - ENGINE_STICKY_INSET;
  if (available <= 0 || available >= ENGINE_STICKY.h) return {};
  return { h: Math.floor(available) };
}

/**
 * issue #2611：「AI 商业模型画布」编辑器②画布里配的是 2 列，chat 模拟渲染出来却只有
 * 1 列。
 *
 * ## 根因：`sticky.perRow` 是「使用者要的列数」，引擎真正画出来的列数是另一回事
 *
 * `template-engine.ts`（531-534 行）不会照单全收 `sticky.perRow`——它按贴纸默认宽度
 * （`ENGINE_STICKY.w`，136px）反算这个分区框物理上一行最多摆得下几张，再取
 * `min(配置的 perRow, 摆得下的张数)`：`floor((sec.w - 28) / (stickyW + gapX))`。
 * `buildExplicitTemplateSpec` 此前只把 `layout.cols` 原样塞进 `sticky.perRow`，从没
 * 检查过这个分区框（`c.w`，由 `gridCols` 与跨列数换算出的 px 宽度）是否真的容得下
 * `cols` 张 136px 宽的贴纸——AI 商业模型画布这类多分区窄格模板（12 列网格里一个
 * 分区常常只跨 2 列，≈230px 宽）配 2 列一行时，`floor((230-28)/(136+12))=1`，
 * 引擎实际只画出 1 列，编辑器右栏配的「2 列」在 chat 里从未生效——与 `stickyHeightOverride`
 * 那条 2026-08-30（issue #2585）修的是**同一类**问题在另一根轴上的版本：`sticky.h`
 * 早就会因为格子矮而收缩，`sticky.w` 却一直没有对应的「格子窄就收缩」的逻辑。
 *
 * ## 修法：贴纸宽度随分区框宽度/配置列数收缩，而不是保持默认宽度硬套
 *
 * 与 `stickyHeightOverride` 同一个思路（也镜像 `sectionGeometryMm` 那条 mm 几何姊妹
 * 路径 `noteMm` 随宽度/列数缩放的公式）：反解引擎的 `perRow` 公式，算出「这个分区框
 * 配置的列数真的一行摆得下」所需的贴纸宽度上限，只在这个上限比默认宽度更窄时才
 * 覆盖——比默认宽度更宽的分区（内置六个模板/大多数组织自建模板）不受影响，
 * 逐字节兼容改动前的输出。
 *
 * 收到 ≤ 0（连一道内边距 + 一道列间距都腾不出来）时不做任何覆盖——那是真的一寸
 * 宽度都没有，用默认宽度算出的 `renderStickyCapacity` 会如实报出更小的实际列数，
 * 不是这个函数能解决的（同 `stickyHeightOverride` 文档「可用高度 ≤ 0 时不覆盖」
 * 那句话在宽度轴上的版本）。
 *
 * ⚠ 刻意不设「收缩到多窄就拒绝、走 overflow 策略」的下限（不同于 mm 几何那条姊妹
 *   路径 `sectionGeometryMm` 的 `MIN_SHRINK_NOTE_MM`）——这里与 `stickyHeightOverride`
 *   同一个判断：`available > 0` 就收，不再另设一道"读不清就不如不收"的阈值。理由是
 *   px 是 `fabric-markdown` 的抽象渲染单位，不像 mm 那样有「46mm 以下人眼读不清」这类
 *   有物理依据的判定档位（`classifyNoteSize` 文档），在这里另拍一个 px 下限没有同等
 *   依据、只会是凭空的数字。真正兜底可读性的是引擎自己的字号收缩（贴纸文字走
 *   `shrinkTextboxToFit`，下限 7px，见 vendor 侧 2026-09-02 回流记录）——贴纸边长
 *   收得越窄，字号会先收到那个下限，而不是本函数需要再挡一层。使用者若把列数配到
 *   窄格子塞不下的地步，这是编辑器右栏「显示方式」本该提示的配置问题（`checkTemplateHealth`
 *   的既有职责），不是这个几何换算函数该做价值判断的地方。
 */
function stickyWidthOverride(cellW: number, cols: number): { w?: number } {
  if (cols <= 1) return {};
  const available = Math.floor((cellW - 2 * ENGINE_STICKY_INSET) / cols - ENGINE_STICKY_GAP.x);
  if (available <= 0 || available >= ENGINE_STICKY.w) return {};
  return { w: available };
}

export function buildExplicitTemplateSpec(input: ExplicitTemplateInput): ExplicitTemplateResult {
  const rawLayout = computeExplicitLayout(input.sections, input.gridCols);
  const typeById = new Map(input.sections.map((s) => [s.sectionId, s.type] as const));
  const headerCells = rawLayout.cells.filter((c) => typeById.get(c.sectionId) === "短文本");

  // 表头带长高超出它自己的网格格子多少（见文件头 2026-09-02 注释）；没有表头时为 0。
  let headerShift = 0;
  let headerBottomRaw = -Infinity;
  if (headerCells.length > 0) {
    const top = Math.min(...headerCells.map((c) => c.y - c.h / 2));
    headerBottomRaw = Math.max(...headerCells.map((c) => c.y + c.h / 2));
    const rawW = Math.max(...headerCells.map((c) => c.x + c.w / 2)) - Math.min(...headerCells.map((c) => c.x - c.w / 2));
    const fieldsPerRow = Math.max(1, Math.min(headerCells.length, Math.floor(rawW / HEADER_FIELD_MIN_W)));
    const rows = Math.ceil(headerCells.length / fieldsPerRow);
    headerShift = Math.max(0, (rows + 1) * HEADER_ROW_PITCH - (headerBottomRaw - top));
  }
  const layout: ExplicitLayout = headerShift > 0
    ? {
      ...rawLayout,
      cells: rawLayout.cells.map((c) => (
        typeById.get(c.sectionId) !== "短文本" && c.y - c.h / 2 >= headerBottomRaw - 1e-6
          ? { ...c, y: c.y + headerShift }
          : c
      )),
      bounds: { ...rawLayout.bounds, bottom: rawLayout.bounds.bottom + headerShift },
    }
    : rawLayout;
  const bodyCells = layout.cells.filter((c) => typeById.get(c.sectionId) !== "短文本");

  const sections: TemplateSection[] = bodyCells.map((c) => ({
    name: c.name,
    x: c.x,
    y: c.y,
    w: c.w,
    h: c.h,
    fill: PAPER,
    sticky: { perRow: c.layout.cols, ...stickyWidthOverride(c.w, c.layout.cols), ...stickyHeightOverride(c.h) },
    stickyColor: TONE_COLORS[c.layout.tone] ?? TONE_COLORS[0],
  }));

  let headerFields:
    | { fields: string[]; headerRect: { x: number; y: number; w: number; h: number }; fieldsPerRow: number }
    | undefined;
  if (headerCells.length > 0) {
    const ordered = [...headerCells].sort(
      (a, b) => a.layout.row - b.layout.row || a.layout.col - b.layout.col,
    );
    const left = Math.min(...headerCells.map((c) => c.x - c.w / 2));
    const top = Math.min(...headerCells.map((c) => c.y - c.h / 2));
    const right = Math.max(...headerCells.map((c) => c.x + c.w / 2));
    const bottom = Math.max(...headerCells.map((c) => c.y + c.h / 2));
    const rawW = right - left;
    const fieldsPerRow = Math.max(1, Math.min(ordered.length, Math.floor(rawW / HEADER_FIELD_MIN_W)));
    const rows = Math.ceil(ordered.length / fieldsPerRow);
    const minH = (rows + 1) * HEADER_ROW_PITCH;
    const h = Math.max(bottom - top, minH);
    headerFields = {
      fields: ordered.map((c) => c.name),
      headerRect: { x: (left + right) / 2, y: top + h / 2, w: rawW, h },
      fieldsPerRow,
    };
  }

  return {
    spec: {
      key: input.key,
      title: input.displayName,
      ...(input.footer ? { footer: input.footer } : {}),
      ...(headerFields ?? {}),
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
/**
 * 区块内标题区（区块名 + `{{token}} X列·Y条` 提示行）的比例尺寸——`cqw` 相对
 * 最外层纸张容器的**宽度**，跟纸面大标题（`"2.2cqw"`）/页脚（`"1.2cqw"`）用
 * 同一套单位。`template-canvas-grid.tsx` 直接读这几个值渲染，不在组件里另开
 * 一份重复声明——同一件事只能有一处数字，见 AGENTS.md「同一事实不得声明在
 * 两处」。
 *
 * ⚠ 2026-09-01 人类反馈"便利贴还是被裁掉"、且明确排除了"画布缩得太小"——全屏下
 *   依然会切。根因：这个标题区此前用固定像素字号/内边距（`text-11`/`text-9`/
 *   `p-2`/`gap-1.5` 这些 Tailwind 档位），不像贴纸本身和纸面大标题那样随 `cqw`
 *   缩放，而"这块地方能放几行贴纸"的公式却假设标题区恒占纸面的固定比例——纸面
 *   渲染得越宽，标题区真实占用的"纸面比例"理应越小，固定像素不会跟着变小，于是
 *   在任何宽度下都会持续少算一点，多算出来的空间最终体现为最后一行贴纸被
 *   `overflow-hidden` 切掉一截。改成这里的 `cqw` 常量后，标题区占用的"纸面比例"
 *   变成一个不随渲染宽度变化的真常量。
 *
 * ⚠ 第一次试着把 `TITLE_RESERVE_MM`（当时是固定 mm 常量）从 22 直接调到 36 做
 *   经验性缓解，但改完发现本仓自己一条用 `h=3`（3/8 页高）区块的单测容量被压到
 *   0——这类偏矮的常见区块本来刚好够用，凭感觉调大一个孤立的经验常量会连它们
 *   一起压垮。真正的修法是让两边算的是同一件事，而不是猜一个数字。
 */
export const BLOCK_HEADER_CQW = {
  /** 替代 `p-2`（区块四边内边距）——⚠ 这个数只是"一条边"的宽度，上下两条边都要算，见下方推导。 */
  padding: 0.6,
  /** 替代原先的 `border: 2px solid`（区块边框）——同样上下两条边都要算。 */
  border: 0.15,
  /** 替代 `gap-1.5`（标题块 ↔ 贴纸网格之间，以及 `{{token}}` ↔ 列·条提示之间）。 */
  gap: 0.5,
  /** 替代 `gap-0.5`（区块名 ↔ `{{token}}` 行之间）。 */
  titleGap: 0.15,
  /** 替代 `text-11`（区块名）。 */
  titleFont: 1.4,
  /** 替代 `text-9`/`text-10`（`{{token}}`/列·条提示）。 */
  metaFont: 1.0,
} as const;
/**
 * 行高倍数——精确等于 Tailwind `leading-tight`（1.25，不是估个 1.2）。
 * `template-canvas-grid.tsx` 的标题行、提示行**都**显式套这个值（`style.lineHeight`），
 * 不靠某一行有 `leading-tight` class、另一行没有还指望它"差不多"——2026-09-01
 * 独立审查抓到的问题：提示行此前没有任何显式行高声明，实际渲染值不受这个常量
 * 约束，字号改动前后两行可能用着不同的行高，这个常量就成了"写在这里、没人真的
 * 照它渲染"的自说自话。
 */
export const BLOCK_HEADER_LINE_HEIGHT = 1.25;
/**
 * 标题区总预留，单位仍是 `cqw`（纸宽的百分比）。`titleReserveMm` 按*当前选中的
 * 纸张宽度*把它换算成 mm，不是只在 A1 上算一次就到处用——推导：
 *
 *   内边距×2（上下两条边）+ 边框×2（上下两条边）+ 标题行(字号×行距)
 *     + 标题↔提示间距 + 提示行(字号×行距) + 标题块↔贴纸网格间距
 *   = 0.6×2 + 0.15×2 + 1.4×1.25 + 0.15 + 1.0×1.25 + 0.5
 *   = 1.2 + 0.3 + 1.75 + 0.15 + 1.25 + 0.5 = 5.15（cqw，纸宽的 5.15%）
 *
 * ⚠ 2026-09-01 独立审查抓到的问题：`padding` 是 CSS 里"四边内边距"，区块是
 *   flex 列容器，贴纸网格排最后一个——真正吃掉纵向空间的是**上下两条边**各一份
 *   内边距，只算一份会把预留量算少、放行一行实际放不下的贴纸，恰恰是这次要修
 *   的那类回归。边框同理（且原来是固定 `2px`，不随纸宽缩放，现已改成 `cqw`）。
 */
const BLOCK_HEADER_RESERVE_CQW =
  BLOCK_HEADER_CQW.padding * 2
  + BLOCK_HEADER_CQW.border * 2
  + BLOCK_HEADER_CQW.titleFont * BLOCK_HEADER_LINE_HEIGHT
  + BLOCK_HEADER_CQW.titleGap
  + BLOCK_HEADER_CQW.metaFont * BLOCK_HEADER_LINE_HEIGHT
  + BLOCK_HEADER_CQW.gap;

/**
 * 标题占位高度（mm）——按*给定纸张的实际宽度*把 `BLOCK_HEADER_RESERVE_CQW`
 * 换算成 mm，取代原先"不管选哪张纸都用同一个固定 mm 常量"的做法（那样在 A3/A4
 * 上会用 A1 的 34mm 顶一个理应小得多的预留量，导致这两档纸张的容量被系统性
 * 低估、甚至在够小的区块上把 `rows` 压到 0）。
 *
 * cqw 的换算基准是**整张纸**（`PAPER_SIZE_MM[size].w`），不是扣掉页边距的内容区
 * ——与 `notePct`/纸面大标题同一个基准。A1（841mm 宽）≈ 43.3mm；A3（420mm）
 * ≈ 21.6mm；A4（297mm）≈ 15.3mm——纸越小，标题区占用的绝对 mm 数跟着变小，
 * 不再是三档共用一个数。
 */
export function titleReserveMm(size: PaperSizeKey = "A1"): number {
  return (BLOCK_HEADER_RESERVE_CQW / 100) * PAPER_SIZE_MM[size].w;
}

/**
 * 区块左右两条边各一份内边距 + 边框，换算成 mm——横向版的 `titleReserveMm`。
 *
 * ⚠ 2026-09-01 人类实测反馈"便利贴还是被遮住一半"、且不分 2 列/3 列都会——
 *   根因和 `titleReserveMm` 那次是**同一个疏漏在另一根轴上**：`sectionGeometryMm`
 *   算 `noteMm`（贴纸边长）时直接拿整个 `wMm`（区块外沿宽度）去除以列数，却没有
 *   先扣掉区块自己的左右内边距/边框——但贴纸网格是区块的**子元素**，它能用的宽度
 *   是 `wMm` 减掉这两条边，不是 `wMm` 本身。公式算出来的 `noteMm` 因此比贴纸网格
 *   真实可用宽度宽了一圈，`cols` 张贴纸 + 列间距的总宽度会超出贴纸网格容器，
 *   超出的部分被同一个 `overflow-hidden` 裁掉——只是这次裁在**贴纸右侧**，不是
 *   上一次那个"最后一行"。两处（`titleReserveMm` 管纵向、这个函数管横向）现在
 *   都从 `BLOCK_HEADER_CQW.padding`/`.border` 这同一份数字反推，不是各自猜一个。
 */
export function blockHorizontalChromeMm(size: PaperSizeKey = "A1"): number {
  const cqw = (BLOCK_HEADER_CQW.padding + BLOCK_HEADER_CQW.border) * 2;
  return (cqw / 100) * PAPER_SIZE_MM[size].w;
}
/**
 * 贴纸实尺参考值——`Design.pdf` §5「尺寸判定」原文把 70–82mm 都算标准 76mm
 * 方形贴纸，76 是这一档的代表值，`defaultLayoutAt`/`autoFillLayout` 猜默认
 * 列数时用它当目标格距。
 *
 * ⚠ 2026-09-01 人类决定推翻 2026-08-30 那条「贴纸固定 76mm、不随区块宽度或
 *   列数变化」的约定（模拟 3M 便利贴「先有固定尺寸的一叠纸」的体验）——那次
 *   改动堵住了 issue #2368「1 列时贴纸被撑爆」这条路，但代价是窄区块（比如
 *   BMC 画布里"关键合作伙伴"这类 1-2 格宽的框）遇上多条目/长文字时，贴纸物理
 *   尺寸依旧钉死 76mm，宽度超过区块可用空间的部分只能被裁掉或迫使区块被撑得
 *   很高——这正是「便利贴太大，装不进区块」的根因（`noteFontSizePx` 的
 *   「超出时」策略只解决贴纸*内部*文字溢出，治不了贴纸本身比区块还宽这件事）。
 *
 *   现在改回「贴纸随区块宽度/列数缩放」——即下方 `sectionGeometryMm` 的
 *   `noteMm = min(MAX_NOTE_MM, (wMm - 6×(cols-1)) / cols)`，与 issue #2368
 *   修复后、2026-08-30 冻结前的公式一致：`cols` 越多、区块越窄，贴纸边长越小；
 *   仍然保留 `MAX_NOTE_MM` 封顶——不然 issue #2368 那条"1 列被撑爆"的回归会
 *   立刻重现。这个常量本身现在只是"猜默认列数"的参考格距，不再是渲染尺寸的
 *   单一事实源（那是 `MAX_NOTE_MM`）。
 */
export const STANDARD_NOTE_MM = 76;
/**
 * 贴纸边长上限——issue #2368 的教训：`noteMm` 若无上限，列数选到 1 时会被撑到
 * 吃满整个区块宽度（比如 268mm），一旦超过区块可用高度就让 `rows` 直接归零、
 * 整块区域画不出任何内容（`rows` 有 `Math.max(0, …)` 下限保护，`noteMm` 却没有
 * 对应的上限保护，这个不对称就是空白区块的根因）。封顶取 `classifyNoteSize`
 * 自己定义的 "oversized" 分界线（82mm，`Design.pdf` §5「尺寸判定」行原文档位）——
 * 这条线本来就是该函数用来判"会显空"的界，贴纸边长永远不越过它，多出来的区块
 * 空间留白，不再继续把贴纸撑大到显示失败。
 */
export const MAX_NOTE_MM = 82;
/**
 * 为了塞进「最多条数」而把贴纸往下收时的边长下限——issue #2527：3 列 × 最多 9 条，
 * 按宽度倒推的贴纸吃到 `MAX_NOTE_MM` 上限后高度只塞得下 1 行，画出来 3×1 而不是
 * 使用者期望的 3×3。修法是按 `ceil(max/cols)` 行反推贴纸边长（见 `sectionGeometryMm`），
 * 但不能无底线地缩：区块很矮却把「最多条数」拧到 99 时，按行反推会得到几 mm 的
 * 贴纸，字号下限（6.5px）一行都放不下，等于画一堆看不见内容的色块。这里取
 * `classifyNoteSize` 「too-small」分界线（46mm）的一半：再小就如实报"放不下"，
 * 走 overflow 策略，而不是假装放得下。
 */
export const MIN_SHRINK_NOTE_MM = 23;

export interface SectionGeometryMmInput {
  readonly w: number;
  readonly h: number;
  readonly cols: number;
  readonly gridCols: 6 | 12;
  /** 纸张尺寸——决定内容区物理 mm 数。缺省 `"A1"`，兼容既有调用方（历史数据的默认尺寸）。 */
  readonly size?: PaperSizeKey;
  /**
   * 「最多条数」（`layout.max`）。给了它，贴纸边长会在宽度版尺寸的基础上再按
   * `ceil(max/cols)` 行往下收，让这块地方真的能摆出使用者要的条数（issue #2527）。
   * 不给则保持纯宽度倒推（既有调用方/测试不受影响）。
   */
  readonly max?: number;
}

export interface SectionGeometryMm {
  /** 区块实尺（mm）。`wMm = w/列数 × 821 - 6`，`hMm = h/8 × 574 - 6`。 */
  readonly wMm: number;
  readonly hMm: number;
  /**
   * 贴纸实尺（mm），固定 1:1 方形。
   * `noteMm = clamp((贴纸网格可用宽度 - 6×(cols-1)) / cols, 0, MAX_NOTE_MM)`——
   * 贴纸网格可用宽度 = `wMm` 扣掉区块自己的左右内边距/边框
   * （`blockHorizontalChromeMm`，2026-09-01：贴纸网格是区块的子元素，用区块
   * 外沿宽度 `wMm` 本身去除会算出比真实可用宽度更宽的贴纸，多出来的部分被
   * 外层 `overflow-hidden` 裁在贴纸右侧）。随区块宽度与列数缩放，但不超过
   * `MAX_NOTE_MM`（issue #2368：封顶防止 1 列时被撑爆），也不低于 0。
   */
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
 *
 * `noteMm` 由 `wMm`/`cols` 倒推、封顶在 `MAX_NOTE_MM`——2026-09-01 推翻
 * 2026-08-30「贴纸大小固定，不随排版变化」的约定，理由见 `MAX_NOTE_MM` 文档。
 *
 * ⚠ 2026-09-01（同日后续）：`noteMm` 倒推时要用**贴纸网格真正可用的宽度**
 *   （`wMm` 扣掉区块自己的左右内边距/边框，`blockHorizontalChromeMm`），不是
 *   区块外沿宽度 `wMm` 本身——理由见该函数文档（人类实测反馈"便利贴还是被遮住
 *   一半，不分列数"，根因是这处遗漏，跟 `titleReserveMm` 那次是同一类疏漏在
 *   横向轴上的版本）。
 */
export function sectionGeometryMm(input: SectionGeometryMmInput): SectionGeometryMm {
  const rowSpanDenominator = 8; // 网格恒 8 行，列数才切 6/12。
  const size = input.size ?? "A1";
  const contentMm = contentMmFor(size);
  const wMm = (input.w / input.gridCols) * contentMm.w - GRID_GAP_MM;
  const hMm = (input.h / rowSpanDenominator) * contentMm.h - GRID_GAP_MM;
  const noteGridWidthMm = wMm - blockHorizontalChromeMm(size);
  // 区块窄到扣完内边距/边框已经不剩空间时，`noteGridWidthMm` 会是负数——
  // `noteMm` 夹到 0（同 `rows` 的 `Math.max(0, …)`），不产出负数贴纸边长，
  // 那样会让 `notePct`/字号算出荒谬的负值/NaN，而不是如实地说"这里放不下"。
  const rawNoteMm = Math.max(0, Math.min(MAX_NOTE_MM, (noteGridWidthMm - GRID_GAP_MM * (input.cols - 1)) / input.cols));
  // ⚠ 2026-09-01（第四轮，真实浏览器 e2e 抓到的回归）：`rows` 此前用的是这个
  //   *未取整*的 `rawNoteMm` 去算，但实际渲染用的是下面 `Math.round` 过的
  //   `noteMm`（`notePct`/字号都读这个四舍五入后的值）——取整可能把贴纸边长
  //   往上调最多 0.5mm，多行累加起来，容量算的行数就可能比实际渲染能放下的
  //   多出一行，最后一行贴纸被 `overflow-hidden` 切掉一截。A4 纸、2 列、900px
  //   视口下实测复现：`noteEdge=688.47 > gridEdge=686`，差 2.47px。改成
  //   `rows`/`fits` 与展示用的 `noteMm` 用**同一个**取整后的数，容量与渲染
  //   不再各自算各自的。
  let noteMm = Math.round(rawNoteMm);
  const availableHeightMm = hMm - titleReserveMm(size);
  // ⚠ 2026-09-01（第三轮）独立审查抓到的问题：`noteMm` 夹到 0 只挡住了"负数
  //   贴纸边长"，没挡住"贴纸边长是 0 但容量还算出正数"——`rows =
  //   floor((hMm-reserve)/(0+6))` 分母只剩间距，照样能除出正数行数，
  //   `fits = cols × rows` 跟着报出一个正的容量，等于宣称"这里放得下 N 张
  //   宽度为 0（也就是看不见）的贴纸"。贴纸边长一旦到 0，这块地方就是真放不下
  //   任何一张，容量必须如实归零，不能因为公式分母还没归零就继续往下算。
  let rows = noteMm <= 0 ? 0 : Math.max(0, Math.floor(availableHeightMm / (noteMm + GRID_GAP_MM)));
  // ⚠ 2026-09-01（第五轮，独立审查驳回"跳过测试"那版之后）：`noteMm` 完全是
  //   按*宽度*（区块宽度 ÷ cols）倒推的，从没被高度约束过——区块偏矮、列数偏多
  //   时（人类实测：A4 纸配上默认区块高选 2 列），按宽度算出的贴纸边长可能比
  //   `availableHeightMm` 还高，`rows` floor 成 0。`visibleNoteCount` 在有真实
  //   数据时会强制至少展示 1 条（`Math.max(1, …)`，见该函数文档），于是那 1 条
  //   按"宽度版" `noteMm` 画出来的贴纸，天生比这块地方的可用高度还高，必然被
  //   `overflow-hidden` 腰斩——不是"渲染没跟上容量算法"，是容量算法自己从没管过
  //   高度这件事。跳过测试断言只是把这个真回归的可见度调低，独立审查驳回是对的。
  //
  //   真正的修法：`rows` 按宽度版 `noteMm` 算出 0、但这块地方的可用高度仍然是
  //   正数时，把贴纸边长**夹到可用高度能放下一行的尺寸**（比宽度版更小——不会
  //   反过来撑大，宽度那边本来就够）。这样强制展示的那 1 条（以及同一行内最多
  //   `cols` 条）用的是真正塞得进这块地方的尺寸，不再必然溢出。仍然放不下时
  //   （`availableHeightMm` 本身就 ≤ 0，或扣掉间距后 ≤ 0）保持 `rows=0`——
  //   如实拒绝，不是硬把负数/零尺寸的贴纸也算成"放得下"。
  if (rows === 0 && noteMm > 0) {
    // ⚠ 这里必须 `Math.floor`，不能 `Math.round`——取整前的第四轮教训刚发生过：
    //   四舍五入可能把这个"保证塞得下"的尺寸向上调，调过头就正好撞回同一类
    //   "算出来的尺寸比真实可用空间还大一点点"的回归（实测：round 出来的值会让
    //   `noteMm+GRID_GAP_MM` 比 `availableHeightMm` 多出零点几 mm）。往下取整
    //   保证这个尺寸 + 间距永远不超过可用高度，宁可贴纸小一圈，不能再让它溢出。
    const heightConstrainedNoteMm = Math.floor(availableHeightMm - GRID_GAP_MM);
    if (heightConstrainedNoteMm > 0 && heightConstrainedNoteMm < noteMm) {
      noteMm = heightConstrainedNoteMm;
      rows = 1;
    }
  }
  // ⚠ issue #2527（2026-09-02 用户反馈）：「目标和需求」设最多 9 条、选 3 列，
  //   按道理是 3 列 × 每列 3 条，实际画出来 3 列 × 每列 1 条。根因：`noteMm` 此前
  //   只由*宽度*倒推（封顶 `MAX_NOTE_MM`），3 列在常规区块宽度下直接吃到 82mm 上限，
  //   区块高度只够摆 1 行，`rows=1`、`fits=3`，剩下 6 条被容量夹掉——「最多条数」
  //   从来没参与过贴纸尺寸的决定，列数选择等于只决定了第一行摆几张。
  //   修法：宽度版容量不够 `max` 时，按 `ceil(max/cols)` 行反推贴纸边长（同一行
  //   `cols` 张的宽度本来就够，只需按高度收小）；收到 `MIN_SHRINK_NOTE_MM` 以下
  //   就停（能多摆几行摆几行，摆不下的仍如实按 overflow 策略处理）。
  //   `Math.floor` 的理由同上一段：宁可小一圈，不能让 `n×noteMm+(n-1)×gap` 超出可用高度。
  const max = input.max;
  if (max !== undefined && max > 0 && noteMm > 0 && input.cols > 0 && input.cols * rows < max) {
    const neededRows = Math.ceil(max / input.cols);
    for (let n = neededRows; n > rows; n -= 1) {
      const fitted = Math.floor((availableHeightMm - GRID_GAP_MM * (n - 1)) / n);
      if (fitted >= MIN_SHRINK_NOTE_MM && fitted < noteMm) {
        noteMm = fitted;
        rows = n;
        break;
      }
    }
  }
  return {
    wMm: Math.round(wMm),
    hMm: Math.round(hMm),
    noteMm,
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
