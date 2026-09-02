/**
 * design-delta `skill-lazy-loading` —— 渐进式披露的目录/按需请求两层，只用于
 * 非 deep-agent 的 chat run（`execute-run.ts` 按 `run.modelProvider !==
 * DEEP_AGENT_PROVIDER_NAME` 决定要不要走这条路，见那个文件对 `buildSystemPrompt`
 * 的调用点）。
 *
 * ## 为什么是「文本围栏块」不是「给模型挂一个 read_skill 工具」——同 `run-script-
 * with-retries.ts` 那条已经验证过的理由
 *
 * `ModelCallPort` 没有工具调用面：`ToolDefinition`/`ToolCallRequest`/`ToolExchangeTurn`
 * （#725）在 #741 被显式退役，连同它们服务的 TS 进程内工具循环一起删掉了——理由是
 * "避免两套通用助手执行路径并存"（`ports.ts` 对应头注）。`run_script` 协议已经在
 * 这个约束下证明过"文本围栏块 + 正则解析 + 再调一次 complete()"这条路径可行
 * （`run-script-with-retries.ts` 自己的头注）。本文件的 `read_skill` 标记是**同一种
 * 形状**：硬编码单一用途、正则解析纯文本，不经过任何 wire 协议层——不是把 #741 删掉
 * 的通用工具调用能力重新打开一个入口。design-delta `skill-lazy-loading` 的
 * `contract.md` §2 有更完整的论证。
 *
 * ## Claude Code / Codex Agent Skills 标准里的对应物
 *
 * 官方三层渐进式披露：① 所有已装 skill 的 name+description 常驻 system prompt
 * ② 模型判定相关才把 SKILL.md 全文读进上下文 ③ 绑定的脚本/参考文件更晚按需读取。
 * 本文件实现①②（目录 + 按需展开全文）；③ 不适用——workspacex 的 skill 没有绑定
 * 预写脚本，脚本是模型当场写的（`run-script-with-retries.ts`），没有第三层可展开。
 */
import type { PinnedSkillContent } from "./ports";

/** 目录里每条摘要的最长字符数——够让模型判断"这个 skill 是不是我需要的"，不多。 */
const SUMMARY_MAX_CHARS = 200;

/**
 * 从 `SKILL.md` 正文摘取一段简短描述,供目录用。规则:取第一个 H1 标题
 * (`# ...`)之后、下一个空行分隔出的首段,截断到 `SUMMARY_MAX_CHARS`。
 *
 * 找不到"H1 + 首段"这个形状时(理论上任何 skill 都应该有,但不假设),退化成
 * "正文前 N 个字符"——诚实地给一个可用的摘要,不是空字符串,不抛错。三份
 * F979 skill(docx/xlsx/pdf-create)的 `SKILL.md` 已经是这个形状(标题 +
 * 概述段落),摘取结果可读；旧 skill 若首段不够精炼,效果打折但不报错。
 */
