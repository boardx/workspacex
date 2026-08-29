/**
 * 用户研究类工作坊模板（声明式 TemplateSpec，引擎见 template-engine.ts）：
 *  - empathy            同理心地图
 *  - jtbd               待完成工作画布
 *  - journey-map        用户旅程图
 *  - value-proposition  价值主张画布
 *  - adlib              价值主张宣言
 *  - hmw                HMW 问题陈述
 */
import { registerTemplate } from './template-engine';


const INK_SOFT = '#4b5563';

// ---------------------------------------------------------------------------
// 同理心地图 Empathy Map — 经典 X 型五区，可用区 x 60..1580，中心 820
// ---------------------------------------------------------------------------
registerTemplate({
  key: 'empathy',
  pdfPage: 4,
  title: '同理心地图 Empathy Map',
  // Per the printed template, the X layout reads: Think&Feel on top, Hear
  // left, See right, Say&Do at the BOTTOM of the X (not the middle), with
  // Pains/Gains as a separate band below.
  sections: [
    { name: '想的与感受到的', x: 820, y: 200, w: 700, h: 200 },
    { name: '听到的', x: 400, y: 450, w: 600, h: 220 },
    { name: '看到的', x: 1240, y: 450, w: 600, h: 220 },
    { name: '说的与做的', x: 820, y: 690, w: 700, h: 200 },
    { name: '痛点', x: 440, y: 920, w: 720, h: 180 },
    { name: '收益', x: 1200, y: 920, w: 720, h: 180 },
  ],
  decorations: [
    {
      id: 'empathy-user-circle',
      label: '',
      shape: 'circle',
      x: 820,
      y: 450,
      width: 90,
      height: 90,
      data: { color: '#ffffff', stroke: INK_SOFT },
    },
    {
      id: 'empathy-user-label',
      label: '👤 用户',
      shape: 'text',
      x: 820,
      y: 450,
      width: 80,
      height: 20,
      data: { fontSize: 13, bold: true, color: INK_SOFT },
    },
  ],
});

// ---------------------------------------------------------------------------
// 待完成工作画布 Jobs to be Done Canvas
// ---------------------------------------------------------------------------
registerTemplate({
  key: 'jtbd',
  pdfPage: 5,
  title: '待完成工作画布 Jobs to be Done Canvas',
  fields: ['执行者', '决策者', '付费者', '关键约束'],
  fieldsPerRow: 2,
  headerRect: { x: 820, y: 105, w: 1520, h: 110 },
  sections: [
    { name: '情境触发', x: 313, y: 320, w: 480, h: 300 },
    { name: '核心任务', x: 819, y: 320, w: 480, h: 300 },
    { name: '期望成果', x: 1325, y: 320, w: 480, h: 300 },
    { name: '内在驱动', x: 313, y: 680, w: 480, h: 300 },
    { name: '痛点阻力', x: 819, y: 680, w: 480, h: 300 },
    { name: '成功标准', x: 1325, y: 680, w: 480, h: 300 },
  ],
});

// ---------------------------------------------------------------------------
// 用户旅程图 User Journey Map — x 轴固定 5 个阶段（Phase 1~5），左端色块标识各泳道
// ---------------------------------------------------------------------------
// 2026-08-29 改版：旧版把"旅程阶段"也当成一条普通泳道——阶段名和下面四条泳道的
// 便利贴之间没有任何数据关联，列分隔线只是画出来的装饰，同一列里放的内容其实互不
// 相干（人类反馈「x轴应该分为若干阶段，每个阶段有不同的内容」）。改版把 5 个阶段
// 做成表头字段（`fields`），下面 4 条泳道各自按阶段拆成 5 个独立分区
// （如「行为 · 阶段1」…「行为 · 阶段5」），阶段列因此是**结构性的**：同一列的
// 内容天然属于同一个阶段，而不是靠人眼对齐虚线。
//
// Rows are tall enough (h:220) to stack TWO rows of stickies before the
// geometric section-membership check could misfire on export (the earlier
// h:150 rows only fit a single sticky row, so a second one would spill
// outside the box and round-trip into the wrong row — see the MVP bandaid
// fix for the same class of bug).
const JOURNEY_ROW_H = 220;
const JOURNEY_PHASES = ['阶段1', '阶段2', '阶段3', '阶段4', '阶段5'];
const JOURNEY_CATEGORY_ROWS = [
  { name: '行为', y: 410 },
  { name: '触点', y: 650 },
  { name: '痛点', y: 890 },
  { name: '机会', y: 1130 },
];
const JOURNEY_HEADER = { name: '旅程阶段', y: 170 };
const JOURNEY_BOX = { x: 895, w: 1370 };
const JOURNEY_STICKY = { w: 200, h: 60, perRow: 1 };

