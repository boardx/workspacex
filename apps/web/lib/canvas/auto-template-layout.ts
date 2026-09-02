/**
 * 组织自建**工作坊画布模板（便签协作模板）** 的自动布局生成器。
 *
 * ⚠ 服务对象只有这一类：分区框 + 可贴便签 + 多人协作的画布（用户画像 / 用户旅程图 /
 *   同理心地图 / 商业模式画布 …）。它与 **mermaid 图表**（flowchart / 类图 / mindmap /
 *   gantt 等 13 种标准图表类型）是**完全独立的两套系统** —— 本文件不 import、不引用、
 *   也不判断任何 mermaid 类型（`MermaidDiagramType` 白名单在 `lib/mermaid-diagram-type.ts`，
 *   与这里没有任何调用关系）。把两者的判断塞进同一条分支链，是下一次「图渲染坏了、
 *   结果改的是画布模板」那类事故的起点。
 *
 * —— 把契约的 `SectionDef[]`（只有
 * `sectionId / name / order / required / capacity`，**没有一个坐标**）变成
 * `fabric-markdown` 的 `TemplateSpec`（有完整几何），供 `registerTemplate` +
 * `templateToModel` 渲染。
 *
 * ## 为什么写在 apps/web 而不是包里
 *
 * `packages/fabric-markdown/` 是 vendor 并入的上游源码（见其 `VENDOR.md` 与
 * ADR-100），本仓纪律是**一个字都不改**。所幸 `registerTemplate` / `TemplateSpec` /
 * `TemplateSection` 都是公开导出，模板完全可以在包外造出来 —— 内置的 19 个模板
 * 走的也正是这条 `registerTemplate(spec)` 路径，我们只是把 spec 从「手写坐标」
 * 换成「按分区定义算坐标」。
 *
 * ## 黑白灰（人类 2026-08-18 明确要求）
 *
 * 只用 `theme.ts` 的中性令牌：`INK` / `INK_SOFT` / `LINE` / `PAPER` / `CANVAS_BG`。
 * **禁用** `PALETTE` 8 色与 `PRIMARY` 紫 —— 这条由 `tests/ui/auto-template-layout.test.ts`
 * 的「生成物里不许出现 PALETTE/PRIMARY 色值」机械断言钉死，不是靠自觉。
 *
 * ⚠ 便签本身保留颜色能力（`STICKY_COLORS` 里有 yellow/blue/green/pink/purple/gray）。
 *   这是我（实现方）做的判断，理由：**便签颜色是协作信号**（谁贴的、哪一类、投票分组），
 *   不是版面装饰；把它一并压成灰会削掉工作坊本身的一种表达手段。人类若认为
 *   「黑白灰」也覆盖便签，推翻这一条只需把默认色改成 `STICKY_COLORS.gray`，
 *   本文件不生成任何便签节点（便签由引擎按围栏正文生成），所以推翻的代价很低。
 *
 * ## A0 坐标系是从内置模板反推出来的，不是我拍的
 *
 * 读 `persona` / `pestel` / `swot` / `bmc` / `mvp` / `three-horizons` 六个内置 spec：
 *   · 左边距恒为 60（persona `headerRect.x=780,w=1440` → 左沿 60；pestel 分区
 *     `x=290,w=460` → 左沿 60；bmc `x=208,w=296` → 左沿 60）
 *   · 右沿落在 1500（persona/pestel）～1580（mvp `x=1335,w=490`）之间
 *   · 顶部从 y=10 起（引擎自己的标题节点在 y=24），底部最深到 ~920（mvp `y=780,h=260`）
 * ⇒ 取 **x∈[60,1580]、y∈[10,920]** 作为基准画幅。新模板必须落在同一尺度里
 *   （同样的边距、同样的便签尺寸、同样的字号），否则一个模板 800 宽、一个 3000 宽，
 *   在同一个 chat 气泡里缩放后观感完全不统一。
 */
import { INK, INK_SOFT, LINE, PAPER, CANVAS_BG } from "@repo/fabric-markdown/theme";
import type { DiagramNode, TemplateSpec, TemplateSection } from "@repo/fabric-markdown";

