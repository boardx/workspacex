"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { AgentDetail } from "@/components/agent/agent-detail";
import { agentChatHref } from "@/lib/agent-directory";

/**
 * AG04 follow-up —— 成员数字人详情 `/agent/[id]`（目录卡片点进来），挂在标准应用外壳里。
 * 「开始对话」与目录页同一条深链 `/chat?agent=<agentId>`；「在对话中发起」某个工作流再带
 * `&prefill=`，由 `copilotkit-v2-shell-route.tsx` 一次性预填到新对话输入框（不自动发送）。
 */
export default function AgentDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  return (
    <AppShell previewRole={null}>
      <AgentDetail
        agentId={decodeURIComponent(params.id)}
        onStartChat={(agentId, prefill) => router.push(agentChatHref(agentId, prefill))}
      />
    </AppShell>
  );
}
