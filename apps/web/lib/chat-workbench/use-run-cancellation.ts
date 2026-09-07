"use client";
import * as React from "react";
import { CancelRunOutput } from "@repo/contracts/run-control";
import { apiRequest } from "@/lib/api-client";
import { getAgentRun, type AgentRunView } from "@/lib/agent-run";
type Snapshot = { source: string; requested: boolean; parentStopped: boolean; child: AgentRunView["childCancellation"]; failure: string | null };
export function useRunCancellation(runId: string | null, bearer: string | null) {
  const source = JSON.stringify([runId, bearer]);
  const empty: Snapshot = { source, requested: false, parentStopped: false, child: undefined, failure: null };
  const [snapshot, setSnapshot] = React.useState<Snapshot>(empty);
  const current = React.useRef(source); current.current = source;
  const view = snapshot.source === source ? snapshot : empty;
  const controller = React.useRef<AbortController | null>(null);
  const posting = React.useRef(false);
  const revision = React.useRef(0);
  const update = React.useCallback((patch: Partial<Snapshot>) => {
    if (current.current === source) setSnapshot(previous => ({ ...(previous.source === source ? previous : { source, requested: false, parentStopped: false, child: undefined, failure: null }), ...patch }));
  }, [source]);
  const observe = React.useCallback((run: AgentRunView) => update({
    requested: Boolean(run.cancelRequestedAt) && !["cancelled", "succeeded", "failed"].includes(run.status),
    parentStopped: run.status === "cancelled", child: run.childCancellation,
  }), [update]);
  React.useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    const readRevision = revision.current;
    if (runId && bearer) void getAgentRun(runId, bearer, abort.signal).then(run => {
      if (!abort.signal.aborted && readRevision === revision.current) observe(run);
    }).catch(() => {});
    return () => abort.abort();
  }, [runId, bearer, observe]);
  const shouldPoll = view.requested || view.child?.kind === "pending";
  React.useEffect(() => {
    if (!shouldPoll || !runId || !bearer) return;
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1500;
    const poll = async () => {
      try {
        const run = await getAgentRun(runId, bearer, abort.signal);
        if (abort.signal.aborted) return;
        observe(run);
        if (["cancelled", "succeeded", "failed"].includes(run.status) && run.childCancellation?.kind !== "pending") return;
      } catch { if (abort.signal.aborted) return; }
      delay = Math.min(delay * 2, 30000);
      timer = setTimeout(() => void poll(), delay);
    };
    timer = setTimeout(() => void poll(), delay);
    return () => { abort.abort(); if (timer) clearTimeout(timer); };
  }, [shouldPoll, runId, bearer, observe]);
  const cancel = React.useCallback(async () => {
    if (!runId || !bearer || view.requested || view.parentStopped || posting.current) return;
    const abort = controller.current;
    posting.current = true; revision.current += 1; update({ requested: true, failure: null });
    try {
      const output = CancelRunOutput.parse(await apiRequest<unknown>(`/agent-runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST", sessionToken: bearer, signal: abort?.signal,
      }));
      if (abort?.signal.aborted) return;
      update({ requested: output.status === "cancel_requested", parentStopped: output.status === "cancelled", child: output.childCancellation });
    } catch {
      if (!abort?.signal.aborted) update({ requested: false, failure: "停止请求未能确认，请重试。" });
    } finally { posting.current = false; }
  }, [runId, bearer, view.requested, view.parentStopped, update]);
  const childNotice = view.child?.kind === "pending"
    ? view.parentStopped ? "父任务已停止，子任务仍待停止确认。" : "正在停止父任务，子任务仍待停止确认。"
    : view.child?.kind === "unavailable" ? "子任务停止状态未确认。" : null;
  return { cancel, requested: view.requested, failure: view.failure, childNotice, canCancel: Boolean(runId && bearer && !view.parentStopped) };
}
