import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type BoardSubmenuDirection = "above" | "below" | "left" | "right";
const icons = { above: ChevronUp, below: ChevronDown, left: ChevronLeft, right: ChevronRight };

/** Indicates the panel's direction, independently of whether it is open. */
export function BoardSubmenuChevron({ open, direction = "above", className, testId }: { open: boolean; direction?: BoardSubmenuDirection; className?: string; testId?: string }) {
  const Icon = icons[direction];
  return <Icon aria-hidden data-testid={testId} data-state={open ? "open" : "closed"} data-direction={direction} style={{ width: 8, height: 8 }} className={cn("submenu pointer-events-none h-2 w-2 shrink-0", className)} />;
}
