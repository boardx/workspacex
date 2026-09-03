/**
 * Story & communication workshop templates, expressed as TemplateSpecs on the
 * shared canvas-template engine (see template-engine.ts for syntax/semantics):
 *
 *  - freytag        戏剧结构金字塔 Freytag's Pyramid
 *  - burger         汉堡沟通模型 Burger Communication Model
 *  - golden-circle  黄金圈法则 Golden Circle Canvas
 *  - three-lenses   三视角模型 The Three Lenses
 *  - storyboard     故事板 Storyboard
 *
 * All layout data only — the engine renders boxes, header fields, decorations
 * and stickies, and serializes stickies back to `## 段落` bullet lists.
 */
import { registerTemplate, STICKY_COLORS } from './template-engine';
import type { DiagramNode } from '../model';
import { LINE } from '../theme';

const DECOR_INK = '#4b5563';

// ---------------------------------------------------------------------------
// 1. 戏剧结构金字塔 Freytag's Pyramid
// ---------------------------------------------------------------------------

registerTemplate({
  key: 'freytag',
  pdfPage: 11,
  title: "戏剧结构金字塔 Freytag's Pyramid",
  sections: [
    { name: '高光点', x: 820, y: 190, w: 490, h: 170 },
    { name: '情节演进', x: 305, y: 400, w: 490, h: 170 },
    { name: '结束', x: 1335, y: 400, w: 490, h: 170 },
    { name: '开场', x: 305, y: 610, w: 490, h: 170 },
    { name: '冲突', x: 820, y: 610, w: 490, h: 170 },
    { name: '收尾', x: 1335, y: 610, w: 490, h: 170 },
    { name: '角色设定', x: 435, y: 830, w: 750, h: 140 },
    { name: '故事主题', x: 1205, y: 830, w: 750, h: 140 },
  ],
});

// ---------------------------------------------------------------------------
// 2. 汉堡沟通模型 Burger Communication Model
// ---------------------------------------------------------------------------

registerTemplate({
  key: 'burger',
  pdfPage: 12,
  title: '汉堡沟通模型 Burger Communication Model',
  sections: [
    { name: '开场引入', x: 820, y: 160, w: 1520, h: 150 },
    { name: '核心洞察 WHY', x: 820, y: 330, w: 1520, h: 150 },
    { name: '实现路径 HOW', x: 820, y: 500, w: 1520, h: 150 },
    { name: '解决方案 WHAT', x: 820, y: 670, w: 1520, h: 150 },
    { name: '行动闭环', x: 820, y: 840, w: 1520, h: 150 },
  ],
  sticky: { w: 180, h: 90, perRow: 4 },
});

// ---------------------------------------------------------------------------
// 3. 黄金圈法则 Golden Circle Canvas
// ---------------------------------------------------------------------------

registerTemplate({
  key: 'golden-circle',
  pdfPage: 15,
  title: '黄金圈法则 Golden Circle Canvas',
  sections: [
    { name: 'WHY', x: 820, y: 210, w: 1520, h: 230 },
    { name: 'HOW', x: 820, y: 460, w: 1520, h: 230 },
    { name: 'WHAT', x: 820, y: 710, w: 1520, h: 230 },
  ],
  sticky: { w: 170, h: 88, perRow: 4 },
});

// ---------------------------------------------------------------------------
// 4. 三视角模型 The Three Lenses
// ---------------------------------------------------------------------------

registerTemplate({
  key: 'three-lenses',
  pdfPage: 16,
  title: '三视角模型 The Three Lenses',
  sections: [
    { name: '人本期望 Desirability', x: 820, y: 210, w: 1520, h: 230 },
    { name: '技术可行 Feasibility', x: 820, y: 460, w: 1520, h: 230 },
    { name: '商业可行 Viability', x: 820, y: 710, w: 1520, h: 230 },
  ],
  sticky: { w: 165, h: 88, perRow: 4 },
});

// ---------------------------------------------------------------------------
// 5. 故事板 Storyboard
// ---------------------------------------------------------------------------

