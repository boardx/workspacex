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