/**
 * 引擎内部的便签几何。**这是本文件唯一一处「同一事实两处声明」的风险点**：
 * `DEFAULT_STICKY` / `STICKY_GAP` 住在 `template-engine.ts` 里且**没有导出**，
 * 而算分区尺寸必须知道它们。vendor 纪律不许我去加一个 export，所以只能镜像一份 ——
 * 并用 `tests/lib/auto-template-sticky-constants.test.ts` 直接读那份源码文本比对，
 * 上游一改这两个常量，门控立刻变红。镜像 + 机械门控是本仓允许的收敛方式，
 * 「镜像但没人盯」才是被点名过五次的那种漂移。
 */
export const ENGINE_STICKY = { w: 136, h: 92, perRow: 3 } as const;
export const ENGINE_STICKY_GAP = { x: 12, y: 14 } as const;
/** 引擎在有标题条时把便签起始 y 压到 `sec.y - h/2 + 44`（无标题条为 14）。 */
export const ENGINE_STICKY_TOP_OFFSET = 44;
/** 引擎的便签左内边距：`sec.x - w/2 + 14 + ...`。 */
export const ENGINE_STICKY_INSET = 14;

/** 基准画幅（见文件头推导）。 */
export const A0_FRAME = { left: 60, top: 10, right: 1580, bottom: 920 } as const;

/** 版面节律：分区间距、右侧暂存区宽度与它与网格之间的留白。 */
export const GUTTER = 24;
export const PARKING_WIDTH = 240;
export const PARKING_GAP = 28;
/** 标题带高度：引擎标题节点在 y=24（h 26），分隔线在 y=56，网格从 84 起。 */
export const TITLE_RULE_Y = 56;
export const GRID_TOP = 84;

/** `capacity` 为 null 时的缺省容量：能横竖排下 6 张便签（3×2）。 */
export const DEFAULT_CAPACITY = 6;

/** 分区框的下限，防止分区特别多时格子小到放不下标题条。 */
export const MIN_CELL = { w: 300, h: 200 } as const;

/** 契约 `canvas.SectionDef` 的结构投影（本文件只读它，不重新定义契约）。 */
export interface AutoLayoutSectionInput {
  readonly sectionId: string;
  readonly name: string;
  readonly order: number;
  readonly required: boolean;
  readonly capacity: number | null;
  /**
   * 契约 `canvas.SectionFieldType`——只有 `buildAutoTemplateSpec` 读它（把
   * `短文本` 分区拆成表头字段，见该函数文档），`computeAutoLayout` 本身
   * 不关心这个字段，缺省时行为与改动前逐字一致（现有调用方/既有测试都
   * 不传它）。
   */
  readonly type?: "便利贴列表" | "短文本" | "长文本";
}

export interface AutoLayoutCell {
  readonly sectionId: string;
  readonly name: string;
  readonly required: boolean;
  readonly capacity: number | null;
  readonly col: number;
  readonly row: number;
  /** 中心点 + 尺寸，与 `TemplateSection` 同型。 */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface AutoLayoutRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface AutoLayout {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly AutoLayoutCell[];
  /** 整张画布的外接矩形（含标题带与右侧暂存区）。 */
  readonly bounds: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  /** 右侧便签暂存区。**它是装饰，不是分区**，见 `buildAutoTemplateSpec` 注释。 */
  readonly parking: AutoLayoutRect;
}

/**
 * 分区数 → 行列数的**分档表**（人类要求「不是一律等分」）。
 * 这几档是工作坊画布的常见画幅，硬编码比算出来的更符合人的预期
 * （6 个分区算法可能给 2×3，但工作坊里 6 分区几乎总是 3×2 的横排）。
 */
const GRID_TIERS: Readonly<Record<number, readonly [number, number]>> = {
  4: [2, 2],
  6: [3, 2],
  8: [4, 2],
  9: [3, 3],
  12: [4, 3],
};

const TARGET_CELL_ASPECT = 4 / 3;

/**
 * 档位外的分区数：在所有 `cols ∈ [1, n]` 里挑一个让**单格画幅最接近 4:3** 的。
 * 比较用 log 比值而不是差值 —— 差值会偏向「宽得离谱」那一侧（3.0 与 0.44 到 1.33
 * 的直觉距离一样远，但差值分别是 1.67 与 0.89）。
 */
export function chooseGrid(count: number, areaW: number, areaH: number): [number, number] {
  if (count <= 0) return [1, 1];
  const tier = GRID_TIERS[count];
  if (tier) return [tier[0], tier[1]];
  let best: [number, number] = [count, 1];
  let bestScore = Number.POSITIVE_INFINITY;
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const cellW = (areaW - (cols - 1) * GUTTER) / cols;
    const cellH = (areaH - (rows - 1) * GUTTER) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    const score = Math.abs(Math.log(cellW / cellH / TARGET_CELL_ASPECT));
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = [cols, rows];
    }
  }
  return best;
}

