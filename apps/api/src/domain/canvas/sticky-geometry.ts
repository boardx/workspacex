/**
 * I-10 · 便签几何归区判定（#1493 / UC-7.3 第二块，`exportSource` 的核心）。
 *
 * ## 语义逐字来自引擎的 `serializeTemplate`，这里是它的可独立调用形
 *
 * `packages/fabric-markdown/src/diagrams/template-engine.ts` 的 `serializeTemplate`
 * 内嵌了同一套判定（包含判定 `|sx-bx| <= w/2 && |sy-by| <= h/2`，否则中心距离平方
 * 最近的框、按框声明序破平），但它不单独导出，且它的输入/输出是整个 DiagramModel 的
 * 序列化——`exportSource` 需要的是「一个点、一批框 → 归哪个框 + 是不是兜底」这一步
 * 判定本身（围栏原位替换不能走整文档重序列化，那会丢 `# 标题`、mermaid 围栏与行序）。
 * 所以这里按 vendor 纪律（不改 fabric-markdown 一个字）**新写**了带完整单测的同语义
 * 纯函数；`tests/canvas/sticky-geometry-assign.test.ts` 用引擎自己的 SWOT 几何数据
 * 钉住两边不漂移。
 *
 * ## 全函数（I-10）
 *
 * 只要 `boxes` 非空，任何点都有归属：框内命中即归入（`nearestFallback: false`，
 * 边线上按 `<=` 算框内，与引擎一致）；全部框外归中心最近的框（`nearestFallback: true`，
 * E2d 的可撤销提示据此弹出）；等距时第一个声明的框赢（引擎的严格 `<` 同款）。
 * `boxes` 为空返回 `null`——那不是「无归属便签」，是这个模板根本没有几何（调用方
 * 保持便签原分区，见 export-canvas-source.ts）。
 */

export interface SectionBox {
  /** 归区结果要报告的分区标识（调用方决定语义：分区名或 sectionId）。 */
  readonly key: string;
  /** 框中心 + 尺寸（canvas px），与 `TemplateSection` 的 x/y/w/h 同一约定。 */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface StickyAssignment {
  readonly key: string;
  /** true = 点落在所有框外、按最近框归入（契约 `nearestFallback` 的定义）。 */
  readonly nearestFallback: boolean;
}

export function assignStickyToBox(
  point: { readonly x: number; readonly y: number },
  boxes: readonly SectionBox[],
): StickyAssignment | null {
  if (boxes.length === 0) return null;

  for (const b of boxes) {
    if (Math.abs(point.x - b.x) <= b.w / 2 && Math.abs(point.y - b.y) <= b.h / 2) {
      return { key: b.key, nearestFallback: false };
    }
  }

  let best = boxes[0]!;
  let bestDist = Infinity;
  for (const b of boxes) {
    const d = (point.x - b.x) ** 2 + (point.y - b.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return { key: best.key, nearestFallback: true };
}
