"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronRight, MessageSquare } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { StateShell } from "@/components/state/state-shell";
import { Badge } from "@/components/ui/badge";
import { sessionTotals } from "@/lib/brain-view";
import { chatMemoryHref } from "@/lib/chat-memory-link";
import type { BrainOverview } from "@/lib/knowledge-graph-api";

/** 对话里的记忆：你创建的、记下了东西的对话，每个一行计数，点进去是那个对话的「记忆」页签。 */
export function SessionMemory({ threads }: { threads: BrainOverview["threads"] }) {
  const { locale, t: copy } = useI18n();
  if (threads.length === 0) {
    return (
      <div data-testid="brain-sessions">
        <StateShell state="empty" emptyHint={copy("brain.sessions.empty")}>
          {null}
        </StateShell>
      </div>
    );
  }
  const totals = sessionTotals(threads);
  return (
    <div className="flex flex-col gap-3" data-testid="brain-sessions">
      <p className="text-12 text-muted-foreground" data-testid="brain-sessions-summary">
        {copy("brain.sessions.summary", { threads: copy("brain.sessions.conversations", { count: totals.threads }), items: copy("brain.sessions.items", { count: totals.items }) })}
        {totals.pending > 0 ? copy("brain.sessions.pendingSummary", { count: totals.pending }) : ""}
        {totals.conflict > 0 ? copy("brain.sessions.conflictSummary", { count: totals.conflict }) : ""}{copy("brain.sessions.period")}
      </p>
      <ul className="flex flex-col gap-2">
        {threads.map((t) => (
          <li key={t.threadId}>
            <Link
              href={chatMemoryHref({ threadId: t.threadId, projectId: t.projectId })}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted"
              data-testid="brain-session-row"
            >
              <MessageSquare aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-13 font-medium">{t.title.trim() === "" ? copy("brain.sessions.untitled") : t.title}</span>
                  {t.projectId !== null ? <Badge tone="outline">{copy("brain.sessions.project")}</Badge> : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-11 text-muted-foreground">
                  <span className="tabular-nums" data-testid="brain-session-total">{copy("brain.sessions.saved", { count: t.claims })}</span>
                  {t.pending > 0 ? <Badge tone="warning">{copy("brain.sessions.pending")} {t.pending}</Badge> : null}
                  {t.confirmed > 0 ? <Badge tone="success">{copy("brain.sessions.confirmed")} {t.confirmed}</Badge> : null}
                  {t.conflict > 0 ? <Badge tone="danger">{copy("brain.sessions.conflict")} {t.conflict}</Badge> : null}
                  {t.objects > 0 ? <span className="tabular-nums">{copy("brain.sessions.objects", { count: t.objects })}</span> : null}
                  <span>{copy("brain.sessions.recent", { date: formatDate(t.lastActivityAt, locale) })}</span>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center text-11 text-muted-foreground">
                {copy("brain.sessions.view")} <ChevronRight aria-hidden className="h-3.5 w-3.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatDate(iso: string, locale: Locale): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(locale === "en" ? "en-US" : "zh-CN", { month: "numeric", day: "numeric" });
}