/** 便签排 `perRow` 张一行、共 `rows` 行时，分区框至少要多大。倒推自引擎的排布公式。 */
function cellSizeForArrangement(perRow: number, rows: number): { w: number; h: number } {
  const pitchX = ENGINE_STICKY.w + ENGINE_STICKY_GAP.x;
  return {
    // 引擎：perRow_eff = max(1, min(3, floor((w - 28) / (stickyW + gapX))))，
    // 便签中心 x = sec.x - w/2 + 14 + stickyW/2 + col * pitchX ⇒ 这个宽度既满足
    // floor 反解，也保证最后一张的右沿还在框内。
    w: 2 * ENGINE_STICKY_INSET + perRow * pitchX,
    // 引擎：第一行便签顶 y = sec.y - h/2 + 44（有标题条），行距 gapY，底部留同样的内边距。
    h:
      ENGINE_STICKY_TOP_OFFSET +
      rows * ENGINE_STICKY.h +
      (rows - 1) * ENGINE_STICKY_GAP.y +
      ENGINE_STICKY_INSET,
  };
}

/**
 * 一个分区要横竖排下 `capacity` 张便签，框至少要多大。
 *
 * 便签一行最多 3 张（引擎上限），所以 `capacity` 张有 1/2/3 三种排法，各自给出一个
 * 「窄而高」到「宽而矮」的框。选哪一种**按画幅**定：挑最接近 `targetAspect` 的那个。
 * 这一步很关键 —— 若一律取 perRow=3，6 分区的画布会被撑到 1464 宽（内置 persona 才 1440
 * 且只排 2 张一行）；若一律取 perRow=1，12 分区的画布会被拉到 2000+ 高。两种都会
 * 打破「所有模板同一尺度」。
 */
export function cellSizeForCapacity(
  capacity: number | null,
  targetAspect: number = TARGET_CELL_ASPECT,
): { w: number; h: number } {
  const cap = Math.max(1, capacity ?? DEFAULT_CAPACITY);
  let best = cellSizeForArrangement(1, cap);
  let bestScore = Number.POSITIVE_INFINITY;
  for (let perRow = 1; perRow <= Math.min(ENGINE_STICKY.perRow, cap); perRow += 1) {
    const size = cellSizeForArrangement(perRow, Math.ceil(cap / perRow));
    const score = Math.abs(Math.log(size.w / size.h / targetAspect));
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = size;
    }
  }
  return best;
}

/**
 * 纯函数：分区定义 → 几何。没有任何 fabric / DOM 依赖，可单测。
 *
 * ⚠ 格子**尺寸统一**（取「基准格 / 容量需求 / 下限」三者的最大值），而不是每个分区
 *   各算各的。理由：列宽不一致会让整张画布失去对齐轴线，VISUAL-SPEC 的「专业工具」
 *   观感首先来自对齐。容量仍然真实影响尺寸 —— 容量最大的那个分区决定了所有格子的大小。
 */
