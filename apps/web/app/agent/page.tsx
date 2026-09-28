"use client";

import { useRouter } from "next/navigation";
import { AgentDirectory } from "@/components/agent/agent-directory";

/**
 * AG04（契约束 agent-role UC-4）—— 成员 Agent 目录，顶层路由 `/agent`（与 `/skill` 平行，
 * ui.md「成员目录作为新顶层路由 /agent，按 roleCategory 分组卡片」）。
 *
 * 「开始对话」跳到 `/chat?agent=<agentId>` —— 占位深链，不在本 feature（AG04）范围内
 * 假装接通聊天侧的 Agent 选择（那是独立的既有能力面），只保证跳转目标是可预期、
 * 可后续对接的一个真实地址，不是死链接。
 */
export default function AgentDirectoryPage() {
  const router = useRouter();
  return <AgentDirectory onStartChat={(agentId) => router.push(`/chat?agent=${encodeURIComponent(agentId)}`)} />;
}
