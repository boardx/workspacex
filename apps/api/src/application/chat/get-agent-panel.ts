/**
 * `getAgentPanel` —— 读 AI 团队面板（F110 · uc-8-2 UC-7）。
 *
 * ⚠ 依赖失败返回错误而不是空面板（契约 `getAgentPanel` 注释逐字）——空数组会被
 *   读成「这个线程没有 agent」，而实际是「取不到」。所以 `findAgentRoster` 返回
 *   `null` 时走 `ThreadNotVisibleError`（同 `getThread` 的「判定通过之后线程却没了」
 *   处理方式，同一个出口，不新造一个「面板取不到」的第二种拒绝形状）。
 *
 * ⚠ **两个计数分离（I-18）**：这里不在本文件里再算一次 `presentCount`/`rosterCount`——
 *   唯一的算法在 `domain/chat/agent-presence.ts`，本文件只调用它。
 *
 * ## 🟡 `rosterVersion` 于 #513 补上，**该契约面待人类补签**
 *
 * `findAgentRoster` 一直就把 `chat_threads.roster_version` SELECT 出来了
 * （`infrastructure/chat/pg-chat-repository.ts` 的 `findAgentRoster`，返回
 * `AgentRosterState.rosterVersion`）——本文件此前只是**把它丢掉**。#513 只是不再丢。
 * 所以这里**不做任何计算**：既不 +1、也不与写端口各算一份。写端口
 * `updateAgentRoster.out.rosterVersion` 与这里读的是同一列。
 * 详见契约 `getAgentPanel` 的文件头（待补签状态记在那里，
 * **没有任何 `design-signoff.md` 被改动**）。
 */
import type { z } from "zod";
import { chat as C } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import { agentPanelCounts, assertAgentPanelInvariants } from "../../domain/chat/agent-presence";
import type { ChatRepository } from "./ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";

/** 契约派生，绝不另写一份。 */
export type GetAgentPanelResult = z.infer<typeof C.operations.getAgentPanel.out>;

/**
 * `[从Agent市场加入]` 的跳转目标。**常量而不是配置**——原型（`chat-team-panel.tsx`）
 * 已经把它接到了这个真实路由（`/admin/agent`），后端只是把前端已经在用的那个落点
 * 也交回响应体里，供非 web 客户端（若将来有）使用，不是重新发明一个地址。
 */
export const AGENT_MARKET_ENTRY = "/admin/agent";

export interface GetAgentPanelDeps extends ResolveVisibilityDeps {
  readonly chat: ChatRepository;
}

export interface GetAgentPanelInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly threadId: string;
}

export async function getAgentPanel(
  deps: GetAgentPanelDeps,
  input: GetAgentPanelInput,
): Promise<GetAgentPanelResult> {
  const outcome = await resolveVisibility(deps, input);
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  const roster = await deps.chat.findAgentRoster(input.orgId, input.threadId);
  if (roster === null) throw new ThreadNotVisibleError();

  // I-17：每个 agent 必须有非空 duty。见 `domain/chat/agent-presence.ts` 文件头。
  assertAgentPanelInvariants(roster.agents);
  // I-18：presentCount 与 rosterCount 是同一份列表的两次投影，不是两处各算一次。
  const { presentCount, rosterCount } = agentPanelCounts(roster.agents);

  return {
    agents: roster.agents.map((a) => ({
      id: a.id,
      abbr: a.abbr,
      name: a.name,
      duty: a.duty,
      roleLabel: a.roleLabel,
      presence: a.presence,
    })),
    presentCount,
    rosterCount,
    marketEntry: AGENT_MARKET_ENTRY,
    // 🟡 #513（待人类补签）：原样转发仓储读到的 `chat_threads.roster_version`。
    // 不重算、不 +1——见文件头。
    rosterVersion: roster.rosterVersion,
  };
}
