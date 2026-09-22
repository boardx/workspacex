/**
 * `/agent/team2` 落地页文案的单一事实源。同 team1（`lib/ic-review/agent-directory.ts`）
 * 的架构：不自建分析引擎，材料 + 任务书发进一条真实项目对话，由挂载了真实模型的
 * 已发布 Agent 完成。
 *
 * ⚠ `agentId` 是后端 `agent-runtime` 里这个 Agent 的真实数据库 id，**本文件不能替它
 * 造一个**——每个部署环境（本机开发库 / devapp / 生产）各自有自己的库，id 天然不跨
 * 环境通用。正常路径下这里保持 `null`：Agent 由部署期幂等补种脚本
 * （`apps/api/scripts/backfill-team2-agent.ts`，`deploy.sh` 4d3）落库，落地页运行时按
 * `name` 在本组织的能力目录里查真实 id（本仓 ad-hoc Agent 的既有做法），**不需要任何人手工
 * 回填 id，也不需要为此重新构建前端**。
 *
 * `NEXT_PUBLIC_TEAM2_AGENT_ID` 仅作为本机开发的逃生口：设了就直接用，跳过查目录。
 * 同理 `apps/api/scripts/publish-team2-agent.ts`（走 HTTP 的手工发布）保留但不再是
 * 部署路径——部署路径是上面那个 backfill 脚本。
 */
export interface RatingAgentEntry {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  readonly agentId: string | null;
  readonly skills: readonly string[];
  readonly capabilities: readonly string[];
  readonly boundaries: readonly string[];
}

export const RATING_AGENT: RatingAgentEntry = {
  slug: "team2",
  name: "投后财务项目评级 Agent",
  tagline: "上传财务报表 / 审计报告 / 访谈录音，自动生成带依据、带不确定性标注的 A–E 投后评级。",
  agentId: process.env.NEXT_PUBLIC_TEAM2_AGENT_ID ?? null,
  // 单条描述而非逐个列出 skill 名——挂哪些 skill 是发布该 Agent 时的组织配置
  // （`skill_mounts`，走 POST /capabilities/mutate），不是本仓源码里该写死的清单
  // （uc-0-5 R7；同 team1 `lib/ic-review/agent-directory.ts` 的写法）。
  skills: ["解析报表/审计报告、录音转写、沙箱确定性算分、生成 PDF/Excel 报告（具体 skill 挂载见后台发布配置）"],
  capabilities: [
    "读取上传的 Excel/PDF/PPT/Word 财务报表与审计报告，抽取营收、利润、现金流等关键字段",
    "严格按固定规则（营收体量/利润水平分档、对数增长率、现金自给月数、两条降级触发）用沙箱脚本计算分数——不用模型心算",
    "输出 A–E 评级结论卡 + 每个数值的依据（来源文件与位置）+ 不确定性标注",
    "用 pdf-create/xlsx-create 生成评级报告 PDF 与指标明细表",
  ],
  boundaries: [
    "评分公式是固定规则，不因材料措辞或语气调整；任何一步计算都必须来自真实脚本执行，不接受模型直接给出的数字",
    "字段缺失一律标注缺失，不得编造或用 0 顶替",
    "不做投资结论，只出评级与依据",
  ],
};
