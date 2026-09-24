"use client";

import * as React from "react";
import { Brain, List, Share2, RefreshCw, Loader2, AlertTriangle, Eye, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KnowledgeList, KnowledgeEmpty } from "./knowledge-list";
import { KnowledgeGraphView } from "./knowledge-graph-view";
import { ClaimSourceDrawer } from "./claim-source-drawer";
import { PromotionResultList } from "./promotion-result-list";
import { countByTriState } from "@/lib/knowledge-graph-view";
import {
  knowledgeGraphErrorCode,
  type ClaimSources,
  type PromotionResults,
  type ThreadKnowledge,
} from "@/lib/knowledge-graph-api";
import {
  KG_TRI_STATE_LABEL_ZH,
  KG_VISIBILITY_LABEL_ZH,
  type KgClaim,
} from "@repo/contracts/chat-knowledge-graph";

export type PanelStatus = "loading" | "error" | "ready";
export type PanelView = "list" | "graph";

/**
 * 写动作（确认 / 改写 / 忘掉 / 记到长期记忆 / 整理本会话）。
 *
 * ⚠ F09 只接「读」：真实 `/chat` 不传这一组，编辑入口一律不渲染——不是只读态（只读态由
 *   服务端 `canEdit=false` 决定，会显示「只读」徽标），只是这些动作的真实通路 F10 起才接，
 *   不画一排点了没反应的按钮。签核预览（`/preview/chat-knowledge-graph`）传演示实现。
 */
export interface KnowledgePanelWriteActions {
  readonly onAction: (action: string, claimId: string) => void;
  readonly onPromote: (claimIds: string[]) => Promise<PromotionResults>;
  readonly onReindex: () => void;
}

/** 面板读取失败的人话（按契约 `getThreadKnowledge.err`）；不是本束可识别的码时给通用说法。 */
export function threadKnowledgeErrorText(code: string | null | undefined): string {
  if (code === "KG_NOT_VISIBLE") return "你没有这条对话的访问权限。";
  if (code === "KG_THREAD_NOT_FOUND") return "对话不存在或已被删除。";
  return "记忆服务暂时连不上，请稍后重试。";
}

function claimSourcesErrorText(e: unknown): string {
  const code = knowledgeGraphErrorCode(e);
  if (code === "KG_NOT_VISIBLE") return "你没有权限查看这一条的来源。";
  if (code === "KG_CLAIM_NOT_FOUND") return "这一条已经不在了。";
  return "没能读到这一条的来源，请稍后重试。";
}

/**
 * 会话右侧栏「记忆」页签（uc-18-3 R8）—— 列表/图切换 + 头部整理状态 + 可见范围 + 七态。
 * 七态：正常 / 加载 / 空 / 部分失败 / 错误 / 只读 / 超限——由 status + data + view 组合。
 * 数据来自 `getThreadKnowledge`（调用方取），来源抽屉经 `loadSources`（`getClaimSources`）。
 */
