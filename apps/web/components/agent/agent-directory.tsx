"use client";

import { ResourceCard, ResourceCardTags } from "@/components/ui/resource-card";
import * as React from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import { DeniedState, ErrorState, LoadingSkeleton } from "@/components/work-stack/states";
import { Bot, FileText, MessageCircle, UserRoundPlus, Workflow } from "lucide-react";
import { agentTaskExamples, directoryWorkflowStatus } from "@/lib/agent-directory-tasks";
import { workflowLabelsOf } from "@/lib/workflow-catalog-title-copy";
import {
  AGENT_ROLE_CATEGORIES,
  agentDisplayName,
  agentSubtitle,
  ROLE_CATEGORY_LABEL,
  listAgentDirectory,
  type AgentDirectoryCard,
  type AgentRoleCategory,
} from "@/lib/agent-directory";

/**
 * AG04（契约束 agent-role UC-4，ui.md）—— 成员 Agent 目录：`/agent` 路由的客户端组件。
 * 接真实后端 `GET /agents/directory`（`listAgentDirectory`）——没有 mock 数据、没有示例卡片。
 * 空结果就是真实空态（同 `skill-catalog-live.tsx` 头注①的同一条纪律）。
 *
 * 就绪状态只暴露两档文案给成员（R5：「不列授权详情」）——契约三档
 * （ready/missing/unknown）里 `missing`/`unknown` 一律显示「能力未就绪」，不区分「明确缺失」
 * 与「查不到」，那条区分本身就是授权细节。
 */
function ReadinessBadge({ card }: { card: AgentDirectoryCard }) {
  const status = directoryWorkflowStatus(card);
  return <Badge tone={status.tone} data-testid="agent-card-readiness" title={status.description} className="shrink-0 whitespace-nowrap text-12">{status.label}</Badge>;
}

/**
 * uiux-r5 #3.2：「部分能力待开通」要说清缺什么。契约只给三档就绪度（R5 不列授权详情），所以原因按
 * 角色类别映射成人话——销售类缺的是 CRM 连接；其余给通用说明。不含授权码 / 内部名。
 */
export function readinessReasonText(card: Pick<AgentDirectoryCard, "readiness" | "roleCategory">): string | null {
  if (card.readiness === "ready") return null;
  if (card.roleCategory === "sales") return "部分能力待开通：销售类流程需接入 CRM 后开放。日常对话可直接开始。";
  if (card.roleCategory === "customer_success") return "部分能力待开通：客户问题处理需接入工单系统后开放，未接入时只能产出草稿。日常对话可直接开始。";
  return "部分能力待开通：需要连接外部系统的动作，等组织管理员开通后开放。日常对话可直接开始。";
}

function AgentCard({ card, onStartChat }: { card: AgentDirectoryCard; onStartChat: (agentId: string, prefill?: string) => void }) {
  const name = agentDisplayName(card);
  const subtitle = agentSubtitle(card);
  const detailHref = `/agent/${encodeURIComponent(card.agentId)}`;
  const workflowLabels = workflowLabelsOf(card);
  const readinessReason = readinessReasonText(card);
  // uiux-r5 #3.1：没有标签的数字人（通用助手）用角色类别兜一枚中性标签，不留空行。
  const displayTags = card.tags.length > 0 ? card.tags : [card.roleCategory ? ROLE_CATEGORY_LABEL[card.roleCategory] : "通用"];
  const workflowsLine = workflowLabels.length > 0 ? `关联流程：${workflowLabels.join("、")}` : null;
  const examples = agentTaskExamples(card);
  return (
    <ResourceCard
      testId={`agent-card-${card.agentId}`}
      className="shadow-none [&_h3]:text-16 [&_p]:text-14"
      ariaLabel={name}
      leading={
        <Avatar
          data-testid="agent-card-avatar"
          initials={card.initials}
          avatarKey={card.avatar?.key ?? null}
          tone="ai"
          className="h-16 w-16 text-20"
        />
      }
      title={
        <Link
          href={detailHref}
          data-testid="agent-card-detail-link"
          aria-label={`查看 ${name} 的详情`}
          className="rounded-sm underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {name}
        </Link>
      }
      subtitle={subtitle ? <span data-testid="agent-card-subtitle" title={subtitle}>{firstClause(subtitle)}</span> : undefined}
      badges={card.catalogSource === "official" ? <Badge tone="ai" data-testid="agent-card-official-badge">官方</Badge> : undefined}
      tags={<ResourceCardTags tags={displayTags} max={2} testId="agent-card-tags" />}
      meta={
        <>
          <span data-testid="agent-card-workflows" className="flex min-w-0 items-center gap-1 truncate">
            <Workflow aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate" title={workflowsLine ?? undefined}>{workflowsLine ?? "直接对话推进"}</span>
          </span>
          <div className="flex flex-wrap gap-2">
            <Badge tone="success" data-testid="agent-card-conversation-status" className="whitespace-nowrap text-12"><MessageCircle aria-hidden className="h-3.5 w-3.5" />对话可用</Badge>
            <ReadinessBadge card={card} />
          </div>
        </>
      }
      actions={
        <>
          <Button asChild size="sm" variant="outline">
            <Link href={detailHref} data-testid="agent-card-view-detail">查看能力</Link>
          </Button>
          <Button
            size="md"
            variant="primary"
            className="ml-auto"
            data-testid="agent-card-start-chat"
            title={readinessReason ?? undefined}
            onClick={() => onStartChat(card.agentId)}
          >
            开始任务
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-2 py-2" aria-label={`${name}的示例任务`} data-testid="agent-card-task-examples">
        {examples.map((example) => (
          <Button key={example.label} type="button" size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal text-left text-12" onClick={() => onStartChat(card.agentId, example.prompt)}>
            <FileText aria-hidden className="h-4 w-4 shrink-0" />{example.label}
          </Button>
        ))}
      </div>
      {readinessReason !== null ? (
        <p data-testid="agent-card-readiness-reason" title={readinessReason} className="line-clamp-2 min-h-[2rem] text-11 text-muted-foreground">{readinessReason}</p>
      ) : null}
    </ResourceCard>
  );
}

const GRID = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3";
const GROUP_THRESHOLD = 9;

function sortByCategory(cards: readonly AgentDirectoryCard[]): readonly AgentDirectoryCard[] {
  const rank = (c: AgentDirectoryCard) => (c.roleCategory ? AGENT_ROLE_CATEGORIES.indexOf(c.roleCategory) : AGENT_ROLE_CATEGORIES.length);
  return [...cards].sort((a, b) => rank(a) - rank(b));
}

export interface AgentDirectoryProps {
  /** 测试/宿主可注入；默认使用真实 `listAgentDirectory`。 */
  fetchDirectory?: (filters: { roleCategory?: AgentRoleCategory; q?: string }) => Promise<readonly AgentDirectoryCard[]>;
  onStartChat?: (agentId: string, prefill?: string) => void;
  /** Authenticated, organization-scoped host owns the actual offer and imports. */
  officialRoles?: React.ReactNode;
  canManageOfficial?: boolean;
  directoryRefreshKey?: number;
}

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly cards: readonly AgentDirectoryCard[] };

