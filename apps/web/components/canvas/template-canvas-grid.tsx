"use client";
import * as React from "react";
import type { SectionDraft } from "./template-editor-model";
import { TONE_COLORS, noteFontSizePx, sectionGeometryMmOf } from "./template-editor-model";
import { PAPER_SIZE_MM, A1_MARGIN_MM, type PaperSizeKey } from "@/lib/canvas/explicit-template-layout";

/**
 * 拖拽式 A1 画布（R4，2026-08-26）——`Design.pdf` §4.2「第二步 · 拖到画布」。
 *
 * ## 为什么是原生 HTML5 drag + CSS grid，不是 fabric
 *
 * 本仓的 `CanvasStage`（fabric）在模板渲染路径上把分区框声明为 `locked`
 * （`selectable:false, evented:false`，见 `canvas-io.ts`），**对象级拖拽在那条路径上
 * 结构性不可行**，而 vendor 纪律不许改包。设计稿要的正是"拖着字段丢到网格上、
 * 拖着已放置的区块换位置"——所以编辑器这一屏用原生 DOM 实现，不经过 fabric。
 *
 * ⚠ 这**不是**第二套渲染：真正给使用者看的成品画布仍然只有一条链
 * （`explicit-template-layout.ts` → `registerTemplate` → `CanvasStage`，R1）。
 * 这里是**编辑态**的直接操作界面，产出的是 `layout`（col/row/w/h）这份数据；
 * 数据一旦存下来，渲染仍然走那条唯一的链。编辑态与渲染态用不同技术是刻意的
 * 分工，不是同一件事做了两遍。
 *
 * ## 落点即位置
 *
 * `Design.pdf` §4.2 原话：「按指针相对内容区的比例换算成 col/row」。所以命中计算
 * 用的是 `getBoundingClientRect()` 的**比例**，不是像素常量——网格 12/6 列可切、
 * 画布宽度随窗口变，比例换算是唯一不会随这两者漂移的算法。
 */

const GRID_ROWS = 8;

