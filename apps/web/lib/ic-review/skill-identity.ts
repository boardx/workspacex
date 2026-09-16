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
/**
 * ⚠ 正文有实质变化就必须升这个号，否则种子的 fail-closed 摘要门控会抛错（被 `main.ts`
 * 的 never-throw 包住，只剩一行日志），线上静静地停在旧正文上——2026-09-16 真机就这样
 * 踩了一次：Excel 结果文件（任务五）合进 main 了，devapp 上的 Agent 从头到尾没见过它。
 * v2 = 加入任务五（同步产出 Excel 结果文件，issue #3707）。
 * v3 = 引入项目类型（并购／融资）与条目适用范围、财务表现改五项分析、对赌期按三年（issue #3710）。
 * v4 = 新增任务四公开信息检索、任务五竞对对比与 SWOT／波特五力、任务六投资风险识别（四类），
 *      需核实清单顺延为任务七、Excel 顺延为任务八并加「竞对对比」「风险清单」两个 sheet（issue #3713）。
 */
export const IC_REVIEW_SKILL_VERSION_ID = `${IC_REVIEW_SKILL_ID}-v4`;
