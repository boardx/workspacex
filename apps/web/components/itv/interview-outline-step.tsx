"use client";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
import { Button } from "@/components/ui/button";
import { InterviewReportMarkdown } from "./interview-report-markdown";
import { appendOutlineGroup, moveOutlineGroup } from "@/lib/interview-outline-order";

function questionLines(markdown: string, start: number, end: number) {
  const content = markdown.slice(start, end);
  return Array.from(content.matchAll(/^([ \t]*\d+\.[ \t]+)([^\r\n]+)/gmu), (match) => {
    const lineStart = start + (match.index ?? 0);
    const prefix = match[1] ?? "";
    const question = match[2] ?? "";
    return { start: lineStart, end: lineStart + match[0].length, textStart: lineStart + prefix.length,
      textEnd: lineStart + prefix.length + question.length, text: question };
  });
}

export function InterviewOutlineStep({ document, pending, onChange, onSave, onConfirm, onGenerate }: {
  document: InterviewMarkdownDocument; pending: boolean; onChange: (markdown: string) => void;
  onSave: () => void; onConfirm: () => void; onGenerate: () => void;
}) {
  const blocks = interviewMarkdown.parseInterviewMarkdown(document).blocks;
  const [active, setActive] = React.useState<string | null>(null);
  const groups = blocks.filter((block) => block.depth >= 2);
  const chosen = groups.find((block) => block.headingId === active) ?? groups[0];
  const move = (direction: -1 | 1) => chosen ? moveOutlineGroup(document, chosen.headingId, direction) : null;
  return <div data-testid="itv-markdown-outline"><h2 className="text-3xl font-semibold tracking-tight lg:text-4xl">访谈问题</h2><p className="mt-2 text-base leading-7 text-muted-foreground">按专家和问题分组审阅。编辑正文保留原始标题与稳定引用。</p>
    {chosen && <div className="mt-4 flex gap-2">{([-1, 1] as const).map((direction) => <Button key={direction} variant="outline" disabled={pending || move(direction) === null} onClick={() => { const next = move(direction); if (next !== null) { onChange(next); setActive(null); } }}>{direction === -1 ? "上移当前分组" : "下移当前分组"}</Button>)}</div>}
    <div className="mt-6 grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]"><aside className="rounded-xl border border-border p-4"><h3 className="font-semibold">专家与问题分组</h3><nav aria-label="访谈问题分组" className="mt-4 space-y-2">{groups.map((block) => <button key={block.headingId} type="button" aria-current={chosen?.headingId === block.headingId ? "true" : undefined} onClick={() => setActive(block.headingId)} className={`block w-full rounded-lg p-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring ${chosen?.headingId === block.headingId ? "bg-muted font-semibold" : "hover:bg-muted/50"}`}>{block.title}</button>)}</nav></aside>
      <section className="min-w-0 rounded-xl border border-border p-5">{groups.length ? groups.map((block) => {
        const questions = questionLines(document.markdown, block.contentStart, block.end);
        return <article key={block.headingId} className={chosen?.headingId === block.headingId ? "block" : "hidden"}>
          <h3 className="text-xl font-semibold">{block.title}</h3>
          {questions.length > 0 && <ol aria-label={`${block.title}访谈问题`} className="mt-4 divide-y divide-border rounded-xl border border-border">{questions.map((question, index) => <li key={question.start} className="flex items-center gap-2 px-3 py-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold">{index + 1}</span>
            <input aria-label={`编辑问题 ${index + 1}`} disabled={pending} value={question.text} onChange={(event) => onChange(document.markdown.slice(0, question.textStart) + event.target.value + document.markdown.slice(question.textEnd))} className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            {([-1, 1] as const).map((direction) => <Button key={direction} variant="ghost" size="icon" disabled={pending || index + direction < 0 || index + direction >= questions.length} aria-label={`${direction === -1 ? "上移" : "下移"}问题 ${index + 1}`} onClick={() => {
              const other = questions[index + direction]; if (!other) return;
              const first = direction === -1 ? other : question; const second = direction === -1 ? question : other;
              onChange(document.markdown.slice(0, first.textStart) + second.text + document.markdown.slice(first.textEnd, second.textStart) + first.text + document.markdown.slice(second.textEnd));
            }}>{direction === -1 ? <ArrowUp className="size-4" aria-hidden /> : <ArrowDown className="size-4" aria-hidden />}</Button>)}
            <Button variant="ghost" size="icon" disabled={pending} aria-label={`删除问题 ${index + 1}`} onClick={() => {
              const tail = document.markdown.slice(question.end);
              const lineBreak = tail.startsWith("\r\n") ? 2 : tail.startsWith("\n") ? 1 : 0;
              onChange(document.markdown.slice(0, question.start) + document.markdown.slice(question.end + lineBreak));
            }}><Trash2 className="size-4" aria-hidden /></Button>
          </li>)}</ol>}
          {questions.length > 0 && <Button className="mt-3 w-full" variant="outline" disabled={pending} onClick={() => {
            const newline = document.markdown.includes("\r\n") ? "\r\n" : "\n";
            onChange(document.markdown.slice(0, block.end) + `${newline}${questions.length + 1}. 新问题${newline}` + document.markdown.slice(block.end));
          }}>添加问题</Button>}
          <details className="mt-4" open={questions.length === 0 ? true : undefined}><summary className="cursor-pointer text-sm font-medium text-muted-foreground">编辑本组 Markdown 原文</summary><textarea aria-label={`编辑${block.title}`} disabled={pending} value={document.markdown.slice(block.contentStart, block.end).trim()} onChange={(event) => { const newline = document.markdown.includes("\r\n") ? "\r\n" : "\n"; onChange(document.markdown.slice(0, block.contentStart) + `${newline}${newline}${event.target.value}${newline}${newline}` + document.markdown.slice(block.end)); }} className="mt-4 min-h-48 w-full rounded-lg border border-input bg-background p-4 text-sm leading-7" /><InterviewReportMarkdown markdown={document.markdown.slice(block.start, block.end)} testId={`itv-question-preview-${block.headingId}`} /></details>
          <Button className="mt-4" variant="outline" disabled={pending} onClick={() => onChange(document.markdown.slice(0, block.start) + document.markdown.slice(block.end))}>删除分组</Button>
        </article>;
      }) : <p className="py-12 text-center text-sm text-muted-foreground">尚无提纲，请生成问题或添加分组。</p>}<Button className="mt-5 w-full" variant="outline" disabled={pending} onClick={() => onChange(appendOutlineGroup(document.markdown, crypto.randomUUID()))}>添加问题分组</Button></section>
    </div><details className="mt-5 rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">完整提纲 Markdown</summary><textarea aria-label="完整提纲 Markdown" value={document.markdown} disabled={pending} onChange={(event) => onChange(event.target.value)} className="mt-4 min-h-64 w-full rounded-lg border border-input bg-background p-4 text-sm leading-7" /></details>
    <footer className="mt-6 flex flex-wrap justify-end gap-3"><Button variant="outline" disabled={pending} onClick={onGenerate}>生成访谈问题</Button><Button variant="outline" disabled={pending || !document.markdown.trim()} onClick={onSave}>保存问题草稿</Button><Button variant="primary" disabled={pending || !groups.length} onClick={onConfirm}>确认问题并开始访谈</Button></footer>
  </div>;
}