registerTemplate({
  key: 'storyboard',
  pdfPage: 17,
  title: '故事板 Storyboard',
  fields: ['故事主角', '故事主题'],
  fieldsPerRow: 2,
  // issue #2575: was x:820 w:1520 — 28px wider than the section grid below
  // (73..1565, i.e. x:819 w:1492), so the header band visibly overhung the
  // 3-column card grid on both edges. Match the grid's outer bounds exactly.
  headerRect: { x: 819, y: 105, w: 1492, h: 100 },
  sections: [
    { name: '1 开场', x: 313, y: 330, w: 480, h: 320, stickyColor: STICKY_COLORS.yellow },
    { name: '2 冲突', x: 819, y: 330, w: 480, h: 320, stickyColor: STICKY_COLORS.pink },
    { name: '3 情节演进', x: 1325, y: 330, w: 480, h: 320, stickyColor: STICKY_COLORS.green },
    { name: '4 高光点', x: 313, y: 690, w: 480, h: 320, stickyColor: STICKY_COLORS.blue },
    { name: '5 结束', x: 819, y: 690, w: 480, h: 320, stickyColor: STICKY_COLORS.yellow },
    { name: '6 收尾', x: 1325, y: 690, w: 480, h: 320, stickyColor: STICKY_COLORS.pink },
  ],
});

// ---------------------------------------------------------------------------
// Sample documents (显示名 → 完整 markdown 文档)
// ---------------------------------------------------------------------------

const FENCE = '```';

export const STORY_SAMPLES: Record<string, string> = {
  '戏剧结构金字塔': `# 戏剧结构金字塔

${FENCE}canvas
模板: freytag

## 开场
- 小镇青年林晓在旧书店打工，日子平静
- 一封没有署名的旧信混进了回收书箱

## 冲突
- 信中提到的地址已在十年前被拆除
- 林晓的追查触怒了不愿被提起的老邻居

## 情节演进
- 林晓走访镇上老人拼凑信件的来龙去脉
- 一张泛黄的合影揭开两家人的旧日纠葛

## 高光点
- 林晓在废弃剧院当众读出信的全文
- 尘封二十年的误会在掌声中解开

## 结束
- 两位当事人时隔多年重新握手言和
- 旧书店挂上了那封信的复印件

## 收尾
- 林晓把这段经历写成了一本小册子
- 小镇的年轻人开始主动追寻自家往事

## 角色设定
- 林晓：好奇心强、心思细腻的旧书店店员
- 老邻居：嘴硬心软，守着秘密多年的手艺人

## 故事主题
- 真相也许迟到，但从不缺席
- 平凡人也有改写命运的勇气
${FENCE}
`,
  '汉堡沟通模型': `# 汉堡沟通模型

${FENCE}canvas
模板: burger

## 开场引入
- 上季度客服平均响应时长同比上升 40%
- 客户满意度首次跌破年度目标线

## 核心洞察 WHY
- 我们相信好的服务体验是复购的第一驱动力
- 响应速度是客户感知服务质量的核心指标

## 实现路径 HOW
- 用智能分流把简单问题交给机器人处理
- 复杂工单自动路由给最熟悉该客户的坐席

## 解决方案 WHAT
- 上线智能工单分流系统
- 组建 7x24 小时轮值客服小组

## 行动闭环
- 下周试点两条产品线，两周后复盘数据
- 每月同步响应时长与满意度看板给全员
${FENCE}
`,
  '黄金圈法则': `# 黄金圈法则

${FENCE}canvas
模板: golden-circle

## WHY
- 让每个孩子都能平等地获得优质教育
- 相信学习的差距不应由出生地决定

## HOW
- 用 AI 把名师课程拆解成个性化学习路径
- 与县域学校共建双师课堂

## WHAT
- 一款自适应练习 App
- 面向乡村教师的暑期培训营
${FENCE}
`,
  '三视角模型': `# 三视角模型

${FENCE}canvas
模板: three-lenses

## 人本期望 Desirability
- 独居老人希望一键就能联系到子女
- 子女想随时了解父母的居家安全状况

## 技术可行 Feasibility
- 毫米波雷达可无感监测跌倒动作
- 现有网关方案支持离线报警

## 商业可行 Viability
- 与社区养老服务打包成按月订阅
- 硬件成本可在 12 个月内摊薄回收
${FENCE}
`,
  '故事板': `# 故事板

${FENCE}canvas
模板: storyboard
故事主角: 快递员老周
故事主题: 城市角落的温暖相遇

## 1 开场
- 清晨五点，老周开始往车里装件
- 车厢里塞满了双十一的包裹

## 2 冲突
- 暴雨突至，部分包裹被淋湿
- 客户在电话里连声催促

## 3 情节演进
- 老周绕路买来塑料布重新打包受潮件
- 途中电动车没电，只能推车前行

## 4 高光点
- 独居老人为他撑伞，递上一杯姜茶
- 老周把最后一单亲手送到床边

## 5 结束
- 老人在包裹里塞了一张手写感谢卡
- 老周收车时看到卡片，笑着揣进怀里

## 6 收尾
- 第二天他特意绕路去看了看老人
- 这条巷子从此成了他最愿意跑的一单
${FENCE}
`,
};