export function TemplateCanvasGrid({
  sections, gridCols, showSample, runData, selectedId, editable,
  title, footer, paperSize = "A1",
  onSelect, onPlace, onMove,
}: {
  readonly sections: readonly SectionDraft[];
  readonly gridCols: 6 | 12;
  readonly showSample: boolean;
  /** 纸张尺寸——决定纸面比例/页边距/mm 换算。缺省 `"A1"`，兼容既有调用方。 */
  readonly paperSize?: PaperSizeKey;
  /**
   * 试运行数据：AI 输出 JSON 的形状（`{ [key]: string | string[] }`）。
   * 非 null 时**压过**样例开关——人类既然给了真数据，就不该再看见占位文案。
   */
  readonly runData: Readonly<Record<string, unknown>> | null;
  readonly selectedId: string | null;
  readonly editable: boolean;
  /**
   * A1 纸上的双语大标题与底部署名（人类 2026-08-26：「需要有一个功能是可以放 Title，
   * 页脚也有一些版权的信息，需要可以预留这个空间」）。
   *
   * ⚠ 空串 = **不画那一带**，那一带的高度还给内容网格。留一条空白带比不留更糟：
   *   它让每张没起标题的模板都白丢一截纸，而使用者看不出那截是干什么的。
   */
  readonly title: string;
  readonly footer: string;
  readonly onSelect: (sectionId: string) => void;
  /** 从左栏拖一个未放置的字段进来。 */
  readonly onPlace: (sectionId: string, col: number, row: number) => void;
  /** 拖动一个已放置的区块换位置。 */
  readonly onMove: (sectionId: string, col: number, row: number) => void;
}) {
  const [dragging, setDragging] = React.useState<{ id: string; kind: "field" | "block" } | null>(null);
  /**
   * ⚠ 落点换算的基准是**内容区**，不是整张纸。加了标题带/页脚带之后两者不再重合：
   *   继续拿纸的 rect 去算比例，拖到哪都会整体往下偏一个标题带的高度，而且
   *   **有没有标题**会让偏移量变化——那种错位看起来像"拖拽不准"，查不到原因。
   */
  const contentRef = React.useRef<HTMLDivElement>(null);

  const placed = sections.filter((s) => s.layout !== null);

  /** 指针 → 网格坐标。按比例换算（见文件头），不是像素常量。 */
  function cellFrom(e: React.DragEvent): { col: number; row: number } | null {
    const el = contentRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const ratioX = (e.clientX - r.left) / r.width;
    const ratioY = (e.clientY - r.top) / r.height;
    return {
      col: Math.min(gridCols, Math.max(1, 1 + Math.floor(ratioX * gridCols))),
      row: Math.min(GRID_ROWS, Math.max(1, 1 + Math.floor(ratioY * GRID_ROWS))),
    };
  }

  function onDrop(e: React.DragEvent): void {
    e.preventDefault();
    if (!editable) return;
    // 拖的是什么由 dataTransfer 带过来——不靠组件内部的 `dragging` state，
    // 那个 state 在跨组件拖拽（左栏字段卡片 → 这里）时不一定同步得上。
    const raw = e.dataTransfer.getData("application/x-tpl-drag");
    const payload = raw !== "" ? JSON.parse(raw) as { id: string; kind: "field" | "block" } : dragging;
    setDragging(null);
    if (!payload) return;
    const cell = cellFrom(e);
    if (!cell) return;
    if (payload.kind === "field") onPlace(payload.id, cell.col, cell.row);
    else onMove(payload.id, cell.col, cell.row);
  }

  return (
    <div
      className="relative grid w-full shadow-sm"
      style={{
        // 标题/页脚字号用 `cqw`（纸宽的百分比）而不是 px：编辑器画布会随窗口变宽变窄，
        // 固定 px 在窄屏上会让标题占掉大半张纸。`cqw` 需要一个容器查询上下文。
        containerType: "inline-size",
        // 纸面真实比值，同缩略图与 mm 计算共用一个来源（`Design.pdf` §5「纸面」）。
        // ⚠ 从 `PAPER_SIZE_MM` 算，不手写字面量——A1/A3/A4 恰好同一个宽高比（√2:1，
        //   ISO 系列的定义性质），所以三档视觉上几乎不变，但仍是"算出来的"不是
        //   "碰巧对"，见 `explicit-template-layout.ts` 的 `PAPER_SIZE_MM` 文件头。
        aspectRatio: `${PAPER_SIZE_MM[paperSize].w} / ${PAPER_SIZE_MM[paperSize].h}`,
        background: "#fff",
        border: "1px solid var(--border, #D6D3CA)",
        // 四边 10mm 页边距，按比例实现——⚠ 页边距固定 10mm 不随纸张缩放，所以百分比
        //   要按**这张纸自己的宽度**算，不能沿用 A1 的 1.189%（A4 纸上 10mm 占比
        //   远大于 A1，写死会让 A4 画布的页边距看起来"缺了一截"）。
        padding: `${(A1_MARGIN_MM / PAPER_SIZE_MM[paperSize].w) * 100}%`,
        gridTemplateColumns: "1fr",
        // 标题带 / 内容 / 页脚带。空文本时那一行**不渲染**，高度塌成 0。
        //
        // ⚠ 三个子元素必须**各自显式声明 `gridRow`**，不能靠出现顺序自动排。
        //   隐式排布下，标题为空时内容区会成为第一个子元素、落进第 1 行（`auto`）——
        //   于是它的高度变成"内容高"而不是 `1fr`，塌成几乎为 0。而 `cellFrom` 用
        //   `contentRef` 的 rect 算落点比例：`r.height ≈ 0` ⇒ `ratioY` 远大于 1 ⇒
        //   行号被夹到第 8 行，那正是 `geom.fits === 0` 的一行 ⇒ 拖进去的区块
        //   一张贴纸都画不出来。2026-08-26 CI 实测撞到这条，症状是"试运行没反应"。
        gridTemplateRows: "auto 1fr auto",
        rowGap: "0.72%",
      }}
      onDragOver={(e) => { if (editable) e.preventDefault(); }}
      onDrop={onDrop}
      data-testid="tpladmin-editor-canvas"
    >
      {/*
        标题带。参照人类给的三张设计图（PESTEL / 用户画像 / AI 战略画布）：双语大标题
        顶格左对齐，占一条窄带，下面才是内容。空串时这一行整个不渲染（`auto` 塌成 0）。
      */}
      {title !== "" && (
        <div
          // ⚠ 颜色用行内 `#14130F` 而不是 `text-*` token：这行字画在一张**白纸**上，
          //   而 token 会随明暗主题翻转——深色模式下 `card-foreground` 变浅色，
          //   印在恒白的纸上就看不见了。同下面区块边框 `2px solid #14130F` 的理由。
          className="font-bold leading-tight"
          // 字号随纸宽缩放（`cqw` = 容器宽度的 %），不是设计系统的字号档位——那张表是
          // 给屏幕上的 UI 用的，而这行字画在一张会随窗口缩放的"纸"上，档位在这里
          // 表达不了。同下面贴纸字号由实尺推导的理由（`Design.pdf` §5 末段）。
          style={{ gridRow: 1, fontSize: "2.2cqw", paddingBottom: "0.6%", color: "#14130F" }}
          data-testid="tpladmin-editor-canvas-title"
        >
          {title}
        </div>
      )}

      {/* 内容区：网格线层与区块层叠在这里，落点换算也以它为基准（见 `contentRef`）。 */}
      <div
        ref={contentRef}
        className="relative grid min-h-0"
        style={{ gridRow: 2, gridTemplateColumns: "1fr", gridTemplateRows: "1fr" }}
      >
      {/* 网格幽灵层：拖动中才显形（`Design.pdf` §4.2「拖动中画布网格线显形」）。 */}
      <div
        className="pointer-events-none"
        style={{
          gridArea: "1 / 1",
          display: "grid",
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
          gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
          // 6mm 间距 ÷ 821mm 内容区宽 = 0.72%（`Design.pdf` §5「网格」原话）。
          gap: "0.72%",
        }}
      >
        {Array.from({ length: gridCols * GRID_ROWS }, (_, i) => (
          <div
            key={i}
            className="rounded-control border border-dashed transition-colors duration-fast"
            style={{ borderColor: dragging ? "#C9C5BB" : "#F0EEE7" }}
          />
        ))}
      </div>

      {/* 内容区：网格线层与区块层都叠在它里面，落点换算也以它为基准 */}
      <div
        style={{
          gridArea: "1 / 1",
          display: "grid",
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
          gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
          gap: "0.72%",
        }}
      >
        {placed.map((s) => {
          const layout = s.layout!;
          const geom = sectionGeometryMmOf(s, gridCols, paperSize);
          const isList = s.type === "便利贴列表";
          /**
           * 贴纸实尺，按纸宽换算成 `cqw`（容器宽度的百分比）——2026-09-01 推翻
           * 2026-08-30 那条「贴纸固定，不随列数/区块变化」的约定（理由见
           * `explicit-template-layout.ts` 的 `MAX_NOTE_MM` 文档：固定大小在窄区块
           * 长文字场景下会让贴纸装不进框，是这次要修的问题）。
           *
           * 用 `geom.noteMm`（已经按 `wMm/cols` 算好、并封顶在 `MAX_NOTE_MM`）而不是
           * 直接 `repeat(cols, 1fr)`：`1fr` 会让贴纸宽度恒等于"区块宽度/列数"，1 列
           * 时贴纸被拉成整个区块那么大的正方形（issue #2368 那次要修的问题，2026-08-30
           * 冻结前的真实回归）；改用 `geom.noteMm` 换算出的 `cqw`，贴纸仍随列数/区块
           * 宽度缩放，但不会超过 `MAX_NOTE_MM`——两次教训（"完全不变"太大、"纯 1fr"
           * 又会撑爆）都躲开。
           */
          const notePct = (geom.noteMm / PAPER_SIZE_MM[paperSize].w) * 100;
          // 实际渲染几条：受"最多条数"与"这块地方放得下几条"双重约束——
          // 画出来的东西不能比物理上放得下的还多，那是在骗人。
          const capacity = isList ? Math.min(layout.max, Math.max(0, geom.fits)) : 1;
          // 试运行时条数由**数据**决定（但仍夹在物理容量内）——这正是试运行要回答的问题：
          // 「我这条数据放进去，装得下吗？」预置成容量上限就永远装得下，等于没问。
          const values = runData === null ? null : valuesFor(s, runData);
          const noteCount = visibleNoteCount(capacity, values === null ? null : values.length);
          const overflowed = values !== null && values.length > capacity;
          /**
           * 「叠放」——2026-09-01 人类反馈「便利贴太大装不下」之前，`layout.overflow`
           * 选哪个都不影响渲染（只拼进一句警告文案，见下方 `overflowed` 那个 span）。
           * 选「叠放」时，装不下的那部分不再直接被外层 `overflow-hidden` 悄悄裁掉——
           * 让出最后一个格子，换成一张「+N」堆叠角标，如实交代"这里还有 N 条没显示"，
           * 而不是让使用者以为数据丢了。其余两个选项（缩小字号/截断）不动这个数，
           * 装不下的行为仍是原来的"摆不下就换行、换行摆不下就被裁掉"。
           */
          const showStack = isList && layout.overflow === "叠放" && overflowed && noteCount > 1;
          const stackExtra = showStack ? values!.length - (noteCount - 1) : 0;
          const visibleCount = showStack ? noteCount - 1 : noteCount;
          return (
            <div
              key={s.sectionId}
              draggable={editable}
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-tpl-drag", JSON.stringify({ id: s.sectionId, kind: "block" }));
                setDragging({ id: s.sectionId, kind: "block" });
              }}
              onDragEnd={() => setDragging(null)}
              onClick={() => onSelect(s.sectionId)}
              className="flex cursor-pointer flex-col gap-1.5 overflow-hidden rounded-card bg-card p-2"
              style={{
                gridColumn: `${layout.col} / span ${layout.w}`,
                gridRow: `${layout.row} / span ${layout.h}`,
                border: `2px solid ${selectedId === s.sectionId ? "#1F5FD0" : "#14130F"}`,
              }}
              data-testid={`tpladmin-editor-block-${s.sectionId}`}
            >
              {/*
                标题「独占一行」，不与 key / 元信息挤在同一条 flex 里。

                ⚠ 原先三者同行且标题没有 `whitespace-nowrap`：窄区块（1-2 格宽）里 flex 会把
                  标题压到 min-content，也就是「一个字一行的竖排」——人类 2026-08-26 截图
                  实测原话「模板的 title 有点问题，不要是竖的，美观有问题」。同一行里那个
                  `{{key}}` 徽章也会被裁掉半截（截图里 `{{resource_considera` 断在中间）。

                  加 `whitespace-nowrap` 治不了根：1 格宽 ≈ 68mm/12，「核心合作伙伴」六个字
                  横排本来就放不下，只会从竖排变成溢出。真正的修法是「分行」——参照设计里
                  （PESTEL / 用户画像 / AI 战略画布）标题也都是独占一行、说明文字在它下面。
              */}
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-11 font-bold leading-tight" title={s.name || "未命名"}>
                  {s.name || "未命名"}
                </span>
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate font-mono text-9 text-primary" title={`{{${s.key}${isList ? "[]" : ""}}}`}>
                    {`{{${s.key}${isList ? "[]" : ""}}}`}
                  </span>
                  <span
                    className={`ml-auto shrink-0 whitespace-nowrap text-9 ${overflowed ? "font-bold text-destructive" : "text-muted-foreground"}`}
                    data-testid={overflowed ? `tpladmin-editor-overflow-${s.sectionId}` : undefined}
                  >
                    {overflowed
                      ? `装不下：${values!.length} 条 / 位置只够 ${capacity} 条`
                      : isList
                        ? `${layout.cols} 列 · ${layout.max} 条`
                        : "文本"}
                  </span>
                </div>
              </div>
              <div
                className="grid flex-1 content-start gap-1 overflow-hidden"
                style={{
                  // 列表型：每列宽 `notePct`（`geom.noteMm` 换算，随区块宽度/列数缩放，
                  // 封顶 `MAX_NOTE_MM`——2026-09-01 见上方 `notePct` 声明处的文档）。
                  // 一行摆 `layout.cols` 张，多出来的换行（`content-start` 让多余行不被
                  // 拉伸），行数摆不下的部分仍会被外层 `overflow-hidden` 裁掉。
                  // 短文本/长文本型：仍是 1fr（占满区块宽的单个文本框，不是贴纸网格）。
                  gridTemplateColumns: isList ? `repeat(${layout.cols}, ${notePct}cqw)` : "1fr",
                }}
              >
                {Array.from({ length: visibleCount }, (_, i) => {
                  const text = values !== null ? values[i] ?? "" : showSample ? sampleTextFor(s, i) : "";
                  // 「截断」——字号维持不变（不像「缩小字号」那样继续按字数缩），改用
                  // line-clamp 硬截断 + 省略号：与外层原有的 `overflow-hidden` 相比，
                  // 后者会在任意像素处生硬切字（可能切在半个字中间），line-clamp 保证
                  // 只在整行末尾断、且带省略号，读起来是"这里还有更多"而不是"字被砍掉了"。
                  const clampLines = isList && layout.overflow === "截断" ? 4 : undefined;
                  return (
                    <div
                      key={i}
                      className="overflow-hidden rounded-control px-1 py-0.5 leading-tight"
                      style={{
                        background: (showSample || values !== null) && isList ? TONE_COLORS[layout.tone] ?? TONE_COLORS[0] : "transparent",
                        border: (showSample || values !== null) && isList ? "none" : "1px dashed #C9C5BB",
                        // 字号由贴纸实尺推导（`Design.pdf` §5 末段：不能写成固定值，
                        // 否则小贴纸会裁字）。选「缩小字号」时额外按文字长度继续收缩，
                        // 见 `noteFontSizePx` 文档。
                        fontSize: `${noteFontSizePx(geom.noteMm, isList, layout.overflow === "缩小字号" ? text.length : 0)}px`,
                        aspectRatio: isList ? "1" : "auto",
                        minHeight: isList ? 0 : 18,
                        ...(clampLines !== undefined
                          ? { display: "-webkit-box", WebkitLineClamp: clampLines, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }
                          : {}),
                      }}
                    >
                      {text}
                    </div>
                  );
                })}
                {showStack && (
                  <div
                    className="flex items-center justify-center rounded-control px-1 py-0.5 text-center font-bold leading-tight"
                    style={{
                      background: TONE_COLORS[layout.tone] ?? TONE_COLORS[0],
                      opacity: 0.6,
                      fontSize: `${noteFontSizePx(geom.noteMm, isList)}px`,
                      aspectRatio: "1",
                    }}
                    data-testid={`tpladmin-editor-stack-${s.sectionId}`}
                  >
                    {`+${stackExtra}`}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      </div>

      {/*
        页脚带：署名 / 版权行。⚠ 老 spec 里「没有」这件事实，19 个内置模板回填一律留空
        （见 `backfill-canvas-builtin-templates.ts` 文件头）——照着参照图把某个署名写进
        代码等于凭空断言作品出处。由人在编辑器里自己填。
      */}
      {footer !== "" && (
        <div
          className="leading-tight"
          style={{ gridRow: 3, fontSize: "1.2cqw", paddingTop: "0.6%", color: "#6B6862" }}
          data-testid="tpladmin-editor-canvas-footer"
        >
          {footer}
        </div>
      )}

      {placed.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-12 text-muted-foreground" data-testid="tpladmin-editor-canvas-empty">
            把左侧字段拖到这里 —— 落点就是它在 A1 纸上的位置
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * 实际画几张贴纸。
 *
 * ## 为什么要有下限 1
 *
 * `capacity` 是「这块地方物理上放得下几张」（`geom.fits` 夹上 `layout.max`）。区块小到
 * 放不下**一张**时它是 0，直接用它当条数就是**一张都不画**——人类填进去的数据凭空
 * 消失，而画布上那个区块还在、只是空的。看起来像"试运行按钮没反应"，
 * 而真正的原因在两层之外的几何计算里。2026-08-26 CI `fullstack-smoke` 实测撞到这条。
 *
 * ⚠ 下限**不是**在骗人说"装得下"：装不下这件事由旁边那行标红的「装不下：N 条 /
 *   位置只够 M 条」如实交代（`overflowed`）。一张画不出来的预览没有任何信息量；
 *   一张画出来了、旁边写着装不下的预览，才回答了试运行要回答的那个问题。
 *
 * ⚠ 下限只在**有数据**时生效。没有试运行数据（样例数据模式）时照旧用容量——
 *   那时候画 0 张是对的：它如实表示"这块地方一张都放不下"。
 */
export function visibleNoteCount(capacity: number, dataLength: number | null): number {
  if (dataLength === null) return capacity;
  return Math.max(1, Math.min(capacity, dataLength));
}

/**
 * 试运行数据里属于这个分区的那几条。
 *
 * ## 缺 key 与"给了空数组"是**两回事**
 *
 * 分区没有 `key`（人类还没填）⇒ 数据里根本没有它的位置 ⇒ 返回**空数组**，画布上是空贴纸。
 * 这与"给了 `[]`"渲染成同一个样子，是刻意的：两种情况下这块地方**确实**没有内容可显示，
 * 而在画布上编一个"未配置"的红字会把排版预览变成一张错误清单。缺 key 的告警归
 * `checkTemplateHealth`（右栏那块），不归这里——同一件事不在两处声明。
 *
 * ⚠ 非数组的值（人类给列表分区填了一个字符串）**不静默丢弃**，包成单条。丢掉它会让
 *   试运行显示"这条数据装得下"，而实际上那条数据压根没进来过。
 */
function valuesFor(s: SectionDraft, data: Readonly<Record<string, unknown>>): readonly string[] {
  if (!s.key) return [];
  const raw = data[s.key];
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
}

/**
 * 样例数据（`Design.pdf` §4.2「样例数据开关在真实文案与空贴纸骨架之间切换」）。
 *
 * ⚠ 这是**排版占位**，不是"AI 会写出来的东西"：真实内容由运行时的模型产出，模板
 *   编辑器不可能知道。占位文本刻意写成「示例条目 N」这种一眼可辨的形状，
 *   而不是编一句像真话的业务文案——后者会让人以为模板里预置了内容。
 */
function sampleTextFor(s: SectionDraft, index: number): string {
  if (s.type === "便利贴列表") return `${s.name || "条目"} 示例 ${index + 1}`;
  if (s.type === "长文本") return `${s.name || "段落"} 的示例段落文字……`;
  return `${s.name || "字段"} 示例`;
}
