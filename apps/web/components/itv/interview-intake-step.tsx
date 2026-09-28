"use client";

import * as React from "react";
import { ArrowRight, FileText, Lightbulb, Mic, Target, UsersRound, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InterviewVoiceInput } from "./interview-voice-input";

const guidance = [
  { title: "研究目标", detail: "希望解决的问题、预期的研究成果", icon: Target },
  { title: "目标用户", detail: "用户特征、人群范围、典型样本", icon: UsersRound },
  { title: "使用场景", detail: "产品或服务的使用场景、使用时机", icon: Workflow },
  { title: "关键问题", detail: "最想了解的核心问题或假设", icon: Lightbulb },
] as const;

/** Controlled Markdown editor. Content changes are not implicit confirmation. */
export function InterviewIntakeStep({ markdown, onChange, onSave, onConfirm, pending, onImportFile, onUploadFile, onVoice, readOnly = false, voiceSessionToken, onVoiceBusyChange }: {
  readonly markdown: string;
  readonly onChange: (markdown: string) => void;
  readonly onSave: () => Promise<void>;
  readonly onConfirm: () => Promise<void>;
  readonly pending: boolean;
  readonly onImportFile?: (file: File) => Promise<string>;
  readonly onUploadFile?: (file: File) => Promise<void>;
  readonly onVoice?: () => Promise<string>;
  readonly readOnly?: boolean;
  readonly voiceSessionToken?: string;
  readonly onVoiceBusyChange?: (busy: boolean) => void;
}) {
  const [error, setError] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const [voiceBusy, setVoiceBusy] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const busy = pending || working || voiceBusy;
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setWorking(true); setError("");
    try { await action(); }
    catch (cause) { setError(`${cause instanceof Error ? cause.message : "操作未完成"}。已有草稿保留，可以继续输入文字或重试。`); }
    finally { setWorking(false); }
  }
  function append(text: string) {
    if (!text.trim()) throw new Error("没有提取到可用文字");
    onChange(markdown ? `${markdown}\n\n${text}` : text);
  }
  return <div data-testid="itv-markdown-intake" className="grid items-start gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(280px,1fr)]">
    <section className="rounded-2xl border border-border bg-card p-4 lg:p-5">
      <h2 className="text-2xl font-semibold tracking-tight">告诉 AI 你想研究什么</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">描述背景、目标和关键问题。需求以 Markdown 保存，确认后才用于生成分析。</p>
      <label htmlFor="interview-demand-markdown" className="sr-only">研究需求 Markdown</label>
      <div className="mt-3 rounded-xl border border-input bg-background p-4">
        <textarea id="interview-demand-markdown" value={markdown} onChange={(event) => onChange(event.target.value)} disabled={busy} readOnly={readOnly}
          placeholder={"请描述你的研究需求，例如：\n\n## 研究目标\n你希望解决什么问题？\n\n## 目标用户\n你希望了解谁的实际行为？\n\n## 关键问题\n最近一次具体场景发生了什么？"}
          className="min-h-64 w-full resize-y bg-transparent text-sm leading-7 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex flex-wrap gap-3">
            {voiceSessionToken ? <InterviewVoiceInput sessionToken={voiceSessionToken} disabled={pending || working} readOnly={readOnly} onAppend={append} onBusyChange={(active) => { setVoiceBusy(active); onVoiceBusyChange?.(active); }} /> : <Button variant="outline" disabled={busy || readOnly || !onVoice} onClick={() => void perform(async () => append(await onVoice!()))}><Mic className="size-4" aria-hidden />语音输入</Button>}
            <Button variant="outline" disabled={busy || readOnly || !(onImportFile || onUploadFile)} onClick={() => fileInput.current?.click()}><FileText className="size-4" aria-hidden />{onUploadFile ? "上传研究文件" : "导入文本文档"}</Button>
            <input ref={fileInput} type="file" accept={onUploadFile ? ".txt,.md,.markdown,.pdf,.docx,.pptx,.xlsx,.csv" : ".txt,.md,.markdown,text/plain,text/markdown"} aria-label="导入研究文件" className="sr-only" disabled={busy || readOnly || !(onImportFile || onUploadFile)}
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file && !readOnly) void perform(async () => { if (onUploadFile) await onUploadFile(file); else if (onImportFile) append(await onImportFile(file)); }); }} />
          </div>
          <span className="text-xs text-muted-foreground">{markdown.length} 字符</span>
        </div>
      </div>
      {error && <p role="alert" className="mt-4 text-sm leading-6 text-destructive">{error}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-3">
        <Button variant="outline" disabled={busy || readOnly || !markdown.trim()} onClick={() => void perform(onSave)}>保存草稿</Button>
        <Button variant="primary" disabled={busy || !markdown.trim()} onClick={() => void perform(onConfirm)}>{busy ? "正在处理…" : "下一步：确认分析"}<ArrowRight className="size-4" aria-hidden /></Button>
      </div>
    </section>
    <aside className="rounded-2xl border border-border bg-card p-4 lg:p-5">
      <h2 className="flex items-center gap-2 text-xl font-semibold"><Lightbulb className="size-5" aria-hidden />小提示</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">提供越详细的背景信息，越有助于形成针对性的访谈方案。</p>
      <div className="mt-4 space-y-4 border-t border-border pt-4">{guidance.map(({ title, detail, icon: Icon }) => <div key={title} className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted"><Icon className="size-5" aria-hidden /></span><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></div></div>)}</div>
      <p className="mt-4 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">{onUploadFile ? "支持 TXT、Markdown、PDF、DOCX、PPTX、XLSX、CSV，最大 3 MB。上传会保存当前草稿与原文件，并将提取的 Markdown 追加到待确认需求；扫描或不支持文件将明确报错。" : "支持 UTF-8 TXT / Markdown 文本文档，最大 2 MB。文件文字导入当前草稿，保存后持久化；原始二进制文件不上传。"}语音仅在服务接通后启用，未确认内容不会自动传给模型。</p>
    </aside>
  </div>;
}
