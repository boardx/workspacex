/**
 * Strategy-workshop canvas templates (PESTEL / SWOT / BMC / MVP / Three
 * Horizons / AI Strategy / AI BMC), expressed as declarative TemplateSpecs
 * on the shared template engine (see template-engine.ts).
 *
 * Layouts follow the A0 workshop-template PDFs: usable canvas x 60..1580,
 * title at y 24, sections start around y 80 when there is no header band.
 */
import { registerTemplate } from './template-engine';


// ---------------------------------------------------------------------------
// 1. PESTEL 分析 — 3×2 grid of six factor boxes.
// ---------------------------------------------------------------------------

registerTemplate({
  key: 'pestel',
  pdfPage: 1,
  title: 'PESTEL 分析 PESTEL Analysis',
  sections: [
    { name: '政治因素', x: 290, y: 290, w: 460, h: 340 },
    { name: '经济因素', x: 780, y: 290, w: 460, h: 340 },
    { name: '社会因素', x: 1270, y: 290, w: 460, h: 340 },
    { name: '技术因素', x: 290, y: 670, w: 460, h: 340 },
    { name: '环境因素', x: 780, y: 670, w: 460, h: 340 },
    { name: '法律因素', x: 1270, y: 670, w: 460, h: 340 },
  ],
});

// ---------------------------------------------------------------------------
// 2. SWOT 分析 — four large quadrants.
// ---------------------------------------------------------------------------

registerTemplate({
  key: 'swot',
  pdfPage: 2,
  title: 'SWOT 分析 SWOT Analysis',
  sections: [
    { name: '优势', x: 430, y: 280, w: 740, h: 380 },
    { name: '劣势', x: 1190, y: 280, w: 740, h: 380 },
    { name: '机会', x: 430, y: 680, w: 740, h: 380 },
    { name: '威胁', x: 1190, y: 680, w: 740, h: 380 },
  ],
  // Center figure where the four quadrants meet, as on the printed template.
  decorations: [
    {
      id: 'swot-center',
      label: '',
      shape: 'circle',
      x: 810,
      y: 480,
      width: 70,
      height: 70,
      data: { color: '#ffffff', stroke: '#64748b' },
    },
    {
      id: 'swot-center-icon',
      label: '👥',
      shape: 'text',
      x: 810,
      y: 480,
      width: 40,
      height: 22,
      data: { fontSize: 18 },
    },
  ],
});

// ---------------------------------------------------------------------------
// 3. 商业模式画布 — classic 9-block canvas: five upper columns (three full
// height, two split top/bottom) plus two wide bottom bands.
// ---------------------------------------------------------------------------

registerTemplate({
  key: 'bmc',
  pdfPage: 9,
  title: '商业模式画布 Business Model Canvas',
  sticky: { w: 120, h: 80, perRow: 2 },
  // 伙伴/业务/资源 indigo · 价值主张 pink · 关系/渠道 sky · 客户细分 green ·
  // 收入/成本 amber (semantic grouping, VISUAL-SPEC §3).
  sectionColors: [0, 0, 0, 1, 4, 4, 2, 3, 3],
  sections: [
    { name: '关键合作伙伴', x: 208, y: 350, w: 296, h: 560 },
    { name: '关键业务', x: 512, y: 210, w: 296, h: 280 },
    { name: '关键资源', x: 512, y: 490, w: 296, h: 280 },
    { name: '价值主张', x: 816, y: 350, w: 296, h: 560 },
    { name: '客户关系', x: 1120, y: 210, w: 296, h: 280 },
    { name: '渠道', x: 1120, y: 490, w: 296, h: 280 },
    { name: '客户细分', x: 1424, y: 350, w: 296, h: 560 },
    { name: '收入来源', x: 430, y: 710, w: 740, h: 120 },
    { name: '成本结构', x: 1190, y: 710, w: 740, h: 120 },
  ],
});

// ---------------------------------------------------------------------------
// 4. MVP 实验画布 — two 3-box rows sandwiching two full-width bands.
// ---------------------------------------------------------------------------

