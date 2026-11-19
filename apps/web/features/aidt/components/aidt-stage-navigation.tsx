import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";

/** Same step links in a compact desktop row and a native mobile disclosure. */
export function AidtStageNavigation({ stageNumber, href, reportHref, reportActive = false }: { stageNumber: number; href: (id: number) => string; reportHref: string; reportActive?: boolean }): JSX.Element {
  const current = AIDT_STEPS.find((step) => step.id === stageNumber)!;
  const links = (mobile: boolean) => AIDT_STEPS.map((step) => <Button key={step.id} asChild variant={step.id === stageNumber && !reportActive ? "secondary" : "ghost"} size="sm" className={mobile ? "justify-start" : "min-w-0 flex-1 justify-start px-2 xl:flex-none"}><Link href={href(step.id)} data-aidt-step={step.id} data-testid={mobile ? `aidt-stage-mobile-${step.id}` : `aidt-stage-desktop-${step.id}`} aria-current={step.id === stageNumber && !reportActive ? "step" : undefined}><span className="text-muted-foreground">{step.id}</span><span className="truncate">{step.title}</span></Link></Button>);
  const report = <Button asChild variant={reportActive ? "secondary" : "ghost"} size="sm" className="justify-start"><Link href={reportHref} aria-current={reportActive ? "step" : undefined}>总结归档</Link></Button>;
  return <div data-testid="aidt-stage-navigation">
    <nav className="hidden gap-1 md:flex xl:flex-col" aria-label="设计思维步骤" data-testid="aidt-desktop-steps">{links(false)}{report}</nav>
    <details className="text-13 md:hidden" data-testid="aidt-mobile-steps"><summary className="cursor-pointer py-2 font-medium">{reportActive ? "总结归档" : `${stageNumber}/6 · ${current.title}`}</summary><nav className="grid grid-cols-2 gap-1 pt-2" aria-label="选择学习步骤">{links(true)}{report}</nav></details>
  </div>;
}
