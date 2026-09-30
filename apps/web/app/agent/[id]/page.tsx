"use client";

import { useRouter } from "next/navigation";
import { AgentDetail } from "@/components/agent/agent-detail";

/**
 * AG04 follow-up —— 成员数字人详情 `/agent/[id]`（目录卡片点进来）。「开始对话」与目录页
 * 同一条深链 `/chat?agent=<agentId>`，由 `copilotkit-v2-shell-route.tsx` 真的选中该 Agent。
 */
export default function AgentDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  return (
    <AgentDetail
      agentId={decodeURIComponent(params.id)}
      onStartChat={(agentId) => router.push(`/chat?agent=${encodeURIComponent(agentId)}`)}
    />
  );
}
