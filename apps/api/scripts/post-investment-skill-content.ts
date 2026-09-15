/**
 * 「投后管理报告」平台内置 Skill 的正文——原样 import web 端的方法论单源
 * （`apps/web/lib/post-investment/methodology.ts`），不在这里另写一份。
 *
 * 与 team1 的 `ic-review-skill-content.ts`、四个官方 Office skill
 * （`office-docs-skill-content.ts`）同一条纪律：正文单独一个文件，seeding 只负责把它
 * 铸成 skill 包落库，不掺逻辑。
 */
import { buildPostInvestmentSkillContent } from "../../web/lib/post-investment/methodology";

export const POST_INVESTMENT_SKILL_MD = `---
name: post-investment-report
description: 投后管理报告方法论——财务字段抽取、沙箱派生计算、三类风险判据（显性/隐性/跨文件关联）、受限渠道外部信息、风险窗口时间轴、两轮人工确认与退出前置条件。
---

${buildPostInvestmentSkillContent()}
`;
