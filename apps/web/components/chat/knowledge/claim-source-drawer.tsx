"use client";

import * as React from "react";
import { X, FileText, MessageSquare, ArrowUpRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ClaimTriStateBadge } from "./claim-tri-state-badge";
import type { ClaimSources } from "@/lib/knowledge-graph-api";
import { useI18n } from "@/lib/i18n/provider";
import { ShareToProject } from "@/components/brain/share-to-project";

/**
 * 来源抽屉（uc-18-2 / UC-KG-2）：一条结论的证据摘录 + 可点回原消息/附件 + provenance 行。
 * 覆盖态：加载中 / 读取失败 / 正常 / 来源已删除（uc-18-5 R8：excerpt.revoked=true 时提示「来源已删除」）。
 *
 * 数据由调用方经 `getClaimSources` 取来（`lib/knowledge-graph-api.ts`）；「跳到消息」只回调，
 * 导航由调用方决定。
 */
export function ClaimSourceDrawer({
  data,
  open,
  onClose,
  onJumpTo,
  loading = false,
  error = null,
  onRetry,
}: {
  data: ClaimSources | null;
  open: boolean;
  onClose: () => void;
  onJumpTo?: (sourceKind: string, sourceRef: string) => void;
  /** 正在读这一条的来源 */
  loading?: boolean;
  /** 读取失败时给人看的一句话（调用方已把错误码翻成人话）；null = 没有失败 */
  error?: string | null;
  onRetry?: () => void;
}) {
  const { t, locale } = useI18n();
  if (!open) return null;
  if (!data || loading || error !== null) {
    return (
      <DrawerFrame onClose={onClose}>
        <header className="flex items-start justify-between gap-2 border-b border-border-subtle p-3">
          <span className="text-11 font-medium text-muted-foreground">{t("chatKnowledge.source.header")}</span>
          <Button variant="ghost" size="xs" aria-label={t("common.close")} onClick={onClose} data-testid="kg-source-drawer-close">
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </header>
        {error !== null ? (
          <div className="flex flex-col items-start gap-2 p-3" role="alert" data-testid="kg-source-drawer-error">
            <p className="flex items-center gap-1 text-11 text-destructive">
              <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
              {error}
            </p>
            {onRetry ? (
              <Button size="xs" variant="outline" onClick={onRetry} data-testid="kg-source-drawer-retry">
                {t("chatKnowledge.retry")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-3" data-testid="kg-source-drawer-loading" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        )}
      </DrawerFrame>
    );
  }
  return (
    <DrawerFrame onClose={onClose}>
      <header className="flex items-start justify-between gap-2 border-b border-border-subtle p-3">
        <div className="flex flex-col gap-1">
          <span className="text-11 font-medium text-muted-foreground">{t("chatKnowledge.source.header")}</span>
          <div className="flex items-center gap-1.5">
            <ClaimTriStateBadge status={data.claim.status} locale={locale} />
            <span className="text-10 text-muted-foreground">
              {t("chatKnowledge.source.counts", { count: data.evidence.filter((e) => !e.revoked).length, against: data.claim.contradictingCount })}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="xs" aria-label={t("common.close")} onClick={onClose} data-testid="kg-source-drawer-close">
          <X aria-hidden className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex flex-col gap-3 overflow-y-auto p-3">
        <p className="text-12 leading-relaxed text-background-foreground" data-testid="kg-source-statement">
          {data.claim.statement}
        </p>
        {/* S10（#4367）：个人记忆（只有主人打得开它的来源）可以显式分享到项目 */}
        {data.claim.scope.kind === "personal" ? (
          <div className="flex justify-end" data-testid="kg-source-share">
            <ShareToProject claimId={data.claim.id} testIdPrefix="kg-share" />
          </div>
        ) : null}
        <Separator />

        <section className="flex flex-col gap-2" data-testid="kg-source-evidence-list">
          <h3 className="text-11 font-medium text-muted-foreground">{t("chatKnowledge.source.excerpts")}</h3>
          {data.evidence.map((ev) => (
            <div
              key={ev.segmentId}
              data-testid={`kg-evidence-${ev.segmentId}`}
              className="rounded-md border border-border-subtle bg-background p-2"
            >
              <div className="mb-1 flex items-center gap-1.5">
                {ev.sourceKind === "attachment" ? (
                  <FileText aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <MessageSquare aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <Badge tone={ev.stance === "contradicting" ? "danger" : "neutral"}>
                  {t(ev.stance === "contradicting" ? "chatKnowledge.source.against" : "chatKnowledge.source.supporting")}
                </Badge>
                {ev.locator?.page ? (
                  <span className="text-10 text-muted-foreground">{t("chatKnowledge.source.page", { page: ev.locator.page })}</span>
                ) : null}
              </div>
              {ev.revoked ? (
                <p
                  role="alert"
                  className="flex items-center gap-1 text-11 text-destructive"
                  data-testid={`kg-evidence-revoked-${ev.segmentId}`}
                >
                  <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
                  {t("chatKnowledge.source.revoked")}
                </p>
              ) : (
                <>
                  <p className="text-11 leading-relaxed text-background-foreground">{ev.excerpt}</p>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="mt-1"
                    data-testid={`kg-evidence-jump-${ev.segmentId}`}
                    onClick={() => onJumpTo?.(ev.sourceKind, ev.sourceRef)}
                  >
                    {t(ev.sourceKind === "attachment" ? "chatKnowledge.source.jumpFile" : "chatKnowledge.source.jumpMessage")}
                    <ArrowUpRight aria-hidden className="ml-1 h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </section>

        <Separator />
        <section className="flex flex-col gap-1.5" data-testid="kg-source-provenance">
          <h3 className="text-11 font-medium text-muted-foreground">{t("chatKnowledge.source.provenance")}</h3>
          {data.provenance.map((p, i) => (
            <div key={i} className="flex flex-col gap-0.5 text-10 text-muted-foreground" data-testid={`kg-provenance-${i}`}>
              <span className="text-background-foreground">{p.action}</span>
              <span>
                {t(p.actor.kind === "human" ? "chatKnowledge.source.human" : "chatKnowledge.source.system")}·{p.actor.id}
                {p.pipelineVersion ? ` · ${p.pipelineVersion}` : ""} · {p.at.slice(0, 10)}
              </span>
            </div>
          ))}
        </section>
      </div>
    </DrawerFrame>
  );
}

function DrawerFrame({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="absolute inset-0 z-20 flex justify-end" data-testid="kg-source-drawer">
      <button
        type="button"
        aria-label={t("chatKnowledge.source.close")}
        className="flex-1 bg-background/60 backdrop-blur-sm"
        data-testid="kg-source-drawer-backdrop"
        onClick={onClose}
      />
      <aside role="dialog" aria-label={t("chatKnowledge.source.dialog")} className="flex w-80 flex-col border-l border-border bg-card shadow-lg">
        {children}
      </aside>
    </div>
  );
}
