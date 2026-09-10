/**
 * MAAU 画布 —— 本仓新增的第 20 个内置工作坊模板（**不是上游内容**，见 VENDOR.md
 * 「本仓相对上游的改动清单」）。
 *
 * 人类直接指令（2026-09-10）：「把这个画布转译成 mermaid 的 fabricjs 的一个画布，
 * 也就是用 markdown 来表达，然后使用 fabricjs 来渲染，中间工作流要使用顺序图来渲染」。
 *
 * ## 为什么单独一个文件，而不是加进 templates-strategy.ts
 *
 * 那三个 `templates-*.ts` 是**上游逐字并入**的文件。往里加一条会把本仓改动和上游内容
 * 搅在一起，下一次回流对比时分不清哪几行是我们的。单开一个文件后，vendor 侧的改动
 * 面只剩 `diagrams/index.ts` 里的一行 `import './templates-maau'`——一行 import 比
 * 一段 60 行的模板数据好比对得多。
 *
 * ## 六个分区的名字为什么不带 ①②③
 *
 * `lookupSectionItems` 的三级兜底里，最后一级 `stripBilingualSuffix` 只剥**末尾连续的
 * 纯 ASCII token**。分区名若写成 `① 意图 Intent`，模型偷懒只写 `## 意图` 时：
 * canonical 剥完是 `①意图`、目标是 `意图`，三级全部落空 ⇒ 分区一片空白——这正是
 * issue #2576（三视角模型）的病。所以分区名一律「中文 English」双语形式，序号交给
 * 画布上的空间位置（左→右、上→下）表达。
 *
 * ## 工作流那一格放的是清单，不是图
 *
 * 顺序图是同一份 markdown 里**第二个围栏**（```mermaid sequenceDiagram），由
 * `ChatDiagramFabric` 单独渲染成一张可编辑的 fabric 图。`markdownToCanvas` 一次只渲染
 * 一个围栏（`blockIndex`，默认 0），一张画布装不下"模板 + 嵌套图"，所以这一格里放的是
 * 自动化/人工确认节点的便签清单，与那张顺序图互为文字与图。
 */
import { registerTemplate } from './template-engine';

registerTemplate({
  key: 'maau',
  title: 'MAAU 画布 Minimum Actionable Agentic Unit',
  fields: ['MAAU 名称', '一句话总结'],
  fieldsPerRow: 2,
  // 精确贴合下方 3×2 网格的外接框（73..1565）——同 issue #2575 给 storyboard 做的那处
  // 修正。用 jtbd 那份 `x:820 w:1520`（60..1580）会让表头两端各探出网格 13px。
  headerRect: { x: 819, y: 105, w: 1492, h: 110 },
  // 为什么/为谁 indigo · 谁来做 sky · 靠什么·怎么证明 amber（PALETTE_SOFT 索引）。
  sectionColors: [0, 0, 4, 4, 3, 3],
  sections: [
    { name: '意图 Intent', x: 313, y: 320, w: 480, h: 300 },
    { name: '用户 User', x: 819, y: 320, w: 480, h: 300 },
    { name: '人与 Agent 分工', x: 1325, y: 320, w: 480, h: 300 },
    { name: '工作流 Workflow', x: 313, y: 680, w: 480, h: 300 },
    { name: '上下文 Context', x: 819, y: 680, w: 480, h: 300 },
    { name: '闭环验证 Validation', x: 1325, y: 680, w: 480, h: 300 },
  ],
});
