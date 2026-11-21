import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";

export function AidtStageNavigation({ stageNumber, href, reportHref, reportActive = false, horizontal = false, completed = null }: {
  stageNumber: number;
  href: (id: number) => string;
  reportHref: string;
  reportActive?: boolean;
  horizontal?: boolean;
  completed?: ReadonlySet<number> | null;
}): JSX.Element {
  const current = AIDT_STEPS.find(step => step.id === stageNumber)!;
  const links = (mobile: boolean) => AIDT_STEPS.map(step => {
    const active = step.id === stageNumber && !reportActive;
    const done = completed?.has(step.id);
    return <Button key={step.id} asChild variant={active ? "secondary" : "ghost"} size="sm"
      className={mobile ? "justify-start" : `min-w-0 flex-1 justify-start px-2 ${horizontal ? "" : "xl:flex-none"}`}>
      <Link href={href(step.id)} data-aidt-step={step.id} data-testid={mobile ? `aidt-stage-mobile-${step.id}` : `aidt-stage-desktop-${step.id}`} aria-current={active ? "step" : undefined}>
        <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-11 ${done ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"}`}>
          {done ? <Check className="h-3 w-3" /> : step.id}
        </span>
        <span className="truncate">{step.title}</span>
        {completed && <span className="sr-only">{done ? "，已完成" : "，未完成"}</span>}
      </Link>
    </Button>;
  });
  const report = <Button asChild variant={reportActive ? "secondary" : "ghost"} size="sm" className="justify-start"><Link href={reportHref} aria-current={reportActive ? "step" : undefined}>总结归档</Link></Button>;
  const progress = completed && <span className="whitespace-nowrap text-12 font-medium tabular-nums text-muted-foreground" data-testid="aidt-stage-progress">{completed.size}/6 已完成</span>;
  const desktop = horizontal ? "hidden items-center gap-1 lg:flex" : "hidden gap-1 md:flex xl:flex-col";
  const mobile = horizontal ? "text-13 lg:hidden" : "text-13 md:hidden";
  return <div data-testid="aidt-stage-navigation">
    <nav className={desktop} aria-label="设计思维步骤" data-testid="aidt-desktop-steps">{links(false)}{report}{progress}</nav>
    <details className={mobile} data-testid="aidt-mobile-steps">
      <summary className="cursor-pointer py-2 font-medium">{reportActive ? "总结归档" : `第 ${stageNumber} 步 · ${current.title}`}{progress && <span className="ml-2">{progress}</span>}</summary>
      <nav className="grid grid-cols-2 gap-1 pt-2" aria-label="选择学习步骤">{links(true)}{report}</nav>
    </details>
  </div>;
}