// Column `c` (0-based, 0..4) center x — same left-edge/gap math for the
// header cells, the body phase-columns, and the divider lines, so all three
// line up pixel-for-pixel.
const JOURNEY_COL_STEP = JOURNEY_STICKY.w + 42;
const JOURNEY_LEFT_EDGE = JOURNEY_BOX.x - JOURNEY_BOX.w / 2 + 14;
function journeyColCenterX(c: number): number {
  return JOURNEY_LEFT_EDGE + c * JOURNEY_COL_STEP + JOURNEY_COL_STEP / 2;
}
// Divider x for the boundary AFTER column `c` (0-based, c from 0 to
// perRow-2) — the midpoint between column c and c+1's centers.
function journeyColDividerX(c: number): number {
  return (journeyColCenterX(c) + journeyColCenterX(c + 1)) / 2;
}

const journeyGridTop = JOURNEY_HEADER.y - JOURNEY_ROW_H / 2;
const journeyGridBottom =
  JOURNEY_CATEGORY_ROWS[JOURNEY_CATEGORY_ROWS.length - 1]!.y + JOURNEY_ROW_H / 2;

registerTemplate({
  key: 'journey-map',
  pdfPage: 6,
  title: '用户旅程图 User Journey Map',
  // 阶段名放在表头（每列一个短文本），正文泳道靠左端色块标注行名，所以框内标题条禁用。
  titleBars: false,
  fields: JOURNEY_PHASES,
  fieldsPerRow: JOURNEY_PHASES.length,
  headerRect: { x: JOURNEY_BOX.x, y: JOURNEY_HEADER.y, w: JOURNEY_BOX.w, h: JOURNEY_ROW_H },
  // 4 条泳道 × 5 个阶段 = 20 个独立分区，同一阶段的内容天然落在同一列。
  sections: JOURNEY_CATEGORY_ROWS.flatMap((r) =>
    JOURNEY_PHASES.map((phase, c) => ({
      name: `${r.name} · ${phase}`,
      x: journeyColCenterX(c),
      y: r.y,
      w: JOURNEY_STICKY.w + 30,
      h: JOURNEY_ROW_H,
    })),
  ),
  decorations: [
    ...[JOURNEY_HEADER, ...JOURNEY_CATEGORY_ROWS].flatMap((r, i) => [
      {
        id: `journey-lane-${i}`,
        label: '',
        shape: 'rect' as const,
        x: 132,
        y: r.y,
        width: 145,
        height: JOURNEY_ROW_H,
        data: { locked: true, color: i === 0 ? '#f1f5f9' : '#e2e8f0', stroke: '#1f2937' },
      },
      {
        id: `journey-lane-label-${i}`,
        label: r.name,
        shape: 'text' as const,
        x: 132,
        y: r.y,
        width: 130,
        height: 40,
        data: { locked: true, fontSize: 14, bold: true, color: '#1f2937' },
      },
    ]),
    // Stage-column dividers spanning the header + every lane, so the journey
    // visually reads as a grid of (stage × lane) cells rather than plain stripes.
    ...Array.from({ length: JOURNEY_PHASES.length - 1 }, (_, c) => ({
      id: `journey-col-${c}`,
      label: '',
      shape: 'rect' as const,
      x: journeyColDividerX(c),
      y: (journeyGridTop + journeyGridBottom) / 2,
      width: 1.5,
      height: journeyGridBottom - journeyGridTop,
      data: { locked: true, color: '#cbd5e1', stroke: 'transparent' },
    })),
  ],
  sticky: JOURNEY_STICKY,
});

