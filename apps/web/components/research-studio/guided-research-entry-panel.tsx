"use client";

import type * as React from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResearchPrototypeTips } from "./research-prototype-tips";

export function GuidedResearchEntryPanel({
  brief,
  onContinue,
  disabled,
}: {
  brief: React.ReactNode;
  onContinue: () => void;
  disabled: boolean;
}) {
  return <section className="space-y-3" data-testid="guided-research-import-panel" data-reference-layout="intake-workspace">
    <div className="grid items-stretch gap-4 lg:min-h-[calc(100dvh-17rem)] lg:grid-cols-[minmax(0,2.05fr)_minmax(18rem,1fr)]">
      <Card className="flex flex-col"><CardHeader className="px-5 pb-3 pt-5"><CardTitle className="text-xl">告诉 AI 你想研究什么</CardTitle></CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3 px-5 pb-5">
          <div className="flex min-h-56 flex-1 flex-col rounded-lg border border-border p-4 [&_textarea]:min-h-48 [&_textarea]:flex-1 [&_textarea]:border-0 [&_textarea]:p-0 [&_textarea]:shadow-none">{brief}</div>
          <div className="mt-auto flex justify-end"><Button variant="primary" className="h-9 px-5 text-sm" aria-label="确认并继续" disabled={disabled} onClick={onContinue}>下一步：确认研究主题 <ArrowRight className="size-4" aria-hidden /></Button></div>
        </CardContent>
      </Card><ResearchPrototypeTips />
    </div>
  </section>;
}
