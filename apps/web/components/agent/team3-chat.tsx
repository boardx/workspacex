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
import { createPersonalThread, getAgentPanel, updateAgentRoster, listPersonalThreads } from "@/lib/live-chat";
import { getResearchSession, type ResearchSession } from "@/lib/live-research-workflow";
import { ResearchPhaseBar } from "./research-phase-bar";
import { ResearchMaterialIntake } from "./research-material-intake";
import { ResearchMaterialReview } from "./research-material-review";
import { ResearchAuditTrail, ResearchGatePanel } from "./research-gate-panel";
import { ResearchVerification } from "./research-verification";
import { getResearchPredictions, type ResearchPrediction } from "@/lib/live-research-workflow";

/** 与 `apps/api/scripts/backfill-team3-agent.ts` 的 `TEAM3_AGENT_NAME` 逐字一致。 */
const TEAM3_AGENT_NAME = "前沿赛道技术路线研判";

/**
 * ⚠ **必须同时交出 `agentId`**（2026-09-15 真机实测）：只给 threadId 正是漏掉的那一环。
 * 「把 Agent 挂进 roster」决定的是"这条线程编制里有谁"，**不决定"这次请求用哪个 agent"**。
 * 不把 agentId 交给选择 provider，请求就不带 `COPILOTKIT_V2_SELECTED_AGENT_HEADER`，
 * 服务端落到「org 动态默认」= 通用助手——本 Agent 的 instructions 一行都进不了
 * system prompt，用户问什么都由通用助手回答。
 */
type Resolved = { threadId: string; agentId: string };

/**
 * ⚠ 用**个人线程**（`projectId: null`），不是项目线程——2026-09-15 devapp 真机实测
 * 修的 bug。此前的写法是「取组织里第一个可见项目当锚点，在那下面建线程」，结果在
 * devapp 上整页红字 `NO_WRITE_ROLE`：`update-agent-roster.ts` 对**项目线程**要求调用者
 * 在该项目里有写角色（`role === null || role === "observer"` 一律 403），而"能看见某个
 * 项目"跟"在那个项目里能写"是两件事，第一个可见项目很可能只是别人让你旁观的。
 *
 * 同一个文件里，个人线程被显式豁免这条检查（`if (!isPersonalThread)`）。而且对 team3
 * 这种「我自己的研究助手」，个人线程本来就是对的语义：它不该往某个别人的项目里塞线程。
 */
async function resolveTeam3Thread(orgId: string): Promise<Resolved> {
  const agents = await listCapabilities(orgId, "agent");
  const team3 = agents.find((a) => a.name === TEAM3_AGENT_NAME && a.enabled);
  if (!team3) {
    throw new Error(
      "本组织尚未配置「前沿赛道技术路线研判」Agent（部署期补种脚本还没跑，或本组织不是 Workspace）。",
    );
  }

  // 复用已有线程：避免每次进页面都新建一条空对话（见文件头注）。
  // 读失败不阻断——退化成"新建一条"，比整页打不开好。
  const existing = await listPersonalThreads({ q: TEAM3_AGENT_NAME }).catch(() => null);
  const reusable = existing?.groups
    .flatMap((g) => g.cards)
    .find((c) => c.title === TEAM3_AGENT_NAME);
  if (reusable) return { threadId: reusable.id, agentId: team3.id };

  const thread = await createPersonalThread(TEAM3_AGENT_NAME);
  const panel = await getAgentPanel(thread.threadId, null);
  await updateAgentRoster(thread.threadId, null, {
    add: [team3.id],
    remove: [],
    expectedRosterVersion: panel.rosterVersion,
  });
  return { threadId: thread.threadId, agentId: team3.id };
}

/** 把服务端错误码翻成用户能据以行动的一句话；认不出的原样交给兜底文案。 */
function explainFailure(raw: string): string {
  if (raw.includes("NO_WRITE_ROLE")) return "当前账号没有写权限，无法把 Agent 加进这条对话";
  if (raw.includes("AGENT_OUT_OF_SCOPE")) return "这个 Agent 不在本组织的能力目录里";
  if (raw.includes("AGENT_NOT_FOUND")) return "找不到这个 Agent";
  if (raw.includes("尚未配置")) return raw;
  return "打开对话失败，请刷新重试";
}