// ---------------------------------------------------------------------------
// 价值主张画布 Value Proposition Canvas
// ---------------------------------------------------------------------------
registerTemplate({
  key: 'value-proposition',
  pdfPage: 7,
  title: '价值主张画布 Value Proposition Canvas',
  // Print-friendly revision: two aligned 3-row columns (product side left,
  // customer side right) — the big square/circle art was dropped in the
  // plain-content-box direction; the fit arrow stays in the gutter.
  sections: [
    { name: '收益创造', x: 425, y: 240, w: 730, h: 220 },
    { name: '痛点缓解', x: 425, y: 480, w: 730, h: 220 },
    { name: '产品与服务', x: 425, y: 720, w: 730, h: 220 },
    { name: '用户任务', x: 1215, y: 240, w: 730, h: 220 },
    { name: '收益', x: 1215, y: 480, w: 730, h: 220 },
    { name: '痛点', x: 1215, y: 720, w: 730, h: 220 },
  ],
  decorations: [
    {
      id: 'vp-fit-arrow',
      label: '⇄',
      shape: 'text',
      x: 820,
      y: 480,
      width: 60,
      height: 40,
      data: { fontSize: 34, color: INK_SOFT },
    },
  ],
});

// ---------------------------------------------------------------------------
// 价值主张宣言 Ad-Lib Value Proposition
// ---------------------------------------------------------------------------
registerTemplate({
  key: 'adlib',
  pdfPage: 8,
  title: '价值主张宣言 Ad-Lib Value Proposition',
  sections: [
    { name: '我们的', x: 440, y: 210, w: 720, h: 200 },
    { name: '帮助', x: 1200, y: 210, w: 720, h: 200 },
    { name: '想要实现', x: 820, y: 430, w: 1480, h: 130 },
    { name: '减少或避免', x: 440, y: 630, w: 720, h: 200 },
    { name: '提升或赋能', x: 1200, y: 630, w: 720, h: 200 },
    { name: '竞争对手价值主张', x: 820, y: 850, w: 1480, h: 130 },
  ],
  // Connector words from the printed Ad-Lib sentence frame.
  decorations: [
    {
      id: 'adlib-by',
      label: '通过 by',
      shape: 'text',
      x: 820,
      y: 517,
      width: 100,
      height: 20,
      data: { fontSize: 13, bold: true, color: INK_SOFT },
    },
    {
      id: 'adlib-unlike',
      label: '而非 unlike',
      shape: 'text',
      x: 160,
      y: 767,
      width: 120,
      height: 20,
      data: { fontSize: 13, bold: true, color: INK_SOFT, align: 'left' },
    },
  ],
});

// ---------------------------------------------------------------------------
// HMW 问题陈述 How Might We Statement — 8 想法格统一 indigo
// ---------------------------------------------------------------------------
registerTemplate({
  key: 'hmw',
  pdfPage: 14,
  title: 'HMW 问题陈述 How Might We Statement',
  fields: ['我们可以如何', '为给', '以便'],
  fieldsPerRow: 3,
  headerRect: { x: 820, y: 110, w: 1520, h: 120 },
  sections: [
    { name: '想法1', x: 250, y: 350, w: 360, h: 240 },
    { name: '想法2', x: 630, y: 350, w: 360, h: 240 },
    { name: '想法3', x: 1010, y: 350, w: 360, h: 240 },
    { name: '想法4', x: 1390, y: 350, w: 360, h: 240 },
    { name: '想法5', x: 250, y: 620, w: 360, h: 240 },
    { name: '想法6', x: 630, y: 620, w: 360, h: 240 },
    { name: '想法7', x: 1010, y: 620, w: 360, h: 240 },
    { name: '想法8', x: 1390, y: 620, w: 360, h: 240 },
  ],
  sectionColors: [0, 0, 0, 0, 0, 0, 0, 0],
  sticky: { w: 150, h: 90, perRow: 2 },
});

