"use client";
import { useI18n } from "@/lib/i18n/provider";

import type * as React from "react";
import { ArrowRight } from "lucide-react";
import { WorkflowActionButton, WorkflowActionBar } from "./research-workflow-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResearchPrototypeTips } from "./research-prototype-tips";

export function GuidedResearchEntryPanel({
  brief,
  onContinue,
  disabled,
  loading = false,
}: {
  brief: React.ReactNode;
  onContinue: () => void;
  disabled: boolean;
  loading?: boolean;
}) {
  const { t } = useI18n();
  return <section className="space-y-3" data-testid="guided-research-import-panel" data-reference-layout="intake-workspace">
    <div className="grid items-stretch gap-4 lg:min-h-[calc(100dvh-17rem)] lg:grid-cols-[minmax(0,2.05fr)_minmax(18rem,1fr)]">
      <Card className="flex flex-col"><CardHeader className="px-5 pb-3 pt-5"><CardTitle className="text-xl">{t("research.intake.heading")}</CardTitle></CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3 px-5 pb-5">
          <div className="flex min-h-56 flex-1 flex-col rounded-lg border border-border p-4 [&_textarea]:min-h-48 [&_textarea]:flex-1 [&_textarea]:border-0 [&_textarea]:p-0 [&_textarea]:shadow-none">{brief}</div>
          <WorkflowActionBar placement="footer" className="mt-auto" data-testid="research-intake-actions"><WorkflowActionButton variant="primary" aria-label={t("research.intake.confirmContinue")} loading={loading} disabled={disabled} icon={<ArrowRight className="size-4" aria-hidden />} onClick={onContinue}>{t("research.intake.next")}</WorkflowActionButton></WorkflowActionBar>
        </CardContent>
      </Card><ResearchPrototypeTips />
    </div>
  </section>;
}
