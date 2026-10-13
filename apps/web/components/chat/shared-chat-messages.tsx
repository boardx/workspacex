"use client";
import type { chatShare } from "@repo/contracts";
import { stripControlMarkersForDisplay } from "@/lib/chat-control-markers";
import { MarkdownProseBlock } from "./markdown-prose";

/** Both publication preview and anonymous reading display the same snapshot. */
export function SharedChatMessages({ snapshot }: { snapshot: chatShare.SnapshotValue }) {
  return <div className="space-y-6" data-testid="shared-chat-messages">
    {snapshot.messages.map((message, index) => <article key={index} className="min-w-0 space-y-2 border-b border-border-subtle pb-6">
      <p className="text-12 font-semibold text-muted-foreground">{message.authorKind === "human" ? "提问者" : "AI 助手"}</p>
      <div className="min-w-0 overflow-x-auto break-words">
        <MarkdownProseBlock text={stripControlMarkersForDisplay(message.text)} testId="shared-chat-message" />
      </div>
      {message.attachments.map((a, i) => <div key={i} className="rounded-md border border-border p-3">
        {a.imageData ? (
          // Immutable raster bytes come from the reviewed snapshot; no private content endpoint.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.imageData} alt={a.filename} className="h-auto max-h-96 max-w-full rounded-md object-contain" loading="lazy" />
        ) : <p className="text-12 text-muted-foreground">{a.filename} · 附件文件未公开</p>}
      </div>)}
    </article>)}
  </div>;
}
