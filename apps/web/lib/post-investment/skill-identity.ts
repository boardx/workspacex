/**
 * 「投后管理报告」内置 Skill 的身份常量——前端（挂载用）与后端（种子逻辑，
 * `apps/api/src/infrastructure/skill/ensure-platform-skill-catalog.ts`）共用同一份，
 * 不在两侧各自声明一次 id。放在浏览器安全的 web 端（不像后端种子模块那样 import
 * 数据库连接），后端反过来 import 这里。同 team1 `lib/ic-review/skill-identity.ts`。
 *
 * ⚠ 版本号是固定值，不是内容摘要。**方法论正文有实质变化时必须手动升到 -v2**，
 * 否则 seeding 会 fail closed（同一个版本 id 的内容摘要对不上就抛错，见 seeding
 * 处的注释）——那是有意的：静默让线上停在旧内容比报错难查得多。
 * 本 Skill 正文由 `@repo/contracts/post-investment-rules` 的阈值渲染而成，所以
 * **改那份契约的阈值也算实质变化**，同样要升版本号。
 */
export const POST_INVESTMENT_SKILL_ID = "skill-team4-post-investment-report";
export const POST_INVESTMENT_SKILL_VERSION_ID = `${POST_INVESTMENT_SKILL_ID}-v1`;
