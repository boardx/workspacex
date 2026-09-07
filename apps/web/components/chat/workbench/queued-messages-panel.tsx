"use client";
import { Button } from "@/components/ui/button";
import type { QueuedMessage } from "@repo/contracts/thread-message-queue";
export function QueuedMessagesPanel({ items, cancel, cancelling, error, canWrite }: {
  items: QueuedMessage[]; cancel: (id: string) => Promise<void>; cancelling: string | null; error: string | null; canWrite: boolean;
}) {
  const visible = items.filter((item) => item.status === "pending" || item.status === "failed");
  if (!visible.length && !error) return null;
  return <section data-testid="workbench-server-queue" className="my-2 space-y-2 text-13" aria-label="待发送消息">
    {error ? <p role="alert">{error}</p> : null}
    {visible.map((item) => <div key={item.id} data-testid="workbench-queued-message" className="flex items-center gap-2 rounded-container border p-2">
      <span className="min-w-0 flex-1 whitespace-pre-wrap">{item.text}<span className="ml-2 text-11 text-muted-foreground">{item.status === "pending" ? "已排队，当前任务结束后发送" : `未能发送：${item.error ?? "请重试"}`}</span></span>
      {item.status === "pending" ? <Button type="button" variant="ghost" size="sm" disabled={!canWrite || cancelling === item.id} onClick={() => void cancel(item.id)} className="shrink-0 underline">{cancelling === item.id ? "撤回中…" : "撤回"}</Button> : null}
    </div>)}
  </section>;
}
