import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function BoardSubmenuChevron({ open, className, testId }: { open: boolean; className?: string; testId?: string }) {
  return <ChevronUp aria-hidden data-testid={testId} data-state={open ? "open" : "closed"} className={cn("submenu h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180", className)} />;
}
