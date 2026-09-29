"use client";

import { useRouter } from "next/navigation";
import { AgentDirectory } from "@/components/agent/agent-directory";

/**
 * AG04（契约束 agent-role UC-4）—— 成员 Agent 目录，顶层路由 `/agent`（与 `/skill` 平行，
 * ui.md「成员目录作为新顶层路由 /agent，按 roleCategory 分组卡片」）。
 *
 * 「开始对话」跳到 `/chat?agent=<agentId>`——`components/chat/copilotkit-v2-shell-route.tsx`
 * 读这个 query 并把它写进 `CopilotKitV2AgentSelectionProvider`，真的选中这个 Agent
 * （R3.6「点击开始对话进入聊天」），不是只保证跳转目标存在的占位深链。
 */
export default function AgentDirectoryPage() {
  const router = useRouter();
  return <AgentDirectory onStartChat={(agentId) => router.push(`/chat?agent=${encodeURIComponent(agentId)}`)} />;
}
