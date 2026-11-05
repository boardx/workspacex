"use client";

import * as React from "react";
import { Sparkles, Trash2, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import type { KgMemoryCard } from "@repo/contracts/chat-knowledge-graph";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { MemoryOverviewCard } from "./memory-overview-card";
import { HumanActionDisplayError, MemoryCardDisplayError, describeHumanActionFailure, describeMemoryCardFailure } from "@/lib/knowledge-graph-failure";

/** 卡上的决定（契约 `actOnMemoryCard.in.decision`）。 */
export type MemoryCardDecision = "accept" | "dismiss";
export interface MemoryCardActOptions {
  /** 忘掉卡：还勾着的条目 */
  readonly claimIds?: readonly string[];
  /** 记住卡：改过的字（没改就不带） */
  readonly editedStatement?: string;
}

/** 撤销的结果（以服务端重读为准）：撤掉了 / 撤了但长期记忆里这条还有别的来源所以还在 / 服务端已经不让撤。 */
export type UndoOutcome = "undone" | "kept" | "not_undoable" | "unknown";
const UNDO_NOTE: Record<UndoOutcome, MessageKey> = {
  undone: "chatKnowledge.memory.undo.undone",
  kept: "chatKnowledge.memory.undo.kept",
  not_undoable: "chatKnowledge.memory.undo.not_undoable",
  unknown: "chatKnowledge.memory.undo.unknown",
};

/** 契约 `KgMemoryCard.items[].statement` 的上限。 */
const STATEMENT_MAX = 2000;

/**
 * U-4：对话里的「记住 / 忘掉」行内确认卡（uc-18-6 A/B），数据是 `getTurnMemory.prompt.memory_card`。
 * - **AI 只生成卡片，人点一下才生效**（I-15 / I-17：执行身份是点击的人）。`onAct` 真正执行
 *   （`actOnMemoryCard`），返回服务端给的新卡片；失败时它抛出的 Error 带的是给人看的话，卡片原样显示、按钮恢复。
 * - 记住卡：内容可改字（Textarea），按「记住」→「已记住 · 撤销」。撤销（`onUndo`）只在服务端给了 claimId 时出现——
 *   那表示这次记住新建了会话里那一条和长期记忆里那一条，撤掉会话那条就只撤掉这次新建的；用的是早就有的那条、
 *   或并进了长期记忆里早就有的那条时 claimId 为 null，只显示「已记住」，不给撤销（撤了会删掉用户原来就有的东西）。
 *   长期记忆里那条后来不在了（撤销过 / 被忘掉）⇒ 服务端读作 dismissed：「这条没有记在长期记忆里」。
 * - 忘掉卡：逐条列出、默认全选、可取消勾选，按「忘掉」执行选中的。危险动作用 destructive 按钮（硬规则 ⑦）。
 * - `canAct = false`（不是对话创建者，R5）：只显示卡上的内容，不给任何按钮。
 * - 状态：open / done（已生效）/ dismissed（不用了）/ stale（期间内容已变，E2：只提示，不再给按钮）/
 *   undone（#4361：忘掉之后点了撤销，都恢复了）。
 * - #4361：忘掉卡生效后「已忘掉 N 条 · 撤销」（`onUndoForget`，服务端 undoMemoryCard，返回撤销后的卡）；
 *   `kind = overview`（「你记得我什么」）交给 `MemoryOverviewCard`（只是清单，没有按钮）。
 */
export function MemoryCard(props: {
  card: KgMemoryCard;
  canAct: boolean;
  onAct: (decision: MemoryCardDecision, opts: MemoryCardActOptions) => Promise<KgMemoryCard>;
  onUndo?: (claimId: string) => Promise<UndoOutcome>;
  onUndoForget?: () => Promise<KgMemoryCard>;
}) {
  if (props.card.kind === "overview") return <MemoryOverviewCard card={props.card} />;
  return <ConfirmMemoryCard {...props} />;
}

function ConfirmMemoryCard({
  card,
  canAct,
  onAct,
  onUndo,
  onUndoForget,
}: {
  card: KgMemoryCard;
  canAct: boolean;
  onAct: (decision: MemoryCardDecision, opts: MemoryCardActOptions) => Promise<KgMemoryCard>;
  onUndo?: (claimId: string) => Promise<UndoOutcome>;
  onUndoForget?: () => Promise<KgMemoryCard>;
}) {
  const { t, locale } = useI18n();
  const isRemember = card.kind === "remember";
  const [current, setCurrent] = React.useState<KgMemoryCard>(card);
  const [undone, setUndone] = React.useState<UndoOutcome | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ owned: HumanActionDisplayError | MemoryCardDisplayError } | { raw: string } | { fallback: true } | null>(null);
  const errorText = error === null ? null : "owned" in error
    ? error.owned instanceof MemoryCardDisplayError
      ? describeMemoryCardFailure(error.owned.failure, locale)
      : describeHumanActionFailure(error.owned.failure, locale)
    : "raw" in error ? error.raw : t("chatKnowledge.memory.failed");
  const original = card.items[0]?.statement ?? "";
  const [text, setText] = React.useState(original);
  const [checked, setChecked] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(card.items.flatMap((it) => (it.claimId === null ? [] : [[it.claimId, true]]))),
  );
  const selected = card.items.flatMap((it) => (it.claimId !== null && checked[it.claimId] === true ? [it.claimId] : []));
  const rootTestId = isRemember ? "kg-card-remember" : "kg-card-forget";

  const run = async (fn: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof HumanActionDisplayError || e instanceof MemoryCardDisplayError ? { owned: e } : e instanceof Error && e.message !== "" ? { raw: e.message } : { fallback: true });
    } finally {
      setBusy(false);
    }
  };

  const decide = (decision: MemoryCardDecision): Promise<void> => run(async () => {
    const opts: MemoryCardActOptions = decision === "dismiss"
      ? {}
      : isRemember
        ? (text.trim() !== original.trim() ? { editedStatement: text.trim() } : {})
        : (selected.length === card.items.length ? {} : { claimIds: selected });
    setCurrent(await onAct(decision, opts));
  });

  if (current.state === "stale") {
    // E2：点击时发现条目期间被改过 / 忘掉了——服务端拒绝后这一轮已重读，卡片停在这里。卡上的内容已经不是现在的样子，
    // 不再给按钮；要记 / 要忘，再说一次就会出一张新卡。
    return (
      <p className="mt-2 flex items-center gap-1 text-10 text-muted-foreground" data-testid="kg-card-stale">
        <AlertTriangle aria-hidden className="h-3.5 w-3.5 text-warning" />
        {t("chatKnowledge.memory.stale")}
      </p>
    );
  }

  if (current.state === "undone") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-10 text-muted-foreground" data-testid="kg-card-undone">
        <Check aria-hidden className="h-3 w-3 text-success" />
        {t("chatKnowledge.memory.restored", { count: current.items.length })}
      </p>
    );
  }

  if (current.state === "done") {
    const rememberedId = isRemember ? current.items[0]?.claimId ?? null : null;
    const canUndo = canAct && (isRemember
      ? onUndo !== undefined && rememberedId !== null && undone === null
      : onUndoForget !== undefined);
    return (
      <div className="mt-2 flex flex-col gap-1" data-testid="kg-card-done">
        <p className="flex items-center gap-1.5 text-10 text-muted-foreground">
          <Check aria-hidden className="h-3 w-3 text-success" />
          {isRemember
            ? (undone !== null ? t(UNDO_NOTE[undone]) : t("chatKnowledge.memory.saved"))
            : t("chatKnowledge.memory.forgotten", { count: current.items.length })}
          {canUndo ? (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                disabled={busy}
                className="underline-offset-2 transition-colors duration-base hover:underline disabled:cursor-not-allowed disabled:text-disabled-foreground"
                data-testid="kg-card-undo"
                onClick={() => void run(async () => {
                  if (isRemember) {
                    if (onUndo !== undefined && rememberedId !== null) setUndone(await onUndo(rememberedId));
                  } else if (onUndoForget !== undefined) {
                    setCurrent(await onUndoForget());
                  }
                })}
              >
                {t("chatKnowledge.memory.undo")}
              </button>
            </>
          ) : null}
        </p>
        {error !== null ? (
          <p role="alert" className="text-10 text-destructive" data-testid="kg-card-error">
            {errorText}
          </p>
        ) : null}
      </div>
    );
  }

  if (current.state === "dismissed") {
    return (
      <p className="mt-2 text-10 text-muted-foreground" data-testid="kg-card-dismissed">
        {isRemember ? t("chatKnowledge.memory.dismissRemember") : t("chatKnowledge.memory.dismissForget")}
      </p>
    );
  }

  return (
    <div
      className="mt-2 flex flex-col gap-2 rounded-lg border border-ai-tint bg-ai-tint/40 p-3"
      data-testid={rootTestId}
    >
      <div className="flex items-center gap-1.5">
        {isRemember ? (
          <Sparkles aria-hidden className="h-4 w-4 text-ai-tint-foreground" />
        ) : (
          <Trash2 aria-hidden className="h-4 w-4 text-destructive" />
        )}
        <span className="text-11 font-medium text-ai-tint-foreground">
          {isRemember ? t("chatKnowledge.memory.rememberPrompt") : t("chatKnowledge.memory.forgetPrompt")}
        </span>
      </div>

      {isRemember ? (
        canAct ? (
          <Textarea
            value={text}
            maxLength={STATEMENT_MAX}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            disabled={busy}
            aria-label={t("chatKnowledge.memory.edit")}
            data-testid="kg-card-remember-text"
            className="text-11"
          />
        ) : (
          <p className="text-11 text-background-foreground" data-testid="kg-card-remember-readonly">{original}</p>
        )
      ) : (
        <ul className="flex flex-col gap-1">
          {card.items.map((it, i) => {
            const key = it.claimId ?? `new-${String(i)}`;
            return (
              <li key={key} className="flex items-start gap-2" data-testid={`kg-card-forget-item-${key}`}>
                {canAct && it.claimId !== null ? (
                  <Checkbox
                    className="mt-0.5"
                    checked={checked[it.claimId] ?? false}
                    disabled={busy}
                    onChange={(e) => setChecked((s) => ({ ...s, [key]: e.target.checked }))}
                    aria-label={t("chatKnowledge.memory.forgetItem", { statement: it.statement })}
                    data-testid={`kg-card-forget-check-${key}`}
                  />
                ) : null}
                <span className="text-11 text-background-foreground">{it.statement}</span>
              </li>
            );
          })}
        </ul>
      )}

      {canAct ? (
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant={isRemember ? "secondary" : "destructive"}
            disabled={busy || (isRemember ? text.trim().length === 0 : selected.length === 0)}
            data-testid="kg-card-accept"
            onClick={() => void decide("accept")}
          >
            {isRemember ? t("chatKnowledge.memory.remember") : t("chatKnowledge.memory.forget", { count: selected.length })}
          </Button>
          <Button size="xs" variant="ghost" disabled={busy} data-testid="kg-card-dismiss" onClick={() => void decide("dismiss")}>
            {t("chatKnowledge.memory.dismiss")}
          </Button>
        </div>
      ) : null}

      {error !== null ? (
        <p role="alert" className="text-10 text-destructive" data-testid="kg-card-error">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
