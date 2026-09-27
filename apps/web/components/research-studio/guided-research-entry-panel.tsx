"use client";

import type * as React from "react";
import { ArrowRight, FileText, Mic, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
  return <section className="space-y-6" data-testid="guided-research-import-panel" data-reference-layout="intake-workspace">
    <div className="border-b border-border pb-4">
      <h1 className="text-4xl font-bold tracking-tight">新建研究</h1>
      <p className="mt-3 text-lg text-muted-foreground">描述你的研究需求，AI 将分析并生成详细的研究计划。</p>
    </div>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]"><Card><CardHeader><CardTitle className="text-2xl">告诉 AI 你想研究什么</CardTitle></CardHeader><CardContent className="space-y-5">{brief}<div className="flex gap-3 border-t pt-4"><Button variant="outline" disabled title="当前环境尚未配置实时录音"><Mic className="mr-2 size-4" />录音</Button><Button variant="outline" disabled title="当前环境尚未配置文件导入"><Upload className="mr-2 size-4" />上传文件</Button></div></CardContent></Card><Card><CardHeader><CardTitle className="text-2xl">小提示</CardTitle><CardDescription>提供越详细的背景信息，研究计划越有针对性。</CardDescription></CardHeader><CardContent className="space-y-6">{[["研究目标", "希望解决的问题、预期的研究成果"], ["研究区域 / 对象", "行业、地区、人群或具体研究对象"], ["时间范围", "关注的时间段"], ["重点关注", "最关心的维度与关键问题"]].map(([title, description]) => <div key={title} className="flex gap-3"><FileText className="mt-1 size-5 shrink-0" /><div><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-muted-foreground">{description}</p></div></div>)}</CardContent></Card></div>
    <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4"><Button variant="outline" disabled={disabled} onClick={onRegenerate}><Sparkles className="size-4" aria-hidden />重新生成本步骤</Button><Button variant="outline" disabled={disabled} onClick={onSave}>保存草稿</Button><Button variant="primary" aria-label="确认并继续" disabled={disabled} onClick={onContinue}>下一步：确认研究主题 <ArrowRight className="size-4" aria-hidden /></Button></div>
  </section>;
}
