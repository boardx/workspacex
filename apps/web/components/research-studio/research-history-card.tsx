import Image from "next/image";
import type { ComponentProps } from "react";
import { StudioHistoryCard } from "@/components/studio/studio-history";
import { Badge } from "@/components/ui/badge";

/** Research-only layout; shared history cards in other studios stay unchanged. */
export function ResearchHistoryCard({ testId, title, status, description, tags, metadata, primaryAction, management, children }: ComponentProps<typeof StudioHistoryCard>) {
  return <article data-testid={testId} className="grid min-h-64 min-w-0 gap-5 rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md sm:grid-cols-[minmax(8rem,0.65fr)_minmax(0,1.35fr)]">
    <div className="relative min-h-48 overflow-hidden rounded-lg bg-muted sm:min-h-72">
      <Image src="/research/energy-storage-cover.png" alt="" fill sizes="(min-width: 768px) 220px, 90vw" className="object-cover grayscale" />
    </div>
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-2"><h2 className="break-words text-xl font-semibold">{title}</h2><span className="shrink-0">{status}</span></div>
      <div className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{description}</div>
      <div className="flex flex-wrap gap-2">{tags.map(tag => <Badge key={tag} tone="neutral">{tag}</Badge>)}</div>
      <div className="mt-auto space-y-3 pt-3">{children}<div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">{metadata}</div><div className="flex items-center justify-between gap-2">{primaryAction}{management}</div></div>
    </div>
  </article>;
}
