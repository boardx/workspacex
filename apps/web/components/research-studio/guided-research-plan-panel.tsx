import type * as React from "react";
import { ArrowRight, Target, CircleHelp, ChartColumn, FileText, Database, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type ResearchPlanField = "plan" | "questions" | "criteria" | "materials" | "sources";

export function GuidedResearchPlanPanel({
  plan,
  questions,
  sourceScope,
  successCriteria,
  materials,
  onConfirm,
  disabled,
  onEdit,
  onBack,
}: {
  plan: React.ReactNode;
  questions: React.ReactNode;
  sourceScope: React.ReactNode;
  successCriteria?: React.ReactNode;
  materials?: React.ReactNode;
  onConfirm: () => void;
  disabled: boolean;
  onEdit?: (field: ResearchPlanField) => void;
  onBack?: () => void;
}) {
  const edit = (field: ResearchPlanField, title: string) => onEdit && <Button variant="outline" className="absolute right-6 top-6 h-10 px-4 text-base" aria-label={`编辑${title}`} disabled={disabled} onClick={() => onEdit(field)}><Pencil className="mr-2 size-4" aria-hidden />编辑</Button>;
  return <section className="space-y-5" data-testid="guided-research-plan-panel" data-reference-layout="plan-cards">
    <Card className="relative shadow-sm">{edit("plan", "研究方向")}<CardHeader className="p-6 pb-4"><CardTitle className="flex items-center gap-4 pr-24 text-[24px]"><Target className="size-12 rounded-xl bg-muted p-2" />研究方向</CardTitle><p className="text-base text-muted-foreground">明确本次研究的具体方向和范围，确保研究内容聚焦且有深度。</p></CardHeader><CardContent className="px-6 pb-6 text-base leading-relaxed">{plan}</CardContent></Card>
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="relative shadow-sm">{edit("questions", "核心问题")}<CardHeader className="p-6 pb-3"><CardTitle className="flex items-center gap-4 pr-24 text-[24px]"><CircleHelp className="size-12 rounded-xl bg-muted p-2" />核心问题</CardTitle><p className="text-base text-muted-foreground">明确需要回答的关键问题，指导后续资料收集和分析。</p></CardHeader><CardContent className="px-6 pb-6 text-base leading-relaxed">{questions}</CardContent></Card>
      <Card className="relative shadow-sm">{edit("criteria", "成功标准")}<CardHeader className="p-6 pb-3"><CardTitle className="flex items-center gap-4 pr-24 text-[24px]"><ChartColumn className="size-12 rounded-xl bg-muted p-2" />成功标准</CardTitle><p className="text-base text-muted-foreground">设定本次研究的预期成果和质量标准。</p></CardHeader><CardContent className="px-6 pb-6 text-base leading-relaxed">{successCriteria ?? <p className="text-muted-foreground">确认研究目标后设置本次研究的预期成果和质量标准。</p>}</CardContent></Card>
      <Card className="relative shadow-sm">{edit("materials", "资料范围")}<CardHeader className="p-6 pb-3"><CardTitle className="flex items-center gap-4 pr-24 text-[24px]"><FileText className="size-12 rounded-xl bg-muted p-2" />资料范围</CardTitle><p className="text-base text-muted-foreground">确定需要收集和分析的资料类型和内容范围。</p></CardHeader><CardContent className="px-6 pb-6 text-base leading-relaxed">{materials ?? sourceScope}</CardContent></Card>
      <Card className="relative shadow-sm">{edit("sources", "来源范围")}<CardHeader className="p-6 pb-3"><CardTitle className="flex items-center gap-4 pr-24 text-[24px]"><Database className="size-12 rounded-xl bg-muted p-2" />来源范围</CardTitle><p className="text-base text-muted-foreground">指定资料的来源渠道，确保信息的权威性和多样性。</p></CardHeader><CardContent className="px-6 pb-6 text-base leading-relaxed">{sourceScope}</CardContent></Card>
    </div>
    <div className="flex justify-end gap-4 pt-4">{onBack && <Button variant="outline" className="h-12 px-6 text-base" onClick={onBack}>上一步</Button>}<Button variant="primary" className="h-12 px-6 text-base" aria-label="开始研究" disabled={disabled} onClick={onConfirm}>开始资料研究 <ArrowRight className="size-4" aria-hidden /></Button></div>
  </section>;
}
