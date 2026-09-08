/**
 * #3063 —— `call_skill` 这一跳的**展示名**解析：把 run 侧已经 pin 住的 skill
 * （`readPinnedSkills` 读回的 `PinnedSkillContent`，同时带 `stableName` 与 `name`）
 * 按模型真实传来的 `skill_stable_name` 查一次，得到用户能读的那个名字。
 *
 * ## 为什么必须由 run 侧解析，而不是让前端自己查
 *
 * #3058 把 `stable_name` 收回为合规 slug（契约 `StableName` 容不下下划线/非 ASCII，
 * 中文名 ⇒ `skill-<8 位 hex>`），所以身份字段不再可读。而 AG-UI 线上唯一带着这跳
 * 身份的字符串就是 `args.skill_stable_name`——前端手里没有任何 skill 名字数据。
 * run 侧本来就为了拼 system prompt 把这批 skill 读进来了，名字是**顺手就有**的事实，
 * 不是新查询；在这里投影一次，比前端再开一条 `stable_name → name` 的查询（那才是
 * 第二份事实）都便宜、都准：快照的是这一跳发生当时的名字，之后改名不会让历史轨迹
 * 跟着漂。
 *
 * 解析不到一律返回 `undefined`（键缺席），展示层退回原样回显 `stable_name`：
 * 宁可显示一个不好看的真名字，也不编一个可能错的译名（`agent-run-phase.ts` 文件头
 * 「宁可笼统，不可编造归因」的同一条纪律）。
 */
import type { PinnedSkillContent } from "./ports";

/** deep-agent 通用助手里执行 skill 的工具名（`apps/deep-agent-service/.../tools.py`）。 */
export const CALL_SKILL_TOOL_NAME = "call_skill";

/** `call_skill` 第一个参数的 wire 名——与 `tools.py` 的签名逐字一致。 */
const SKILL_STABLE_NAME_ARG = "skill_stable_name";

export function calledSkillStableName(argsSummary: string | null): string | null {
  if (argsSummary === null || argsSummary === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsSummary);
  } catch {
    // 参数摘要被截断 / 根本不是 JSON：没有可信身份可读，不猜。
    return null;
  }
  const value = (parsed as Record<string, unknown> | null)?.[SKILL_STABLE_NAME_ARG];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * `toolName` 是 `call_skill`、参数里有一个能在本轮 pin 住的 skill 里找到的
 * `skill_stable_name`、且那条 skill 的展示名与身份**不同**时，返回展示名；
 * 其余一律 `undefined`。
 *
 * ⚠ 展示名与 `stableName` 逐字相同时也返回 `undefined`——写进事件里只会得到一份
 * 与 `args` 重复的字节，消费端退回原样回显的结果完全一样。
 */
export function resolveCalledSkillDisplayName(
  toolName: string | null,
  argsSummary: string | null,
  pinnedSkills: readonly PinnedSkillContent[],
): string | undefined {
  if (toolName !== CALL_SKILL_TOOL_NAME) return undefined;
  const stableName = calledSkillStableName(argsSummary);
  if (stableName === null) return undefined;
  const match = pinnedSkills.find((skill) => skill.stableName === stableName);
  const name = match?.name.trim();
  if (name === undefined || name === "" || name === stableName) return undefined;
  return name.slice(0, 200);
}

/** 展开进 `tool_start` 执行事件的可选字段——解析不到时是空对象（键缺席）。 */
export function skillDisplayNameField(
  toolName: string | null,
  argsSummary: string | null,
  pinnedSkills: readonly PinnedSkillContent[],
): { readonly skillDisplayName?: string } {
  const name = resolveCalledSkillDisplayName(toolName, argsSummary, pinnedSkills);
  return name === undefined ? {} : { skillDisplayName: name };
}
