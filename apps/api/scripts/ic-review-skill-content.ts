/**
 * 「上会审阅」平台内置 Skill 的正文——原样 import web 端的方法论单源
 * （`apps/web/lib/ic-review/review-prompt.ts`），不在这里另写一份。
 *
 * 与四个官方 Office skill（`office-docs-skill-content.ts`）同一条纪律：正文单独
 * 一个文件，`ensure-ic-review-skill.ts` 只负责把它铸成 skill 包落库，不掺逻辑。
 */
import { buildIcReviewSkillContent } from "../../web/lib/ic-review/review-prompt";

export const IC_REVIEW_SKILL_MD = `---
name: ic-review-standard
description: 上会材料审阅方法论——上会标准 IC-1..IC-8、交叉验证规则、输出格式、两轮人工确认约定。
---

${buildIcReviewSkillContent()}
`;
