"use client";

/**
 * Team3「前沿赛道技术路线研判」的**内嵌聊天界面**（人类 2026-09-15 指令：
 * 「入口点击以后，会打开类似 chatui 的界面，可以用所有的 chat 的能力，但是这个是
 * team3 的 agent」）。
 *
 * ## 为什么是内嵌而不是跳转
 *
 * 此前 `/agent/team3` 是一个落地页 + 「开始对话」按钮，按下去 `router.push('/chat?...')`
 * ——用户被甩到通用 chat 路由，地址栏也不再是 team3，"这是 team3 的 agent"这件事在
 * 界面上就断了。本组件改成：进页面就地解析/创建 team3 线程，然后在**同一个路由里**
 * 挂载真正的 `CopilotKitV2Shell`，与 `/chat` 用的是同一个壳、同一套 provider，
 * 因此附件上传、流式、工具轨迹、mermaid 图渲染（`ChatDiagramFabric`）等全部 chat
 * 能力天然都在——不是另写一个简化版聊天框。
 *
 * ## 与 `(v2)/layout.tsx` 的关系
 *
 * `/chat` 那棵树由 `app/chat/(v2)/layout.tsx` 组装：
 * `CopilotKitV2AgentSelectionProvider` → `CopilotKitV2Providers` → `AppShell` →
 * `CopilotKitV2ShellRoute`（从 `useParams()` 读线程 id）。本组件复用**同样三层**
 * provider，只把最内层换成直接传参的 `CopilotKitV2Shell`——因为这里的线程 id 不在
 * URL 段上，而是进页面后解析出来的。三层 provider 不能省：壳内部依赖它们（选中
 * agent 的 header、CopilotKit runtime、会话身份）。
 *
 * ## 线程解析
 *
 * 复用与旧按钮完全相同的既有真实端口（`listCapabilities` → 按名字查真实 agentId、
 * `listProjects`/`createProject` 取项目锚点、`createThread`、`getAgentPanel` +
 * `updateAgentRoster` 把 team3 挂进编制），不新增任何后端接口。差别只是：解析完
 * 不跳转，直接把 `threadId` 交给壳。
 *
 * ⚠ 每次进页面都新建一条线程会让历史迅速变成一堆空对话。所以先用
 * `listPersonalThreads` 找本项目里**已经挂着 team3、且标题是 team3 的**那条线程复用；
 * 找不到才新建。这不是缓存（不存本地状态），是每次都按服务端事实判断。
 */
import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Providers } from "@/app/chat/copilotkit-v2/copilotkit-v2-providers";
import { CopilotKitV2Shell } from "@/components/chat/copilotkit-v2-shell";
import { useSession } from "@/components/session/session-provider";
import { listCapabilities } from "@/lib/live-capabilities";
import { listProjects, createProject } from "@/lib/live-projects";
import { createThread, getAgentPanel, updateAgentRoster, listThreads } from "@/lib/live-chat";

/** 与 `apps/api/scripts/backfill-team3-agent.ts` 的 `TEAM3_AGENT_NAME` 逐字一致。 */
const TEAM3_AGENT_NAME = "前沿赛道技术路线研判";

type Resolved = { threadId: string; projectId: string };

async function resolveTeam3Thread(orgId: string): Promise<Resolved> {
  const agents = await listCapabilities(orgId, "agent");
  const team3 = agents.find((a) => a.name === TEAM3_AGENT_NAME && a.enabled);
  if (!team3) {
    throw new Error(
      "本组织尚未配置「前沿赛道技术路线研判」Agent（部署期补种脚本还没跑，或本组织不是 Workspace）。",
    );
  }

  const projects = await listProjects(orgId);
  const projectId = projects[0]?.id
    ?? (await createProject({ orgId, name: TEAM3_AGENT_NAME, kind: "research_project", blueprintVersionId: null })).id;

  // 复用已有线程：避免每次进页面都新建一条空对话（见文件头注）。
  // 读失败不阻断——退化成"新建一条"，比整页打不开好。
  const existing = await listThreads(projectId).catch(() => null);
  const reusable = existing?.groups
    .flatMap((g) => g.cards)
    .find((c) => c.title === TEAM3_AGENT_NAME);
  if (reusable) return { threadId: reusable.id, projectId };

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
  return { threadId: thread.threadId, projectId };
}

export function Team3Chat(): JSX.Element {
  const { session } = useSession();
  const orgId = session?.currentOrgId ?? null;
  const [resolved, setResolved] = React.useState<Resolved | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!orgId || resolved) return;
    let cancelled = false;
    void resolveTeam3Thread(orgId)
      .then((r) => { if (!cancelled) setResolved(r); })
      .catch((e: unknown) => {
        if (!cancelled) setFailure(e instanceof Error ? e.message : "打开对话失败，请刷新重试。");
      });
    return () => { cancelled = true; };
  }, [orgId, resolved]);

  if (failure !== null) {
    return (
      <div
        data-testid="team3-chat-error"
        className="mx-auto w-full max-w-screen-2xl px-5 py-6 text-12 text-destructive md:px-8 lg:px-10"
      >
        {failure}
      </div>
    );
  }

  if (resolved === null) {
    return (
      <div
        data-testid="team3-chat-loading"
        className="mx-auto w-full max-w-screen-2xl px-5 py-6 text-12 text-muted-foreground md:px-8 lg:px-10"
      >
        正在打开「{TEAM3_AGENT_NAME}」对话…
      </div>
    );
  }

  return (
    <div data-testid="team3-chat" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <CopilotKitV2Shell initialThreadId={resolved.threadId} projectId={resolved.projectId} />
    </div>
  );
}

/** 页面级挂点：把 `/chat` 那三层 provider 原样套上，壳才能正常工作（见文件头注）。 */
export function Team3ChatScreen(): JSX.Element {
  return (
    <CopilotKitV2AgentSelectionProvider>
      <CopilotKitV2Providers>
        <AppShell previewRole={null} hideTopBar>
          <Team3Chat />
        </AppShell>
      </CopilotKitV2Providers>
    </CopilotKitV2AgentSelectionProvider>
  );
}
