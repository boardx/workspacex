/**
 * `/agent/team4` 落地页文案的单一事实源。同 team1 第三版架构：不声明固定
 * `agentId`——`ensure-agent.ts` 在真正点「开始分析」时才按需解析/发布，跟任何
 * org admin 在后台手动建一个 Agent 是同一条真实路径。
 */
export interface PostInvestmentAgentEntry {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  readonly skills: readonly string[];
  readonly capabilities: readonly string[];
  readonly boundaries: readonly string[];
}

export const POST_INVESTMENT_AGENT: PostInvestmentAgentEntry = {
  slug: "team4",
  name: "投后管理报告 AI 生成单元",
  tagline: "投后季度/半年度编报告，把「读材料、算趋势、查外部信息、找风险」的机械负担拿走；数字有出处，结论不编造。",
  skills: ["post-investment-report-standard（投后报告标准，待发布为平台 Skill，复用 data-analysis 沙箱算派生数值）"],
  capabilities: [
    "把材料作为附件发进一条真实项目对话，由挂载的模型完成分析",
    "抽取财务与经营字段，用沙箱脚本算同比/占比/周转天数/现金跑道等派生数值——不用模型心算",
    "显性异常 / 隐性风险 / 跨文件关联三类风险分开呈现，每条带出处",
    "受限渠道（企查查/天眼查/裁判文书网/交易所/证监会/统计局）查外部信息，与材料内事实分栏呈现",
    "整理风险窗口时间轴（政策生效日/合同到期日/回购或IPO截止日/专利到期日）",
    "生成投后管理报告 PDF 与财务指标明细表 Excel",
    "在真实对话里按你的确认与分级做定向深挖（重算/拉明细/测算现金跑道缺口）",
  ],
  boundaries: [
    "不下投资/退出结论、不给评级——涉及退出条款时只列前置条件与缺口",
    "材料与外部渠道都没有的事实只能进「需核实清单」，不得进结论区",
    "不修改、不回写上传的原始材料",
  ],
};
