"use client";
import * as React from "react";
import Link from "next/link";
import { History, Lock, MessageSquare, Search } from "lucide-react";
import type { KgClaimKind } from "@repo/contracts/chat-knowledge-graph";
import { ClaimTriStateBadge } from "@/components/chat/knowledge/claim-tri-state-badge";
import { StateShell } from "@/components/state/state-shell";
import { ShareToProject } from "@/components/brain/share-to-project";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forgetFromBrain, undoSupersedeFromBrain } from "@/lib/brain-memory-actions";
import {
  countByKind, earliestSaidAt, filterPersonalClaims, forgetPlan, originsByClaim, replacedByClaim,
  type PersonalClaimOrigin, type PersonalReplaced,
} from "@/lib/brain-view";
import { chatMemoryHref } from "@/lib/chat-memory-link";
import type { PersonalKnowledge } from "@/lib/knowledge-graph-api";
import { BRAIN_FORGET_STILL_LIVE_ZH, KG_RELOAD_ON_FAILURE, describeBrainActionFailure } from "@/lib/knowledge-graph-failure";
import { knowledgeGraphErrorCode } from "@/lib/knowledge-graph-api";
import { personalOriginLabel } from "@/lib/knowledge-graph-recall";
import { KG_CLAIM_KIND_LABEL_ZH, KG_OBJECT_KIND_LABEL_ZH, groupClaimsByKind } from "@/lib/knowledge-graph-view";

type Claim = PersonalKnowledge["claims"][number];
/** 正在进行 / 刚失败的那一个动作：忘掉某条，或撤销某条旧记忆的取代。 */
type Pending = { readonly kind: "forget"; readonly claimId: string } | { readonly kind: "undo"; readonly oldClaimId: string };
interface ActionError { readonly claimId: string; readonly message: string }

/**
 * 我的长期记忆（个人空间）：按类型分组、可搜、每条带「来自你 {M/D} 的对话」并能点回出自的对话。
 * issue #4302（人类决定 2026-09-26）：被改口取代的旧记忆折叠在新的那条下面（「取代了：…」），被忘掉的不显示；
 * 每条可以「忘掉这条」，折叠的旧记忆可以「撤销取代」——两者都复用对话里的既有动作（lib/brain-memory-actions.ts）。
 * 动作一点就先在界面上生效（乐观），成功后静默重读；失败就放回原样，并在那一条下面说清原因。
 */