export function deriveSkillSummary(content: string, maxChars = SUMMARY_MAX_CHARS): string {
  const withoutH1 = content.replace(/^#[^\n]*\n+/, "");
  const firstParagraph = withoutH1.split(/\n\s*\n/)[0] ?? "";
  const candidate = (firstParagraph.trim() !== "" ? firstParagraph : content).trim();
  // 去掉 Markdown 的行内标记(粗体/斜体/行内代码),目录是给模型看的纯文本提要,
  // 不需要模型再解一层 Markdown。
  const plain = candidate.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  return plain.length <= maxChars ? plain : `${plain.slice(0, maxChars)}...`;
}

const READ_SKILL_FENCE_OPEN = "```read_skill";
/** ⚠ 同 `SCRIPT_FENCE_RE`:无 `g` 标志,模块级复用的正则字面量带 `g` 会因
 *  `lastIndex` 残留而随调用次数变结果。 */
const READ_SKILL_FENCE_RE = /```read_skill\s*\n([\s\S]*?)```/;

/** 解析模型回复里的 `read_skill` 围栏块,返回请求的 `stable_name`(已 trim)。没有
 *  命中或块内容为空时返回 `null`。 */
export function tryExtractReadSkillRequest(reply: string): string | null {
  const fenced = READ_SKILL_FENCE_RE.exec(reply);
  const requested = fenced?.[1]?.trim();
  return requested !== undefined && requested !== "" ? requested : null;
}

/** 渐进式披露的按需请求轮数上限(design-delta `skill-lazy-loading` contract.md §2.3)。
 *  与 `run-script-with-retries.ts` 的 `MAX_SCRIPT_ATTEMPTS` 是两件独立的事,不共用
 *  计数器——一个覆盖"该读哪些 skill",一个覆盖"脚本对不对",混在一起数会让"这次
 *  到底是哪个耗尽了"无法从计数上区分。 */
export const MAX_READ_SKILL_ROUNDS = 3;

/**
 * 目录 + 按需请求协议说明,拼进非 deep-agent run 的 system prompt。挂载 0 个 skill
 * 时调用方不应该拼这一段(空目录没有意义)——本函数不做这个判断,由调用方按
 * `skills.length > 0` 决定要不要拼。
 */
export function buildSkillCatalogBlock(
  skills: readonly Pick<PinnedSkillContent, "stableName" | "content">[],
): string {
  const entries = skills
    .map((s) => `- ${s.stableName}: ${deriveSkillSummary(s.content)}`)
    .join("\n");
  return [
    "You have the following Skills available. Only their name and a one-line summary are",
    "shown below — you have NOT been given their full instructions yet.",
    "",
    entries,
    "",
    "Before using a Skill, request its full instructions with exactly this fenced block",
    "(request one Skill's stable name per block):",
    "",
    READ_SKILL_FENCE_OPEN,
    "<stable_name>",
    "```",
    "",
    "You will receive its full instructions in your next turn. Only request Skills you",
    "actually need for the current task — if none of them are relevant, answer directly",
    "without requesting any.",
  ].join("\n");
}

/**
 * #2534 —— deep-agent run 的目录块。与 `buildSkillCatalogBlock` 同一份条目（同一个
 * `deriveSkillSummary`），只有"怎么拿全文"那段不同：deep-agent 远端图有真实工具
 * （`list_org_skills` / `call_skill`，`apps/deep-agent-service/.../tools.py`），全文经
 * `config.configurable.org_skills` 结构化送过去、由工具按需取；这里**不能**写
 * `read_skill` 围栏——那是给没有工具面的纯 provider 的文本约定，`execute-run.ts` 对
 * deep-agent run 根本不解析它。
 *
 * 为什么 deep-agent 也要目录而不是全文（此前 `skill-lazy-loading` §1 刻意不碰）：
 * #2519 之后 run 默认加载组织全部已启用 skill，"全文进 system prompt"从"四份"变成
 * "全部"——正是 #2515 要削的延迟。目录让编排模型知道有什么，全文只在 `call_skill`
 * 那次独立子调用里出现（`deep-agent-model-provider.ts` 头注对 `org_skills` 的说明）。
 */
export function buildDeepAgentSkillCatalogBlock(
  skills: readonly Pick<PinnedSkillContent, "stableName" | "content">[],
): string {
  const entries = skills
    .map((s) => `- ${s.stableName}: ${deriveSkillSummary(s.content)}`)
    .join("\n");
  return [
    "You have the following Skills available. Only their name and a one-line summary are",
    "shown below — their full instructions are NOT in this prompt.",
    "",
    entries,
    "",
    "To use one, call the `call_skill` tool with its stable name (use `list_org_skills` to",
    "see the list again). The skill's full instructions are given to that focused",
    "execution — do not answer from memory of what a skill might say. Only use Skills you",
    "actually need for the current task; if none are relevant, answer directly.",
  ].join("\n");
}

/** 把某个 skill 的全文追加进 system prompt(目录条目保留,不删除——模型仍能看到
 *  "还有哪些没读")。 */
export function appendSkillFullContent(
  system: string,
  skill: Pick<PinnedSkillContent, "stableName" | "name" | "content">,
): string {
  return `${system}\n\n---\n\nFull instructions for "${skill.stableName}" (${skill.name}), as requested:\n\n${skill.content}`;
}

/** 模型请求了一个不在这次 run 挂载集合里的 skill——诚实告知,不是静默忽略(verification.md
 *  V6),也不让模型第二轮拿到和第一轮一模一样的目录、猜不出请求为什么没生效。 */
export function appendSkillNotMountedNotice(system: string, requestedStableName: string): string {
  return `${system}\n\n---\n\nThe Skill "${requestedStableName}" is not mounted in this conversation — it is not among the Skills listed above. Do not request it again; use only the Skills listed above, or answer without one if none of them apply.`;
}
