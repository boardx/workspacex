"use client";

/**
 * Team3 ad-hoc MVP（`docs/design/agent-team3-mvp-backlog.md`）——`/agent/team3` 唯一一个
 * 接了真实后端的 CTA。其余五个 team 仍是纯占位（`app/agent/[teamId]/page.tsx` 只在
 * `team.slug === "team3"` 时渲染本组件，不改其余五个的行为）。
 *
 * 流程：拿组织第一个可见项目作锚点（没有就现建一个，同 `lib/live-tasks.ts` 现有的
 * "第一个可见项目作锚点"惯例）→ 在该项目下新建一条私有线程 → 按 agent 名字在组织
 * 能力目录里查出 team3 的真实 agentId（agentId 由部署期补种脚本生成，非确定性，
 * 前端不能硬编码，见 `apps/api/scripts/backfill-team3-agent.ts`）→ 把它加进这条线程的
 * 编制 → 跳到 `/chat?projectId=...&threadId=...`。全部走已有的真实端口，没有新接口。
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/session/session-provider";
import { listCapabilities } from "@/lib/live-capabilities";
import { listProjects, createProject } from "@/lib/live-projects";
import { createThread, getAgentPanel, updateAgentRoster } from "@/lib/live-chat";

const TEAM3_AGENT_NAME = "前沿赛道技术路线研判";

export function Team3StartChatButton() {
  const router = useRouter();
  const { session } = useSession();
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const handleClick = React.useCallback(async () => {
    const orgId = session?.currentOrgId;
    if (!orgId) return;
    setPending(true);
    setFailure(null);
    try {
      const agents = await listCapabilities(orgId, "agent");
      const team3 = agents.find((a) => a.name === TEAM3_AGENT_NAME && a.enabled);
      if (!team3) {
        throw new Error(
          "本组织尚未配置「前沿赛道技术路线研判」Agent（部署期补种脚本还没跑，或本组织不是 Workspace）。",
        );
      }

      const projects = await listProjects(orgId);
      const projectId = projects[0]?.id
        ?? (await createProject({ name: "前沿赛道技术路线研判", kind: "research_project", blueprintVersionId: null })).id;

      const thread = await createThread({
        projectId,
        groupId: null,
        title: TEAM3_AGENT_NAME,
        visibilityScope: "private",
      });

      const panel = await getAgentPanel(thread.threadId, projectId);
      await updateAgentRoster(thread.threadId, projectId, {
        add: [team3.id],
        remove: [],
        expectedRosterVersion: panel.rosterVersion,
      });

      router.push(`/chat?projectId=${encodeURIComponent(projectId)}&threadId=${encodeURIComponent(thread.threadId)}`);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "开始对话失败，请重试。");
      setPending(false);
    }
  }, [router, session?.currentOrgId]);

  return (
    <div className="mt-6 flex flex-col gap-2">
      <Button
        size="sm"
        data-testid="team3-start-chat"
        disabled={pending || !session?.currentOrgId}
        onClick={() => void handleClick()}
      >
        <Bot aria-hidden className="mr-1.5 size-4" />
        {pending ? "正在创建对话…" : "开始对话"}
      </Button>
      {failure ? (
        <p className="text-11 text-destructive" data-testid="team3-start-chat-error">{failure}</p>
      ) : null}
    </div>
  );
}
