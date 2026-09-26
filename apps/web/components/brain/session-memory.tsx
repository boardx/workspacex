"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronRight, MessageSquare } from "lucide-react";
import { KG_TRI_STATE_LABEL_ZH } from "@repo/contracts/chat-knowledge-graph";
import { StateShell } from "@/components/state/state-shell";
import { Badge } from "@/components/ui/badge";
import { sessionTotals } from "@/lib/brain-view";
import { chatMemoryHref } from "@/lib/chat-memory-link";
import type { BrainOverview } from "@/lib/knowledge-graph-api";

/** 对话里的记忆：你创建的、记下了东西的对话，每个一行计数，点进去是那个对话的「记忆」页签。 */
export function SessionMemory({ threads }: { threads: BrainOverview["threads"] }) {
  if (threads.length === 0) {
    return (
      <div data-testid="brain-sessions">
        <StateShell state="empty" emptyHint="还没有哪个对话记下东西。在对话里聊到的决定、事实和风险，会自动记在那个对话的「记忆」里。">
          {null}
        </StateShell>
      </div>
    );
  }
  const totals = sessionTotals(threads);
  return (
    <div className="flex flex-col gap-3" data-testid="brain-sessions">
      <p className="text-12 text-muted-foreground" data-testid="brain-sessions-summary">
        {totals.threads} 个对话共记下 {totals.items} 条
        {totals.pending > 0 ? `，其中 ${totals.pending} 条等你确认` : ""}
        {totals.conflict > 0 ? `，${totals.conflict} 条有矛盾` : ""}。
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
                  <span className="truncate text-13 font-medium">{t.title.trim() === "" ? "未命名对话" : t.title}</span>
                  {t.projectId !== null ? <Badge tone="outline">项目对话</Badge> : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-11 text-muted-foreground">
                  <span className="tabular-nums" data-testid="brain-session-total">记下 {t.claims} 条</span>
                  {t.pending > 0 ? <Badge tone="warning">{KG_TRI_STATE_LABEL_ZH.pending} {t.pending}</Badge> : null}
                  {t.confirmed > 0 ? <Badge tone="success">{KG_TRI_STATE_LABEL_ZH.confirmed} {t.confirmed}</Badge> : null}
                  {t.conflict > 0 ? <Badge tone="danger">{KG_TRI_STATE_LABEL_ZH.conflict} {t.conflict}</Badge> : null}
                  {t.objects > 0 ? <span className="tabular-nums">涉及 {t.objects} 个人和事</span> : null}
                  <span>· 最近 {formatDate(t.lastActivityAt)}</span>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center text-11 text-muted-foreground">
                查看记忆 <ChevronRight aria-hidden className="h-3.5 w-3.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
