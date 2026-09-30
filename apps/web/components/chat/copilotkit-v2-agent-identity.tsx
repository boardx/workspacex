"use client";

import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { agentDisplayName, type AgentDirectoryCard } from "@/lib/agent-directory";
import { useAgentDirectoryMap } from "@/lib/use-agent-directory-map";
import { useAgentRunView } from "@/lib/use-agent-run-view";
import { InterruptRenderContext } from "./workbench/interrupt-render-context";

/**
 * v2 聊天（CopilotKit v2 `assistantMessage` slot）里助手消息的作者身份行：当这条线程的
 * 数字人（`CopilotKitV2MessageActionsProvider.agentId`，即当前线程选中的 agent）在成员目录
 * 里有插画头像时，在回答上方画「头像 + 称呼」（uiux-r1 #5）。不是数字人 ⇒ 画通用助手身份
 * （uiux-r2 #5：普通线程也要有作者身份）。只在有正文的助手回合、且是连续助手回合的第一条上
 * 画——见 `shouldShowAssistantIdentity`。
 */
export const GENERIC_ASSISTANT_NAME = "AI 助手";

/**
 * 这条助手回合自己是否已经画了身份行。回合内的行内提示（如「没有转交」）在回合没画身份行时
 * （正文被收走、只剩提示）自带一行，画了就不重复。默认 true：脱离回合渲染时不自作主张加身份行。
 */
export const AssistantIdentityDrawnContext = React.createContext<boolean>(true);

export function AgentIdentityRow({
  agentId: selectedAgentId,
  runId,
  fetchDirectory,
  fetchRun,
}: {
  /** composer 上此刻的选择——只在这条回合不属于任何 run 时兜底。 */
  agentId: string | null | undefined;
  /**
   * uiux-r3 #4.3：这条回合所属的 run。有它时作者身份取 run 上**持久化**的 `agentId`，
   * 刷新后选择回到默认也不会塌成「AI 助手」。
   */
  runId?: string | null;
  /** 测试注入；默认读真实 `GET /agents/directory`（模块级共享一次请求）。 */
  fetchDirectory?: () => Promise<readonly AgentDirectoryCard[]>;
  fetchRun?: Parameters<typeof useAgentRunView>[2];
}): JSX.Element | null {
  const host = React.useContext(InterruptRenderContext);
  const run = useAgentRunView(runId, host.bearer, fetchRun);
  const agentId = run?.agentId ?? selectedAgentId;
  const map = useAgentDirectoryMap(Boolean(agentId), fetchDirectory);
  // run 还没读回来时先不画，避免「AI 助手 → 数字人」闪一下。
  if (runId && run === undefined) return null;
  const card = agentId ? map.get(agentId) : undefined;
  // 目录还没读回来时先不画，避免「通用助手 → 数字人」闪一下。
  if (agentId && !card && map.size === 0) return null;
  // uiux-r2 #5：普通线程（没选数字人 / 数字人没有插画头像）也要有作者身份，用通用助手身份。
  const name = card ? agentDisplayName(card) : GENERIC_ASSISTANT_NAME;
  const initials = card?.initials ?? "AI";
  const avatarKey = card?.avatar?.key ?? null;
  return (
    <div data-testid="chat-v2-agent-identity" className="mb-0.5 flex items-center gap-2">
      <Avatar
        data-testid="chat-v2-agent-portrait"
        initials={initials}
        avatarKey={avatarKey}
        tone="ai"
        size="md"
        aria-hidden
      />
      <span className="text-12 font-medium text-background-foreground">{name}</span>
    </div>
  );
}

type IdentityMessage = { readonly id?: string; readonly role?: string; readonly content?: unknown; readonly toolCalls?: readonly unknown[] };

function hasVisibleText(m: IdentityMessage): boolean {
  return typeof m.content === "string" && m.content.trim() !== "";
}

/**
 * uiux-r2 #4.2 / #5 —— 身份行只画在「有可见正文」的助手回合上，并把连续的助手回合归到同一个
 * 身份头下：往前找最近一条有正文的消息，若也是助手的，就不再重复画。
 */
export function shouldShowAssistantIdentity(
  message: IdentityMessage,
  messages: readonly IdentityMessage[] | undefined,
  /** 不渲染的回合（如复述确认卡的转交旁白）：既不画身份行，也不算「已画过身份头」。 */
  isHidden?: (m: IdentityMessage) => boolean,
): boolean {
  if (!hasVisibleText(message) || isHidden?.(message)) return false;
  const list = messages ?? [];
  const idx = list.findIndex((m) => m.id === message.id);
  for (let i = idx - 1; i >= 0; i--) {
    const prev = list[i]!;
    if (prev.role === "user") return true;
    // 带工具调用的回合多半是被执行轨迹收走的过程旁白（不渲染），不算已画过的身份头。
    if (prev.role === "assistant" && hasVisibleText(prev) && !(prev.toolCalls?.length) && !isHidden?.(prev)) return false;
  }
  return true;
}