export function AgentDirectory({ fetchDirectory = listAgentDirectory, onStartChat, officialRoles, canManageOfficial = false, directoryRefreshKey = 0 }: AgentDirectoryProps) {
  const [tab, setTab] = React.useState<"organization" | "official">("organization");
  const [category, setCategory] = React.useState<AgentRoleCategory | "all">("all");
  const [query, setQuery] = React.useState("");
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const requestId = React.useRef(0);

  const load = React.useCallback((filters: { roleCategory?: AgentRoleCategory; q?: string }) => {
    const id = ++requestId.current;
    setState({ kind: "loading" });
    fetchDirectory(filters).then(
      (cards) => { if (requestId.current === id) setState({ kind: "ready", cards }); },
      (error: unknown) => {
        if (requestId.current !== id) return;
        if (error instanceof ApiError && error.status === 401) { setState({ kind: "denied" }); return; }
        // 不把 reasonCode / error.message 端上屏（曾显示「AGENT_NOT_FOUND」）：只说人话。
        setState({ kind: "error", message: error instanceof ApiError ? httpFailureText(error.status) : "网络连接出了问题，稍后再试一次" });
      },
    );
  }, [fetchDirectory]);

  React.useEffect(() => {
    if (tab !== "organization") return;
    const filters = { roleCategory: category === "all" ? undefined : category, q: query.trim() || undefined };
    const timer = window.setTimeout(() => load(filters), query ? 250 : 0);
    return () => { window.clearTimeout(timer); requestId.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` 依赖 `fetchDirectory`，两者一起触发即可
  }, [category, query, load, tab, directoryRefreshKey]);

  React.useEffect(() => { if (directoryRefreshKey > 0) setTab("organization"); }, [directoryRefreshKey]);

  const handleStartChat = onStartChat ?? (() => { /* 未接线的宿主：无操作，不假装跳转 */ });

  return (
    <div data-testid="agent-directory" className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-24 font-bold text-background-foreground">数字人目录</h1>
              <p className="mt-1 text-14 text-muted-foreground">按角色找同事，按任务开始工作。</p>
            </div>
            {officialRoles && canManageOfficial && tab === "organization" ? (
              <Button type="button" variant="outline" onClick={() => setTab("official")} data-testid="agent-directory-enable-official">
                <UserRoundPlus aria-hidden className="h-4 w-4" />启用官方数字人
              </Button>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {officialRoles ? (
              <div className="flex shrink-0 gap-1 rounded-control bg-muted p-1" aria-label="数字人目录范围">
                <Button type="button" variant={tab === "organization" ? "primary" : "ghost"} aria-pressed={tab === "organization"} onClick={() => setTab("organization")}>本组织</Button>
                <Button type="button" variant={tab === "official" ? "primary" : "ghost"} aria-pressed={tab === "official"} onClick={() => setTab("official")}>官方角色</Button>
              </div>
            ) : null}
            {tab === "organization" ? (
              <Input data-testid="agent-directory-search" placeholder="搜索角色、标签…" value={query}
                onChange={(event) => setQuery(event.target.value)} aria-label="搜索数字人" className="min-w-0 flex-1" />
            ) : null}
          </div>
          {tab === "organization" ? (
            <div data-testid="agent-directory-filter-category" className="flex flex-wrap gap-1">
              <Button type="button" size="sm" variant={category === "all" ? "secondary" : "ghost"} aria-pressed={category === "all"} onClick={() => setCategory("all")}>全部</Button>
              {AGENT_ROLE_CATEGORIES.map((c) => (
                <Button key={c} type="button" size="sm" variant={category === c ? "secondary" : "ghost"} aria-pressed={category === c} onClick={() => setCategory(c)}>{ROLE_CATEGORY_LABEL[c]}</Button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
       <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-6">
        {tab === "official" ? (
          <div data-testid="agent-directory-official">
            {officialRoles}
            <Button type="button" variant="outline" className="mt-4" onClick={() => setTab("organization")}>查看本组织数字人</Button>
          </div>
        ) : (
          <>
            {directoryRefreshKey > 0 ? <p role="status" className="mb-4 text-14 text-muted-foreground">数字人配置已更新。具体能力以详情中的就绪状态为准。</p> : null}
        {state.kind === "loading" && <LoadingSkeleton testid="agent-directory-loading" />}
        {state.kind === "denied" && <DeniedState testid="agent-directory-denied" />}
        {state.kind === "error" && (
          <ErrorState
            testid="agent-directory-error"
            message={`角色目录加载失败：${state.message}`}
            onRetry={() => load({ roleCategory: category === "all" ? undefined : category, q: query.trim() || undefined })}
          />
        )}
        {state.kind === "ready" && state.cards.length === 0 && (
          <div data-testid="agent-directory-empty" className="flex flex-col items-center gap-2 rounded-card border border-dashed border-border px-4 py-12 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ai-tint text-ai-tint-foreground">
              <Bot aria-hidden className="h-5 w-5" />
            </span>
            <p className="text-14 font-medium text-background-foreground">
              {query.trim() || category !== "all" ? "没有符合条件的数字人" : "组织里还没有数字人"}
            </p>
            <p className="max-w-md text-12 text-muted-foreground">
              {query.trim() || category !== "all"
                ? "换个关键词，或者回到「全部」看看。"
                : "组织管理员导入官方角色包后，这里会出现研究、产品、销售、设计等角色。"}
            </p>
            {(query.trim() || category !== "all") && (
              <Button size="sm" variant="outline" onClick={() => { setQuery(""); setCategory("all"); }}>清除筛选</Button>
            )}
          </div>
        )}
        {state.kind === "ready" && state.cards.length > 0 && (
          // 卡片少时（每类一两张）按类分组会变成一列单卡、右半屏空着（uiux-r1 #3 P0-1）——
          // 超过一屏的量才分组，否则一张网格铺满容器。
          state.cards.length > GROUP_THRESHOLD ? (
            <div className="flex flex-col gap-6">
              {AGENT_ROLE_CATEGORIES.filter((c) => state.cards.some((card) => card.roleCategory === c)).map((c) => (
                <section key={c} data-testid={`agent-directory-group-${c}`}>
                  <h2 className="mb-3 text-12 font-medium text-muted-foreground">{ROLE_CATEGORY_LABEL[c]}</h2>
                  <div className={GRID}>
                    {state.cards.filter((card) => card.roleCategory === c).map((card) => (
                      <AgentCard key={card.agentId} card={card} onStartChat={handleStartChat} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div data-testid="agent-directory-grid" className={GRID}>
              {sortByCategory(state.cards).map((card) => (
                <AgentCard key={card.agentId} card={card} onStartChat={handleStartChat} />
              ))}
            </div>
          )
        )}
            {state.kind === "ready" && state.cards.length > 0 ? (
              <p className="mt-5 text-12 text-muted-foreground">示例任务会预填到新对话，发送前可以修改；已有草稿会保留。角色启用与流程业务验收是不同状态。</p>
            ) : null}
            {officialRoles ? <Button type="button" variant="ghost" className="mt-3" onClick={() => setTab("official")}>浏览官方角色</Button> : null}
          </>
        )}
       </div>
      </div>
    </div>
  );
}

/**
 * 卡片描述只取到句子边界（uiux-r2 #3.3 / uiux-r3 #3.2：不在半句中间断）；完整文字放 title 提示。
 * 句子边界只认 。！？——「；」「，」后面还有半句话，停在那里读起来就是被截断的。第一句本身就超长时，
 * 退到最后一个分句处收成完整的一句（句号结尾，不挂省略号）。渲染处不再叠 CSS 行数截断，
 * 否则这里取好的整句又会被视觉上切一刀。
 */
export function firstClause(text: string, max = 40): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const m = /^[^。！？!?]*[。！？!?]/.exec(t);
  const sentence = m ? m[0] : t;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  const at = Math.max(cut.lastIndexOf("；"), cut.lastIndexOf("，"), cut.lastIndexOf("、"));
  return at > 8 ? `${cut.slice(0, at)}。` : sentence;
}
