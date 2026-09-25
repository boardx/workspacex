"use client";

import * as React from "react";
import { Brain, List, Share2, RefreshCw, Loader2, AlertTriangle, Eye, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KnowledgeList, KnowledgeEmpty } from "./knowledge-list";
import { KnowledgeGraphView } from "./knowledge-graph-view";
import { ClaimSourceDrawer } from "./claim-source-drawer";
import { PromotionResultList } from "./promotion-result-list";
import { NominationCard } from "./nomination-card";
import { usePromotionFlow, visibleNominations, type PromoteFn } from "./use-promotion-flow";
import { countByTriState } from "@/lib/knowledge-graph-view";
import { describeHumanActionFailure } from "@/lib/knowledge-graph-failure";
import { onOpenClaimSources, requestRememberStatement, takePendingClaimSources } from "@/lib/knowledge-graph-events";
import {
  knowledgeGraphErrorCode,
  type ClaimSources,
  type PromotionNominations,
  type PromotionResults,
  type ThreadKnowledge,
} from "@/lib/knowledge-graph-api";
import {
  claimTriState,
  KG_PROMOTE_MAX_BATCH,
  KG_TRI_STATE_LABEL_ZH,
  KG_VISIBILITY_LABEL_ZH,
  type KgClaim,
  type KgHumanAction,
} from "@repo/contracts/chat-knowledge-graph";

export type PanelStatus = "loading" | "error" | "ready";
export type PanelView = "list" | "graph";

/** 契约 `confirmClaims` 单批上限（`z.array(...).max(50)`）。 */
const CONFIRM_BATCH_MAX = 50;

/**
 * 写动作。
 *
 * - `apply`：人的编辑动作（F10，`applyHumanAction`）。失败时 reject，面板把错误翻成人话显示。
 *   真实 `/chat` 只在服务端 `canEdit=true` 时传（`useKnowledgeWriteActions`）；不传 = 一个编辑入口都不画。
 * - `onPromote`：记到我的长期记忆（F11，`promoteToPersonal`）。真实 `/chat` 只在服务端
 *   `canEdit && canPromote` 时传（`useKnowledgeWriteActions`）；逐条结果由面板显示，整批失败 reject。
 *   `choices` 只在回答 `needs_choice` 时带。
 * - `onReindex`：整理本会话（F13）。真实 `/chat` 还不传，对应入口不渲染——不画一排点了没反应的按钮。
 *   签核预览传演示实现。
 */
export interface KnowledgePanelWriteActions {
  readonly apply: (action: KgHumanAction) => Promise<void>;
  readonly onPromote?: PromoteFn;
  readonly onReindex?: () => void;
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
  // 看不见与不存在对外同一个出口（I-3：不泄露别人的记忆是否存在），所以两种可能都照实说。
  if (code === "KG_CLAIM_NOT_FOUND") return "这一条已经不在了，或你无权查看。";
  return "没能读到这一条的来源，请稍后重试。";
}

/**
 * 会话右侧栏「记忆」页签（uc-18-3 R8）—— 列表/图切换 + 头部整理状态 + 可见范围 + 七态。
 * 七态：正常 / 加载 / 空 / 部分失败 / 错误 / 只读 / 超限——由 status + data + view 组合。
 * 数据来自 `getThreadKnowledge`（调用方取），来源抽屉经 `loadSources`（`getClaimSources`，按 claimId 取）。
 * F13：回答下的引用 chip 经 `requestOpenClaimSources` 打开抽屉——那一条可能是长期记忆里的，
 * 不在本会话的 `claims` 里，所以抽屉按 claimId 开，不要求先在列表里找到它。
 */
