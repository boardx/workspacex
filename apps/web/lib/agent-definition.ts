/**
 * #617 —— `createAgent`（契约 `agentRuntime.operations.createAgent`）的前端薄封装。
 *
 * ## 为什么不是 `lib/live-capabilities.ts`
 *
 * 那个文件封装的是 F15 的 `capability_listings`（组织能力目录，粗粒度：名字 + 可见范围 +
 * 启用/停用），走 `POST /capabilities/mutate`。`createAgent` 是 F55 的「执行侧」agent
 * 定义（缩写角标 / 职责一句话 / clone_from / 工具白名单），落在完全不同的一张表
 * （`agents`/`agent_versions`），走独立的 `POST /agents`。混进 `live-capabilities.ts`
 * 会让"目录项"和"agent 定义"这两个不同的模型看起来是同一件事——AGENTS.md 明令的
 * "同一事实不得声明在两处"反过来也适用于"两件事不得看起来是一处"。
 *
 * ## phase-1 范围
 *
 * 只封装"从零新建"（`cloneFrom` 恒为 `null`，`source` 恒为 `"self"`）。
 * "复制一个现成的" UI 未做——见 #617 报告里的范围说明。
 */
import { agentRuntime } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type AgentVisibility = z.infer<typeof agentRuntime.operations.createAgent.in>["visibility"];
export type CreateAgentResult = z.infer<typeof agentRuntime.operations.createAgent.out>;
export type SelfPublishResult = z.infer<
  typeof agentRuntime.operations.selfPublishToollessAgent.out
>;

export async function createAgentFromScratch(input: {
  readonly name: string;
  readonly initials: string;
  readonly role: string;
  readonly visibility: AgentVisibility;
}): Promise<CreateAgentResult> {
  return apiRequest<CreateAgentResult>(agentRuntime.operations.createAgent.path, {
    method: "POST",
    body: {
      name: input.name,
      initials: input.initials,
      role: input.role,
      visibility: input.visibility,
      cloneFrom: null,
      source: "self",
    },
  });
}

/**
 * #660 候选 A —— 写入 agent 的**可执行定义**（`PATCH /agents/:agentId`）。
 *
 * ⚠ 后端本轮**只**接线 `patch.instructions` 一个字段，其余字段返回 501
 * （见 `set-agent-instructions.ts` 头注）。这里因此也只发这一个字段——
 * 发一个后端会拒的字段等于制造一次必然失败。
 * ⚠ `expectedVersion` 契约要求必填，但草稿 agent 的 `published_version_id` 恒为 NULL，
 *   后端本轮不校验它（同上头注）。传空串是**如实**表达"没有版本可对"，
 *   不是伪造一个版本号。
 */
export async function setAgentInstructions(
  agentId: string,
  instructions: string,
): Promise<{ agentId: string }> {
  return apiRequest<{ agentId: string }>(
    agentRuntime.operations.updateAgentDefinition.path.replace(":agentId", encodeURIComponent(agentId)),
    { method: "PATCH", body: { agentId, patch: { instructions }, expectedVersion: "" } },
  );
}

/**
 * #660 —— 「无能力面自助发布」。**⚠⚠ 草案边，尚未经人类签核**
 * （`KNOWN_CONTRACT_GAPS.AR11`）。
 *
 * ⚠ 路径里的 `:agentId` 用 `replace` 从契约的 `path` 上换，而不是手写
 * `` `/agents/${id}/self-publish` `` —— ADR-020：路径是契约的，不在前端第二次声明。
 */
export async function selfPublishAgent(agentId: string): Promise<SelfPublishResult> {
  return apiRequest<SelfPublishResult>(
    agentRuntime.operations.selfPublishToollessAgent.path.replace(":agentId", encodeURIComponent(agentId)),
    { method: "POST", body: { agentId } },
  );
}
