import type * as React from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type ResearchPlanField = "plan" | "questions" | "criteria" | "materials" | "sources";

export function GuidedResearchPlanPanel({ plan, onConfirm, disabled, onBack }: {
  plan: React.ReactNode;
  onConfirm: () => void;
  disabled: boolean;
  onBack?: () => void;
  questions?: React.ReactNode;
  sourceScope?: React.ReactNode;
  successCriteria?: React.ReactNode;
  materials?: React.ReactNode;
  editDisabled?: boolean;
  onEdit?: (field: ResearchPlanField) => void;
}) {
  return <section className="space-y-3" data-testid="guided-research-plan-panel" data-reference-layout="plan-workspace">
    <Card className="shadow-sm"><CardContent className="space-y-3 p-4 text-sm leading-relaxed">{plan}</CardContent></Card>
    <div className="flex justify-end gap-2">{onBack && <Button variant="primary" className="h-9 px-4 text-sm" onClick={onBack}>上一步</Button>}<Button variant="primary" className="h-9 px-4 text-sm" aria-label="开始研究" disabled={disabled} onClick={onConfirm}>开始资料研究 <ArrowRight className="size-4" aria-hidden /></Button></div>
  </section>;
}