export function KnowledgePanel({
  status,
  data,
  errorCode,
  initialView = "list",
  onRetry,
  loadSources,
  writeActions,
  nominations = null,
  initialPromotionResult = null,
  onJumpToSource,
}: {
  status: PanelStatus;
  data: ThreadKnowledge | null;
  errorCode?: string | null;
  initialView?: PanelView;
  onRetry?: () => void;
  loadSources?: (claimId: string) => Promise<ClaimSources>;
  writeActions?: KnowledgePanelWriteActions;
  /** F11：AI 提名（`listPromotionNominations`）。只在能记到长期记忆时画，且只提名不执行。 */
  nominations?: PromotionNominations | null;
  initialPromotionResult?: PromotionResults | null;
  /** 来源抽屉的「跳到原消息」（F15 / E4）：真实 `/chat` 传，把那条消息滚到眼前并高亮；不传 = 签核预览，只回调不导航。 */
  onJumpToSource?: (input: { claim: KgClaim; sourceKind: string; sourceRef: string }) => void;
}) {
  const [view, setView] = React.useState<PanelView>(initialView);
  const [selectMode, setSelectMode] = React.useState(false);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [nominationsDismissed, setNominationsDismissed] = React.useState(false);

  const drawer = useClaimSourcesDrawer(loadSources);
  const drawerClaim = drawer.data?.claim ?? null;
  const jumpTo = React.useMemo(
    () => (onJumpToSource === undefined || drawerClaim === null
      ? undefined
      : (sourceKind: string, sourceRef: string) => onJumpToSource({ claim: drawerClaim, sourceKind, sourceRef })),
    [onJumpToSource, drawerClaim],
  );
  const [actionError, setActionError] = React.useState<string | null>(null);

  /** 执行一个编辑动作；成功返回 true（对话框据此关闭），失败把人话挂在面板顶部并返回 false。 */
  const runAction = React.useCallback(async (action: KgHumanAction): Promise<boolean> => {
    if (!writeActions) return false;
    setActionError(null);
    try {
      await writeActions.apply(action);
      return true;
    } catch (e) {
      setActionError(describeHumanActionFailure(e));
      return false;
    }
  }, [writeActions]);

  const canEdit = data?.canEdit ?? false;
  /** 编辑入口只在「服务端说可编辑」且「这些动作真的有通路」时渲染。 */
  const editable = canEdit && writeActions !== undefined;
  const onPromote = writeActions?.onPromote;
  const canPromote = (data?.canPromote ?? false) && canEdit && onPromote !== undefined;
  const promo = usePromotionFlow({
    onPromote: canPromote ? onPromote : undefined,
    onError: setActionError,
    initialResult: initialPromotionResult,
  });
  const promoResult = promo.result;
  const promoteClaims = canPromote ? (ids: string[]) => { void promo.run(ids); } : undefined;
  const shownNominations = canPromote && !nominationsDismissed
    ? visibleNominations(nominations, data?.claims ?? [], promoResult)
    : null;
  /** 「全部确认」的对象：三态为「AI 记下的」的条目（有矛盾的不在内，服务端也会整批拒绝）。 */
  const pendingIds = (data?.claims ?? []).filter((c) => claimTriState(c.status) === "pending").map((c) => c.id);
  const counts = data ? countByTriState(data.claims) : { pending: 0, confirmed: 0, conflict: 0 };
  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const claimLabel = (id: string) => data?.claims.find((c) => c.id === id)?.statement ?? id;
  const pendingCount = counts.pending;
  const openClaimById = drawer.open;

  // F13：回答下的引用 chip 请求打开某条来源。挂载时先接住「点击时面板还没挂载」的那一次，
  // 之后已挂载时的请求直接取走打开。
  React.useEffect(() => {
    const pending = takePendingClaimSources();
    if (pending !== null) openClaimById(pending);
    return onOpenClaimSources(() => {
      const id = takePendingClaimSources();
      if (id !== null) openClaimById(id);
    });
  }, [openClaimById]);

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

        {/* issue #4179（F17 手动入口 ②）—— 手打一句话，走同一条「记住」确认卡路径 */}
        {editable ? <RememberQuickAdd /> : null}

        {/* 记到长期记忆入口（仅个人线程 canPromote） */}
        {data && canPromote && data.claims.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {selectMode ? (
              <>
                <Button
                  size="xs"
                  disabled={selectedIds.length === 0 || selectedIds.length > KG_PROMOTE_MAX_BATCH || promo.busy}
                  data-testid="kg-promote-submit"
                  onClick={() => {
                    void promo.run(selectedIds);
                    setSelectMode(false);
                    setSelected({});
                  }}
                >
                  记到我的长期记忆（{selectedIds.length}）
                </Button>
                <Button size="xs" variant="ghost" data-testid="kg-promote-cancel" onClick={() => { setSelectMode(false); setSelected({}); }}>
                  取消
                </Button>
                {/* U-3：点这个按钮本身就算确认——先说清楚，再让人点 */}
                <span className="text-10 text-muted-foreground" data-testid="kg-promote-hint">
                  {selectedIds.length > KG_PROMOTE_MAX_BATCH
                    ? `一次最多记 ${String(KG_PROMOTE_MAX_BATCH)} 条`
                    : "记下后即视为你确认过"}
                </span>
              </>
            ) : (
              <Button size="xs" variant="outline" disabled={promo.busy} data-testid="kg-promote-enter" onClick={() => setSelectMode(true)}>
                {promo.busy ? <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> : null}
                记到我的长期记忆…
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {/* 主体 */}
      <div className="flex-1 overflow-y-auto p-3">
        {actionError !== null ? (
          <div
            role="alert"
            className="mb-3 flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-11 text-destructive"
            data-testid="kg-action-error"
          >
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{actionError}</span>
            <button
              type="button"
              className="text-10 text-muted-foreground underline-offset-2 transition-colors duration-base hover:underline"
              onClick={() => setActionError(null)}
              data-testid="kg-action-error-dismiss"
            >
              知道了
            </button>
          </div>
        ) : null}
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
              {shownNominations ? (
                <NominationCard
                  // 提名列表变了（记下了一部分）⇒ 勾选从头来
                  key={shownNominations.nominations.map((n) => n.claimId).join("|")}
                  data={shownNominations}
                  claimLabel={claimLabel}
                  onPromote={promoteClaims}
                  onDismiss={() => setNominationsDismissed(true)}
                  busy={promo.busy}
                />
              ) : null}
              {promoResult ? (
                <div className="rounded-lg border border-border-subtle bg-muted/40 p-2" data-testid="kg-promotion-summary">
                  <p className="mb-1.5 text-11 font-medium text-muted-foreground" role="status">
                    {promotionSummaryText(promoResult)}
                  </p>
                  <PromotionResultList
                    data={promoResult}
                    claimLabel={claimLabel}
                    onChoice={canPromote ? promo.choose : undefined}
                    busy={promo.busy}
                  />
                </div>
              ) : null}
              {/* U-2：列表头部「全部确认」批量 —— 只在有「AI 记下的」且可编辑时出现 */}
              {editable && pendingCount > 0 && !selectMode ? (
                <div className="flex items-center justify-between rounded-md border border-border-subtle bg-muted/40 px-2 py-1.5">
                  <span className="text-11 text-muted-foreground">有 {pendingCount} 条是 AI 记下的，还没经你确认</span>
                  <Button
                    size="xs"
                    variant="secondary"
                    data-testid="kg-confirm-all"
                    onClick={() => {
                      void runAction({ type: "confirmClaims", claimIds: pendingIds.slice(0, CONFIRM_BATCH_MAX) });
                    }}
                  >
                    全部确认
                  </Button>
                </div>
              ) : null}
              <KnowledgeList
                claims={data.claims}
                objects={data.objects}
                canEdit={editable}
                selectable={selectMode}
                selected={selected}
                onToggleSelect={(id, next) => setSelected((s) => ({ ...s, [id]: next }))}
                onOpenSource={(c: KgClaim) => drawer.open(c.id)}
                onApply={editable ? runAction : undefined}
                onPromote={promoteClaims}
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
        onJumpTo={jumpTo}
      />
    </div>
  );
}

/** 逐条结果上方那一行：几条记下了，几条还要你选 / 没记下（原因见下面逐条）。 */
function promotionSummaryText(result: PromotionResults): string {
  const done = result.results.filter((r) => r.outcome !== "needs_choice" && r.outcome !== "rejected").length;
  const choosing = result.results.filter((r) => r.outcome === "needs_choice").length;
  const rejected = result.results.filter((r) => r.outcome === "rejected").length;
  const parts = [`已记到长期记忆 ${String(done)} 条`];
  if (choosing > 0) parts.push(`${String(choosing)} 条等你选`);
  if (rejected > 0) parts.push(`${String(rejected)} 条没记下`);
  return parts.join(" · ");
}

/**
 * 来源抽屉的取数状态。换一条时丢弃上一条的在途结果（按请求代次），不让慢响应覆盖新选中的那条。
 */
function useClaimSourcesDrawer(loadSources: ((claimId: string) => Promise<ClaimSources>) | undefined) {
  const [claim, setClaim] = React.useState<string | null>(null);
  const [data, setData] = React.useState<ClaimSources | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const generation = React.useRef(0);

  const load = React.useCallback((target: string) => {
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

/**
 * issue #4179（F17 手动入口 ②）—— 面板「+ 记一条」：手打一句话，走 F17 已有的「记住」确认卡
 * 路径（`cards.open(..., { kind: "remember", statement })`），**不新增契约操作**。
 *
 * 这里只 `requestRememberStatement`（`lib/knowledge-graph-events.ts`）——真正把它送进
 * `detectMemoryIntent` → `cards.open` 的是订阅方 `copilotkit-v2-panel-body.tsx` 的 `send()`
 * （加「记住：」前缀，当一条新消息发出去）。提交后清空输入框、收起表单；回答下方随后出现的是
 * **确认卡**，不是直接写入——是否真的记住仍要用户在那张卡上再点一次「记住」（F17 既有规矩，
 * 这条手动入口不绕过它）。
 */
function RememberQuickAdd(): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");

  if (!open) {
    return (
      <Button size="xs" variant="outline" data-testid="kg-remember-quick-add-open" onClick={() => setOpen(true)}>
        + 记一条
      </Button>
    );
  }

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    requestRememberStatement(trimmed);
    setText("");
    setOpen(false);
  };

  return (
    <form
      className="flex items-center gap-1.5"
      data-testid="kg-remember-quick-add-form"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      <Input
        autoFocus
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="要记住的一句话…"
        aria-label="要记住的一句话"
        data-testid="kg-remember-quick-add-input"
        className="h-7 flex-1 text-11"
      />
      <Button
        size="xs"
        type="submit"
        disabled={text.trim().length === 0}
        data-testid="kg-remember-quick-add-submit"
      >
        记住
      </Button>
      <Button
        size="xs"
        type="button"
        variant="ghost"
        data-testid="kg-remember-quick-add-cancel"
        onClick={() => { setText(""); setOpen(false); }}
      >
        取消
      </Button>
    </form>
  );
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
