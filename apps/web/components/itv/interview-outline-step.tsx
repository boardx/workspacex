"use client";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { DigitalExpertCatalogRow } from "@/lib/interview-api";
import type { InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
import { Button } from "@/components/ui/button";
import { ExpertAvatar } from "./expert-avatar";
import { moveOutlineGroup } from "@/lib/interview-outline-order";

function questionLines(markdown: string, start: number, end: number) {
  const content = markdown.slice(start, end);
  return Array.from(content.matchAll(/^([ \t]*(?:\d+\.|[-*+])[ \t]+)([^\r\n]+)/gmu), (match) => {
    const lineStart = start + (match.index ?? 0);
    const prefix = match[1] ?? "";
    const raw = match[2] ?? "";
    const question = raw.replace(/^\*{1,2}/u, "").replace(/\*{1,2}$/u, "").trim();
    const ordered = /\d+\./u.test(prefix);
    const explanatory = /^(?:(?:目的|背景|说明|目标|追问目的)(?:[：:]|\s|为什么)|用于|访谈说明)/u.test(question);
    const direct = (ordered && !explanatory) || /[？?]$/u.test(question) || /(?:谁|什么|哪(?:里|个|些)?|是否|如何|为何|为什么|吗|呢|几|多少)/u.test(question)
      || /^请(?:介绍|描述|分享|回忆|举例|谈谈)/u.test(question);
    if (explanatory || !direct) return null;
    return { start: lineStart, end: lineStart + match[0].length, textStart: lineStart + prefix.length,
      textEnd: lineStart + prefix.length + raw.length, text: question };
  }).filter((question): question is NonNullable<typeof question> => question !== null);
}

export function normalizeOutlineForPersistence(document: InterviewMarkdownDocument) {
  const newline = document.markdown.includes("\r\n") ? "\r\n" : "\n";
  const blocks = interviewMarkdown.parseInterviewMarkdown(document).blocks;
  return blocks.flatMap((block) => {
    const expertLink = block.links.find((item) => /^#expert-[^\s#]+$/u.test(item.url));
    if (!expertLink) return [];
    const heading = document.markdown.slice(block.start, block.contentStart).trimEnd();
    const questions = questionLines(document.markdown, block.contentStart, block.end);
    return [`${heading}${newline}${newline}${questions.map((question, index) => `${index + 1}. ${question.text}`).join(newline)}`];
  }).join(`${newline}${newline}`).trimEnd() + newline;
}

function expertRole(expertId: string, directory: readonly DigitalExpertCatalogRow[], expertsDocument?: InterviewMarkdownDocument) {
  const catalogExpert = directory.find((expert) => expert.expertId === expertId);
  if (catalogExpert) return catalogExpert.occupation;
  const block = expertsDocument && interviewMarkdown.parseInterviewMarkdown(expertsDocument).blocks.find((candidate) =>
    candidate.links.some((link) => link.url === `#expert-${expertId}`));
  const body = block ? expertsDocument!.markdown.slice(block.contentStart, block.end) : "";
  return body.match(/(?:^|\n)(?:#{1,6}\s*)?(?:专业角色|职业)(?:[：:]\s*|\s*\r?\n+)([^\r\n#]+)/u)?.[1]?.trim() || "未设置职业";
}

export function InterviewOutlineStep({ document, directory = [], expertsDocument, avatarContext, pending, onChange, onSave, onConfirm, onGenerate }: {
  document: InterviewMarkdownDocument; pending: boolean; onChange: (markdown: string) => void;
  onSave: () => void; onConfirm: () => void; onGenerate: () => void;
  directory?: readonly DigitalExpertCatalogRow[]; expertsDocument?: InterviewMarkdownDocument;
  avatarContext?: { interviewId: string; revisionId: string };
}) {
  const blocks = interviewMarkdown.parseInterviewMarkdown(document).blocks;
  const [active, setActive] = React.useState<string | null>(null);
  const groups = blocks.flatMap((block) => {
    const link = block.links.find((item) => /^#expert-[^\s#]+$/u.test(item.url));
    return link ? [{ ...block, expertId: link.url.slice(8), displayName: link.text }] : [];
  });
  const chosen = groups.find((block) => block.headingId === active) ?? groups[0];
  const move = (direction: -1 | 1) => chosen ? moveOutlineGroup(document, chosen.headingId, direction) : null;
  return <div data-testid="itv-markdown-outline"><h2 className="text-3xl font-semibold tracking-tight lg:text-4xl">访谈问题</h2><p className="mt-2 text-base leading-7 text-muted-foreground">按专家逐题确认访谈内容。</p>
    {chosen && <div className="mt-4 flex gap-2">{([-1, 1] as const).map((direction) => <Button key={direction} variant="outline" disabled={pending || move(direction) === null} onClick={() => { const next = move(direction); if (next !== null) { onChange(next); setActive(null); } }}>{direction === -1 ? "上移当前分组" : "下移当前分组"}</Button>)}</div>}
    <div className="mt-6 grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]"><aside className="rounded-xl border border-border p-4"><h3 className="font-semibold">访谈专家</h3><nav aria-label="访谈问题分组" className="mt-4 space-y-2">{groups.map((block) => <button key={block.headingId} type="button" aria-current={chosen?.headingId === block.headingId ? "true" : undefined} onClick={() => setActive(block.headingId)} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left focus-visible:ring-2 focus-visible:ring-ring ${chosen?.headingId === block.headingId ? "bg-muted" : "hover:bg-muted/50"}`}><ExpertAvatar expertId={block.expertId} displayName={block.displayName} className="size-10" context={avatarContext} /><span className="min-w-0"><strong className="block truncate text-sm">{block.displayName}</strong><span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{expertRole(block.expertId, directory, expertsDocument)}</span></span></button>)}</nav></aside>
      <section className="min-w-0 rounded-xl border border-border p-5">{chosen ? (() => {
        const questions = questionLines(document.markdown, chosen.contentStart, chosen.end);
        return <article key={chosen.headingId}>
          <h3 className="text-xl font-semibold">{chosen.displayName}</h3>
          {questions.length > 0 && <ol aria-label={`${chosen.title}访谈问题`} className="mt-4 divide-y divide-border rounded-xl border border-border">{questions.map((question, index) => <li key={question.start} className="flex items-center gap-2 px-3 py-2">
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
          {questions.length === 0 && <p className="mt-6 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">还没有访谈问题。</p>}
          <Button className="mt-3 w-full" variant="outline" disabled={pending} onClick={() => {
            const newline = document.markdown.includes("\r\n") ? "\r\n" : "\n";
            onChange(document.markdown.slice(0, chosen.end) + `${newline}${questions.length + 1}. 新问题？${newline}` + document.markdown.slice(chosen.end));
          }}>添加问题</Button>
          <Button className="mt-4" variant="outline" disabled={pending} onClick={() => onChange(document.markdown.slice(0, chosen.start) + document.markdown.slice(chosen.end))}>删除该专家问题</Button>
        </article>;
      })() : <p className="py-12 text-center text-sm text-muted-foreground">尚无专家问题，请先生成访谈问题。</p>}</section>
    </div>
    <footer className="mt-6 flex flex-wrap justify-end gap-3"><Button variant="outline" disabled={pending} onClick={onGenerate}>生成访谈问题</Button><Button variant="outline" disabled={pending || !document.markdown.trim()} onClick={onSave}>保存问题草稿</Button><Button variant="primary" disabled={pending || !groups.length} onClick={onConfirm}>确认问题并开始访谈</Button></footer>
  </div>;
}
