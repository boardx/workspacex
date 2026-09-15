/**
 * `/agent/team4` 落地页文案的单一事实源。同 team1 架构：不声明固定 `agentId`——
 * `ensure-agent.ts` 在真正进入对话时才按需解析/发布，跟任何 org admin 在后台手动建
 * 一个 Agent 是同一条真实路径。
 *
 * ## 为什么每条能力承诺带一个 `evidence`
 *
 * 落地页写「能做什么」是给人看的承诺，方法论（`methodology.ts` → 内置 Skill）才是
 * Agent 真正会做的事。两份文案各写各的，就会出现"页面上承诺了同业对比、方法论里
 * 根本没教它怎么做"——用户照着承诺用，发现做不到。`evidence` 是这条承诺在方法论
 * 渲染结果里的锚点，由验收打分器（`scripts/team4-acceptance-score.mjs` 的 U2）机械
 * 核对：承诺一条，方法论里必须真有对应的那一段，否则掉分。
 *
 * 加新承诺时先在方法论里把它写成可执行的指令，再回来加这一条 + 它的 evidence；
 * 反过来（先在页面上吹、方法论回头再说）会当场红。
 */
export interface AgentCapability {
  /** 给人看的一句话承诺。 */
  readonly text: string;
  /** 这条承诺在方法论渲染结果里的锚点——打分器据此核对"承诺兑现"。 */
  readonly evidence: string;
}

export interface PostInvestmentAgentEntry {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  readonly capabilities: readonly AgentCapability[];
  readonly boundaries: readonly string[];
}

export const POST_INVESTMENT_AGENT: PostInvestmentAgentEntry = {
  slug: "team4",
  name: "投后管理报告 AI 生成单元",
  tagline: "投后季度/半年度编报告，把「读材料、算趋势、查外部信息、找风险」的机械负担拿走；数字有出处，结论不编造。",
  capabilities: [
    { text: "读 PDF / Word / Excel / PPT / 图片 / 录音材料，抽取财务与经营字段并给出逐数出处",
      evidence: "wx_document_parse" },
    { text: "用沙箱脚本算同比、资本化率、集中度、关联方价差、现金跑道与缺口月数——不用模型心算",
      evidence: "不要自己心算" },
    { text: "显性 / 隐性 / 跨文件关联三类风险分开呈现，每条带判据与原文引用",
      evidence: "哪两份材料" },
    { text: "受限渠道（企查查/天眼查/裁判文书网/交易所/证监会/统计局）查外部信息，并做可比上市公司同业对比",
      evidence: "可比上市公司同业对比" },
    { text: "整理风险窗口时间轴：政策生效日、合同到期日、回购或 IPO 截止日、专利到期日",
      evidence: "风险窗口时间轴" },
    { text: "产出投后管理报告 PDF 与财务指标明细表 Excel，并交出可逐条核对的数据来源清单",
      evidence: "数据来源清单" },
    { text: "两轮人工确认后按你的分级做定向深挖（重算 / 拉明细 / 测算跑道缺口）",
      evidence: "只做被勾选的深挖" },
  ],
  boundaries: [
    "不下投资/退出结论、不给评级——涉及退出条款时只列前置条件与缺口",
    "材料与外部渠道都没有的事实只能进「需核实清单」，不得进结论区",
    "材料自相矛盾时列出冲突双方与出处，不挑一个当既成事实往下推",
  ],
};