export function KnowledgePanel({
  status,
  data,
  errorCode,
  initialView = "list",
  onRetry,
  loadSources,
  writeActions,
  initialPromotionResult = null,
}: {
  status: PanelStatus;
  data: ThreadKnowledge | null;
  errorCode?: string | null;
  initialView?: PanelView;
  onRetry?: () => void;
  loadSources?: (claim: KgClaim) => Promise<ClaimSources>;
  writeActions?: KnowledgePanelWriteActions;
  initialPromotionResult?: PromotionResults | null;
}) {
  const [view, setView] = React.useState<PanelView>(initialView);
  const [selectMode, setSelectMode] = React.useState(false);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [promoResult, setPromoResult] = React.useState<PromotionResults | null>(initialPromotionResult);

  const drawer = useClaimSourcesDrawer(loadSources);

  const canEdit = data?.canEdit ?? false;
  /** 编辑入口只在「服务端说可编辑」且「这些动作真的有通路」时渲染。 */
  const editable = canEdit && writeActions !== undefined;
  const canPromote = (data?.canPromote ?? false) && writeActions !== undefined;
  const counts = data ? countByTriState(data.claims) : { pending: 0, confirmed: 0, conflict: 0 };
  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const claimLabel = (id: string) => data?.claims.find((c) => c.id === id)?.statement ?? id;
  const pendingCount = counts.pending;
  const openClaimById = (claimId: string) => {
    const claim = data?.claims.find((c) => c.id === claimId);
    if (claim) drawer.open(claim);
  };

  return (
    <div className="relative flex h-full flex-col" data-testid="kg-panel">
      {/* 头部：标题 + 可见范围 + 整理状态 + 列表/图切换 */}
      <div className="flex flex-col gap-2 border-b border-border-subtle p-3">
        <div className="flex items-center gap-2">
          <Brain aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-12 font-medium" data-testid="kg-panel-title">
            记忆{data ? `（${data.claims.length}）` : ""}
          </h2>
          {data && !canEdit ? (
            <Badge tone="outline" data-testid="kg-readonly-badge">只读</Badge>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="xs"
              aria-label="列表视图"
              aria-pressed={view === "list"}
              data-active={view === "list"}
              data-testid="kg-view-list"
              onClick={() => setView("list")}
            >
              <List aria-hidden className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={view === "graph" ? "secondary" : "ghost"}
              size="xs"
              aria-label="关系图"
              aria-pressed={view === "graph"}
              data-active={view === "graph"}
              data-testid="kg-view-graph"
              onClick={() => setView("graph")}
            >
              <Share2 aria-hidden className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* U-6：可见范围常驻（带文字 + 图标，不只靠颜色） */}
        {data ? (
          <span
            className="flex w-fit items-center gap-1 rounded-control bg-muted px-1.5 py-0.5 text-10 text-muted-foreground"
            data-testid="kg-visibility"
            data-visibility={data.visibility}
          >
            {data.visibility === "owner_only" ? (
              <Lock aria-hidden className="h-3 w-3" />
            ) : (
              <Eye aria-hidden className="h-3 w-3" />
            )}
            {KG_VISIBILITY_LABEL_ZH[data.visibility]}
          </span>
        ) : null}

        {/* 整理状态行（uc-18-1 R8） */}
        {data ? <IngestionStatus data={data} onReindex={writeActions?.onReindex} /> : null}

        {/* 三态计数 */}
        {data && data.claims.length > 0 ? (
          <div className="flex items-center gap-1.5" data-testid="kg-tri-counts">
            <Badge tone="warning">{KG_TRI_STATE_LABEL_ZH.pending} {counts.pending}</Badge>
            <Badge tone="success">{KG_TRI_STATE_LABEL_ZH.confirmed} {counts.confirmed}</Badge>
            <Badge tone="danger">{KG_TRI_STATE_LABEL_ZH.conflict} {counts.conflict}</Badge>
          </div>
        ) : null}

        {/* 记到长期记忆入口（仅个人线程 canPromote） */}
        {data && writeActions && canPromote && data.claims.length > 0 ? (
          <div className="flex items-center gap-1.5">
            {selectMode ? (
              <>
                <Button
                  size="xs"
                  disabled={selectedIds.length === 0}
                  data-testid="kg-promote-submit"
                  onClick={() => {
                    void writeActions.onPromote(selectedIds).then(setPromoResult);
                    setSelectMode(false);
                  }}
                >
                  记到我的长期记忆（{selectedIds.length}）
                </Button>
                <Button size="xs" variant="ghost" data-testid="kg-promote-cancel" onClick={() => { setSelectMode(false); setSelected({}); }}>
                  取消
                </Button>
              </>
            ) : (
              <Button size="xs" variant="outline" data-testid="kg-promote-enter" onClick={() => setSelectMode(true)}>
                记到我的长期记忆…
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {/* 主体 */}
      <div className="flex-1 overflow-y-auto p-3">
        {status === "loading" ? (
          <div data-testid="loading" className="flex flex-col gap-3" aria-busy="true">
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
              没能读到这条对话的记忆
            </div>
            <p className="text-11 text-muted-foreground" data-testid="kg-error-reason">
              {threadKnowledgeErrorText(errorCode)}
            </p>
            {onRetry ? (
              <Button size="xs" variant="outline" data-testid="kg-error-retry" onClick={onRetry}>
                <RefreshCw aria-hidden className="h-3 w-3" />
                重试
              </Button>
            ) : null}
          </div>
        ) : null}

        {status === "ready" && data ? (
          data.claims.length === 0 && data.objects.length === 0 ? (
            <KnowledgeEmpty onReindex={writeActions?.onReindex} />
          ) : view === "list" ? (
            <div className="flex flex-col gap-3">
              {promoResult ? (
                <div className="rounded-lg border border-border-subtle bg-muted/40 p-2">
                  <p className="mb-1.5 text-11 font-medium text-muted-foreground">上次记入长期记忆的结果</p>
                  <PromotionResultList data={promoResult} claimLabel={claimLabel} />
                </div>
              ) : null}
              {/* U-2：列表头部「全部确认」批量 —— 只在有「AI 记下的」且可编辑时出现 */}
              {editable && writeActions && pendingCount > 0 && !selectMode ? (
                <div className="flex items-center justify-between rounded-md border border-border-subtle bg-muted/40 px-2 py-1.5">
                  <span className="text-11 text-muted-foreground">有 {pendingCount} 条是 AI 记下的，还没经你确认</span>
                  <Button
                    size="xs"
                    variant="secondary"
                    data-testid="kg-confirm-all"
                    onClick={() => writeActions.onAction("confirmClaims", "")}
                  >
                    全部确认
                  </Button>
                </div>
              ) : null}
              <KnowledgeList
                claims={data.claims}
                canEdit={editable}
                selectable={selectMode}
                selected={selected}
                onToggleSelect={(id, next) => setSelected((s) => ({ ...s, [id]: next }))}
                onOpenSource={drawer.open}
                onAction={writeActions?.onAction}
              />
            </div>
          ) : (
            <KnowledgeGraphView data={data} onOpenClaim={openClaimById} />
          )
        ) : null}
      </div>

      <ClaimSourceDrawer
        data={drawer.data}
        open={drawer.isOpen}
        loading={drawer.loading}
        error={drawer.error}
        onRetry={drawer.retry}
        onClose={drawer.close}
      />
    </div>
  );
}

/**
 * 来源抽屉的取数状态。换一条时丢弃上一条的在途结果（按请求代次），不让慢响应覆盖新选中的那条。
 */
function useClaimSourcesDrawer(loadSources: ((claim: KgClaim) => Promise<ClaimSources>) | undefined) {
  const [claim, setClaim] = React.useState<KgClaim | null>(null);
  const [data, setData] = React.useState<ClaimSources | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const generation = React.useRef(0);

  const load = React.useCallback((target: KgClaim) => {
    const gen = ++generation.current;
    setClaim(target);
    setData(null);
    setError(null);
    if (!loadSources) {
      setLoading(false);
      setError("暂时看不了这一条的来源。");
      return;
    }
    setLoading(true);
    loadSources(target).then(
      (value) => {
        if (gen !== generation.current) return;
        setData(value);
        setLoading(false);
      },
      (e: unknown) => {
        if (gen !== generation.current) return;
        setError(claimSourcesErrorText(e));
        setLoading(false);
      },
    );
  }, [loadSources]);

  const close = React.useCallback(() => {
    generation.current += 1;
    setClaim(null);
    setData(null);
    setLoading(false);
    setError(null);
  }, []);

  const retry = React.useCallback(() => { if (claim) load(claim); }, [claim, load]);

  return { isOpen: claim !== null, data, loading, error, open: load, close, retry };
}

function IngestionStatus({ data, onReindex }: { data: ThreadKnowledge; onReindex?: () => void }) {
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
          {onReindex ? (
            <Button size="xs" variant="ghost" data-testid="kg-ingestion-retry" onClick={onReindex}>
              <RefreshCw aria-hidden className="h-3 w-3" />
              重试
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