/** 对话体本身。解析已由 {@link Team3ChatScreen} 完成，这里只消费结果。 */
export function Team3Chat({ resolved }: { resolved: Resolved }): JSX.Element {
  const [research, setResearch] = React.useState<ResearchSession | null>(null);
  const [predictions, setPredictions] = React.useState<ResearchPrediction[]>([]);

  // 阶段条与预测表的数据。读失败**不阻断聊天**——研判流程状态是增益，拿不到它时
  // 聊天本身仍然完全可用；把次要功能的故障升级成主功能不可用是更糟的选择。
  React.useEffect(() => {
    let cancelled = false;
    void getResearchSession(resolved.threadId)
      .then((s) => { if (!cancelled) setResearch(s); })
      .catch(() => undefined);
    void getResearchPredictions(resolved.threadId)
      .then((p) => { if (!cancelled) setPredictions(p); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [resolved]);

  /**
   * 研判面板 —— 全部经壳的 `conversationHeader` 插槽渲染到**对话列内部**。
   *
   * ⚠ 2026-09-15 devapp 真机截图实测的教训：此前它们是 `CopilotKitV2Shell` 的
   * **兄弟节点**，而那个壳自己就渲染整套布局（侧边栏 + 对话列）。结果是面板横在
   * 整个应用之上、侧边栏被挤到下半屏。壳是"一整个屏"，不是一个内容块。
   */
  const panels = research ? (
    <div data-testid="team3-panels" className="shrink-0 overflow-y-auto">
      <ResearchPhaseBar
        phase={research.phase}
        publishedGraphVersion={research.lineage.publishedGraphVersion}
        verifyDueAt={research.verifyDueAt}
      />
      {/* 下面每个组件都自己判断该不该出现（不该出现时返回 null），
          所以这里不再重复一遍阶段条件——两处判断迟早会说不一致。 */}
      <ResearchMaterialIntake session={research} onChange={setResearch} />
      <ResearchMaterialReview session={research} onChange={setResearch} />
      <ResearchGatePanel session={research} onChange={setResearch} />
      <ResearchVerification
        threadId={research.threadId}
        predictions={predictions}
        onChange={setPredictions}
      />
      <ResearchAuditTrail threadId={research.threadId} />
    </div>
  ) : null;

  return (
    <div data-testid="team3-chat" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 个人线程 ⇒ projectId 恒为 null（壳的入参本就是 `string | null`）。 */}
      <CopilotKitV2Shell
        initialThreadId={resolved.threadId}
        projectId={null}
        conversationHeader={panels}
      />
    </div>
  );
}


/**
 * 页面级挂点。
 *
 * ⚠ **先解析、再挂 provider**，不是先挂再异步 setState。
 * `copilotkit-v2-providers.tsx` 关于 token 的头注记录过同一个时序竞争：底层 proxied
 * agent 有一定概率在构造那一帧就把 headers 定死，随后的 prop 变化不一定生效；那里的
 * 结论是"让首帧就是最终值，消灭空档本身，而不是试图跑赢它"。选中的 agent 走的是同一
 * 条 header 通道，所以沿用同一条纪律——解析完成之前只渲染加载/错误态，不挂壳。
 *
 * 顺带：解析会建线程，若内外各调一次就会建出两条空对话。所以解析**只在这里发生一次**，
 * `Team3Chat` 拿现成的结果。
 */
export function Team3ChatScreen(): JSX.Element {
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
        // 直接把服务端错误码摊在页面上对用户毫无信息量；翻成人话但**保留原始码**。
        if (cancelled) return;
        const raw = e instanceof Error ? e.message : String(e);
        setFailure(`${explainFailure(raw)}（${raw}）`);
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
    // ⚠ initialAgentId 是这次修复的要害：不传它，请求就不带选中 header，
    //   服务端落到 org 动态默认（通用助手），本 Agent 的 instructions 一行都进不去。
    <CopilotKitV2AgentSelectionProvider initialAgentId={resolved.agentId}>
      <CopilotKitV2Providers>
        <AppShell previewRole={null} hideTopBar>
          <Team3Chat resolved={resolved} />
        </AppShell>
      </CopilotKitV2Providers>
    </CopilotKitV2AgentSelectionProvider>
  );
}
