"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { AgentDirectory } from "@/components/agent/agent-directory";
import { agentChatHref } from "@/lib/agent-directory";

/**
 * AG04（契约束 agent-role UC-4）—— 成员数字人目录，顶层路由 `/agent`（与 `/skill` 平行，
 * ui.md「成员目录作为新顶层路由 /agent，按 roleCategory 分组卡片」）。挂在标准应用外壳里
 * （左侧导航 + 顶栏），同其他成员页（uiux-r1 #3：此前是没有外壳的孤页）。
 *
 * 「开始对话」跳到 `/chat?agent=<agentId>`——`components/chat/copilotkit-v2-shell-route.tsx`
 * 读这个 query 并把它写进 `CopilotKitV2AgentSelectionProvider`，真的选中这个 Agent。
 */
export default function AgentDirectoryPage() {
  const router = useRouter();
  return (
    <AppShell previewRole={null}>
      <AgentDirectory onStartChat={(agentId) => router.push(agentChatHref(agentId))} />
    </AppShell>
  );
}
