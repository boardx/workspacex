import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export type AidtActivity = { id: string; label: string; href?: string };
export function AidtActivityNav({ items, currentId, onSelect }: { items: readonly AidtActivity[]; currentId: string; onSelect?: (id: string) => void }): JSX.Element {
  return <nav className="flex flex-wrap gap-1" aria-label="本步任务" data-testid="aidt-activity-nav">{items.map(item => <Button key={item.id} asChild={!!item.href} type={item.href ? undefined : "button"} size="sm" variant={item.id === currentId ? "secondary" : "ghost"} data-aidt-activity={item.id} data-testid={`aidt-activity-${item.id}`} aria-current={item.id === currentId ? "page" : undefined} onClick={item.href ? undefined : () => onSelect?.(item.id)}>{item.href ? <Link href={item.href}>{item.label}</Link> : item.label}</Button>)}</nav>;
}
