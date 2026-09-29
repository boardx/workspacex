/**
 * AG04（契约束 `agent-role` UC-4）—— 成员 Agent 目录的前端薄封装。
 *
 * 与 `lib/live-skill.ts` 同一条纪律：这个文件不做判断。没有「是不是管理员」的分支，
 * 没有把 404 翻译成「隐藏卡片」的逻辑——权限是服务端的裁决（`listAgentDirectory`/
 * `getAgentDirectoryCard` 用例），这一层只把契约里的形状原样送过去、把失败原样带回来。
 * 形状与路径全部来自 `@repo/contracts`，不手写第二份。
 */
import { agentRole } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type AgentDirectoryCard = z.infer<typeof agentRole.AgentDirectoryCard>;
export type AgentRoleCategory = z.infer<typeof agentRole.AgentRoleCategory>;

export const AGENT_ROLE_CATEGORIES = agentRole.AgentRoleCategory.options;

/** ui.md 没有给中文标签表；沿用 `lib/mock/work-stack.ts` 已在用的四个 + 契约多出的 `general`。 */
export const ROLE_CATEGORY_LABEL: Record<AgentRoleCategory, string> = {
  research: "研究",
  product: "产品",
  sales: "销售",
  design: "设计",
  general: "通用",
};

export async function listAgentDirectory(
  filters: { readonly roleCategory?: AgentRoleCategory; readonly q?: string } = {},
): Promise<readonly AgentDirectoryCard[]> {
  const out = await apiRequest<unknown>(agentRole.operations.listAgentDirectory.path, {
    method: "GET",
    query: { roleCategory: filters.roleCategory, q: filters.q },
  });
  return agentRole.operations.listAgentDirectory.out.parse(out).items;
}

export async function getAgentDirectoryCard(agentId: string): Promise<AgentDirectoryCard> {
  const out = await apiRequest<unknown>(
    agentRole.operations.getAgentDirectoryCard.path.replace(":agentId", encodeURIComponent(agentId)),
    { method: "GET" },
  );
  return agentRole.operations.getAgentDirectoryCard.out.parse(out);
}
