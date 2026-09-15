/**
 * 评级记录的「组织记忆」格式 —— 让下一次评级真的找得到上一次（R3-9 趋势判断、R3-15 修正记忆）。
 *
 * ## 为什么不是 wx_knowledge_search
 *
 * 任务书此前让模型用 `wx_knowledge_search` 搜自己上次发布的评级报告。那条路**结构上走不通**：
 * `pg-artifact-index-writer.ts` 的 INSERT 带着 `WHERE ... a.source='upload' AND NOT a.synthesized`,
 * 而 agent 产出的文件走 `agui-file-events.ts` 落库时 `source: "agent_run_output"`——
 * 永远不进 `segment_text`，永远搜不到。结果是第四步恒定输出「首次评级，无趋势判断」，
 * 而且看起来完全正常：模型确实搜了，确实没搜到，确实照实说了。HMW 卡上要的「趋势」那半边
 * 就这样静默地空转。
 *
 * `wx_memory_search` / `wx_memory_write`（`standard-memory.ts`，native 工具）是真能写、
 * 真能读回来的组织级记忆，literal 模式按文本匹配。本文件定义写进去的格式，让写与搜对齐——
 * 格式两处各写一遍就会搜不到，所以它只在这里声明一次。
 *
 * ⚠ 这是 MVP 的记忆通道，不是 R6 后置条件要求的评级记录实体（那需要契约
 * `postinvest-rating.ts` 的 createRatingRun/getRatingRecord 真正落库，带版本链与
 * draft/confirmed 状态）。记忆里存的是**摘要**，够做趋势对比，不够做审计追溯。
 */

/** 搜索前缀：写入与检索共用，改一个字两边就对不上。 */
export const RATING_MEMO_TAG = "POSTINVEST-RATING-RECORD";

/** 修正记录的前缀（R3-15：明确错误的修正要被记住，避免同类错误复发）。 */
export const RATING_CORRECTION_TAG = "POSTINVEST-RATING-CORRECTION";

/**
 * 渲染成任务书里的「记忆协议」段。写成模板而不是描述，是因为模型要照着它**逐字**产出，
 * 下一次才搜得到——描述性的「记得把结果存起来」会得到十种不同格式。
 */
export function buildMemoryProtocol(): string {
  return [
    "## 记忆协议（决定下一次评级能不能做趋势对比，不可跳过）",
    "",
    `开工第一件事：用 wx_memory_search 搜 "${RATING_MEMO_TAG} <项目名或公司名>"，把本项目此前的评级记录读出来。`,
    `同时搜 "${RATING_CORRECTION_TAG} <项目名或公司名>"，看有没有我以前指出过的错误——同类错误不要再犯。`,
    "搜不到就是首次评级，照实说，不要编一条历史。",
    "",
    "出完结论后：用 wx_memory_write 写一条记录，第一行必须逐字是下面这个格式（字段用 | 分隔，缺的写 null）：",
    `${RATING_MEMO_TAG} | 项目名 | 公司名 | 报告期 | S1 | S2 | S3 | 总分 | 等级 | 数据质量标注(逗号分隔或 none) | 评级日期`,
    "第二行起可以写简短说明（关键驱动因素、缺了哪些字段），控制在十行以内。",
    "idempotencyKey 用「项目名-报告期」，同一项目同一报告期重评时覆盖而不是堆一条新的。",
    "",
    "我指出明确错误（算错 / 对标错 / 信息误解 / 信息缺失四类之一）并且你据此改了结论后：",
    `再用 wx_memory_write 写一条 "${RATING_CORRECTION_TAG} | 项目名 | 错误类型 | 修正前 | 修正后 | 依据"。`,
    "主观偏差那一类不写——它不构成错误，写进记忆等于把我的印象变成下次的规则。",
  ].join("\n");
}
