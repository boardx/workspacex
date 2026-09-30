"use client";
import * as React from "react";
import { ArrowRightLeft, FileText, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  HANDOFF_SOURCE_UNAVAILABLE_COPY, cancelHandoff, confirmHandoff, handoffFailureText, handoffRejectedText, handoffStatusText,
  listThreadHandoffs, type ConfirmHandoffResult, type HandoffEvidenceItem, type HandoffView, type ThreadHandoffs,
} from "@/lib/agent-handoff";

/**
 * AG07 聊天 handoff 卡片（契约束 agent-role ui.md：`handoff-confirm-card` / `handoff-confirm` / `handoff-cancel`）。
 *
 * 两种呈现，都只给发起人本人（服务端按身份过滤，这里不做权限判断）：
 *   1. 来源线程：Agent 发出的转交请求——目标角色 + 交接包摘要 + 确认 / 取消。确认后服务端在接收方
 *      新开线程，`onOpenThread` 跳过去；不在本地预测结果。
 *   2. 转交新开的线程：顶部说明「从哪里转交来、交接了什么」，引用按**发起人**身份重读，
 *      无权 / 不存在的一律显示「无法展示此来源」（E8），不带任何内容。
 *
 * 无转交时整块不渲染。`refreshKey` 变化时重读（一轮对话结束后外壳会递增它）。
 */
export function ChatHandoffPanel({
  threadId,
  sessionToken,
  refreshKey = 0,
  onOpenThread,
  load = listThreadHandoffs,
  confirm = confirmHandoff,
  cancel = cancelHandoff,
}: {
  threadId: string | null;
  sessionToken?: string;
  refreshKey?: number;
  onOpenThread?: (result: ConfirmHandoffResult) => void;
  load?: typeof listThreadHandoffs;
  confirm?: typeof confirmHandoff;
  cancel?: typeof cancelHandoff;
}) {
  const [data, setData] = React.useState<ThreadHandoffs | null>(null);
  const [reloadTick, setReloadTick] = React.useState(0);

  React.useEffect(() => {
    if (!threadId) { setData(null); return; }
    let live = true;
    load(threadId, sessionToken).then(
      (value) => { if (live) setData(value); },
      // 读失败不打扰聊天：卡片只是缺席，主对话照常可用。
      () => { if (live) setData(null); },
    );
    return () => { live = false; };
  }, [threadId, sessionToken, refreshKey, reloadTick, load]);

  if (!data || (data.requested.length === 0 && data.origin === null)) return null;

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-background px-4 py-2" data-testid="chat-handoff-panel">
      {data.origin && <HandoffOriginCard handoff={data.origin.handoff} evidence={data.origin.evidence} />}
      {data.requested.map((view) => (
        <HandoffRequestCard
          key={view.handoffId}
          view={view}
          onConfirm={async () => {
            const result = await confirm(view.handoffId, sessionToken);
            setReloadTick((n) => n + 1);
            onOpenThread?.(result);
          }}
          onCancel={async () => {
            await cancel(view.handoffId, sessionToken);
            setReloadTick((n) => n + 1);
          }}
        />
      ))}
    </div>
  );
}

function PacketSummary({ view }: { view: HandoffView }) {
  const { packet } = view;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-11">
      <dt className="text-muted-foreground">问题</dt>
      <dd className="line-clamp-2 text-card-foreground" data-testid="handoff-question">{packet.originalQuestion}</dd>
      {packet.confirmedScope.trim() !== "" && (
        <>
          <dt className="text-muted-foreground">已确认范围</dt>
          <dd className="line-clamp-2 text-card-foreground">{packet.confirmedScope}</dd>
        </>
      )}
      {packet.openItems.length > 0 && (
        <>
          <dt className="text-muted-foreground">未决事项</dt>
          <dd className="text-card-foreground">{packet.openItems.join("；")}</dd>
        </>
      )}
      <dt className="text-muted-foreground">引用</dt>
      <dd className="text-card-foreground">
        {packet.evidenceRefs.length > 0 ? `${packet.evidenceRefs.length} 条（接收方将按你的权限重新读取）` : "无"}
      </dd>
    </dl>
  );
}

function HandoffRequestCard({
  view,
  onConfirm,
  onCancel,
}: {
  view: HandoffView;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const [inFlight, setInFlight] = React.useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const target = view.targetName ? `${view.targetName}（${view.targetRole}）` : view.targetRole;
  const pending = view.status === "requested";

  const run = async (which: "confirm" | "cancel", fn: () => Promise<void>) => {
    setInFlight(which);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(handoffFailureText(e, view.targetRole));
    } finally {
      setInFlight(null);
    }
  };

  return (
    <section
      className="rounded-md border border-ai/30 bg-card px-3 py-2"
      data-testid="handoff-confirm-card"
      data-handoff-status={view.status}
      aria-label={`转交给 ${target}`}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-12 font-medium text-card-foreground">
        <ArrowRightLeft aria-hidden className="h-3.5 w-3.5 shrink-0 text-ai" />
        <span>建议转交给 {target}</span>
        <Badge tone={pending ? "ai" : view.status === "confirmed" ? "success" : "neutral"}>{handoffStatusText(view)}</Badge>
      </div>
      <PacketSummary view={view} />
      {view.status === "rejected" && view.notAllowedReason && (
        <p className="mt-1.5 text-11 text-muted-foreground" role="status">
          {handoffRejectedText(view)}
        </p>
      )}
      {pending && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            data-testid="handoff-confirm"
            disabled={inFlight !== null}
            onClick={() => void run("confirm", onConfirm)}
          >
            {inFlight === "confirm" ? "正在转交…" : "确认转交并新开对话"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid="handoff-cancel"
            disabled={inFlight !== null}
            onClick={() => void run("cancel", onCancel)}
          >
            {inFlight === "cancel" ? "正在取消…" : "不用了"}
          </Button>
        </div>
      )}
      {error && (
        <p className="mt-1.5 text-11 text-destructive" role="alert" data-testid="handoff-error">{error}</p>
      )}
    </section>
  );
}

function HandoffOriginCard({ handoff, evidence }: { handoff: HandoffView; evidence: readonly HandoffEvidenceItem[] }) {
  return (
    <section className="rounded-md border border-border bg-card px-3 py-2" data-testid="handoff-origin-card" aria-label="转交来的对话">
      <div className="mb-1.5 flex items-center gap-1.5 text-12 font-medium text-card-foreground">
        <ArrowRightLeft aria-hidden className="h-3.5 w-3.5 shrink-0 text-ai" />
        <span>这是转交给 {handoff.targetName ?? handoff.targetRole} 的对话</span>
      </div>
      <PacketSummary view={handoff} />
      {evidence.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1" data-testid="handoff-evidence">
          {evidence.map((item) => (
            <li
              key={item.ref}
              className="flex items-center gap-1.5 text-11"
              data-testid="handoff-evidence-item"
              data-readable={item.readable ? "true" : "false"}
            >
              {item.readable ? (
                <>
                  <FileText aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate text-card-foreground">可查看的来源 · {item.mime}</span>
                </>
              ) : (
                <>
                  <Lock aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">{HANDOFF_SOURCE_UNAVAILABLE_COPY}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
