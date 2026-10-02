import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared presentation only; each workflow owns its navigation and durable state. */
const workspaceWidth = "mx-auto max-w-[1440px]";
export const researchWorkspaceStyle = {
  header: "top-0 z-20 bg-background/95 backdrop-blur md:sticky",
  brandBar: "border-b bg-card px-4 py-2 lg:px-8",
  width: workspaceWidth,
  heading: `${workspaceWidth} px-4 pt-4 lg:px-8`,
  main: `${workspaceWidth} min-w-0 px-4 pt-1 lg:px-8`,
  timeline: "flex flex-wrap items-center gap-y-3 lg:flex-nowrap",
  step: "flex min-w-0 flex-1 basis-1/2 items-center sm:basis-1/3 lg:basis-0",
  command: "h-auto justify-start gap-2 bg-transparent p-1 text-left text-sm transition-colors hover:bg-transparent",
  connector: "mx-2 hidden min-w-3 flex-1 border-t border-border lg:block",
  report: "grid min-w-0 items-start gap-8 bg-card text-card-foreground xl:grid-cols-[12rem_minmax(0,1fr)] xl:gap-x-10",
} as const;

export function ResearchWorkspaceStepIndicator({ number, active, completed, running }: {
  number: number;
  active: boolean;
  completed: boolean;
  running: boolean;
}) {
  return <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full border text-base",
    active || completed || running ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted/30 text-muted-foreground",
    (active || running) && "ring-2 ring-primary ring-offset-2")}>
    {running ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : completed ? <><Check className="size-4" aria-hidden /><span className="sr-only">已完成</span></> : number}
  </span>;
}
