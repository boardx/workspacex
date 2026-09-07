"use client";
import * as React from "react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { operations, type PublicInterjection } from "@repo/contracts/interjection-status";
import { apiRequest, getStoredSessionToken } from "@/lib/api-client";
/** Receipt and application are distinct durable facts, visible outside the trace fold. */
export function RunInterjections({ events, readHistory = false }: { events: readonly ExecutionEvent[]; readHistory?: boolean }) {
  const runId = events[0]?.runId;
  const lastStatus = [...events].reverse().find((event) => event.kind === "status");
  const shouldRead = readHistory || events.some((event) => event.kind === "interjection") || (lastStatus?.kind === "status" && ["running", "paused", "awaiting_tool_permission"].includes(lastStatus.status));
  const bearer = getStoredSessionToken();
  const source = `${runId ?? ""}:${bearer ?? ""}`;
  const [snapshot, setSnapshot] = React.useState<{ source: string; items: PublicInterjection[] }>({ source, items: [] });
  React.useEffect(() => {
    if (!runId || !bearer || !shouldRead) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const result = operations.list.out.parse(await apiRequest(operations.list.path.replace(":runId", encodeURIComponent(runId)), { sessionToken: bearer, signal: controller.signal }));
        if (controller.signal.aborted) return;
        setSnapshot({ source, items: result.items });
        if (result.items.some((item) => item.status === "received")) timer = setTimeout(() => void read(), 5000);
      } catch { /* Journal streaming remains the primary live status source. */ }
    };
    void read(); return () => { controller.abort(); clearTimeout(timer); };
  }, [runId, bearer, source, shouldRead]);
  const latest = new Map<string, Pick<PublicInterjection, "interjectionId" | "text" | "status">>((snapshot.source === source ? snapshot.items : []).map((item) => [item.interjectionId, item]));
  for (const event of events) if (event.kind === "interjection") {
    if (event.status === "received" && latest.get(event.interjectionId)?.status !== undefined && latest.get(event.interjectionId)?.status !== "received") continue;
    latest.set(event.interjectionId, event);
  }
  if (!latest.size) return null;
  return <div className="my-2 space-y-1 text-11 text-muted-foreground" aria-label="插话状态">
    {[...latest.values()].map((event) => <p key={event.interjectionId} data-testid="workbench-interjection-status" data-status={event.status}>
      插话「{event.text}」 · {event.status === "applied" ? "已应用" : event.status === "not_applied" ? "本轮未应用" : "已收到，等待安全边界应用"}
    </p>)}
  </div>;
}
