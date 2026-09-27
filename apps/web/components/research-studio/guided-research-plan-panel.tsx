import type * as React from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function GuidedResearchPlanPanel({
  plan,
  questions,
  sourceScope,
  onConfirm,
  disabled,
}: {
  plan: React.ReactNode;
  questions: React.ReactNode;
  sourceScope: React.ReactNode;
  onConfirm: () => void;
  disabled: boolean;
}) {
  return <section className="space-y-5" data-testid="guided-research-plan-panel" data-reference-layout="plan-cards">
    <div className="pb-4"><h1 className="text-4xl font-bold">研究计划</h1><p className="mt-3 text-lg text-muted-foreground">编辑和调整研究内容，确认后开始资料研究。</p></div>
    <Card className="border-primary/20 shadow-sm"><CardHeader className="border-b border-border/70 pb-4"><CardTitle className="text-base">研究方向与计划</CardTitle></CardHeader><CardContent className="pt-5">{plan}</CardContent></Card>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-primary/15 bg-accent/20 shadow-sm"><CardHeader className="pb-3"><CardTitle className="text-base">核心问题</CardTitle></CardHeader><CardContent>{questions}</CardContent></Card>
      <Card className="border-primary/15 shadow-sm"><CardHeader className="pb-3"><CardTitle className="text-base">资料范围</CardTitle></CardHeader><CardContent>{sourceScope}</CardContent></Card>
    </div>
    <div className="flex justify-end border-t border-border pt-4"><Button variant="primary" disabled={disabled} onClick={onConfirm}>开始研究 <ArrowRight className="size-4" aria-hidden /></Button></div>
  </section>;
}