// ---------------------------------------------------------------------------
// 示例文档（显示名 → 完整 markdown）
// ---------------------------------------------------------------------------
export const USER_SAMPLES: Record<string, string> = {
  '同理心地图': `# 同理心地图示例

\`\`\`canvas
模板: empathy

## 想的与感受到的
- 担心项目延期会影响年终绩效
- 希望能有更省心的协作方式

## 听到的
- 同事抱怨需求文档总是变来变去
- 老板强调本季度必须控制成本

## 看到的
- 竞品团队用自动化工具提升了效率
- 同行分享的协作流程比自己团队更顺畅

## 说的与做的
- 嘴上说"没问题"，实际加班赶进度
- 私下用 Excel 各自维护一份进度表

## 痛点
- 会议太多，真正做事的时间被切碎
- 跨部门沟通经常互相踢皮球

## 收益
- 一目了然的进度看板减少来回确认
- 自动提醒让关键节点不再遗漏
\`\`\`
`,
  '待完成工作画布': `# 待完成工作画布示例

\`\`\`canvas
模板: jtbd
执行者: 一线运营专员
决策者: 运营总监
付费者: 公司预算部门
关键约束: 每月工具预算不超过5000元

## 情境触发
- 每周一要向管理层汇报运营数据
- 活动上线前需要临时拉取用户名单

## 核心任务
- 快速汇总多渠道数据生成周报
- 按标签筛选目标用户并导出

## 期望成果
- 一份可以直接汇报的数据看板
- 用户名单导出即可用，无需二次清洗

## 内在驱动
- 希望在管理层面前显得专业可靠
- 不想再因为数据出错被追责

## 痛点阻力
- 各渠道数据格式不统一，手工对齐费时
- 临时取数经常要等技术同事排期

## 成功标准
- 周报制作时间从4小时缩短到1小时
- 数据口径全组统一，不再互相对不上
\`\`\`
`,
  '用户旅程图': `# 用户旅程图示例

\`\`\`canvas
模板: journey-map
阶段1: 发现需求
阶段2: 对比选型
阶段3: 首次使用
阶段4: 持续使用
阶段5: 推荐他人

## 行为 · 阶段1
- 在搜索引擎查找解决方案

## 行为 · 阶段2
- 试用三款竞品并记录感受

## 触点 · 阶段1
- 行业社群里的推荐帖

## 触点 · 阶段2
- 销售顾问的在线咨询

## 痛点 · 阶段1
- 不确定自己的场景是否适用

## 痛点 · 阶段3
- 注册流程要填的信息太多

## 机会 · 阶段3
- 首次使用即可看到可量化的效果

## 机会 · 阶段5
- 提供裂变奖励，鼓励老用户拉新
\`\`\`
`,
  '价值主张画布': `# 价值主张画布示例

\`\`\`canvas
模板: value-proposition

## 收益创造
- 自动生成结构化会议纪要
- 一键分发给缺席同事

## 痛点缓解
- 免去手工整理录音的重复劳动
- 减少因记录疏漏导致的返工

## 产品与服务
- 一站式会议纪要自动生成工具
- 支持多语言实时转写

## 用户任务
- 开会时同步记录关键结论
- 会后向缺席同事同步要点

## 收益
- 会议纪要产出时间缩短到几分钟
- 关键决策可追溯、可检索

## 痛点
- 边开会边记笔记顾此失彼
- 录音回听整理耗时太长
\`\`\`
`,
  '价值主张宣言': `# 价值主张宣言示例

\`\`\`canvas
模板: adlib

## 我们的
- 智能排班助手
- SaaS 订阅服务

## 帮助
- 连锁餐饮门店的值班经理
- 50人以下的零售团队

## 想要实现
- 十分钟内排出下周全员班表
- 高峰时段人手始终充足

## 减少或避免
- 人工排班反复修改的沟通成本
- 因人手不足导致的服务质量下滑

## 提升或赋能
- 员工可自主换班并即时生效
- 管理者随时掌握实时排班全貌

## 竞争对手价值主张
- 传统 Excel 排班模板，免费但费时
- 通用 HR 系统自带排班，功能笨重
\`\`\`
`,
  'HMW 问题陈述': `# HMW 问题陈述示例

\`\`\`canvas
模板: hmw
我们可以如何: 简化报销流程
为给: 经常出差的销售同事
以便: 让他们把时间花在客户身上

## 想法1
- 拍照自动识别发票并填单
- 出差行程结束自动生成报销草稿

## 想法2
- 常用报销项一键复用上次记录
- 审批人超时未处理自动提醒

## 想法3
- 微信小程序随手拍随手报
- 报销状态实时推送到手机

## 想法4
- 差旅预算超支提前预警
- 常旅行程自动匹配报销模板

## 想法5
- 发票查重避免重复报销
- 报销类目智能推荐

## 想法6
- 审批链路按金额自动分级
- 高频审批人移动端一键通过

## 想法7
- 报销数据自动对接财务系统
- 月度报销报表自动生成

## 想法8
- 新人报销规则智能问答助手
- 报销异常自动标记待人工复核
\`\`\`
`,
};