export function PersonalMemory({
  personal, origins, onShowSessions, onChanged,
}: {
  personal: PersonalKnowledge;
  origins: readonly PersonalClaimOrigin[];
  onShowSessions: () => void;
  /** 改过之后静默重读两份数据（use-brain-data 的 refresh），返回重读到的长期记忆 */
  onChanged: () => Promise<PersonalKnowledge>;
}) {
  const [query, setQuery] = React.useState("");
  const [kind, setKind] = React.useState<KgClaimKind | null>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [error, setError] = React.useState<ActionError | null>(null);
  const byClaim = React.useMemo(() => originsByClaim(origins), [origins]);
  const replaced = React.useMemo(() => replacedByClaim(personal.replaced), [personal.replaced]);
  // 乐观：正在忘掉的那条先不显示（失败再放回来）
  const claims = React.useMemo(
    () => personal.claims.filter((c) => !(pending?.kind === "forget" && pending.claimId === c.id)),
    [personal.claims, pending],
  );
  const kinds = React.useMemo(() => countByKind(claims), [claims]);
  const visible = React.useMemo(() => filterPersonalClaims(claims, query, kind), [claims, query, kind]);
  const objects = personal.objects.filter((o) => o.claimCount > 0);

  const run = async (
    next: Pending, anchorClaimId: string, act: (progress: (n: number) => void) => Promise<void>,
    /** 成功后按重读结果核对：返回一句话 ⇒ 动作没有真的生效，如实说在那一条下面 */
    check: (fresh: PersonalKnowledge) => string | null = () => null,
  ) => {
    if (pending !== null) return;
    setError(null);
    setPending(next);
    let progressed = 0;
    try {
      await act((n) => { progressed = n; });
      const fresh = await onChanged().catch(() => null);
      const notDone = fresh === null ? null : check(fresh);
      if (notDone !== null) setError({ claimId: anchorClaimId, message: notDone });
    } catch (e) {
      setError({ claimId: anchorClaimId, message: describeBrainActionFailure(e) });
      // 服务端已经和界面不一致（这一条变了 / 版本变了），或多个来源里已经做掉了几个 ⇒ 重读看真实结果
      const code = knowledgeGraphErrorCode(e);
      if (progressed > 0 || (code !== null && (KG_RELOAD_ON_FAILURE.has(code) || code === "KG_PROMPT_NOT_FOUND"))) {
        await onChanged().catch(() => undefined);
      }
    } finally {
      setPending(null);
    }
  };
  const forget = (c: Claim) => {
    const steps = forgetPlan(c, byClaim.get(c.id) ?? []);
    if (steps === null) return;
    void run(
      { kind: "forget", claimId: c.id }, c.id, (p) => forgetFromBrain(steps, p),
      (fresh) => (fresh.claims.some((x) => x.id === c.id) ? BRAIN_FORGET_STILL_LIVE_ZH : null),
    );
  };
  const undoSupersede = (by: Claim, r: PersonalReplaced) => {
    if (r.undo === null) return;
    const undo = r.undo;
    void run({ kind: "undo", oldClaimId: r.replaces.claimId }, by.id, () => undoSupersedeFromBrain(undo));
  };

  return (
    <div className="flex flex-col gap-4" data-testid="brain-personal">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3" data-testid="brain-personal-notice">
        <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-12 text-muted-foreground">
          只有你自己看得到。在对话的「记忆」页签里点「记到我的长期记忆」，那一条就会出现在这里，换个对话我也记得。
          在这里「忘掉这条」之后，换个对话我就不再用它；你确认过的，出自的对话里那条也会一起忘掉。
        </p>
      </div>

      {/* 出错的那一条已经不在列表里了（例如在别处被忘掉）：原因说在列表上方 */}
      {error !== null && !claims.some((c) => c.id === error.claimId) ? (
        <p role="alert" className="text-11 text-destructive" data-testid="brain-action-error">{error.message}</p>
      ) : null}

      {claims.length === 0 ? (
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
                全部 {claims.length}
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
                    {g.claims.map((c) => {
                      const from = byClaim.get(c.id) ?? [];
                      const canForget = forgetPlan(c, from) !== null;
                      const folded = (replaced.get(c.id) ?? [])
                        .filter((r) => !(pending?.kind === "undo" && pending.oldClaimId === r.replaces.claimId));
                      return (
                        <li key={c.id} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3" data-testid="brain-personal-item">
                          <div className="flex items-start gap-2">
                            <p className="min-w-0 flex-1 text-13">{c.statement}</p>
                            <ClaimTriStateBadge status={c.status} />
                          </div>
                          <OriginLinks origins={from} />
                          {folded.map((r) => (
                            <div
                              key={r.replaces.claimId}
                              className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-subtle bg-panel px-2 py-1 text-11 text-muted-foreground"
                              data-testid="brain-replaced"
                            >
                              <History aria-hidden className="h-3 w-3 shrink-0" />
                              <span className="min-w-0 flex-1" data-testid="brain-replaced-text">取代了：{r.replaces.statement}</span>
                              {r.undo !== null ? (
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  disabled={pending !== null}
                                  onClick={() => undoSupersede(c, r)}
                                  data-testid="brain-undo-supersede"
                                >
                                  撤销取代
                                </Button>
                              ) : null}
                            </div>
                          ))}
                          <div className="flex justify-end gap-1">
                            {/* S10（#4367）：显式分享到项目（先看范围，再确认；可撤回） */}
                            <ShareToProject claimId={c.id} testIdPrefix="brain-share" />
                            {canForget ? (
                              <Button
                                size="xs"
                                variant="ghost"
                                disabled={pending !== null}
                                onClick={() => forget(c)}
                                data-testid="brain-forget"
                              >
                                忘掉这条
                              </Button>
                            ) : null}
                          </div>
                          {error?.claimId === c.id ? (
                            <p role="alert" className="text-11 text-destructive" data-testid="brain-action-error">{error.message}</p>
                          ) : null}
                        </li>
                      );
                    })}
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

/** 「来自你 {M/D} 的对话」（与对话里召回 chip 同一个文案函数）；来源都没有时间时只说「来自对话」。 */
function originLabel(origins: readonly PersonalClaimOrigin[]): string {
  const saidAt = earliestSaidAt(origins);
  return saidAt === null ? "来自对话" : personalOriginLabel({ scope: "personal", saidAt }) ?? "来自对话";
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
      <span data-testid="brain-origin-time">{originLabel(origins)}</span>
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
