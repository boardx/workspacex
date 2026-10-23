"use client";
import type { InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { InterviewReportMarkdown } from "./interview-report-markdown";

type Segment = { start: number; end: number; title: string | null; contentStart: number };
/** Read-only segmentation: preserve original Markdown slices and ignore fenced examples. */
function segments(markdown: string): Segment[] {
  const result: Segment[] = [];
  let offset = 0, start = 0, contentStart = 0;
  let title: string | null = null;
  let fence: string | null = null;
  let questionLevel = 7;
  for (const line of markdown.split(/(?<=\n)/u)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (!fence && !/^(?: {4}|\t)/u.test(line)) {
      const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
      const text = (heading?.[2] ?? line.trim()).replace(/^\*\*(.+)\*\*$/u, "$1");
      const question = (Boolean(heading) || /^(?:\d+[.、．)）]\s*|问题[一二三四五六七八九十\d]+[：:、.\s])/u.test(text)) && /[？?]/u.test(text);
      if (question || (title && heading && heading[1]!.length <= questionLevel)) {
        if (offset > start) result.push({ start, end: offset, title, contentStart });
        start = offset; title = question ? text : null;
        contentStart = question ? offset + line.length : offset;
        questionLevel = heading?.[1]?.length ?? 7;
      }
    }
    offset += line.length;
  }
  if (offset > start) result.push({ start, end: offset, title, contentStart });
  return result;
}
function Answer({ title, markdown, document }: { title: string; markdown: string; document?: InterviewMarkdownDocument }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return <section className="border-b border-border py-3 last:border-b-0">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className="flex w-full items-start justify-between gap-3 rounded-lg p-2 text-left text-base font-semibold leading-7 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span>{title.replace(/\*\*/gu, "")}</span>{open ? <ChevronUp className="mt-1 size-5 shrink-0" aria-hidden /> : <ChevronDown className="mt-1 size-5 shrink-0" aria-hidden />}
    </button>
    <div id={id} hidden={!open} className="px-2 pb-3"><InterviewReportMarkdown longForm document={document ? { ...document, markdown } : undefined} markdown={markdown} testId="itv-question-answer" /></div>
  </section>;
}
export function InterviewQuestionAnswers({ markdown, document }: { markdown: string; document?: InterviewMarkdownDocument }) {
  return <div data-testid="itv-question-answers">{segments(markdown).map(segment => segment.title
    ? <Answer key={`${segment.start}:${segment.title}`} document={document} title={segment.title} markdown={markdown.slice(segment.contentStart, segment.end)} />
    : <InterviewReportMarkdown key={segment.start} longForm document={document ? { ...document, markdown: markdown.slice(segment.start, segment.end) } : undefined} markdown={markdown.slice(segment.start, segment.end)} testId="itv-transcript-context" />)}</div>;
}