export function computeAutoLayout(sections: readonly AutoLayoutSectionInput[]): AutoLayout {
  const ordered = [...sections].sort((a, b) => a.order - b.order || a.sectionId.localeCompare(b.sectionId));
  const gridLeft = A0_FRAME.left;
  const baseAreaW = A0_FRAME.right - A0_FRAME.left - PARKING_WIDTH - PARKING_GAP;
  const baseAreaH = A0_FRAME.bottom - GRID_TOP;
  const [cols, rows] = chooseGrid(ordered.length, baseAreaW, baseAreaH);

  const baseCellW = cols > 0 ? (baseAreaW - (cols - 1) * GUTTER) / cols : baseAreaW;
  const baseCellH = rows > 0 ? (baseAreaH - (rows - 1) * GUTTER) / rows : baseAreaH;
  let needW: number = MIN_CELL.w;
  let needH: number = MIN_CELL.h;
  // 容量需求按**基准格自己的画幅**来挑排法，而不是按 4:3 —— 否则窄格子（分区多）
  // 会被算出一个宽而矮的需求，反过来把整张画布横向撑爆。
  const baseAspect = baseCellH > 0 ? baseCellW / baseCellH : TARGET_CELL_ASPECT;
  for (const s of ordered) {
    const need = cellSizeForCapacity(s.capacity, baseAspect);
    needW = Math.max(needW, need.w);
    needH = Math.max(needH, need.h);
  }
  const cellW = Math.round(Math.max(baseCellW, needW));
  const cellH = Math.round(Math.max(baseCellH, needH));

  const cells: AutoLayoutCell[] = ordered.map((s, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      sectionId: s.sectionId,
      name: s.name,
      required: s.required,
      capacity: s.capacity,
      col,
      row,
      x: gridLeft + cellW / 2 + col * (cellW + GUTTER),
      y: GRID_TOP + cellH / 2 + row * (cellH + GUTTER),
      w: cellW,
      h: cellH,
    };
  });

  const gridW = cols * cellW + (cols - 1) * GUTTER;
  const gridH = rows * cellH + (rows - 1) * GUTTER;
  const parkingLeft = gridLeft + gridW + PARKING_GAP;
  const parking: AutoLayoutRect = {
    x: parkingLeft + PARKING_WIDTH / 2,
    y: GRID_TOP + gridH / 2,
    w: PARKING_WIDTH,
    h: gridH,
  };
  return {
    cols,
    rows,
    cells,
    bounds: {
      left: A0_FRAME.left,
      top: A0_FRAME.top,
      right: Math.max(A0_FRAME.right, parkingLeft + PARKING_WIDTH),
      bottom: Math.max(A0_FRAME.bottom, GRID_TOP + gridH),
    },
    parking,
  };
}

// ---------------------------------------------------------------------------
// 装饰件（全部中性色，全部 locked）
// ---------------------------------------------------------------------------

/**
 * 虚线是画出来的，不是设出来的。
 *
 * 引擎的 `rect` 节点走 `makeShape()`，`strokeWidth` 与 `strokeDashArray` 都写死在
 * 包里（`STROKE_W.normal`，无 dash 入口），`TemplateSection` 也只有 `fill` 一个样式位。
 * 包不许改 ⇒ 虚线只能用一串短实心矩形沿边走一圈来近似（VISUAL-SPEC 里
 * freytag/burger 的装饰也是这种「用细 rect 拼形状」的做法，不是我发明的用法）。
 */
function dashedRectSegments(
  idPrefix: string,
  rect: AutoLayoutRect,
  opts: { dash: number; gap: number; thickness: number },
): DiagramNode[] {
  const out: DiagramNode[] = [];
  const { dash, gap, thickness } = opts;
  const pitch = dash + gap;
  const left = rect.x - rect.w / 2;
  const top = rect.y - rect.h / 2;
  const push = (id: string, x: number, y: number, w: number, h: number): void => {
    out.push({
      id,
      label: "",
      shape: "rect",
      x,
      y,
      width: w,
      height: h,
      data: { locked: true, color: LINE, stroke: "transparent" },
    });
  };
  const runs = Math.max(1, Math.floor(rect.w / pitch));
  for (let i = 0; i < runs; i += 1) {
    const cx = left + i * pitch + dash / 2;
    push(`${idPrefix}-t-${i}`, cx, top, dash, thickness);
    push(`${idPrefix}-b-${i}`, cx, top + rect.h, dash, thickness);
  }
  const vruns = Math.max(1, Math.floor(rect.h / pitch));
  for (let i = 0; i < vruns; i += 1) {
    const cy = top + i * pitch + dash / 2;
    push(`${idPrefix}-l-${i}`, left, cy, thickness, dash);
    push(`${idPrefix}-r-${i}`, left + rect.w, cy, thickness, dash);
  }
  return out;
}

