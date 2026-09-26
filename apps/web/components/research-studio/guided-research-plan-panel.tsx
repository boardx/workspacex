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
  return <section className="space-y-5" data-testid="guided-research-plan-panel">
    <div><p className="text-12 font-medium text-primary">步骤 4 · 研究计划</p><h1 className="mt-1 text-24 font-semibold">研究计划</h1><p className="mt-2 text-sm text-muted-foreground">先确认回答什么、如何验证，以及检索资料的范围。</p></div>
    <Card><CardHeader><CardTitle className="text-base">研究方向与计划</CardTitle></CardHeader><CardContent>{plan}</CardContent></Card>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">核心问题</CardTitle></CardHeader><CardContent>{questions}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">资料范围</CardTitle></CardHeader><CardContent>{sourceScope}</CardContent></Card>
    </div>
    <div className="flex justify-end"><Button variant="primary" disabled={disabled} onClick={onConfirm}>开始研究 <ArrowRight className="size-4" aria-hidden /></Button></div>
  </section>;
}
