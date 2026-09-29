"use client";

import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { DeniedState, EmptyState, ErrorState, LoadingSkeleton } from "@/components/work-stack/states";
import {
  AGENT_ROLE_CATEGORIES,
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
function ReadinessBadge({ readiness }: { readiness: AgentDirectoryCard["readiness"] }) {
  if (readiness === "ready") {
    return <Badge tone="success" data-testid="agent-card-readiness">可用</Badge>;
  }
  return <Badge tone="warning" data-testid="agent-card-readiness">能力未就绪</Badge>;
}

function AgentCard({ card, onStartChat }: { card: AgentDirectoryCard; onStartChat: (agentId: string) => void }) {
  return (
    <Card data-testid={`agent-card-${card.agentId}`} className="transition-colors hover:bg-muted/40">
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-center gap-3">
          <Avatar
            data-testid="agent-card-avatar"
            initials={card.initials}
            avatarKey={card.avatar?.key ?? null}
            tone="ai"
            size="lg"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-13 font-bold text-background-foreground">{card.name}</p>
              {card.catalogSource === "official" && (
                <Badge tone="ai" data-testid="agent-card-official-badge">官方</Badge>
              )}
            </div>
            <p className="truncate text-11 text-muted-foreground">{card.roleLabel}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span data-testid="agent-card-workflows" className="truncate text-11 text-muted-foreground">
            {card.workflows.length > 0
              ? `可发起：${card.workflows.map((w) => w.name).join("、")}`
              : "暂无可发起 Workflow"}
          </span>
          <ReadinessBadge readiness={card.readiness} />
        </div>
        <Button
          size="sm"
          variant="primary"
          data-testid="agent-card-start-chat"
          onClick={() => onStartChat(card.agentId)}
        >
          开始对话
        </Button>
      </CardContent>
    </Card>
  );
}

export interface AgentDirectoryProps {
  /** 测试/宿主可注入；默认使用真实 `listAgentDirectory`。 */
  fetchDirectory?: (filters: { roleCategory?: AgentRoleCategory; q?: string }) => Promise<readonly AgentDirectoryCard[]>;
  onStartChat?: (agentId: string) => void;
}

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly cards: readonly AgentDirectoryCard[] };

export function AgentDirectory({ fetchDirectory = listAgentDirectory, onStartChat }: AgentDirectoryProps) {
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
        setState({ kind: "error", message: error instanceof Error ? error.message : "加载失败" });
      },
    );
  }, [fetchDirectory]);

  React.useEffect(() => {
    const filters = { roleCategory: category === "all" ? undefined : category, q: query.trim() || undefined };
    const timer = window.setTimeout(() => load(filters), query ? 250 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` 依赖 `fetchDirectory`，两者一起触发即可
  }, [category, query, load]);

  const handleStartChat = onStartChat ?? (() => { /* 未接线的宿主：无操作，不假装跳转 */ });

  return (
    <div data-testid="agent-directory" className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <h1 className="text-14 font-bold text-background-foreground">Agent 目录</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div data-testid="agent-directory-filter-category" className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setCategory("all")}
              aria-pressed={category === "all"}
              className={`rounded-control px-2.5 py-1 text-12 transition-colors hover:bg-muted ${
                category === "all" ? "bg-muted font-medium text-background-foreground" : "text-muted-foreground"
              }`}
            >
              全部
            </button>
            {AGENT_ROLE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={`rounded-control px-2.5 py-1 text-12 transition-colors hover:bg-muted ${
                  category === c ? "bg-muted font-medium text-background-foreground" : "text-muted-foreground"
                }`}
              >
                {ROLE_CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
          <div className="w-56">
            <Input
              data-testid="agent-directory-search"
              placeholder="搜索角色…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索 Agent"
            />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
          <EmptyState testid="agent-directory-empty" message="没有匹配的角色 Agent。你所在组织可能尚未导入官方角色包，或搜索条件过窄。" />
        )}
        {state.kind === "ready" && state.cards.length > 0 && (
          <div className="flex flex-col gap-6">
            {AGENT_ROLE_CATEGORIES.filter((c) => state.cards.some((card) => card.roleCategory === c)).map((c) => (
              <section key={c} data-testid={`agent-directory-group-${c}`}>
                <h2 className="mb-2 text-12 font-medium uppercase tracking-wide text-muted-foreground">
                  {ROLE_CATEGORY_LABEL[c]}
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {state.cards.filter((card) => card.roleCategory === c).map((card) => (
                    <AgentCard key={card.agentId} card={card} onStartChat={handleStartChat} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
