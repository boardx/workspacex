"use client";

import type * as React from "react";
import { ArrowRight, Mic, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResearchPrototypeTips } from "./research-prototype-tips";

export function GuidedResearchEntryPanel({
  brief,
  onContinue,
  onRegenerate,
  onSave,
  disabled,
}: {
  brief: React.ReactNode;
  onContinue: () => void;
  onRegenerate: () => void;
  onSave: () => void;
  disabled: boolean;
}) {
  return <section className="space-y-3" data-testid="guided-research-import-panel" data-reference-layout="intake-workspace">
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2.05fr)_minmax(18rem,1fr)]">
      <Card><CardHeader className="px-5 pb-3 pt-5"><CardTitle className="text-xl">告诉 AI 你想研究什么</CardTitle></CardHeader>
        <CardContent className="space-y-3 px-5 pb-5">
          <div className="rounded-lg border border-border p-4 [&_textarea]:border-0 [&_textarea]:p-0 [&_textarea]:shadow-none">{brief}
            <div className="mt-3 flex gap-2"><Button variant="outline" className="h-9 px-4 text-sm" disabled title="当前环境尚未配置实时录音"><Mic className="mr-2 size-4" />录音</Button><Button variant="outline" className="h-9 px-4 text-sm" disabled title="当前环境尚未配置文件导入"><Upload className="mr-2 size-4" />上传文件</Button></div>
          </div>
          <div className="flex justify-end"><Button variant="primary" className="h-9 px-5 text-sm" aria-label="确认并继续" disabled={disabled} onClick={onContinue}>下一步：确认研究主题 <ArrowRight className="size-4" aria-hidden /></Button></div>
          <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">草稿与重新生成</summary><div className="mt-3 flex justify-end gap-2"><Button variant="outline" disabled={disabled} onClick={onRegenerate}><Sparkles className="size-4" aria-hidden />重新生成本步骤</Button><Button variant="outline" disabled={disabled} onClick={onSave}>保存草稿</Button></div></details>
        </CardContent>
      </Card><ResearchPrototypeTips />
    </div>
  </section>;
}
