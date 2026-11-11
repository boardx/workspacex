import * as React from "react";
import { Bot, Puzzle } from "lucide-react";
import { ResourceCard } from "@/components/ui/resource-card";

type CardProps = React.ComponentProps<typeof ResourceCard>;

/** Shared, deliberately minimal presentation for capability directories. */
export function capabilityCardSpec(kind: "agent" | "skill", spec: CardProps): CardProps {
  const Icon = kind === "agent" ? Bot : Puzzle;
  const description = spec.description ?? (kind === "agent" ? spec.subtitle ?? "Agent" : undefined);
  return {
    title: spec.title,
    titleTestId: spec.titleTestId,
    leading: spec.leading ?? <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon aria-hidden className="h-8 w-8" /></span>,
    description: description == null ? undefined : <span className="line-clamp-2">{description}</span>,
    className: "h-36 shadow-none",
  };
}
