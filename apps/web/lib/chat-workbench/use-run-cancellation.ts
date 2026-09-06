"use client";
import * as React from "react";
import { CancelRunOutput } from "@repo/contracts/run-control";
import { apiRequest } from "@/lib/api-client";
import { getAgentRun } from "@/lib/agent-run";

export function useRunCancellation(runId: string | null, bearer: string | null) {
  const [requested, setRequested] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const controller = React.useRef<AbortController | null>(null);
  const posting = React.useRef(false);
  const scope = React.useRef(runId);
  scope.current = runId;
  React.useEffect(() => {
    setRequested(false); setFailure(null);
    const abort = new AbortController();
    controller.current = abort;
    if (runId && bearer) void getAgentRun(runId, bearer, abort.signal).then((view) => {
      if (!abort.signal.aborted && view.cancelRequestedAt && view.status !== "cancelled") setRequested(true);
    }).catch(() => {});
    return () => abort.abort();
  }, [runId, bearer]);
  React.useEffect(() => {
    if (!requested || !runId || !bearer) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const view = await getAgentRun(runId, bearer, abort.signal);
        if (abort.signal.aborted) return;
        if (["cancelled", "succeeded", "failed"].includes(view.status)) { setRequested(false); return; }
      } catch { if (abort.signal.aborted) return; }
      timer = setTimeout(() => { void poll(); }, 1500);
    };
    void poll();
    return () => { abort.abort(); if (timer) clearTimeout(timer); };
  }, [requested, runId, bearer]);
  const cancel = React.useCallback(async () => {
    if (!runId || !bearer || requested || posting.current) return;
    posting.current = true;
    setRequested(true); setFailure(null);
    try {
      const output = CancelRunOutput.parse(await apiRequest<unknown>(`/agent-runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST", sessionToken: bearer, signal: controller.current?.signal,
      }));
      if (scope.current !== runId) return;
      setRequested(output.status === "cancel_requested");
    } catch {
      if (scope.current !== runId) return;
      setRequested(false); setFailure("停止请求未能确认，请重试。");
    } finally { posting.current = false; }
  }, [runId, bearer, requested]);
  return { cancel, requested, failure, canCancel: Boolean(runId && bearer) };
}