registerTemplate({
  key: 'mvp',
  pdfPage: 10,
  title: 'MVP 实验画布 MVP Experiment Canvas',
  // Standard 3-column grid (w 490, centers 305/820/1335) so row edges align
  // exactly with the full-width bands at 60..1580 — print-friendly.
  sections: [
    { name: '早期客户', x: 305, y: 190, w: 490, h: 220 },
    { name: '未满足需求', x: 820, y: 190, w: 490, h: 220 },
    { name: '价值主张', x: 1335, y: 190, w: 490, h: 220 },
    // Full-width bars must be tall enough to CONTAIN a 92px sticky's center
    // (roundtrip-guard caught silent section migration at h=90).
    { name: '愿景与假设', x: 820, y: 390, w: 1520, h: 150 },
    { name: '核心用户旅程', x: 820, y: 560, w: 1520, h: 150 },
    { name: '实验设计', x: 305, y: 780, w: 490, h: 260 },
    { name: '早期关键指标', x: 820, y: 780, w: 490, h: 260 },
    { name: '实验结果与下一步', x: 1335, y: 780, w: 490, h: 260 },
  ],
});

// ---------------------------------------------------------------------------
// 5. 三地平线模型 — three tall focus columns on the left, three horizon
// bands on the right, with horizon captions above the columns.
// ---------------------------------------------------------------------------

registerTemplate({
  key: 'three-horizons',
  pdfPage: 13,
  title: '三地平线模型 Three Horizons Framework',
  // Re-laid out: three wide focus columns on the left (top/bottom aligned
  // with the three horizon bands on the right), no caption decorations —
  // the horizon bands already carry the year ranges.
  sections: [
    { name: 'H1 焦点领域', x: 210, y: 390, w: 300, h: 580 },
    { name: 'H2 焦点领域', x: 530, y: 390, w: 300, h: 580 },
    { name: 'H3 焦点领域', x: 850, y: 390, w: 300, h: 580 },
    { name: '第一地平线（1-3年）', x: 1310, y: 190, w: 540, h: 180 },
    { name: '第二地平线（3-5年）', x: 1310, y: 390, w: 540, h: 180 },
    { name: '第三地平线（5年以上）', x: 1310, y: 590, w: 540, h: 180 },
  ],
});

// ---------------------------------------------------------------------------
// 6. AI 战略画布 — same 5-column grid as the BMC, AI-strategy blocks.
// ---------------------------------------------------------------------------

registerTemplate({
  key: 'ai-strategy',
  pdfPage: 18,
  title: 'AI 战略画布 AI Strategy Canvas',
  sticky: { w: 120, h: 80, perRow: 2 },
  // 资源/角色/调性 indigo · 背景信息 pink · 定位/产品 sky · 目标受众 green ·
  // 规则/需求 amber (mirrors the BMC semantic grouping).
  sectionColors: [0, 0, 0, 1, 4, 4, 2, 3, 3],
  sections: [
    { name: '资源配置', x: 208, y: 350, w: 296, h: 560 },
    { name: 'AI角色定位', x: 512, y: 210, w: 296, h: 280 },
    { name: '风格调性', x: 512, y: 490, w: 296, h: 280 },
    { name: '背景信息', x: 816, y: 350, w: 296, h: 560 },
    { name: '企业定位', x: 1120, y: 210, w: 296, h: 280 },
    { name: '产品服务', x: 1120, y: 490, w: 296, h: 280 },
    { name: '目标受众', x: 1424, y: 350, w: 296, h: 560 },
    { name: '规则', x: 430, y: 710, w: 740, h: 120 },
    { name: '需求与目标', x: 1190, y: 710, w: 740, h: 120 },
  ],
});

// ---------------------------------------------------------------------------
// 7. AI 商业模型画布 — six upper columns (three full height, three split
// top/bottom) plus three bottom bands.
// ---------------------------------------------------------------------------

