"use client";
import * as React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { listMyConsolidationRuns, undoConsolidationRun, type ConsolidationRun } from "@/lib/live-memory-ops";

/**
 * Phase 18 S8（#4365）—— 大脑页「我的长期记忆」下方的「整理记录」：后台记忆整合对你的长期记忆做过什么，每次都能撤销。
 *
 * - 合并了重复（「A」和「B」说的是同一件事，合成一条，来源都保留）；
 * - 合一了写法（「项目 A」并入「项目A」）；
 * - 发现矛盾（开了一张冲突卡，在那个对话里由你决定——整合从不替你选）。
 * 「撤销这次整理」= 逐处还原；已经变了的那一处（例如冲突卡你已经处理过）不还原，并写明原因。
 * 没有任何整理记录时整块不出现（整合默认关，大多数人看不到它）。数据只有本人读得到（`GET /knowledge-graph/me/consolidations`）。
 */

const KIND_TEXT: Record<ConsolidationRun["changes"][number]["kind"], string> = {
  claim_merge: "合并了重复",
  entity_merge: "合一了写法",
  conflict_opened: "发现矛盾",
};

function describe(change: ConsolidationRun["changes"][number]): React.ReactNode {
  const kept = change.kept.text ?? "（已不在长期记忆里）";
  const other = change.other.text ?? "（已不在长期记忆里）";
  if (change.kind === "claim_merge") return <>「{other}」并入「{kept}」（两条的来源都保留）</>;
  if (change.kind === "entity_merge") return <>「{other}」并入「{kept}」</>;
  return (
    <>
      「{other}」与「{kept}」不一致，
      {change.threadId !== null
        ? <Link className="underline underline-offset-2" href={`/chat/${encodeURIComponent(change.threadId)}`}>去那个对话里决定</Link>
        : "请在对话里决定"}
    </>
  );
}

const STATE_TEXT: Record<ConsolidationRun["state"], string> = { applied: "", undone: "已撤销", partially_undone: "已部分撤销" };

export function ConsolidationHistory({ onChanged }: { onChanged?: () => unknown }) {
  const [runs, setRuns] = React.useState<readonly ConsolidationRun[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [undoError, setUndoError] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      setRuns(await listMyConsolidationRuns(signal));
      setFailed(false);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setFailed(true);
    }
  }, []);

  React.useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const undo = async (runId: string) => {
    if (busy !== null) return;
    setBusy(runId);
    setUndoError(null);
    try {
      const run = await undoConsolidationRun(runId);
      setRuns((prev) => (prev ?? []).map((r) => (r.runId === runId ? run : r)));
      await onChanged?.();
    } catch (err) {
      setUndoError(err instanceof ApiError && err.reasonCode === "KG_CONSOLIDATION_RUN_NOT_FOUND"
        ? "这次整理已经撤销过了（或已不存在）。"
        : "没能撤销，稍后再试一次。");
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (failed) {
    return <p className="text-11 text-muted-foreground" data-testid="brain-consolidation-failed">暂时读不到整理记录。</p>;
  }
  if (runs === null || runs.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-4" data-testid="brain-consolidation">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-13 font-semibold">整理记录</h2>
        <p className="text-11 text-muted-foreground">后台定期整理你的长期记忆。每次整理都能撤销，撤销后恢复成整理之前的样子。</p>
      </div>
      {undoError !== null && <p role="alert" className="text-11 text-destructive" data-testid="brain-consolidation-undo-failed">{undoError}</p>}
      <ul className="flex flex-col gap-2">
        {runs.map((run) => (
          <li key={run.runId} className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3" data-testid={`brain-consolidation-run-${run.runId}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-12 font-medium text-card-foreground">
                {new Date(run.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 的整理
                {STATE_TEXT[run.state] !== "" && (
                  <span className="ml-1.5 text-11 font-normal text-muted-foreground" data-testid="brain-consolidation-run-state">{STATE_TEXT[run.state]}</span>
                )}
              </span>
              {run.state === "applied" && (
                <Button size="sm" variant="outline" onClick={() => void undo(run.runId)} disabled={busy !== null} data-testid="brain-consolidation-undo">
                  {busy === run.runId ? <><Loader2 aria-hidden className="mr-1 h-3 w-3 animate-spin" />撤销中…</> : "撤销这次整理"}
                </Button>
              )}
            </div>
            <ul className="flex flex-col gap-1">
              {run.changes.map((c) => (
                <li key={c.changeId} className="text-11 text-card-foreground" data-testid={`brain-consolidation-change-${c.kind}`}>
                  <span className="mr-1.5 text-muted-foreground">{KIND_TEXT[c.kind]}</span>
                  <span className={c.state === "undone" ? "line-through text-muted-foreground" : ""}>{describe(c)}</span>
                  {c.state === "undo_skipped" && c.undoNote !== null && (
                    <span className="ml-1.5 text-muted-foreground">（没有撤销：{c.undoNote}）</span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
