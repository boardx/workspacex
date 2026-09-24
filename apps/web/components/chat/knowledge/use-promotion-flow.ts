"use client";

import * as React from "react";
import type { PromotionChoice, PromotionNominations, PromotionResults } from "@/lib/knowledge-graph-api";
import { describePromotionFailure } from "@/lib/knowledge-graph-failure";
import { claimTriState, type KgClaim } from "@repo/contracts/chat-knowledge-graph";

export type PromoteFn = (claimIds: string[], choices?: PromotionChoice[]) => Promise<PromotionResults>;

/**
 * phase-18 F11 —— 面板里「记到我的长期记忆」的一次次提交与逐条结果。
 *
 * - 首次提交（不带 `choices`）⇒ 结果整份替换：面板只显示「上次记入的结果」。
 * - 回答 `needs_choice`（带 `choices` 重发那一条）⇒ 只替换那一条的结果，其它条保持原样。
 * - 整批被拒（403 / 400 / 404 / 网络）⇒ 把人话交给 `onError`，结果不动；不上屏任何内部码。
 * - 在途时 `busy=true`，再点直接忽略（按钮也禁用），不重复提交。
 */
export function usePromotionFlow({
  onPromote,
  onError,
  initialResult = null,
}: {
  onPromote: PromoteFn | undefined;
  onError: (message: string | null) => void;
  initialResult?: PromotionResults | null;
}) {
  const [result, setResult] = React.useState<PromotionResults | null>(initialResult);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);

  const run = React.useCallback(async (claimIds: string[], choices?: PromotionChoice[]): Promise<void> => {
    if (!onPromote || busyRef.current || claimIds.length === 0) return;
    busyRef.current = true;
    setBusy(true);
    onError(null);
    try {
      const next = await onPromote(claimIds, choices);
      setResult((prev) => (choices && choices.length > 0 && prev ? mergeResults(prev, next) : next));
    } catch (e) {
      onError(describePromotionFailure(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [onPromote, onError]);

  const choose = React.useCallback((claimId: string, choice: PromotionChoice["choice"]) => {
    void run([claimId], [{ claimId, choice }]);
  }, [run]);

  return { result, busy, run, choose };
}

function mergeResults(prev: PromotionResults, next: PromotionResults): PromotionResults {
  const byId = new Map(next.results.map((r) => [r.claimId, r]));
  const merged = prev.results.map((r) => byId.get(r.claimId) ?? r);
  const extra = next.results.filter((r) => !prev.results.some((p) => p.claimId === r.claimId));
  return { results: [...merged, ...extra] };
}

/** 这一条在本次结果里已经进了长期记忆（新记入 / 并入已有 / 并存）。 */
function isSettled(result: PromotionResults | null, claimId: string): boolean {
  return result?.results.some((r) => r.claimId === claimId &&
    (r.outcome === "promoted" || r.outcome === "merged_into_existing" || r.outcome === "coexisting")) ?? false;
}

/**
 * 面板上要显示的 AI 提名：只留读模型里还在、还显示着的条目（提名指向已不在的一条时不画，
 * 免得上屏一个内部 id），并去掉本次已经记进长期记忆的。
 */
export function visibleNominations(
  nominations: PromotionNominations | null | undefined,
  claims: readonly KgClaim[],
  result: PromotionResults | null,
): PromotionNominations | null {
  if (!nominations) return null;
  const shown = new Set(claims.filter((c) => claimTriState(c.status) !== null).map((c) => c.id));
  const list = nominations.nominations.filter((n) => shown.has(n.claimId) && !isSettled(result, n.claimId));
  return list.length > 0 ? { nominations: list } : null;
}
