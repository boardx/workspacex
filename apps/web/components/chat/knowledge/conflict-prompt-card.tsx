"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { HumanActionDisplayError, describeHumanActionFailure } from "@/lib/knowledge-graph-failure";
import type { MessageKey } from "@/lib/i18n/messages";
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { KgConflictPrompt } from "@repo/contracts/chat-knowledge-graph";

/** 三个出口（契约 `KgHumanAction.resolveConflict.resolution`）。 */
export type ConflictResolution = "keep_new" | "keep_both" | "ignore";
export interface ConflictConditions {
  readonly newer: string;
  readonly older: string;
}

/**
 * 这张卡在服务端已经不在了（别的标签页处理过、其中一条被改掉——`KG_PROMPT_NOT_FOUND`）。
 * `onResolve` 抛它 ⇒ 卡片收起成一行说明，不再留着点不动的按钮。`message` 是给人看的话。
 */
export class ConflictPromptGoneError extends Error {
  constructor(message: string, readonly displayFailure?: HumanActionDisplayError) {
    super(message);
    this.name = "ConflictPromptGoneError";
  }
}

/** 契约 `conditions.newer / older` 的上限。 */
const CONDITION_MAX = 200;

const RESOLVED_NOTE: Record<ConflictResolution, MessageKey> = {
  keep_new: "chatKnowledge.conflict.resolved.new",
  keep_both: "chatKnowledge.conflict.resolved.both",
  ignore: "chatKnowledge.conflict.resolved.ignore",
};

/** issue #4290 低把握改口卡（`kind = possible_change`）的两个出口的结果。 */
const CHANGE_RESOLVED_NOTE: Record<"keep_new" | "keep_both", MessageKey> = {
  keep_new: "chatKnowledge.conflict.changeResolved.new",
  keep_both: "chatKnowledge.conflict.changeResolved.both",
};

/** ISO 时间 → 「9/20」（本地时区）。纯展示格式化，不引入日期库。 */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
}

/**
 * U-5：矛盾提醒卡（uc-18-6 D）——新说法与「你确认过」的一条冲突时，在当轮回答下方出现。
 * 数据是 `getTurnMemory.prompt.conflict`（一轮最多一张，服务端保证 I-18）。
 *
 * - 三个出口：以新的为准 / 两条都留（各写一句适用条件）/ 忽略（同一对不再提醒）。
 *   `onResolve` 真正执行（`applyHumanAction{resolveConflict}`）；失败时它抛出的 Error 带的是给人看的话
 *   （`describeHumanActionFailure`），卡片原样显示、按钮恢复，可以再试。成功后卡片收成一行结果。
 *   抛 `ConflictPromptGoneError`（卡已经不在了）⇒ 收成一行说明，不再给按钮。
 * - `canResolve = false`（不是对话创建者，R5）：只显示提醒文字，不给按钮。
 * - `prompt.kind = possible_change`（issue #4290，人类决定 2026-09-26「高把握自动、低把握弹卡」）：同一张卡换一种问法——
 *   「用〈新〉取代〈旧〉？」，两个出口 [取代]（= keep_new）/ [两条都保留]（= keep_both，不问适用条件、直接交出去）。
 */
