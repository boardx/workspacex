"use client";

import * as React from "react";
import { Brain, List, Share2, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KnowledgeList, KnowledgeEmpty } from "./knowledge-list";
import { KnowledgeGraphView } from "./knowledge-graph-view";
import { ClaimSourceDrawer } from "./claim-source-drawer";
import { PromotionResultList } from "./promotion-result-list";
import {
  countByTriState,
  KG_TRI_STATE_LABEL_ZH,
  claimSourcesNormal,
  claimSourcesRevoked,
  promotionResultsMixed,
  type ThreadKnowledge,
  type ClaimSources,
  type PromotionResults,
} from "@/lib/mock/knowledge-graph";
import type { KgClaim } from "@repo/contracts/chat-knowledge-graph";

export type PanelStatus = "loading" | "error" | "ready";
export type PanelView = "list" | "graph";

/**
 * 会话右侧栏「知识」tab（uc-18-3 R8）—— 列表/图切换 + 头部入图状态 + 七态。
 * ⚠ 纯前端 mock；动作只在本地演示，不接后端（硬规则 ③）。
 * 七态：正常 / 加载 / 空 / 部分失败 / 错误 / 只读 / 超限——由 status + data + view 组合。
 */
export function KnowledgePanel({
  status,
  data,
  errorCode,
  initialView = "list",
  showPromotionResult = false,
}: {
  status: PanelStatus;
  data: ThreadKnowledge | null;
  errorCode?: string;
  initialView?: PanelView;
  showPromotionResult?: boolean;
}) {
  const [view, setView] = React.useState<PanelView>(initialView);
  const [selectMode, setSelectMode] = React.useState(false);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [drawer, setDrawer] = React.useState<ClaimSources | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [promoResult, setPromoResult] = React.useState<PromotionResults | null>(
    showPromotionResult ? promotionResultsMixed : null,
  );

  const canEdit = data?.canEdit ?? false;
  const canPromote = data?.canPromote ?? false;
  const counts = data ? countByTriState(data.claims) : { pending: 0, confirmed: 0, conflict: 0 };
  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const claimLabel = (id: string) => data?.claims.find((c) => c.id === id)?.statement ?? id;

  const openSource = (claim: KgClaim) => {
    setDrawer(claim.status === "proposed" && claim.id === "clm-todo-migrate" ? claimSourcesRevoked : { ...claimSourcesNormal, claim });
    setDrawerOpen(true);
  };

  return (
    <div className="relative flex h-full flex-col" data-testid="kg-panel">
      {/* 头部：标题 + 入图状态 + 列表/图切换 */}
      <div className="flex flex-col gap-2 border-b border-border-subtle p-3">
        <div className="flex items-center gap-2">
          <Brain aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-12 font-medium" data-testid="kg-panel-title">
            知识{data ? `（${data.claims.length}）` : ""}
          </h2>
          {data && !canEdit ? (
            <Badge tone="outline" data-testid="kg-readonly-badge">只读</Badge>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="xs"
              aria-label="列表视图"
              data-active={view === "list"}
              data-testid="kg-view-list"
              onClick={() => setView("list")}
            >
              <List aria-hidden className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={view === "graph" ? "secondary" : "ghost"}
              size="xs"
              aria-label="图视图"
              data-active={view === "graph"}
              data-testid="kg-view-graph"
              onClick={() => setView("graph")}
            >
              <Share2 aria-hidden className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* 入图状态行（uc-18-1 R8） */}
        {data ? <IngestionStatus data={data} /> : null}

        {/* 三态计数 */}
        {data && data.claims.length > 0 ? (
          <div className="flex items-center gap-1.5" data-testid="kg-tri-counts">
            <Badge tone="warning">{KG_TRI_STATE_LABEL_ZH.pending} {counts.pending}</Badge>
            <Badge tone="success">{KG_TRI_STATE_LABEL_ZH.confirmed} {counts.confirmed}</Badge>
            <Badge tone="danger">{KG_TRI_STATE_LABEL_ZH.conflict} {counts.conflict}</Badge>
          </div>
        ) : null}

        {/* 存入个人空间入口（仅个人线程 canPromote） */}
        {data && canPromote && data.claims.length > 0 ? (
          <div className="flex items-center gap-1.5">
            {selectMode ? (
              <>
                <Button
                  size="xs"
                  disabled={selectedIds.length === 0}
                  data-testid="kg-promote-submit"
                  onClick={() => {
                    setPromoResult(promotionResultsMixed);
                    setSelectMode(false);
                  }}
                >
                  存入个人空间（{selectedIds.length}）
                </Button>
                <Button size="xs" variant="ghost" data-testid="kg-promote-cancel" onClick={() => { setSelectMode(false); setSelected({}); }}>
                  取消
                </Button>
              </>
            ) : (
              <Button size="xs" variant="outline" data-testid="kg-promote-enter" onClick={() => setSelectMode(true)}>
                存入个人空间…
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {/* 主体 */}
      <div className="flex-1 overflow-y-auto p-3">
        {status === "loading" ? (
          <div data-testid="loading" className="flex flex-col gap-3">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : null}

        {status === "error" ? (
          <div className="flex flex-col items-start gap-2" data-testid="err-panel" role="alert">
            <div className="flex items-center gap-1.5 text-12 text-destructive">
              <AlertTriangle aria-hidden className="h-4 w-4" />
              没能读到这条对话的知识
            </div>
            <p className="text-11 text-muted-foreground">
              {errorCode === "KG_NOT_VISIBLE"
                ? "你没有这条对话的访问权限。"
                : "对话不存在或已被删除。"}
            </p>
            <Button size="xs" variant="outline" data-testid="kg-error-retry">
              <RefreshCw aria-hidden className="h-3 w-3" />
              重试
            </Button>
          </div>
        ) : null}

        {status === "ready" && data ? (
          data.claims.length === 0 && data.objects.length === 0 ? (
            <KnowledgeEmpty />
          ) : view === "list" ? (
            <div className="flex flex-col gap-3">
              {promoResult ? (
                <div className="rounded-lg border border-border-subtle bg-muted/40 p-2">
                  <p className="mb-1.5 text-11 font-medium text-muted-foreground">上次「存入个人空间」结果</p>
                  <PromotionResultList data={promoResult} claimLabel={claimLabel} />
                </div>
              ) : null}
              <KnowledgeList
                claims={data.claims}
                canEdit={canEdit}
                selectable={selectMode}
                selected={selected}
                onToggleSelect={(id, next) => setSelected((s) => ({ ...s, [id]: next }))}
                onOpenSource={openSource}
              />
            </div>
          ) : (
            <KnowledgeGraphView data={data} />
          )
        ) : null}
      </div>

      <ClaimSourceDrawer data={drawer} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}

function IngestionStatus({ data }: { data: ThreadKnowledge }) {
  const { queued, running, failed } = data.ingestion;
  const busy = queued + running > 0;
  if (!busy && failed === 0) {
    return (
      <p className="text-10 text-muted-foreground" data-testid="kg-ingestion-idle">
        已整理到最新
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="kg-ingestion-status">
      {busy ? (
        <span className="flex items-center gap-1 text-10 text-muted-foreground" data-testid="kg-ingestion-running">
          <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
          整理中（{queued + running} 条）
        </span>
      ) : null}
      {failed > 0 ? (
        <span className="flex items-center gap-1.5" data-testid="kg-ingestion-failed">
          <Badge tone="danger">失败 {failed} 条</Badge>
          <Button size="xs" variant="ghost" data-testid="kg-ingestion-retry">
            <RefreshCw aria-hidden className="h-3 w-3" />
            重试
          </Button>
        </span>
      ) : null}
    </div>
  );
}
