/**
 * 系统预置 agent 的 stable_name / 显示名——**唯一事实源**。
 *
 * 三处系统预置 agent（`ensure-default-agent.ts` / `ensure-deep-research-agent.ts` /
 * `ensure-image-gen-agent.ts`）各自曾把这两个字符串直接声明在自己文件里。前端需要
 * 「哪个是通用助手」这条事实来挑默认 agent（见下方「为什么需要这个文件」），如果
 * 前端另抄一份字符串常量，就是本仓第六次「同一事实声明在两处」——AGENTS.md 明确点名
 * 这条纪律，这里改成单源：后端三处 `ensure-*.ts` 与前端 `chat-live-message-panel.tsx`
 * 都从这里导入，不各自持有字面量。
 *
 * ## 为什么需要这个文件（root cause，2026-08-14 devapp 实测）
 * `getAgentPanel`/`listCapabilities` 的 agent 列表按 `ORDER BY name` 返回（数据库
 * 默认排序规则）。Latin 字母（"Deep Research"）在默认 collation 下排在中文（"通用助手"）
 * 之前，于是"新对话默认选中的 agent"= 数组第一个 = 纯粹按字母顺序偶然选中的
 * "Deep Research"——不是任何人做过的产品决策。Deep Research 是慢速多步的外部调用，
 * 默认选中它会让"发一句话"体验变成长时间卡在"思考中"、看起来像是坏了。
 * 前端据此常量优先选中"通用助手"作为默认 agent，而不是盲选数组第一个。
 */
export const DEFAULT_AGENT_STABLE_NAME = "default-assistant";
export const DEFAULT_AGENT_NAME = "通用助手";

export const DEEP_RESEARCH_AGENT_STABLE_NAME = "deep-research-agent";
export const DEEP_RESEARCH_AGENT_NAME = "Deep Research";

export const IMAGE_GEN_AGENT_STABLE_NAME = "image-gen-agent";
export const IMAGE_GEN_AGENT_NAME = "图片生成";