function buildDecorations(layout: AutoLayout): DiagramNode[] {
  const deco: DiagramNode[] = [];

  // ① 标题带的细分隔线（标题文字本身由引擎画，见 template-engine 的 `tpl-title`）。
  deco.push({
    id: "auto-title-rule",
    label: "",
    shape: "rect",
    x: (layout.bounds.left + layout.bounds.right) / 2,
    y: TITLE_RULE_Y,
    width: layout.bounds.right - layout.bounds.left,
    height: 2,
    data: { locked: true, color: LINE, stroke: "transparent" },
  });

  // ② 必填分区的强调框。
  //
  // ⚠ 要求原文是「边框加粗（stroke 2）」，但**引擎不接受按节点设 strokeWidth**
  //   （`makeShape` 里写死 `STROKE_W.normal`），包又不许改。所以用几何手段等效：
  //   在必填分区外面再套一圈 6px 外扩的框，两道 1.5px 描边并排 = 视觉上的加粗边。
  //   这是黑白灰约束下**唯一**不靠颜色的区分手段（装饰在分区框之下渲染，
  //   外扩的部分露在外面，不会被分区白底盖住）。
  for (const cell of layout.cells) {
    if (!cell.required) continue;
    deco.push({
      id: `auto-required-${cell.sectionId}`,
      label: "",
      shape: "rect",
      x: cell.x,
      y: cell.y,
      width: cell.w + 6,
      height: cell.h + 6,
      data: { locked: true, color: "transparent", stroke: INK },
    });
  }

  // ③ 右侧便签暂存区（人类明确要求「边列贴协作」）。
  //
  // ⚠⚠ 它是 **decoration，不是 section**，这是本文件最重要的一条约束：
  //   分区列表的权威是数据库里的 `SectionDef[]`（契约 `canvas.SectionDef`）。
  //   凭空多一个 section 会让「模板说 6 个分区、画布显示 7 个框」对不上，而且
  //   引擎的便签归属是**几何判定**（便签中心落在哪个 section 框里就算哪个分区），
  //   多一个框就意味着便签可以被序列化进一个**契约里根本不存在的 `## 分区`**，
  //   再存回后台就是脏数据。做成装饰后，暂存区里的便签在几何上不属于任何 section，
  //   会被引擎按「最近的框」归给相邻分区 —— 这正是「待归类」的正确语义。
  deco.push({
    id: "auto-parking-bg",
    label: "",
    shape: "rect",
    x: layout.parking.x,
    y: layout.parking.y,
    width: layout.parking.w,
    height: layout.parking.h,
    data: { locked: true, color: CANVAS_BG, stroke: "transparent" },
  });
  deco.push(
    ...dashedRectSegments("auto-parking-dash", layout.parking, { dash: 24, gap: 14, thickness: 2 }),
  );
  deco.push({
    id: "auto-parking-label",
    label: "便签暂存 · 待归类",
    shape: "text",
    x: layout.parking.x,
    y: layout.parking.y - layout.parking.h / 2 + 22,
    width: layout.parking.w - 24,
    height: 20,
    data: { locked: true, fontSize: 14, bold: true, color: INK_SOFT, align: "center" },
  });

  return deco;
}

export interface AutoTemplateInput {
  /** 注册进 `fabric-markdown` 全局表用的 key（组织模板的 key，或命名空间化后的 key）。 */
  readonly key: string;
  /** 模板显示名 —— 画布顶部标题带上的那行字。 */
  readonly displayName: string;
  readonly sections: readonly AutoLayoutSectionInput[];
}

export interface AutoTemplateResult {
  readonly spec: TemplateSpec;
  readonly layout: AutoLayout;
}

/**
 * 表头字段带的高度（px，与 `computeAutoLayout` 的 `A0_FRAME` 同一套抽象画布单位，
 * 不是 mm）——2026-08-30 追加。取值参照内置 `persona` 手工 spec 的
 * `headerRect.h=110`（`packages/fabric-markdown/src/diagrams/persona.ts`），
 * 略窄一点是因为组织自建模板的表头通常字段更少、不需要那么高的带。
 */
const HEADER_BAND_H = 90;
/**
 * 表头字段每一行占的高度（px）。镜像 `persona.ts` 内置 `headerRect`（h=110，9 字段/
 * 5 每行=2 行）的行距比例 `110 ÷ (2+1) ≈ 36.7`，取整数 40 留余量——字段值在引擎里
 * 会按格宽逐字换行，两行值（13px × 2 行 ≈ 34px）要在一个行距里放得下。
 * 显式布局（`explicit-template-layout.ts`）与这里共用同一个常量，不再各写一份。
 */
