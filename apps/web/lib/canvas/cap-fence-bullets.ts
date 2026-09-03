/**
 * issue #2564：「AI 商业模型画布 / 模版编辑 / 显示方式 / 列数」——排版内容错乱、内容
 * 溢出。
 *
 * ## 根因：真正出问题的是**渲染**，不是布局数据
 *
 * 编辑器②画布（`TemplateCanvasGrid`）里样例数据的条数恒等于配置的容量，从来不会
 * 溢出，看起来一切正常——真调模型跑一次（「chat 模拟」/真实 chat）之后才会溢出：
 * 模型实际产出的条数可能比模板配置的「最多条数」多（`checkTemplateHealth` 的
 * `overflowing` 早就在报这类不匹配，但「不阻止保存」），或者哪怕条数对得上，
 * `packages/fabric-markdown` 的 `template-engine.ts`（`spec.sections.forEach` 那段）
 * 把一个分区收到的便签**全部**画出来、从不检查这个框实际放得下几张——vendor 引擎
 * 的 fabric 画布**没有任何裁剪**（不是 DOM，没有 `overflow: hidden`），便签超出框高
 * 之后照样继续往下叠，直接画进下一行/相邻分区的地界：标题条被压住、便签溢出到
 * 相邻分区，正是用户截图里「排版内容错乱、内容溢出」的样子。
 *
 * vendor 不许改（见 `packages/fabric-markdown/VENDOR.md`），真正的修法是在喂给引擎
 * **之前**，把每个分区的条目数截到 `renderStickyCapacity`（`auto-template-layout.ts`，
 * 那条公式的逆运算）算出的真实渲染容量——这是「引擎自己会用的那套排布公式」的
 * 逆运算，不是另一套猜测的上限。截断优于溢出：一块地方物理上放不下的条目，画出来
 * 压住别的分区，比如实少展示几条更糟——`overflow: 截断` 本就是编辑器右栏提供的
 * 三个显示策略之一（文档见 `explicit-template-layout.ts`），这里是那条策略在
 * fabric.js 渲染路径上唯一说得通的实现（`缩小字号`/`叠放` 两个选项无法覆盖「数量
 * 超出框高」这类溢出——字号缩小不会让便签变矮，vendor 也没有真正的堆叠/分页机制）。
 *
 * ## 只截数量，不改文字/顺序
 *
 * 保留前 `capacity` 条、按原有顺序，只丢弃超出的部分——不重排、不截断单条文字
 * （那是 `noteFontSizePx`/`template-canvas-grid.tsx` 管的另一层，见其文档）。
 */
import type { TemplateSpec } from "@repo/fabric-markdown";
import { ENGINE_STICKY, renderStickyCapacity } from "./auto-template-layout";

/**
 * `spec` 的每个分区在引擎里实际能画下几张便签——`## 分区名` → 容量。
 * 只覆盖 `spec.sections`（表头 `fields` 不是便签列表，不参与截断）。
 *
 * ⚠ 独立审查抓到的问题（修复见 `renderStickyCapacity` 文档）：便签尺寸必须按引擎
 *   自己的合并规则算——`{ ...(spec.sticky ?? DEFAULT_STICKY), ...sec.sticky }`
 *   （`template-engine.ts` 475 行 `sectionSticky`），逐字段合并，不是「有 spec.sticky
 *   就整份换掉默认值」。这里精确复刻同一条合并（而不是只合并 `perRow`、`w`/`h`
 *   仍然悄悄用 `ENGINE_STICKY` 的默认值）——bmc/strategy 系（120×80）、burger（180×90）、
 *   HMW（150×90）等内置模板的 `spec.sticky` 与 `ENGINE_STICKY` 不同，也要按它们
 *   自己的尺寸算容量。
 */
export function sectionRenderCapacities(spec: TemplateSpec): ReadonlyMap<string, number> {
  const titleBars = spec.titleBars !== false;
  const specSticky = spec.sticky ?? ENGINE_STICKY;
  const out = new Map<string, number>();
  for (const sec of spec.sections) {
    const w = sec.sticky?.w ?? specSticky.w;
    const h = sec.sticky?.h ?? specSticky.h;
    const perRow = sec.sticky?.perRow ?? specSticky.perRow;
    out.set(sec.name, renderStickyCapacity(sec.w, sec.h, perRow, titleBars, w, h));
  }
  return out;
}

/**
 * 围栏正文（`## 分区名` + `- 要点` 那种文本，`templateToModel`/`parseTemplateText`
 * 认识的格式）里，把每个分区下的要点行截到 `capacities` 给的真实渲染容量——
 * 超出的行整行丢弃，不改动其它任何内容（表头 `字段: 值` 行、未知分区名、
 * 找不到容量信息的分区都原样保留）。
 *
 * 只在遇到 `## 分区名` 标题时切换「当前分区」、遇到空行/新标题时重置计数——
 * 与引擎自己的 `parseTemplateText` 认的是同一套边界（`##` 开头即标题，`-`/`*`
 * 开头即要点），但这里不需要处理表头 `字段: 值` 行、段落续行这些细节，因为它们
 * 从不计入容量、也从不被丢弃。
 */
export function capFenceBulletsToCapacity(
  fenceBody: string, capacities: ReadonlyMap<string, number>,
): string {
  const lines = fenceBody.split("\n");
  const out: string[] = [];
  let current: string | null = null;
  let cap: number | null = null;
  let count = 0;
  for (const raw of lines) {
    const trimmed = raw.trim();
    const heading = /^##\s*(.+)$/.exec(trimmed);
    if (heading) {
      current = heading[1]!.trim();
      cap = capacities.get(current) ?? null;
      count = 0;
      out.push(raw);
      continue;
    }
    const bullet = /^[-*]\s+/.exec(trimmed);
    if (bullet && current !== null && cap !== null) {
      count += 1;
      if (count > cap) continue; // 超出这个分区的真实渲染容量——整行丢弃，不画。
    }
    out.push(raw);
  }
  return out.join("\n");
}