registerTemplate({
  key: 'ai-bmc',
  pdfPage: 19,
  title: 'AI 商业模型画布 The AI Business Model Canvas',
  sticky: { w: 104, h: 76, perRow: 2 },
  // 伙伴/输入/输出 indigo · 价值主张 pink · 技术/训练 sky · 用户与客户 green ·
  // 资源考量 indigo · 渠道 sky · 成本/收入/利益相关方 amber.
  sectionColors: [0, 0, 0, 1, 4, 4, 2, 0, 4, 3, 3, 3],
  sections: [
    { name: '核心合作伙伴', x: 185, y: 350, w: 246, h: 560 },
    { name: '输入', x: 438, y: 210, w: 246, h: 280 },
    { name: '输出', x: 438, y: 490, w: 246, h: 280 },
    { name: '价值主张', x: 691, y: 350, w: 246, h: 560 },
    { name: '技术能力', x: 944, y: 210, w: 246, h: 280 },
    { name: '训练人员', x: 944, y: 490, w: 246, h: 280 },
    { name: '用户与客户', x: 1197, y: 350, w: 246, h: 560 },
    { name: '资源考量', x: 1450, y: 210, w: 246, h: 280 },
    { name: '渠道', x: 1450, y: 490, w: 246, h: 280 },
    { name: '成本', x: 313, y: 710, w: 506, h: 120 },
    { name: '收入来源', x: 819, y: 710, w: 506, h: 120 },
    { name: '利益相关方', x: 1325, y: 710, w: 506, h: 120 },
  ],
});

// ---------------------------------------------------------------------------
// Sample documents (display name → full markdown with a ```canvas fence).
// ---------------------------------------------------------------------------

