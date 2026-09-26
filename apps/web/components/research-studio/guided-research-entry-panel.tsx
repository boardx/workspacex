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
  return <section className="space-y-6" data-testid="guided-research-import-panel" data-reference-layout="three-entry-cards">
    <div className="border-b border-border pb-4">
      <p className="text-12 font-medium text-primary">步骤 2 · 导入需求</p>
      <h1 className="mt-1 text-24 font-semibold tracking-tight">导入研究需求</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">通过文本、文件或语音说明研究目标；所有后续 Markdown 都以这份需求为准。</p>
    </div>
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="border-border/80 shadow-sm transition-shadow duration-base hover:shadow-md">
        <CardHeader className="space-y-2 pb-2"><Upload className="size-5 text-primary" aria-hidden /><CardTitle className="text-base">上传文件</CardTitle><CardDescription>支持 PDF、Word、PPT、Excel、TXT 等资料。</CardDescription></CardHeader>
        <CardContent className="space-y-3"><Button variant="outline" className="w-full" disabled>选择文件</Button><p className="text-12 text-muted-foreground">当前环境尚未配置文件导入</p></CardContent>
      </Card>
      <Card className="border-border/80 shadow-sm transition-shadow duration-base hover:shadow-md">
        <CardHeader className="space-y-2 pb-2"><Mic className="size-5 text-primary" aria-hidden /><CardTitle className="text-base">实时语音录入</CardTitle><CardDescription>边说边整理研究背景、目标与限制。</CardDescription></CardHeader>
        <CardContent className="space-y-3"><Button variant="outline" className="w-full" disabled>开始录音</Button><p className="text-12 text-muted-foreground">当前环境尚未配置实时录音</p></CardContent>
      </Card>
      <Card className="border-primary/30 bg-accent/35 shadow-sm transition-shadow duration-base hover:shadow-md">
        <CardHeader className="space-y-2 pb-2"><FileText className="size-5 text-primary" aria-hidden /><CardTitle className="text-base">输入文本</CardTitle><CardDescription>直接在下方编辑研究需求 Markdown。</CardDescription></CardHeader>
        <CardContent><p className="text-12 text-muted-foreground">保存后再确认主题，避免未应用的内容进入下一步。</p></CardContent>
      </Card>
    </div>
    <div className="rounded-xl border border-primary/15 bg-card p-4 shadow-sm sm:p-5">{brief}</div>
    <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4"><Button variant="outline" disabled={disabled} onClick={onRegenerate}><Sparkles className="size-4" aria-hidden />重新生成本步骤</Button><Button variant="outline" disabled={disabled} onClick={onSave}>保存草稿</Button><Button variant="primary" aria-label="确认并继续" disabled={disabled} onClick={onContinue}>下一步：确认研究主题 <ArrowRight className="size-4" aria-hidden /></Button></div>
  </section>;
}
