/**
 * 「上会审阅」内置 Skill 的身份常量——前端（挂载用）与后端（种子脚本，
 * `apps/api/src/infrastructure/skill/ensure-ic-review-skill.ts`）共用同一份，
 * 不在两侧各自声明一次 id。放在浏览器安全的 web 端（不像后端种子模块那样
 * import 数据库连接），后端反过来 import 这里。
 *
 * 版本号是固定值，不是内容摘要——与四个官方 Office skill 的 `${skillId}-v1`
 * 同一个做法：改动内容有实质变化时手动升到 `-v2`，而不是让版本号随每次构建的
 * 内容哈希漂移（那样前端「已经挂了哪个版本」的判断会和实际内容脱钩）。
 */
export const IC_REVIEW_SKILL_ID = "skill-team1-ic-review-standard";
export const IC_REVIEW_SKILL_VERSION_ID = `${IC_REVIEW_SKILL_ID}-v1`;