export function ConflictPromptCard({
  prompt,
  canResolve,
  onResolve,
}: {
  prompt: KgConflictPrompt;
  canResolve: boolean;
  onResolve: (resolution: ConflictResolution, conditions?: ConflictConditions) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [resolved, setResolved] = React.useState<ConflictResolution | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ kind: "raw"; text: string } | { kind: "fallback" } | { kind: "owned"; failure: HumanActionDisplayError } | null>(null);
  const [gone, setGone] = React.useState<ConflictPromptGoneError | null>(null);
  const [showBoth, setShowBoth] = React.useState(false);
  const [newerCond, setNewerCond] = React.useState("");
  const [olderCond, setOlderCond] = React.useState("");

  const run = async (resolution: ConflictResolution, conditions?: ConflictConditions): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onResolve(resolution, conditions);
      setResolved(resolution);
    } catch (e) {
      if (e instanceof ConflictPromptGoneError) {
        setGone(e);
        return;
      }
      setError(e instanceof HumanActionDisplayError ? { kind: "owned", failure: e } : e instanceof Error && e.message !== "" ? { kind: "raw", text: e.message } : { kind: "fallback" });
    } finally {
      setBusy(false);
    }
  };

  const possibleChange = prompt.kind === "possible_change";

  if (resolved !== null) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-10 text-muted-foreground" data-testid="kg-conflict-resolved">
        <Check aria-hidden className="h-3 w-3 text-success" />
        {t(possibleChange && resolved !== "ignore" ? CHANGE_RESOLVED_NOTE[resolved] : RESOLVED_NOTE[resolved])}
      </p>
    );
  }

  if (gone !== null) {
    return (
      <p role="status" className="mt-2 text-10 text-muted-foreground" data-testid="kg-conflict-gone">
        {gone.displayFailure ? describeHumanActionFailure(gone.displayFailure.failure, locale) : gone.message}
      </p>
    );
  }

  const bothReady = newerCond.trim() !== "" && olderCond.trim() !== "";

  if (possibleChange) {
    return (
      <div className="mt-2 flex flex-col gap-2 rounded-lg border border-warning bg-warning-tint p-3" data-testid="kg-conflict-card" data-kind="possible_change">
        <p className="flex items-start gap-1.5 text-11 text-warning-tint-foreground" data-testid="kg-conflict-text">
          <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("chatKnowledge.conflict.changePrompt", { newer: prompt.newerClaim.statement, older: prompt.olderClaim.statement })}</span>
        </p>
        {canResolve ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="xs" variant="secondary" data-testid="kg-conflict-keep-new" disabled={busy} onClick={() => void run("keep_new")}>
              {t("chatKnowledge.conflict.replace")}
            </Button>
            <Button size="xs" variant="outline" data-testid="kg-conflict-keep-both" disabled={busy} onClick={() => void run("keep_both")}>
              {t("chatKnowledge.conflict.keepBothChange")}
            </Button>
          </div>
        ) : null}
        {error !== null ? (
          <p role="alert" className="text-10 text-destructive" data-testid="kg-conflict-error">
            {error.kind === "owned" ? describeHumanActionFailure(error.failure.failure, locale) : error.kind === "raw" ? error.text : t("chatKnowledge.conflict.failed")}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-warning bg-warning-tint p-3" data-testid="kg-conflict-card">
      <p className="flex items-start gap-1.5 text-11 text-warning-tint-foreground" data-testid="kg-conflict-text">
        <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {t("chatKnowledge.conflict.prompt", { date: shortDate(prompt.olderClaim.saidAt), older: prompt.olderClaim.statement, newer: prompt.newerClaim.statement })}
        </span>
      </p>

      {!canResolve ? null : showBoth ? (
        <div className="flex flex-col gap-1.5" data-testid="kg-conflict-both-conditions">
          <label className="flex flex-col gap-0.5 text-10 text-muted-foreground">
            {t("chatKnowledge.conflict.newCondition")}
            <Input
              value={newerCond}
              maxLength={CONDITION_MAX}
              onChange={(e) => setNewerCond(e.target.value)}
              placeholder={t("chatKnowledge.conflict.newPlaceholder")}
              data-testid="kg-conflict-cond-newer"
              className="text-11"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-10 text-muted-foreground">
            {t("chatKnowledge.conflict.oldCondition")}
            <Input
              value={olderCond}
              maxLength={CONDITION_MAX}
              onChange={(e) => setOlderCond(e.target.value)}
              placeholder={t("chatKnowledge.conflict.oldPlaceholder")}
              data-testid="kg-conflict-cond-older"
              className="text-11"
            />
          </label>
          <div className="flex items-center gap-1.5">
            <Button
              size="xs"
              data-testid="kg-conflict-both-save"
              disabled={!bothReady || busy}
              onClick={() => void run("keep_both", { newer: newerCond.trim(), older: olderCond.trim() })}
            >
              {t("chatKnowledge.action.save")}
            </Button>
            <Button size="xs" variant="ghost" data-testid="kg-conflict-both-cancel" disabled={busy} onClick={() => setShowBoth(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="secondary" data-testid="kg-conflict-keep-new" disabled={busy} onClick={() => void run("keep_new")}>
            {t("chatKnowledge.conflict.useNew")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            data-testid="kg-conflict-keep-both"
            disabled={busy}
            onClick={() => {
              setError(null);
              setShowBoth(true);
            }}
          >
            {t("chatKnowledge.conflict.keepBoth")}
          </Button>
          <Button size="xs" variant="ghost" data-testid="kg-conflict-ignore" disabled={busy} onClick={() => void run("ignore")}>
            {t("chatKnowledge.conflict.ignore")}
          </Button>
        </div>
      )}

      {error !== null ? (
        <p role="alert" className="text-10 text-destructive" data-testid="kg-conflict-error">
          {error.kind === "owned" ? describeHumanActionFailure(error.failure.failure, locale) : error.kind === "raw" ? error.text : t("chatKnowledge.conflict.failed")}
        </p>
      ) : null}
    </div>
  );
}
