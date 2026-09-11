"use client";
import * as React from "react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { operations, type PublicInterjection } from "@repo/contracts/interjection-status";
import { apiRequest, getStoredSessionToken } from "@/lib/api-client";
/**
 * Receipt and application are distinct durable facts, visible outside the trace fold.
 *
 * ⚠ issue #3399 ② —— `not_applied` 是**终局**，不是"排队等下一轮"。
 *
 * 真实链路：run 一进终态，`workbench_journal_unapplied_interjections` 触发器把没应用的
 * 插话记一条 `not_applied` 事件就结束了；没有任何地方把它带进下一轮，助手从头到尾
 * 没有收到这句话。原文案「本轮未应用」让用户以为它还在队里——那是静默丢弃。
 * 所以这里必须把去向说死（没被采纳、助手没收到），并给出一条**真的会把它发出去**的
 * 路径；不允许留下"显示了一句状态、然后什么都没发生"（同族：#3311 / #3317 / #3372）。
 */
export function RunInterjections({ events, readHistory = false, onResend }: { events: readonly ExecutionEvent[]; readHistory?: boolean; onResend?: (text: string) => void }) {
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
      插话「{event.text}」 · {event.status === "applied" ? "已应用" : event.status === "not_applied" ? "本轮未被采纳，助手没有收到这句话" : "已收到，等待安全边界应用"}
      {event.status === "not_applied" && onResend ? <>
        {" "}
        <button type="button" data-testid="workbench-interjection-resend" className="underline underline-offset-2 transition-colors hover:text-card-foreground"
          onClick={() => onResend(event.text)}>重新发送</button>
      </> : null}
    </p>)}
  </div>;
}
