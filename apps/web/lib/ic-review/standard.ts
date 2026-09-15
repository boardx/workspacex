/**
 * 上会标准清单 IC-1…IC-8 —— 唯一事实源。
 *
 * MVP 架构（2026-09-15 第二版）：不再喂给一个本地正则引擎，而是拼进发给真实
 * chat 后端的审阅指令（`review-prompt.ts`）。因此每条只保留「标题 + 是否阻断」，
 * 详细判据交给挂载在真实 Agent 上的模型去读懂——正则关键词匹配不是判据，
 * 模型基于条目标题理解材料是不是真的回答了这件事，才是判据。
 */
export interface StandardItem {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  /** 缺失即不具备上会条件——报告首屏需要点出阻断性缺失条数。 */
  readonly blocking: boolean;
}

export const IC_STANDARD: readonly StandardItem[] = [
  { id: "IC-1-1", category: "战略逻辑：为什么必须买", title: "战略定位：明确对应集团战略方向与业务布局", blocking: true },
  { id: "IC-1-2", category: "战略逻辑：为什么必须买", title: "市场分析：规模与增速、竞争格局及驱动成功的关键因素", blocking: true },
  { id: "IC-1-3", category: "战略逻辑：为什么必须买", title: "并购必要性：与自建等替代方案比较", blocking: true },
  { id: "IC-1-4", category: "战略逻辑：为什么必须买", title: "并购目的：获取技术/市场/客户/品牌/渠道/资源或能力等核心目标", blocking: true },
  { id: "IC-1-5", category: "战略逻辑：为什么必须买", title: "战略协同：与集团现有产业、业务、能力的协同价值", blocking: true },
  { id: "IC-1-6", category: "战略逻辑：为什么必须买", title: "时间窗口：为什么当前是实施并购的最佳时点", blocking: false },

  { id: "IC-2-1", category: "标的价值：为什么选择它", title: "核心价值：标的最核心资产（技术/人才/客户/品牌/渠道/数据/制造能力等）", blocking: true },
  { id: "IC-2-2", category: "标的价值：为什么选择它", title: "竞争优势：行业地位、技术壁垒、商业模式及成长潜力", blocking: true },
  { id: "IC-2-3", category: "标的价值：为什么选择它", title: "财务表现：收入成长性、盈利质量、资产质量、现金流质量", blocking: true },
  { id: "IC-2-4", category: "标的价值：为什么选择它", title: "团队能力：核心管理团队、关键人才及留任安排", blocking: true },
  { id: "IC-2-5", category: "标的价值：为什么选择它", title: "不可替代性：相较其他方案及其他标的的优势", blocking: false },
  { id: "IC-2-6", category: "标的价值：为什么选择它", title: "标的风险评估：①战略风险（市场/技术路线/竞争/政策）②经营风险（客户集中/盈利/供应链）", blocking: true },

  { id: "IC-3-1", category: "交易合理性：是否值得买", title: "业务尽调：市场调研与上下游头部客户访谈，验证行业天花板与真实市占率", blocking: true },
  { id: "IC-3-2", category: "交易合理性：是否值得买", title: "财税尽调：盈利质量、资产真实性、表外负债、关联交易，逐项给出解决方法与底稿支撑", blocking: true },
  { id: "IC-3-3", category: "交易合理性：是否值得买", title: "法务尽调：合规、知识产权权属、核心专利/商标纠纷、重大合同及应对策略", blocking: true },
  { id: "IC-3-4", category: "交易合理性：是否值得买", title: "人力尽调：核心管理层评分、组织架构与薪酬激励合理性、文化相容性、人才流失风险", blocking: true },
  { id: "IC-3-5", category: "交易合理性：是否值得买", title: "其他尽调：IT（数据安全/出海合规）、环境（潜在修复责任）等", blocking: false },
  { id: "IC-3-6", category: "交易合理性：是否值得买", title: "关键利益方：创始团队、现有股东、核心客户/供应商、债权人", blocking: false },
  { id: "IC-3-7", category: "交易合理性：是否值得买", title: "交易架构：交易方式/范围/支付方式/控制权安排/监管审批/资金方案", blocking: true },
  { id: "IC-3-8", category: "交易合理性：是否值得买", title: "价格合理性：估值方法与依据，须有 DCF（或交叉验证）+ 敏感性分析 + 商誉减值压力测试 + 溢价来源 + 其他潜在买家竞价分析", blocking: true },
  { id: "IC-3-9", category: "交易合理性：是否值得买", title: "交易条款：SPA/SHA/战略协同合同/技术转让授权协议等核心条款摘要与预案", blocking: true },
  { id: "IC-3-10", category: "交易合理性：是否值得买", title: "投资回报：IRR、ROIC、投资回收周期", blocking: true },
  { id: "IC-3-11", category: "交易合理性：是否值得买", title: "退出机制：极端情况下的退出方案", blocking: true },

  { id: "IC-4-1", category: "项目主人：谁对交易和整合负责", title: "交易责任主体：交易团队与业务主人的分工；对尽调数据真实性完整性、交易价格与架构合理性负责", blocking: true },
  { id: "IC-4-2", category: "项目主人：谁对交易和整合负责", title: "投后责任主体：资产归属哪个业务体系、经营第一责任人及其经营目标", blocking: true },

  { id: "IC-5-1", category: "投后整合方案：买完如何整合", title: "过渡期安排：交割前置条件清单（审批/核心人员留任/关键客户续约/TSA 及费用/数据上平台）、支付节奏挂钩", blocking: true },
  { id: "IC-5-2", category: "投后整合方案：买完如何整合", title: "百日整合：交割后百日详细计划（组织调整/客户沟通等）；含剥离须事前完整剥离预算", blocking: true },
  { id: "IC-5-3", category: "投后整合方案：买完如何整合", title: "治理体系：独立运营/深度融合/控股赋能及原因", blocking: true },
  { id: "IC-5-4", category: "投后整合方案：买完如何整合", title: "价值兑现：第一责任人的价值创造计划、路径拆解、关键里程碑、链群合约", blocking: true },

  { id: "IC-6-1", category: "投后发展目标：未来五年达到什么状态", title: "战略目标：未来 3-5 年业务定位、行业地位", blocking: true },
  { id: "IC-6-2", category: "投后发展目标：未来五年达到什么状态", title: "财务目标：标的收入/利润/利润率/市值/现金流（≥5 年）及对收购主体 ROIC/市值/分红/商誉的影响", blocking: true },
  { id: "IC-6-3", category: "投后发展目标：未来五年达到什么状态", title: "能力目标：技术平台、研发能力、生态能力、全球化能力", blocking: false },
  { id: "IC-6-4", category: "投后发展目标：未来五年达到什么状态", title: "组织目标：团队建设、人才结构及组织能力提升", blocking: false },

  { id: "IC-7-1", category: "投后经营机制：如何确保价值兑现", title: "正负向激励机制：薪酬激励/增量分红/股权期权/跟投；未达标、人才流失、整合滞后、风险失控的追责与纠偏", blocking: true },
  { id: "IC-7-2", category: "投后经营机制：如何确保价值兑现", title: "经营复盘机制：月度/季度经营复盘、预警机制、动态调整机制", blocking: true },
  { id: "IC-7-3", category: "投后经营机制：如何确保价值兑现", title: "资源保障机制：资金、技术、渠道、供应链、品牌等资源支撑方案", blocking: false },

  { id: "IC-8-1", category: "决策事项与见证性材料", title: "决策事项清单：提请投委会审批的全部决策点（估值金额、交易架构、核心条款、业绩目标等）", blocking: true },
  { id: "IC-8-2", category: "决策事项与见证性材料", title: "见证性材料：完整尽调报告、SPA 协议、估值模型底稿、领域投决会决议、立项风险提示的闭环跟踪", blocking: true },
];

export const IC_CATEGORIES: readonly string[] = Array.from(new Set(IC_STANDARD.map((i) => i.category)));
