/** Agent-authored synthetic fixtures only; no production/user source loading. */
export const methodScenarios = [
 {id:'S010',packId:'standard-methods',packVersion:'1.0.0',skill:'interview-synthesis',filename:'interviews.txt',
  source:'Research question R1: Is onboarding clear?\nParticipant P01, transcript T01: "The setup was clear and I finished without help."\nDuplicate copy of T01, same participant P01: "The setup was clear and I finished without help."\nParticipant P02, transcript T02: "The setup was confusing; I could not find the next step."\nNo demographic information was collected.\n',
  prompt:'根据附件访谈回答研究问题R1，选择适合技能，生成并发布report.md：主题、反对证据、原句来源与去重后的参与者计数。重复转录不能重复计人；没有人口统计资料。核验文件后发布，不外发或建任务。',
  required:[/P01/,/P02/,/T01/,/T02/,/2\s*(?:位|名|个)|two\s+(?:unique\s+)?participants/i,/confusing|困惑|不清楚|混乱/i], forbidden:[/3\s*(?:位|名)参与|three participants|年龄为|岁女性|岁男性/i]},
 {id:'S011',packId:'standard-context',packVersion:'1.0.0',skill:'internal-communications',filename:'facts.txt',
  source:'Audience: internal team only. Purpose: announce a planned pilot. Confirmed: Project Cedar pilot is approved for planning, not launched. Launch date: unknown. Adoption metrics: not collected. Owner: team lead. No permission to email, post, or notify anyone.\n',
  prompt:'根据附件可信事实选择合适技能，为内部团队写试点公告与FAQ草稿，发布report.md。日期和指标未提供，不得虚构；不要发送通知、邮件或创建任务。先读回核验。',
  required:[/Cedar/,/未知|待定|未确定|Unknown/i,/FAQ|常见问题|问答/i],forbidden:[/已上线|已经上线|已正式启动|2026年\d+月\d+日|采用率\s*\d+/]},
 {id:'S014',packId:'standard-context',packVersion:'1.0.0',skill:'project-status-report',filename:'project-overview.txt',
  source:'Project name: Cedar. Reporting period: this week. Use the current project tools for authoritative overview; no budget or task metrics supplied in this attachment.',
  prompt:'选择适合技能，查找当前组织中的Cedar项目并读取真实项目概览，生成本周进展报告report.md并发布。关键字段注明工具来源；概览未提供的预算、任务指标与发布日期明确未知，未实现的blueprint不要写成可用。不要发通知；实际读回核验。',
  required:[/Cedar/,/未知|Unknown|未提供/i,/blueprint|蓝本|蓝图/i,/来源|source/i],forbidden:[/blueprint已上线|blueprint已实现|预算为\s*\d+|完成率\s*\d+/i]},
 {id:'S019',packId:'standard-methods',packVersion:'1.0.1',skill:'user-research-planning',filename:'brief.txt',
  source:'Objective O1: understand where new users get stuck during setup. Objective O2: understand how users decide setup is complete. Audience: adult first-time users. Constraint: 5 interviews, 20 minutes each; no study has run yet. Do not collect health, income, ethnicity, religion, or exact address. No participants recruited yet.\n',
  prompt:'根据附件研究目标和限制选择适合技能，写研究计划、招募条件和访谈提纲report.md并发布。每道问题标O1或O2映射，不编造受访者或发现，不收集不必要敏感信息。先核验文件，不发招募或建任务。',
  required:[/O1/,/O2/,/20/,/5/,/招募|recruit/i,/尚未|未开展|还未|not yet|计划/i],forbidden:[/受访者表示|调查显示|我们发现/]}];
