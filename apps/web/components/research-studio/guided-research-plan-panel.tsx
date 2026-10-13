import type * as React from "react";
import { ArrowRight } from "lucide-react";
import { WorkflowActionButton, WorkflowActionBar } from "./research-workflow-actions";
import { Card, CardContent } from "@/components/ui/card";

export type ResearchPlanField = "plan" | "questions" | "criteria" | "materials" | "sources";

export function GuidedResearchPlanPanel({ plan, onConfirm, disabled, onBack, loading = false }: {
  plan: React.ReactNode;
  onConfirm: () => void;
  disabled: boolean;
  loading?: boolean;
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
    <WorkflowActionBar placement="footer" data-testid="research-plan-actions">{onBack && <WorkflowActionButton variant="outline" onClick={onBack}>上一步</WorkflowActionButton>}<WorkflowActionButton variant="primary" aria-label="生成报告" loading={loading} disabled={disabled} icon={<ArrowRight className="size-4" aria-hidden />} onClick={onConfirm}>生成报告</WorkflowActionButton></WorkflowActionBar>
  </section>;
}
