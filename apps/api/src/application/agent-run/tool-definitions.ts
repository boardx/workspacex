/**
 * #725 -- turning a run's pinned Skills into tools an orchestrator model can actually call.
 *
 * ## What "execute" means today, and why this file does not invent a new mechanism
 *
 * Before #725, a Skill's whole `SKILL.md` body was pasted into the orchestrator's own
 * system prompt (`buildSystemPrompt` in `execute-run.ts`) and the model was left to
 * "pretend" it had used it. This codebase has exactly ONE real execution primitive for
 * anything model-shaped: `ModelCallPort.complete()`. #725 does not add a second one --
 * "running a Skill" becomes a SEPARATE, focused `complete()` call whose system prompt is
 * ONLY that Skill's content (see `tool-loop.ts`'s `executeSkillTool`), rather than one
 * call juggling every pinned Skill's content at once. That is the entire difference
 * between "the model already knows the skill text" and "the model actually invoked it":
 * a dedicated call, a real request/response, a step recorded either way.
 *
 * ## Why the tool's only parameter is `task: string`
 *
 * These Skills are declarative, freeform `SKILL.md` documents (chat-ux-acceptance-
 * criteria.md's own framing: "组织已导入的 skill 集合"), not typed APIs with a schema a
 * human declared. A single free-text `task` field is the honest shape for "hand this
 * Skill a description of what you want it to do" -- inventing a richer per-Skill schema
 * from unstructured markdown would be a fabricated contract nothing verified.
 */
import type { PinnedSkillContent, ToolDefinition } from "./ports";

/** OpenAI-compatible function names top out at 64 chars; `stableName` (contract's
 * `StableName`, `^[a-z0-9][a-z0-9-]*$`) is already a strict subset of the legal charset. */
const TOOL_NAME_MAX = 64;

export interface SkillForTool extends PinnedSkillContent {
  readonly stableName: string;
  readonly name: string;
}

/**
 * One tool per pinned Skill, in the SAME order `skills` was given (mirrors
 * `buildSystemPrompt`'s own "ordering is a property of `skillVersionIds`" discipline).
 * Total, pure, no I/O -- easy to unit test without a database or a model call.
 */
export function buildToolDefinitions(
  skills: readonly SkillForTool[],
): readonly ToolDefinition[] {
  return skills.map((skill) => ({
    name: skill.stableName.slice(0, TOOL_NAME_MAX),
    description:
      `调用已导入的技能「${skill.name}」，让它针对给定任务真正执行一次并返回结果——` +
      "不是复述这个技能会做什么，而是把任务交给它去做。任务描述得越具体，结果越可用。",
    parametersSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "交给这个技能执行的具体任务，写清它需要知道的全部上下文。",
        },
      },
      required: ["task"],
      additionalProperties: false,
    },
  }));
}

/** `stableName -> Skill`, for `tool-loop.ts` to resolve a model's tool call back to the
 * pinned content it should execute against. A `Map` because a run may pin several Skills
 * and each tool call names exactly one by its tool name. */
export function indexSkillsByToolName(
  skills: readonly SkillForTool[],
): ReadonlyMap<string, SkillForTool> {
  return new Map(skills.map((skill) => [skill.stableName.slice(0, TOOL_NAME_MAX), skill]));
}
