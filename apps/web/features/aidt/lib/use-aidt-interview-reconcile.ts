"use client";

import * as React from "react";
import { apiRequest } from "@/lib/api-client";

export function useAidtInterviewReconcile(projectId: string, entityId: string | undefined, token: string | undefined, clean: boolean, refreshStage: () => Promise<void>) {
  const completed = React.useRef("");
  const pending = React.useRef<AbortController | null>(null);
  const [failed, setFailed] = React.useState("");
  const scope = JSON.stringify([projectId, entityId, token]);
  React.useEffect(() => {
    completed.current = ""; setFailed("");
    return () => { pending.current?.abort(); pending.current = null; };
  }, [scope]);
  const onSettled = (id: string) => {
    if (!entityId || !token || !clean || completed.current === id || pending.current || failed === id) return;
    const controller = new AbortController();
    pending.current = controller;
    void apiRequest<unknown>(`/projects/${encodeURIComponent(projectId)}/aidt/stages/2/entities/${encodeURIComponent(entityId)}/reconcile`, {
      method: "POST", sessionToken: token, signal: controller.signal,
    }).then(async () => {
      if (controller.signal.aborted) return;
      // A full reload removes the Chat controls and discards in-progress guide edits.
      await refreshStage();
      if (!controller.signal.aborted) completed.current = id;
    }).catch(() => { if (!controller.signal.aborted) setFailed(id); })
      .finally(() => { if (pending.current === controller) pending.current = null; });
  };
  return { onSettled, failed: Boolean(failed), retry: () => setFailed("") };
}
