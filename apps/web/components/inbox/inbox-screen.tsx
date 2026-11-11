"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Inbox } from "lucide-react";
import { orgAdmin } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { useI18n } from "@/lib/i18n/provider";
import { useNotificationCenter } from "@/lib/notifications/use-notification-center";
import { workbenchThreadPath } from "@/lib/chat-workbench/project-scope";
import { cn } from "@/lib/utils";

export function InboxScreen({ initialMessage }: { initialMessage?: string }) {
  const session = useOptionalSession()?.session;
  return <InboxContent key={JSON.stringify([session?.userId, session?.currentOrgId, session?.sessionToken])}
    token={session?.sessionToken} initialMessage={initialMessage} />;
}

function InboxContent({ token, initialMessage }: { token?: string; initialMessage?: string }) {
  const { t, locale } = useI18n();
  const { items, unreadCount, failed, busy, loading, refresh, markRead } = useNotificationCenter(token);
  const [selectedId, setSelectedId] = React.useState(initialMessage);
  const [reading, setReading] = React.useState(Boolean(initialMessage));
  const selected = items.find(item => item.id === selectedId);
  const needsRead = selected?.readAt === null && !selected.actionable;
  React.useEffect(() => {
    if (reading && needsRead && selectedId) void markRead([selectedId]);
  }, [reading, needsRead, selectedId, markRead]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const messages = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return <div className="flex min-h-full min-w-0 flex-col md:h-full">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex items-center gap-3">
        <Inbox aria-hidden className="h-5 w-5" />
        <h1 className="text-20 font-semibold">{t("notifications.inbox")}</h1>
        <span className="text-12 text-muted-foreground">{t("notifications.unread", { count: unreadCount })}</span>
      </div>
      <Button size="sm" variant="outline" disabled={busy || unreadCount === 0} onClick={() => void markRead()}>
        {t("notifications.markAllRead")}
      </Button>
    </header>
    {failed && <div role="status" className="flex items-center gap-3 border-b border-border px-5 py-2 text-13">
      {t("notifications.refreshFailed")}
      <Button size="sm" variant="ghost" onClick={() => void refresh()}>{t("state.retry")}</Button>
    </div>}
    <div className="grid min-w-0 flex-1 md:min-h-0 md:grid-cols-[minmax(14rem,22rem)_minmax(0,1fr)]">
      <nav aria-label={t("notifications.inbox")} className={cn("min-w-0 border-border md:block md:overflow-y-auto md:border-r", reading && "hidden")}>
        {loading ? <p role="status" className="p-5 text-13 text-muted-foreground">{t("notifications.loading")}</p>
          : messages.length === 0 && !failed && <p className="p-5 text-13 text-muted-foreground">{t("notifications.noMessages")}</p>}
        {messages.map(item => <button key={item.id} type="button" aria-current={item.id === selectedId ? "true" : undefined}
          onClick={() => { setSelectedId(item.id); setReading(true); }}
          className={cn("block w-full min-w-0 border-b border-border px-5 py-3 text-left transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
            item.id === selectedId && "bg-muted")}>
          <span className="flex flex-wrap justify-between gap-x-2 text-11 text-muted-foreground">
            <span>{t(`notifications.kind.${item.kind}`)}</span>
            <time dateTime={item.createdAt}>{date.format(new Date(item.createdAt))}</time>
          </span>
          <span className={cn("mt-1 block break-words text-14", item.readAt === null && "font-semibold")}>
            {item.readAt === null && <span className="sr-only">{t("notifications.unread", { count: 1 })} </span>}
            {item.title}
          </span>
        </button>)}
      </nav>
      <section aria-label={t("notifications.messageDetails")} className={cn("min-w-0 px-5 py-6 md:block md:overflow-y-auto lg:px-10", !reading && "hidden")}>
        <Button variant="ghost" size="sm" className="mb-4 md:hidden" onClick={() => setReading(false)}>
          <ArrowLeft aria-hidden className="h-4 w-4" />{t("notifications.backToMessages")}
        </Button>
        {selected ? <article className="mx-auto max-w-3xl">
          <h2 className="break-words text-24 font-semibold">{selected.title}</h2>
          <time className="mt-2 block text-12 text-muted-foreground" dateTime={selected.createdAt}>{date.format(new Date(selected.createdAt))}</time>
          <p className="mt-6 whitespace-pre-wrap break-words text-14 leading-relaxed">{selected.body}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {selected.inboxInviteId && <Button asChild variant="primary">
              <Link href={`${orgAdmin.INVITATION_ACTIVATION_PATH}?${orgAdmin.INBOX_INVITE_PARAM}=${encodeURIComponent(selected.inboxInviteId)}`}>
                {t("notifications.openInvitation")}
              </Link>
            </Button>}
            {selected.threadId && <Button asChild variant="outline">
              <Link href={workbenchThreadPath(selected.threadId, null)}>{t("notifications.openConversation")}</Link>
            </Button>}
          </div>
        </article> : <p className="text-14 text-muted-foreground">
          {t(loading ? "notifications.loading" : selectedId && !failed ? "notifications.messageUnavailable" : "notifications.selectMessage")}
        </p>}
      </section>
    </div>
  </div>;
}