export const HEADER_ROW_PITCH = 40;

/**
 * 表头带实际高度：`HEADER_BAND_H` 是下限，字段多到要换行时按行数长高
 * （2026-09-02，与显式布局同一条规则——此前恒 90px，9 个字段/5 每行=2 行挤在
 * 90px 里行距只剩 30px，换行后的字段值上下两行互相压住）。
 */
function headerBandHeight(fieldCount: number, fieldsPerRow: number): number {
  const rows = Math.max(1, Math.ceil(fieldCount / Math.max(1, fieldsPerRow)));
  return Math.max(HEADER_BAND_H, (rows + 1) * HEADER_ROW_PITCH);
}

/** `computeAutoLayout` 产出的整份布局整体下移 `dy`，给上方腾出表头带。纯几何平移。 */
function shiftLayout(layout: AutoLayout, dy: number): AutoLayout {
  return {
    ...layout,
    cells: layout.cells.map((c) => ({ ...c, y: c.y + dy })),
    parking: { ...layout.parking, y: layout.parking.y + dy },
    bounds: { ...layout.bounds, bottom: layout.bounds.bottom + dy },
  };
}

/**
 * 组织自建模板 → 可渲染的 `TemplateSpec`。
 *
 * 也刻意不设 `sectionColors`：那是 PALETTE 索引，黑白灰约束下不该出现
 * （引擎当前也已把标题条固定成灰色，设了也不生效 —— 更不该留一个「看着像在生效」的入参）。
 *
 * ⚠ 2026-08-30 追加：此前这里的文档说「刻意不产出 `fields`/`headerRect`：契约的
 *   `SectionDef` 里没有『表头字段』这个概念」——那句话在 2026-08-26 之后已经过时：
 *   契约早就加了 `SectionFieldType`（`短文本`/`长文本`/`便利贴列表`），`短文本`
 *   分区就是表头字段的事实源（`canvas-template-guidance.ts` 与
 *   `builtin-template-config.ts` 都已按这条判据拼 prompt / 落库）。本函数此前没跟上：
 *   `type` 从入参类型上就被漏掉，`短文本` 分区被当成普通贴纸 box 处理，模型按 guidance
 *   写出的 `字段名: 字段值` 行落进 `fields` map 却没有 `headerRect` 可渲染，静默丢失
 *   （用户画像在 chat 模拟里测不出表头字段就是这个根因）。
 *   现在 `type === "短文本"` 的分区会被拆出来，合并成一条表头带（`HEADER_BAND_H`），
 *   正文分区（`便利贴列表`/`长文本`，以及所有没有 `type` 的旧数据）仍走原来的
 *   `computeAutoLayout` 网格——没有任何 `短文本` 分区时（现有测试与既有调用方都是
 *   这种情况）输出与改动前逐字一致。
 */
export function buildAutoTemplateSpec(input: AutoTemplateInput): AutoTemplateResult {
  const header = input.sections.filter((s) => s.type === "短文本");
  const body = input.sections.filter((s) => s.type !== "短文本");
  const hasHeader = header.length > 0 && body.length > 0;

  const headerPerRow = Math.min(5, header.length);
  const bandH = hasHeader ? headerBandHeight(header.length, headerPerRow) : 0;
  const rawLayout = computeAutoLayout(hasHeader ? body : input.sections);
  const layout = hasHeader ? shiftLayout(rawLayout, bandH + GUTTER) : rawLayout;

  const sections: TemplateSection[] = layout.cells.map((c) => ({
    name: c.name,
    x: c.x,
    y: c.y,
    w: c.w,
    h: c.h,
    fill: PAPER,
  }));

  const headerFields = hasHeader
    ? {
      fields: header.map((h) => h.name),
      headerRect: {
        x: (A0_FRAME.left + A0_FRAME.right) / 2,
        y: GRID_TOP + bandH / 2,
        w: A0_FRAME.right - A0_FRAME.left,
        h: bandH,
      },
      fieldsPerRow: headerPerRow,
    }
    : {};

  return {
    spec: {
      key: input.key,
      title: input.displayName,
      ...headerFields,
      sections,
      titleBars: true,
      decorations: buildDecorations(layout),
    },
    layout,
  };
}
