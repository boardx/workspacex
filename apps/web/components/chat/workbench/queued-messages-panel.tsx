"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { QueuedMessage } from "@repo/contracts/thread-message-queue";
/**
 * 服务端排队中的消息。2026-09-08 人类直接指令：「还在排队的 prompt 应该要可以编辑」——
 * pending 状态的条目点「编辑」就地改正文，保存走 `PATCH …/queued-messages/:id`；
 * 服务端只接受仍在 pending 的行（已派发的会 409，这里把失败印回同一行）。
 */
export function QueuedMessagesPanel({ items, cancel, cancelling, edit, error, canWrite }: {
  items: QueuedMessage[]; cancel: (id: string) => Promise<void>; cancelling: string | null;
  edit: (id: string, text: string) => Promise<boolean>; error: string | null; canWrite: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = React.useState<{ id: string; text: string; saving: boolean } | null>(null);
  const visible = items.filter((item) => item.status === "pending" || item.status === "failed");
  if (!visible.length && !error) return null;
  const save = async () => {
    if (!editing || !editing.text.trim()) return;
    setEditing({ ...editing, saving: true });
    const ok = await edit(editing.id, editing.text.trim());
    setEditing((current) => ok ? null : current ? { ...current, saving: false } : null);
  };
  return <section data-testid="workbench-server-queue" className="my-2 space-y-2 text-13" aria-label={t("chatInteractions.queuedMessages")}>
    {error ? <p role="alert">{error}</p> : null}
    {visible.map((item) => editing?.id === item.id && item.status === "pending"
      ? <form key={item.id} data-testid="workbench-queued-message" className="space-y-2 rounded-container border p-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <Textarea aria-label={t("chatInteractions.editQueued")} value={editing.text} autoFocus rows={3} disabled={editing.saving}
          onChange={(event) => setEditing({ ...editing, text: event.target.value })}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void save(); } if (event.key === "Escape") setEditing(null); }} />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={editing.saving || !editing.text.trim()}>{editing.saving ? t("chatInteractions.saving") : t("chatInteractions.save")}</Button>
          <Button type="button" variant="ghost" size="sm" disabled={editing.saving} onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
          <span className="text-11 text-muted-foreground">{t("chatInteractions.queueKeys")}</span>
        </div>
      </form>
      : <div key={item.id} data-testid="workbench-queued-message" className="flex items-center gap-2 rounded-container border p-2">
        <span className="min-w-0 flex-1 whitespace-pre-wrap">{item.text}<span className="ml-2 text-11 text-muted-foreground">{item.status === "pending" ? t("chatInteractions.queued") : t("chatInteractions.queueFailed", { error: item.error ?? t("chatInteractions.tryAgain") })}</span></span>
        {item.status === "pending" ? <>
          <Button type="button" variant="ghost" size="sm" disabled={!canWrite || cancelling === item.id} onClick={() => setEditing({ id: item.id, text: item.text, saving: false })} className="shrink-0 underline">{t("chatInteractions.edit")}</Button>
          <Button type="button" variant="ghost" size="sm" disabled={!canWrite || cancelling === item.id} onClick={() => void cancel(item.id)} className="shrink-0 underline">{cancelling === item.id ? t("chatInteractions.withdrawing") : t("chatInteractions.withdraw")}</Button>
        </> : null}
      </div>)}
  </section>;
}
