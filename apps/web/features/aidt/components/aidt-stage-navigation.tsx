import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";

/** Same step links in a compact desktop row and a native mobile disclosure. */
export function AidtStageNavigation({ stageNumber, href }: { stageNumber: number; href: (id: number) => string }): JSX.Element {
  const current = AIDT_STEPS.find((step) => step.id === stageNumber)!;
  const links = (mobile: boolean) => AIDT_STEPS.map((step) => <Button key={step.id} asChild variant={step.id === stageNumber ? "secondary" : "ghost"} size="sm" className={mobile ? "justify-start" : "min-w-0 flex-1 px-2"}><Link href={href(step.id)} data-aidt-step={step.id} data-testid={`aidt-stage-${mobile ? "mobile" : "desktop"}-${step.id}`} aria-current={step.id === stageNumber ? "step" : undefined}><span className="text-muted-foreground">{step.id}</span><span className="truncate">{step.title}</span></Link></Button>);
  return <div data-testid="aidt-stage-navigation">
    <nav className="hidden gap-1 md:flex" aria-label="设计思维步骤" data-testid="aidt-desktop-steps">{links(false)}</nav>
    <details className="text-13 md:hidden" data-testid="aidt-mobile-steps"><summary className="cursor-pointer py-2 font-medium">{stageNumber}/6 · {current.title}</summary><nav className="grid grid-cols-2 gap-1 pt-2" aria-label="选择学习步骤">{links(true)}</nav></details>
  </div>;
}
