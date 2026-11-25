"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TagFilterBar } from "@/components/ui/tag-filter-bar";
import { aggregateTags, dedupeTags, hasTag, matchesQuery } from "@/lib/tag-utils";
import { cn } from "@/lib/utils";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

export const cardTagPrefix = "cardTags:";
const prefix = cardTagPrefix;
const maxTags = 8;
const maxTagLength = 24;
export const aidtCardTagLimits = { maxTags, maxTagLength };

export function readAidtEntityCardTags(fields: AidtUiStageDraft["fields"], id: string): string[] {
  try {
    const tags: unknown = JSON.parse(fields[prefix + id] ?? "[]");
    return Array.isArray(tags) ? dedupeTags(tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0 && tag.length <= maxTagLength)).slice(0, maxTags) : [];
  } catch {
    return [];
  }
}

export function updateAidtEntityCardTags(draft: AidtUiStageDraft, id: string, tags: readonly string[]): AidtUiStageDraft {
  const key = prefix + id;
  const next = dedupeTags(tags).filter(tag => tag.length <= maxTagLength).slice(0, maxTags);
  if (JSON.stringify(readAidtEntityCardTags(draft.fields, id)) === JSON.stringify(next)) return draft;
  if (!(key in draft.fields) && Object.keys(draft.fields).length >= 100) return draft;
  return { ...draft, fields: { ...draft.fields, [key]: JSON.stringify(next) } };
}

type CardTags = {
  draft: AidtUiStageDraft;
  labels: readonly string[];
  selected: string | null;
  query: string;
  knownTags: ReadonlyMap<string, number>;
  filters: React.ReactNode;
  register: (id: string) => () => void;
};
const CardTagsContext = React.createContext<CardTags | null>(null);

export const AidtNewEntityCardButton = React.forwardRef<HTMLButtonElement, Pick<React.ComponentProps<typeof Button>, "disabled" | "onClick" | "aria-expanded" | "aria-controls">>(
  function AidtNewEntityCardButton(props, ref) {
    return <Button ref={ref} type="button" variant="primary" {...props} data-testid="aidt-new-entity-card">
      <Plus className="size-4" aria-hidden />新建卡片
    </Button>;
  },
);


export function AidtEntityCardDirectory({ draft, children }: {
  draft: AidtUiStageDraft;
  children: React.ReactNode;
}) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [activeIds, setActiveIds] = React.useState<readonly string[]>([]);
  const mounted = React.useRef(new Map<string, number>());
  const register = React.useCallback((id: string) => {
    const count = mounted.current.get(id) ?? 0;
    mounted.current.set(id, count + 1);
    if (count === 0) setActiveIds([...mounted.current.keys()]);
    return () => {
      const remaining = (mounted.current.get(id) ?? 1) - 1;
      if (remaining > 0) mounted.current.set(id, remaining);
      else {
        mounted.current.delete(id);
        setActiveIds([...mounted.current.keys()]);
      }
    };
  }, []);
  // Cards register before applying their filter. Deleted cards unmount, so
  // historical cardTags fields never create orphaned directory filters.
  const cards = activeIds.map(id => ({ tags: readAidtEntityCardTags(draft.fields, id) }));
  const knownTags = aggregateTags(cards);
  const labels = [...knownTags.keys()];
  const filter = selected ? labels.find(label => hasTag([label], selected)) ?? null : null;
  const filteredLabels = labels.filter(label => matchesQuery(query, [label]) || Boolean(filter && hasTag([label], filter)));
  const filtering = Boolean(filter || query.trim());
  const matching = cards.filter(card => (!filter || hasTag(card.tags, filter)) && matchesQuery(query, [], card.tags)).length;
  React.useEffect(() => {
    if (selected && !filter) setSelected(null);
  }, [selected, filter]);
  const clear = () => { setSelected(null); setQuery(""); };
  const filters = <section className="space-y-3" aria-label="筛选卡片标签">
      <p className="text-13 font-medium">全部卡片 · {matching}</p>
      {cards.length > 0 && <div className="flex min-w-0 items-center gap-2">
        <Input aria-label="搜索卡片标签" placeholder="搜索标签" value={query} onChange={event => setQuery(event.currentTarget.value)} />
        {filtering && <Button type="button" size="sm" variant="ghost" onClick={clear}>清除筛选</Button>}
      </div>}
      {labels.length > 0 && <TagFilterBar tags={filteredLabels.map(tag => ({ tag, count: knownTags.get(tag) }))} selected={filter ? [filter] : []}
        onChange={next => { if (!next.length) clear(); else setSelected(next[0]!); }} prefix="aidt-card" business="卡片" mode="single" allActive={!filtering} />}
      {filtering && matching === 0 && <div role="status" data-testid="aidt-card-filter-empty" className="space-y-2 rounded-container border border-dashed border-border p-4 text-13">
        <p>没有匹配标签的卡片。</p><Button type="button" size="sm" variant="outline" onClick={clear}>显示全部卡片</Button>
      </div>}
    </section>;
  return <CardTagsContext.Provider value={{
    draft, labels, selected: filter, query, knownTags, filters, register,
  }}>
    {children}
  </CardTagsContext.Provider>;
}

export function AidtCardFilters() {
  return React.useContext(CardTagsContext)?.filters ?? null;
}

export function AidtCardStatus({ children, confirmed }: { children: React.ReactNode; confirmed?: boolean }) {
  return <span className={cn("ml-auto shrink-0 self-start rounded-full px-2 py-1 text-11 font-medium", confirmed ? "bg-muted text-card-foreground" : "bg-muted text-muted-foreground")}>{children}</span>;
}

export function AidtCardHeader({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-2">
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-12 font-semibold">{label}</span>
    {children}
  </div>;
}

export function AidtEntityCard({ entityId, className, children, action, management, useSharedTags = true }: {
  entityId: string;
  className?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  management?: React.ReactNode;
  useSharedTags?: boolean;
}) {
  const context = React.useContext(CardTagsContext);
  const tags = useSharedTags && context ? readAidtEntityCardTags(context.draft.fields, entityId) : [];
  const register = useSharedTags ? context?.register : undefined;
  React.useEffect(() => register?.(entityId), [entityId, register]);
  if (useSharedTags && context && (context.selected && !hasTag(tags, context.selected) || !matchesQuery(context.query, [], tags))) return null;
  return <li data-testid="aidt-entity-card" className={cn("flex min-h-[180px] min-w-0 flex-col gap-3 rounded-container border border-border bg-card p-4 text-card-foreground", className)}>
    {children}
    {tags.length > 0 && <ul aria-label="卡片标签" className="flex flex-wrap gap-1 text-12">{tags.map(tag => <li key={tag} className="rounded-full bg-muted px-2 py-1">{tag}</li>)}</ul>}
    {(action || management) && <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <div className="min-w-0">{action}</div>
      {(management) && <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
        {management}
      </div>}
    </div>}
  </li>;
}
