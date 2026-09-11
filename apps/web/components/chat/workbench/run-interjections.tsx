"use client";
import * as React from "react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { operations, type PublicInterjection } from "@repo/contracts/interjection-status";
import { apiRequest, getStoredSessionToken } from "@/lib/api-client";
/**
 * Receipt and application are distinct durable facts, visible outside the trace fold.
 *
 * ⚠ issue #3399 ② / #3405 —— 一条插话的去向只有四种，每一种都说死，没有"悬着"。
 *
 * #3399 查明：run 一进终态，触发器给没应用的插话记一条 `not_applied` 就结束了，
 * 没有任何地方把它带进下一轮——助手从头到尾没收到这句话。#3400 先把文案改成不撒谎
 * （前端止血）；#3405 是治因：服务端现在真的把它作为下一条消息投进同一线程，
 * 状态因此分成两支：
 *   · `carried_over` —— **已带入下一轮**，那句话真的进了下一轮的模型输入。
 *   · `not_applied`  —— 真的没有下一轮（用户主动取消了本轮 / 本轮自己就是带入轮，
 *                        已到深度上限）。终局，靠「重新发送」。
 * 判定的唯一事实源在 DB 触发器（migration 20260911060000）的那个 `CASE`，
 * 这里只渲染它的结论，不在前端重写第二份判定。
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
      插话「{event.text}」 · {event.status === "applied" ? "已应用"
        : event.status === "carried_over" ? "本轮没来得及采纳，已作为下一条消息带入下一轮"
          : event.status === "not_applied" ? "本轮未被采纳，助手没有收到这句话" : "已收到，等待安全边界应用"}
      {event.status === "not_applied" && onResend ? <>
        {" "}
        <button type="button" data-testid="workbench-interjection-resend" className="underline underline-offset-2 transition-colors hover:text-card-foreground"
          onClick={() => onResend(event.text)}>重新发送</button>
      </> : null}
    </p>)}
  </div>;
}
