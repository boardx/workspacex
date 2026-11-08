import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

/** Shared geometry and interaction for organization and project module entry points. */
export function ModuleEntryGrid({ children, testId, label }: { children: ReactNode; testId: string; label?: string }) {
  return <section aria-label={label} data-testid={testId} className="grid auto-rows-fr gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 13rem), 1fr))" }}>{children}</section>;
}

export function ModuleEntryCard({ href, label, description, icon, count, testId }: {
  href: string; label: string; description: string; icon: ReactNode; count?: ReactNode; testId: string;
}) {
  return (
    <Link href={href} data-testid={testId} className="group relative flex min-h-24 min-w-0 flex-col gap-1 rounded-card border border-border-subtle bg-card p-4 pl-14 shadow-sm transition-shadow duration-fast hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="absolute left-4 top-4 flex h-7 w-7 items-center justify-center rounded-control bg-muted text-muted-foreground">{icon}</span>
      <span className="flex items-center gap-1 text-13 font-medium text-card-foreground">
        {label}<ArrowRight aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-fast group-hover:translate-x-0.5" />
        {count !== undefined && <span className="ml-auto font-mono tabular-nums">{count}</span>}
      </span>
      <span className="line-clamp-2 text-12 text-muted-foreground">{description}</span>
    </Link>
  );
}
