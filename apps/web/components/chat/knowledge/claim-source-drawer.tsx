"use client";

import * as React from "react";
import { X, FileText, MessageSquare, ArrowUpRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ClaimTriStateBadge } from "./claim-tri-state-badge";
import type { ClaimSources } from "@/lib/knowledge-graph-api";

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
  if (!open) return null;
  if (!data || loading || error !== null) {
    return (
      <DrawerFrame onClose={onClose}>
        <header className="flex items-start justify-between gap-2 border-b border-border-subtle p-3">
          <span className="text-11 font-medium text-muted-foreground">来源与证据</span>
          <Button variant="ghost" size="xs" aria-label="关闭" onClick={onClose} data-testid="kg-source-drawer-close">
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
                重试
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
          <span className="text-11 font-medium text-muted-foreground">来源与证据</span>
          <div className="flex items-center gap-1.5">
            <ClaimTriStateBadge status={data.claim.status} />
            <span className="text-10 text-muted-foreground">
              证据 {data.evidence.filter((e) => !e.revoked).length} · 反对 {data.claim.contradictingCount}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="xs" aria-label="关闭" onClick={onClose} data-testid="kg-source-drawer-close">
          <X aria-hidden className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex flex-col gap-3 overflow-y-auto p-3">
        <p className="text-12 leading-relaxed text-background-foreground" data-testid="kg-source-statement">
          {data.claim.statement}
        </p>
        <Separator />

        <section className="flex flex-col gap-2" data-testid="kg-source-evidence-list">
          <h3 className="text-11 font-medium text-muted-foreground">证据摘录</h3>
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
                  {ev.stance === "contradicting" ? "反对" : "支持"}
                </Badge>
                {ev.locator?.page ? (
                  <span className="text-10 text-muted-foreground">第 {ev.locator.page} 页</span>
                ) : null}
              </div>
              {ev.revoked ? (
                <p
                  role="alert"
                  className="flex items-center gap-1 text-11 text-destructive"
                  data-testid={`kg-evidence-revoked-${ev.segmentId}`}
                >
                  <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
                  来源已删除，该证据已退出召回
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
                    跳到{ev.sourceKind === "attachment" ? "原文件" : "原消息"}
                    <ArrowUpRight aria-hidden className="ml-1 h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </section>

        <Separator />
        <section className="flex flex-col gap-1.5" data-testid="kg-source-provenance">
          <h3 className="text-11 font-medium text-muted-foreground">溯源</h3>
          {data.provenance.map((p, i) => (
            <div key={i} className="flex flex-col gap-0.5 text-10 text-muted-foreground" data-testid={`kg-provenance-${i}`}>
              <span className="text-background-foreground">{p.action}</span>
              <span>
                {p.actor.kind === "human" ? "人" : "系统"}·{p.actor.id}
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
  return (
    <div className="absolute inset-0 z-20 flex justify-end" data-testid="kg-source-drawer">
      <button
        type="button"
        aria-label="关闭来源"
        className="flex-1 bg-background/60 backdrop-blur-sm"
        data-testid="kg-source-drawer-backdrop"
        onClick={onClose}
      />
      <aside role="dialog" aria-label="记忆来源" className="flex w-80 flex-col border-l border-border bg-card shadow-lg">
        {children}
      </aside>
    </div>
  );
}
