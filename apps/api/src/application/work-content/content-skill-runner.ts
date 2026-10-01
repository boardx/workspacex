/**
 * CT06 —— 内容线阶段内执行一个已固定版本 Skill 的端口（ADR-118 #9：版本来自实例冻结的 pinnedSkills）。
 * `prior` 是本实例此前各 Skill 阶段的产出。
 *
 * 生产实现 `ModelContentSkillRunner`：以发起 Agent **固定版本**（实例冻结的 agentVersionId）的模型执行，
 * 经 `ModelCallPort`（与聊天 / run 同一条模型出口）；e2e 把该出口指向回环模型（UC-WC-I5）。
 * 模型必须返回一个 JSON 对象；否则抛错，阶段失败（不把非结构化文本当产出往下传）。
 */
import type { ModelCallPort } from "../agent-run/ports";

export interface ContentSkillInvocation {
  orgId: string;
  instanceId: string;
  agentVersionId: string;
  workflowId: string;
  stageId: string;
  skillId: string;
  skillVersion: string;
  input: Record<string, unknown>;
  prior: Readonly<Record<string, unknown>>;
}

export interface ContentSkillRunnerPort {
  run(call: ContentSkillInvocation): Promise<Record<string, unknown>>;
}

/** 发起 Agent 固定版本的模型（agent_versions.model_provider / model_id）；版本不存在返回 null。 */
export interface AgentVersionModelPort {
  agentVersionModel(orgId: string, agentVersionId: string): Promise<{ modelProvider: string; modelId: string } | null>;
}

/** Read SKILL.md from the exact published version pinned by the Workflow, in its organization. */
export interface ContentSkillInstructionsPort {
  skillInstructions(orgId: string, stableId: string, semanticVersion: string): Promise<string | null>;
}

export type ContentSkillRunFailure = "agent_version_missing" | "skill_instructions_missing" | "skill_output_not_json_object";

export class ContentSkillRunError extends Error {
  /** 机读错误码（`failureKindOf` 只看 code，不读 message）：`CONTENT_SKILL_AGENT_VERSION_MISSING` / `CONTENT_SKILL_OUTPUT_NOT_JSON_OBJECT`。 */
  readonly code: string;
  constructor(readonly reason: ContentSkillRunFailure, readonly skillId: string) {
    super(`content skill ${skillId}: ${reason}`);
    this.name = "ContentSkillRunError";
    this.code = reason === "agent_version_missing" ? "CONTENT_SKILL_AGENT_VERSION_MISSING"
      : reason === "skill_instructions_missing" ? "CONTENT_SKILL_INSTRUCTIONS_MISSING" : "CONTENT_SKILL_OUTPUT_NOT_JSON_OBJECT";
  }
}

/** system prompt 的格式约定行（唯一事实源；e2e 回环模型据此识别内容线 Skill 请求）。 */
export const CONTENT_SKILL_REPLY_INSTRUCTION = "Reply with exactly one JSON object and nothing else.";

/** 容忍模型把 JSON 包在 ```json 围栏里；其余一律按 JSON 解析。 */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  try {
    const v: unknown = JSON.parse((fenced ? fenced[1]! : text).trim());
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class ModelContentSkillRunner implements ContentSkillRunnerPort {
  constructor(
    private readonly model: ModelCallPort,
    private readonly agents: AgentVersionModelPort,
    private readonly skills: ContentSkillInstructionsPort,
  ) {}

  async run(call: ContentSkillInvocation): Promise<Record<string, unknown>> {
    const pinned = await this.agents.agentVersionModel(call.orgId, call.agentVersionId);
    if (!pinned) throw new ContentSkillRunError("agent_version_missing", call.skillId);
    const instructions = await this.skills.skillInstructions(call.orgId, call.skillId, call.skillVersion);
    if (!instructions?.trim()) throw new ContentSkillRunError("skill_instructions_missing", call.skillId);
    const completion = await this.model.complete({
      modelProvider: pinned.modelProvider,
      modelId: pinned.modelId,
      system: [
        `Workflow ${call.workflowId} stage ${call.stageId}: run Skill ${call.skillId}@${call.skillVersion}.`,
        instructions,
        "Use the workflow input and the prior stage outputs in the user message.",
        CONTENT_SKILL_REPLY_INSTRUCTION,
      ].join("\n"),
      user: JSON.stringify({ skill: `${call.skillId}@${call.skillVersion}`, stageId: call.stageId, input: call.input, prior: call.prior }),
    });
    const out = parseJsonObject(completion.text);
    if (!out) throw new ContentSkillRunError("skill_output_not_json_object", call.skillId);
    return out;
  }
}
