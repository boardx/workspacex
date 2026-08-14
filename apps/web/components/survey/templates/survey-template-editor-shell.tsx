"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Eye, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReportTemplateStep } from "@/components/survey/workflow/report-template-step";
import { createSurveyWorkflowMock } from "@/lib/survey/workflow-model";
import { SURVEY_TEMPLATE_CARDS } from "@/lib/survey/resource-library";
import type { survey } from "@repo/contracts";

export function SurveyTemplateEditorShell({ templateId }: { templateId: string }) {
  const router = useRouter();
  const template = SURVEY_TEMPLATE_CARDS.find((item) => item.id === templateId);
  const reportSectionCount = template?.reportSectionCount ?? 8;
  const title = template ? template.title.replace(/模板$/, "报告模块") : "新建报告模块";
  const [model, setModel] = React.useState<survey.SurveyWorkflowModel>(() => {
    const baseModel = createSurveyWorkflowMock();
    return {
      ...baseModel,
      reportTemplate: {
        sections: baseModel.reportTemplate.sections.slice(0, reportSectionCount),
      },
    };
  });
  const [saved, setSaved] = React.useState(false);

  return (
    <main className="min-h-full bg-background text-background-foreground" data-testid="survey-template-editor-shell">
      <header className="border-b border-border bg-card px-4 py-3 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
              <div className="flex items-center gap-2"><h1 className="truncate text-16 font-semibold">{title}</h1><Badge tone="primary">报告模块编辑</Badge></div>
              <p className="text-10 text-muted-foreground">报告模块 ID {templateId} · {reportSectionCount} 个报告章节</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm"><Eye className="h-3.5 w-3.5" />预览模板</Button>
            <Button variant="primary" size="sm" onClick={() => setSaved(true)} data-testid="survey-template-save"><Save className="h-3.5 w-3.5" />保存模板</Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/studio/survey?tab=reports")} data-testid="survey-template-back-to-list"><ArrowLeft className="h-3.5 w-3.5" />返回列表</Button>
          </div>
        </div>
        {saved && <p className="mt-2 text-right text-11 text-success" data-testid="survey-template-saved"><Check className="mr-1 inline h-3 w-3" />模板已保存</p>}
      </header>
      <div className="border-b border-border bg-card px-5 py-3">
        <h2 className="text-14 font-semibold">报告模板</h2>
        <p className="mt-1 text-10 text-muted-foreground">为每个章节配置管理问题、分析方法、输出方式和具体图表类型。</p>
      </div>
      <ReportTemplateStep model={model} setModel={setModel} readonly={false} />
    </main>
  );
}
