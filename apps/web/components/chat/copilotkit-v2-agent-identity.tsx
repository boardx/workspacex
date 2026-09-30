"use client";

import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { agentDisplayName, type AgentDirectoryCard } from "@/lib/agent-directory";
import { useAgentDirectoryMap } from "@/lib/use-agent-directory-map";

/**
 * v2 聊天（CopilotKit v2 `assistantMessage` slot）里助手消息的作者身份行：当这条线程的
 * 数字人（`CopilotKitV2MessageActionsProvider.agentId`，即当前线程选中的 agent）在成员目录
 * 里有插画头像时，在回答上方画「头像 + 称呼」。不是数字人（没有头像的通用助手 / 服务端默认
 * agent）⇒ 什么都不画，保持原来的纯正文气泡（uiux-r1 #5：数字人头像在选人器、目录里都有，
 * 唯独消息上没有）。
 */
export function AgentIdentityRow({
  agentId,
  fetchDirectory,
}: {
  agentId: string | null | undefined;
  /** 测试注入；默认读真实 `GET /agents/directory`（模块级共享一次请求）。 */
  fetchDirectory?: () => Promise<readonly AgentDirectoryCard[]>;
}): JSX.Element | null {
  const map = useAgentDirectoryMap(Boolean(agentId), fetchDirectory);
  const card = agentId ? map.get(agentId) : undefined;
  if (!card?.avatar) return null;
  const name = agentDisplayName(card);
  return (
    <div data-testid="chat-v2-agent-identity" className="mb-0.5 flex items-center gap-2">
      <Avatar
        data-testid="chat-v2-agent-portrait"
        initials={card.initials}
        avatarKey={card.avatar.key}
        tone="ai"
        size="md"
        aria-hidden
      />
      <span className="text-12 font-medium text-background-foreground">{name}</span>
    </div>
  );
}