export const STRATEGY_SAMPLES: Record<string, string> = {
  'PESTEL 分析': `# 智能家电出海 PESTEL 分析

\`\`\`canvas
模板: pestel

## 政治因素
- 双碳政策推动家电能效标准升级
- 出口目的国关税政策存在不确定性

## 经济因素
- 铜铝等原材料价格上涨挤压毛利
- 三四线城市消费升级带来增量市场

## 社会因素
- 年轻家庭更看重颜值与智能化体验
- 老龄化催生适老化家电需求

## 技术因素
- AIoT 平台成熟降低智能化改造成本
- 竞品加速布局边缘计算能力

## 环境因素
- 欧盟碳边境税提高出口合规成本
- 消费者对可回收包装接受度提升

## 法律因素
- 多国数据本地化要求增加合规投入
- 产品能效认证标准逐年收紧
\`\`\`
`,
  'SWOT 分析': `# 连锁家居品牌 SWOT 分析

\`\`\`canvas
模板: swot

## 优势
- 自有工厂供应链响应速度快
- 线下门店覆盖 300 余个城市

## 劣势
- 品牌形象老化，年轻客群渗透不足
- 线上运营团队规模薄弱

## 机会
- 以旧换新补贴刺激置换需求
- 东南亚新兴市场渗透率仍低

## 威胁
- 电商平台白牌低价竞争加剧
- 原材料与物流成本持续上涨
\`\`\`
`,
  '商业模式画布': `# 智能家居服务商 商业模式画布

\`\`\`canvas
模板: bmc

## 关键合作伙伴
- 智能硬件代工厂
- 家装公司与设计师工作室

## 关键业务
- 全屋智能方案设计与安装
- 售后运维与设备升级

## 关键资源
- 自研 IoT 控制平台
- 全国安装服务网络

## 价值主张
- 一站式全屋智能解决方案
- 30 分钟上门安装与调试服务

## 客户关系
- 专属安装顾问一对一服务
- 会员社群持续答疑与优惠

## 渠道
- 天猫京东品牌旗舰店
- 家装公司渠道合作分成

## 客户细分
- 一二线城市新装修家庭
- 中小型民宿与公寓业主

## 收入来源
- 硬件销售与安装服务费
- 会员订阅与增值服务

## 成本结构
- 硬件采购与生产成本
- 安装网络与客服团队薪酬
\`\`\`
`,
  'MVP 实验画布': `# 烘焙供应链 SaaS MVP 实验画布

\`\`\`canvas
模板: mvp

## 早期客户
- 连锁咖啡店区域店长
- 独立烘焙工作室主理人

## 未满足需求
- 多门店原料库存难以统一管理
- 供应商比价耗时且缺乏历史数据

## 价值主张
- 一键比价并自动生成采购单
- 库存预警减少临期原料浪费

## 愿景与假设
- 假设门店愿意为节省的采购时间付费
- 愿景是成为烘焙行业的采购操作系统

## 核心用户旅程
- 注册门店信息并接入现有供应商
- 每周查看比价建议并一键下单

## 实验设计
- 两周免费试用后逐一电话回访
- A/B 测试两种定价页文案

## 早期关键指标
- 试用转付费率不低于 20%
- 周活跃门店数持续增长

## 实验结果与下一步
- 试用转化率达到 24%，超出预期
- 下一步接入更多区域供应商 SKU
\`\`\`
`,
  '三地平线模型': `# 社区零售集团 三地平线规划

\`\`\`canvas
模板: three-horizons

## H1 焦点领域
- 优化现有门店坪效与损耗
- 提升会员复购率至 45%

## H2 焦点领域
- 自有品牌供应链对外输出
- 前置仓即时配送试点

## H3 焦点领域
- 无人门店网络规模化
- 社区生活服务平台生态

## 第一地平线（1-3年）
- 巩固现有门店盈利能力
- 完成会员数字化改造

## 第二地平线（3-5年）
- 供应链能力对外输出成为新业务线
- 前置仓覆盖核心城市 80% 社区

## 第三地平线（5年以上）
- 无人零售网络规模化复制
- 构建社区生活服务生态平台
\`\`\`
`,
  'AI 战略画布': `# 外贸 SaaS 客服助手 AI 战略画布

\`\`\`canvas
模板: ai-strategy

## 资源配置
- 自研跨境行业语料库
- 客服团队人工审核通道

## AI角色定位
- 专业而亲切的外贸顾问
- 主动提示合规与关税风险

## 风格调性
- 用词严谨但语气友好
- 拒绝提供未经核实的法律建议

## 背景信息
- 服务覆盖 30 余个出口目的国
- 涵盖关税、认证、物流常见问答

## 企业定位
- 面向中小外贸企业的 SaaS 服务商
- 深耕跨境电商行业十年

## 产品服务
- 多语言智能客服机器人
- 询盘自动分类与优先级排序

## 目标受众
- 中小外贸企业客服团队
- 独立站与跨境电商运营人员

## 规则
- 涉及报价的问题始终转人工确认
- 不主动承诺交货时间

## 需求与目标
- 客服首次响应时间缩短一半
- 询盘转化率提升 15%
\`\`\`
`,
  'AI 商业模型画布': `# 多语言电商文案引擎 AI 商业模型画布

\`\`\`canvas
模板: ai-bmc

## 核心合作伙伴
- 电商平台开放接口团队
- 多语言本地化审校服务商

## 输入
- 商品原始信息与图片
- 目标市场关键词库

## 输出
- 多语言商品标题与详情文案
- 广告投放素材文案

## 价值主张
- 一键生成多语言产品描述
- 人工翻译成本降低 80%

## 技术能力
- 自研行业术语微调模型
- 商品知识库向量检索

## 训练人员
- 跨境电商领域标注团队
- 多语言母语审校专家

## 用户与客户
- 跨境电商运营团队
- 外贸 SOHO 创业者

## 资源考量
- GPU 推理算力预算
- 多语言语料授权成本

## 渠道
- SaaS 官网自助订阅
- 电商 ERP 服务商联合分销

## 成本
- 模型训练与推理算力
- 人工审校与客服支持

## 收入来源
- 按生成字数阶梯计费
- 企业版按坐席订阅收费

## 利益相关方
- 电商平台规则合规团队
- 品牌方内容审核部门
\`\`\`
`,
};
