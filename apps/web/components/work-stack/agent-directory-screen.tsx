"use client";
import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DeniedState, EmptyState, ErrorState, LoadingSkeleton } from "@/components/work-stack/states";
import {
  OFFICIAL_AGENTS,
  ROLE_CATEGORY_LABEL,
  type OfficialAgent,
  type PreviewState,
  type Readiness,
  type RoleCategory,
} from "@/lib/mock/work-stack";

const CATEGORIES = Object.keys(ROLE_CATEGORY_LABEL) as RoleCategory[];

function readinessTag(r: Readiness) {
  if (r === "ready") return <Badge tone="success" data-testid="agent-card-readiness">可用</Badge>;
  if (r === "not_ready")
    return <Badge tone="warning" data-testid="agent-card-readiness">能力未就绪</Badge>;
  return <Badge tone="outline" data-testid="agent-card-readiness">就绪性未知</Badge>;
}

function AgentCard({ agent, onOpen }: { agent: OfficialAgent; onOpen: (id: string) => void }) {
  return (
    <Card data-testid={`agent-card-${agent.agentId}`} className="transition-colors hover:bg-muted/40">
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-center gap-3">
          <Avatar
            initials={agent.initials}
            tone="ai"
            size="lg"
            data-testid="agent-card-avatar"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-13 font-bold text-background-foreground">{agent.name}</p>
              <Badge tone="ai" data-testid="agent-card-official-badge">
                官方
              </Badge>
            </div>
            <p className="truncate text-11 text-muted-foreground">
              {agent.code} · {agent.title}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span data-testid="agent-card-workflows" className="text-11 text-muted-foreground">
            {agent.workflowCount} 个可发起 Workflow
          </span>
          {readinessTag(agent.readiness)}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" data-testid="agent-card-start-chat" onClick={() => onOpen(agent.agentId)}>
            开始对话
          </Button>
          <Button size="sm" variant="outline" onClick={() => onOpen(agent.agentId)}>
            查看详情
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentRoleSection({ agent }: { agent: OfficialAgent }) {
  return (
    <section data-testid="agent-role-section" className="flex w-96 shrink-0 flex-col gap-4 border-l border-border bg-card p-4">
      <header className="flex items-center gap-3">
        <Avatar initials={agent.initials} tone="ai" size="lg" />
        <div>
          <h2 className="text-14 font-bold text-background-foreground">{agent.name}</h2>
          <p className="text-11 text-muted-foreground">{agent.code} · {ROLE_CATEGORY_LABEL[agent.category]}</p>
        </div>
      </header>

      <p data-testid="agent-role-locked-hint" className="rounded-control bg-muted px-3 py-2 text-11 text-muted-foreground">
        官方 Agent 的白名单与策略为只读，克隆后可改。
      </p>

      <section className="flex flex-col gap-2">
        <h3 className="text-12 font-medium text-background-foreground">Workflow 白名单</h3>
        <ul data-testid="agent-card-workflows" className="flex flex-col gap-1">
          {agent.workflowAllowlist.map((w) => (
            <li key={w.key} className="flex items-center justify-between text-12">
              <span className="text-background-foreground">{w.name}</span>
              <span className="text-11 text-muted-foreground">{w.key}</span>
            </li>
          ))}
        </ul>
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <h3 className="text-12 font-medium text-background-foreground">挂载 Skill</h3>
        <ul className="flex flex-col gap-1">
          {agent.skills.map((s) => (
            <li key={s.stableId} className="flex items-center justify-between text-12">
              <span className="text-background-foreground">
                {s.name} <span className="text-muted-foreground">{s.stableId}</span>
              </span>
              <Badge tone={s.mounted ? "neutral" : "outline"}>{s.mounted ? "已挂载" : "由 Workflow 固定"}</Badge>
            </li>
          ))}
        </ul>
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <h3 className="text-12 font-medium text-background-foreground">能力就绪性</h3>
        <ul className="flex flex-col gap-1.5">
          {agent.capabilities.map((c) => (
            <li
              key={c.category}
              data-testid={`agent-role-capability-${c.category}`}
              className="flex items-center justify-between rounded-control border border-border/60 px-3 py-1.5 text-12"
            >
              <span className="text-background-foreground">{c.category}</span>
              {c.readiness === "ready" ? (
                <Badge tone="success">就绪</Badge>
              ) : c.readiness === "not_ready" ? (
                <Badge tone="warning">未就绪</Badge>
              ) : (
                <Badge tone="outline">未知</Badge>
              )}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

export function AgentDirectoryScreen({ state }: { state: PreviewState }) {
  const [category, setCategory] = React.useState<RoleCategory | "all">("all");
  const [query, setQuery] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>("D005");

  if (state === "denied") {
    return (
      <div data-testid="agent-directory" className="p-6">
        <DeniedState testid="agent-directory-denied" />
      </div>
    );
  }

  const filtered = OFFICIAL_AGENTS.filter((a) => {
    if (category !== "all" && a.category !== category) return false;
    if (query && !`${a.name}${a.code}${a.title}`.includes(query)) return false;
    return true;
  });
  const listEmpty = state === "empty" || filtered.length === 0;
  const opened = OFFICIAL_AGENTS.find((a) => a.agentId === openId) ?? null;

  const grouped = CATEGORIES.map((c) => ({
    category: c,
    agents: filtered.filter((a) => a.category === c),
  })).filter((g) => g.agents.length > 0);

  return (
    <div data-testid="agent-directory" className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <h1 className="text-14 font-bold text-background-foreground">成员 Agent 目录</h1>
        <div className="ml-auto flex items-center gap-2">
          <div data-testid="agent-directory-filter-category" className="flex gap-1">
            <button
              onClick={() => setCategory("all")}
              className={`rounded-control px-2.5 py-1 text-12 transition-colors hover:bg-muted ${
                category === "all" ? "bg-muted font-medium text-background-foreground" : "text-muted-foreground"
              }`}
            >
              全部
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
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
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索 Agent"
            />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {state === "loading" ? (
            <LoadingSkeleton testid="agent-directory-loading" />
          ) : state === "depfail" ? (
            <ErrorState
              testid="agent-directory-error"
              message="角色目录加载失败，请稍后重试。"
            />
          ) : listEmpty ? (
            <EmptyState
              testid="agent-directory-empty"
              message="没有匹配的角色 Agent。你所在组织可能尚未导入官方角色包。"
            />
          ) : (
            <div className="flex flex-col gap-6">
              {grouped.map((g) => (
                <section key={g.category} data-testid={`agent-directory-group-${g.category}`}>
                  <h2 className="mb-2 text-12 font-medium uppercase tracking-wide text-muted-foreground">
                    {ROLE_CATEGORY_LABEL[g.category]}
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    {g.agents.map((a) => (
                      <AgentCard key={a.agentId} agent={a} onOpen={setOpenId} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {opened && state !== "loading" && !listEmpty && <AgentRoleSection agent={opened} />}
      </div>
    </div>
  );
}
