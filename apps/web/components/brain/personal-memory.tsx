"use client";
import * as React from "react";
import Link from "next/link";
import { Lock, MessageSquare, Search } from "lucide-react";
import type { KgClaimKind } from "@repo/contracts/chat-knowledge-graph";
import { ClaimTriStateBadge } from "@/components/chat/knowledge/claim-tri-state-badge";
import { StateShell } from "@/components/state/state-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { countByKind, filterPersonalClaims, originsByClaim, type PersonalClaimOrigin } from "@/lib/brain-view";
import { chatMemoryHref } from "@/lib/chat-memory-link";
import type { PersonalKnowledge } from "@/lib/knowledge-graph-api";
import { KG_CLAIM_KIND_LABEL_ZH, KG_OBJECT_KIND_LABEL_ZH, groupClaimsByKind } from "@/lib/knowledge-graph-view";

/** 我的长期记忆（个人空间）：按类型分组、可搜、每条能点回出自的对话。只读——修改在对话的「记忆」页签里做。 */
export function PersonalMemory({
  personal, origins, onShowSessions,
}: {
  personal: PersonalKnowledge;
  origins: readonly PersonalClaimOrigin[];
  onShowSessions: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [kind, setKind] = React.useState<KgClaimKind | null>(null);
  const byClaim = React.useMemo(() => originsByClaim(origins), [origins]);
  const kinds = React.useMemo(() => countByKind(personal.claims), [personal.claims]);
  const visible = React.useMemo(() => filterPersonalClaims(personal.claims, query, kind), [personal.claims, query, kind]);
  const objects = personal.objects.filter((o) => o.claimCount > 0);

  return (
    <div className="flex flex-col gap-4" data-testid="brain-personal">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3" data-testid="brain-personal-notice">
        <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-12 text-muted-foreground">
          只有你自己看得到。在对话的「记忆」页签里点「记到我的长期记忆」，那一条就会出现在这里，换个对话我也记得。
        </p>
      </div>

      {personal.claims.length === 0 ? (
        <div className="flex flex-col gap-2" data-testid="brain-personal-empty">
          <StateShell state="empty" emptyHint="长期记忆里还没有东西。去对话里把值得记住的内容记下来吧。">{null}</StateShell>
          <div className="flex justify-center">
            <Button size="sm" variant="outline" onClick={onShowSessions} data-testid="brain-personal-go-sessions">
              看看对话里记下了什么
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索长期记忆"
                aria-label="搜索长期记忆"
                className="pl-7"
                data-testid="brain-personal-search"
              />
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="按类型筛选">
              <KindChip active={kind === null} onClick={() => setKind(null)} testId="brain-kind-all">
                全部 {personal.claims.length}
              </KindChip>
              {kinds.map((k) => (
                <KindChip key={k.kind} active={kind === k.kind} onClick={() => setKind(k.kind)} testId={`brain-kind-${k.kind}`}>
                  {KG_CLAIM_KIND_LABEL_ZH[k.kind]} {k.count}
                </KindChip>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border py-6 text-center text-12 text-muted-foreground" data-testid="brain-personal-no-match">
              没有符合条件的记忆，换个关键字或类型试试。
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {groupClaimsByKind(visible).map((g) => (
                <section key={g.kind} className="flex flex-col gap-2" data-testid={`brain-personal-group-${g.kind}`}>
                  <h2 className="text-11 font-semibold text-muted-foreground">{g.label} · {g.claims.length}</h2>
                  <ul className="flex flex-col gap-2">
                    {g.claims.map((c) => (
                      <li key={c.id} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3" data-testid="brain-personal-item">
                        <div className="flex items-start gap-2">
                          <p className="min-w-0 flex-1 text-13">{c.statement}</p>
                          <ClaimTriStateBadge status={c.status} />
                        </div>
                        <OriginLinks origins={byClaim.get(c.id) ?? []} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {objects.length > 0 ? (
            <section className="flex flex-col gap-2" data-testid="brain-personal-objects">
              <h2 className="text-11 font-semibold text-muted-foreground">涉及的人和事 · {objects.length}</h2>
              <div className="flex flex-wrap gap-1.5">
                {objects.map((o) => (
                  <span key={o.id} className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-panel px-2 py-1 text-12" data-testid="brain-personal-object">
                    {o.name}
                    <span className="text-10 text-muted-foreground">{KG_OBJECT_KIND_LABEL_ZH[o.kind]} · {o.claimCount}</span>
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function KindChip({ active, onClick, testId, children }: { active: boolean; onClick: () => void; testId: string; children: React.ReactNode }) {
  return (
    <Button size="xs" variant={active ? "primary" : "ghost"} aria-pressed={active} onClick={onClick} data-testid={testId}>
      {children}
    </Button>
  );
}

function OriginLinks({ origins }: { origins: readonly PersonalClaimOrigin[] }) {
  if (origins.length === 0) {
    return (
      <p className="text-11 text-muted-foreground" data-testid="brain-origin-gone">
        出自的那句话已经不在了（对话或原话被删除，或那一条在对话里被忘掉了）。
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-11 text-muted-foreground">
      <span>来自对话</span>
      {origins.map((o) => (
        <Link
          key={`${o.threadId}:${o.sourceClaimId}`}
          href={chatMemoryHref({ threadId: o.threadId, projectId: o.projectId, claimId: o.sourceClaimId })}
          className="inline-flex items-center gap-1 rounded px-1 text-primary underline-offset-2 transition-colors hover:underline"
          data-testid="brain-origin-link"
        >
          <MessageSquare aria-hidden className="h-3 w-3" />
          {o.threadTitle.trim() === "" ? "未命名对话" : o.threadTitle}
        </Link>
      ))}
      <Badge tone="outline">点开看原话</Badge>
    </div>
  );
}
