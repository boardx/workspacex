"use client";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import type { InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
import { Button } from "@/components/ui/button";
import { InterviewReportMarkdown } from "./interview-report-markdown";

export function InterviewOutlineStep({ document, pending, onChange, onSave, onConfirm, onGenerate }: {
  document: InterviewMarkdownDocument; pending: boolean; onChange: (markdown: string) => void;
  onSave: () => void; onConfirm: () => void; onGenerate: () => void;
}) {
  const blocks = interviewMarkdown.parseInterviewMarkdown(document).blocks;
  const [active, setActive] = React.useState<string | null>(null);
  const groups = blocks.filter((block) => block.depth >= 2);
  const chosen = groups.find((block) => block.headingId === active) ?? groups[0];
  return <div data-testid="itv-markdown-outline"><h2 className="text-2xl font-semibold">访谈问题</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">按专家和问题分组审阅。编辑正文保留原始标题与稳定引用。</p>
    <div className="mt-6 grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]"><aside className="rounded-xl border border-border p-4"><h3 className="font-semibold">专家与问题分组</h3><nav aria-label="访谈问题分组" className="mt-4 space-y-2">{groups.map((block) => <button key={block.headingId} type="button" aria-current={chosen?.headingId === block.headingId ? "true" : undefined} onClick={() => setActive(block.headingId)} className={`block w-full rounded-lg p-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring ${chosen?.headingId === block.headingId ? "bg-muted font-semibold" : "hover:bg-muted/50"}`}>{block.title}</button>)}</nav></aside>
      <section className="min-w-0 rounded-xl border border-border p-5">{groups.length ? groups.map((block) => <article key={block.headingId} className={chosen?.headingId === block.headingId ? "block" : "hidden"}><h3 className="text-xl font-semibold">{block.title}</h3><textarea aria-label={`编辑${block.title}`} disabled={pending} value={document.markdown.slice(block.contentStart, block.end).trim()} onChange={(event) => { const newline = document.markdown.includes("\r\n") ? "\r\n" : "\n"; onChange(document.markdown.slice(0, block.contentStart) + `${newline}${newline}${event.target.value}${newline}${newline}` + document.markdown.slice(block.end)); }} className="mt-4 min-h-64 w-full rounded-lg border border-input bg-background p-4 text-sm leading-7" /><InterviewReportMarkdown markdown={document.markdown.slice(block.start, block.end)} testId={`itv-question-preview-${block.headingId}`} /><Button className="mt-4" variant="outline" disabled={pending} onClick={() => onChange(document.markdown.slice(0, block.start) + document.markdown.slice(block.end))}>删除分组</Button></article>) : <p className="py-12 text-center text-sm text-muted-foreground">尚无提纲，请生成问题或添加分组。</p>}<Button className="mt-5 w-full" variant="outline" disabled={pending} onClick={() => onChange(`${document.markdown.trimEnd()}\n\n## [新增问题](#question-${crypto.randomUUID()})\n\n请填写开放式问题、目的与反例追问。\n`)}>添加问题分组</Button></section>
    </div><details className="mt-5 rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">完整提纲 Markdown</summary><textarea aria-label="完整提纲 Markdown" value={document.markdown} disabled={pending} onChange={(event) => onChange(event.target.value)} className="mt-4 min-h-64 w-full rounded-lg border border-input bg-background p-4 text-sm leading-7" /></details>
    <footer className="mt-6 flex flex-wrap justify-end gap-3"><Button variant="outline" disabled={pending} onClick={onGenerate}>生成访谈问题</Button><Button variant="outline" disabled={pending || !document.markdown.trim()} onClick={onSave}>保存问题草稿</Button><Button variant="primary" disabled={pending || !groups.length} onClick={onConfirm}>确认问题并开始访谈</Button></footer>
  </div>;
}
