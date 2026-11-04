"use client";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { ArrowRight, Loader2, RotateCcw, ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { DigitalExpertCatalogRow } from "@/lib/interview-api";
import type { InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
import { Button } from "@/components/ui/button";
import { WorkflowActionButton as ActionButton } from "@/components/research-studio/research-workflow-actions";
import { ExpertAvatar } from "./expert-avatar";
import { moveOutlineGroup } from "@/lib/interview-outline-order";
import { InterviewStepHeader, InterviewStepActions } from "./interview-step-header";

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
  return body.match(/(?:^|\n)(?:#{1,6}\s*)?(?:专业角色|职业)(?:[：:]\s*|\s*\r?\n+)([^\r\n#]+)/u)?.[1]?.trim() || null;
}

export type InterviewOutlineAction = "save" | "generate" | "confirm";

export function InterviewOutlineStep({ document, directory = [], expertsDocument, avatarContext, pending, loadingAction = null, generating = false, onChange, onSave, onConfirm, onGenerate }: {
  document: InterviewMarkdownDocument; pending: boolean; loadingAction?: InterviewOutlineAction | null; generating?: boolean; onChange: (markdown: string) => void;
  onSave: () => void; onConfirm: () => void; onGenerate: () => void;
  directory?: readonly DigitalExpertCatalogRow[]; expertsDocument?: InterviewMarkdownDocument;
  avatarContext?: { interviewId: string; revisionId: string };
}) {
 const { t } = useI18n();
  const blocks = interviewMarkdown.parseInterviewMarkdown(document).blocks;
  const [active, setActive] = React.useState<string | null>(null);
  const groups = blocks.flatMap((block) => {
    const link = block.links.find((item) => /^#expert-[^\s#]+$/u.test(item.url));
    return link ? [{ ...block, expertId: link.url.slice(8), displayName: link.text }] : [];
  });
  const confirmedExperts = expertsDocument ? interviewMarkdown.projectInterviewMarkdownExperts(expertsDocument) : [];
  const navigationExperts = groups.length ? groups.map((group) => ({ expertId: group.expertId, displayName: group.displayName, headingId: group.headingId }))
    : confirmedExperts.map((expert) => ({ expertId: expert.expertId, displayName: expert.displayName, headingId: `pending-${expert.expertId}` }));
  const groupRefs = React.useRef(new Map<string, HTMLElement>());
  const questionRefs = React.useRef(new Map<string, HTMLTextAreaElement>());
  const addedQuestion = React.useRef<string | null>(null);
  React.useEffect(() => {
    const resize = () => questionRefs.current.forEach(input => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 320)}px`;
    });
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [document.markdown]);
  React.useEffect(() => {
    if (pending || !addedQuestion.current) return;
    const input = questionRefs.current.get(addedQuestion.current);
    if (input) { addedQuestion.current = null; input.focus(); input.select(); }
  }, [document.markdown, pending]);
  const chosen = groups.find((block) => block.headingId === active) ?? groups[0];
  const move = (direction: -1 | 1) => chosen ? moveOutlineGroup(document, chosen.headingId, direction) : null;
  const generationLabel = t("itv.outline.generating", { count: confirmedExperts.length });
  const isGenerating = generating || loadingAction === "generate";
  const generationStatus = isGenerating ? <div role="status" aria-live="polite" aria-busy="true" data-testid="loading" className="flex items-start gap-3 rounded-xl border border-border bg-card p-5"><Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden /><div><p className="text-sm font-medium">{generationLabel}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{t("itv.outline.wait")}</p></div></div> : null;
  return <div data-testid="itv-markdown-outline"><InterviewStepHeader title={t("itv.outline.title")} />

    <div className="mt-6 grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]"><aside className="min-w-0 rounded-xl border border-border p-4 lg:sticky lg:top-5"><h3 className="font-semibold">{t("itv.outline.experts")}</h3><nav aria-label={t("itv.outline.groups")} className="mt-4 space-y-2">{navigationExperts.map((block, index) => <button key={block.headingId} type="button" aria-label={block.displayName} aria-current={(chosen?.headingId === block.headingId || (!groups.length && index === 0)) ? "true" : undefined} onClick={() => { if (!groups.length) return; setActive(block.headingId); groupRefs.current.get(block.headingId)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className={`flex min-w-0 w-full items-center gap-3 rounded-xl p-3 text-left focus-visible:ring-2 focus-visible:ring-ring ${(chosen?.headingId === block.headingId || (!groups.length && index === 0)) ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-muted/50"}`}><ExpertAvatar expertId={block.expertId} displayName={block.displayName} className="size-10" context={avatarContext} /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{block.displayName}</strong><span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{expertRole(block.expertId, directory, expertsDocument) ?? t("itv.outline.noOccupation")}</span></span></button>)}</nav></aside>
      <section className="min-w-0 space-y-5">{generationStatus}{groups.length ? groups.map((group) => {
        const questions = questionLines(document.markdown, group.contentStart, group.end);
        return <article key={group.headingId} draggable={!pending} onDragStart={(event) => { event.dataTransfer.setData("text/plain", group.headingId); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData("text/plain"); const sourceIndex = groups.findIndex((item) => item.headingId === sourceId); const targetIndex = groups.findIndex((item) => item.headingId === group.headingId); if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return; let next = document.markdown; const direction = targetIndex > sourceIndex ? 1 : -1; for (let index = sourceIndex; index !== targetIndex; index += direction) { const moved = moveOutlineGroup({ ...document, markdown: next }, sourceId, direction); if (moved === null) return; next = moved; } onChange(next); }} ref={(node) => { if (node) groupRefs.current.set(group.headingId, node); else groupRefs.current.delete(group.headingId); }} className={`scroll-mt-5 rounded-xl border bg-background p-5 ${chosen?.headingId === group.headingId ? "border-primary/40 ring-1 ring-primary/15" : "border-border"}`}>
          <div className="flex items-center justify-between gap-3"><h3 className="min-w-0 flex-1 break-words text-xl font-semibold [overflow-wrap:anywhere]">{group.displayName}</h3><div className="flex shrink-0 gap-1">{([-1, 1] as const).map((direction) => <Button key={direction} variant="ghost" size="icon" disabled={pending || moveOutlineGroup(document, group.headingId, direction) === null} aria-label={t(direction === -1 ? "itv.outline.moveExpertUp" : "itv.outline.moveExpertDown", { name: group.displayName })} onClick={() => { const next = moveOutlineGroup(document, group.headingId, direction); if (next !== null) onChange(next); }}>{direction === -1 ? <ArrowUp className="size-4" aria-hidden /> : <ArrowDown className="size-4" aria-hidden />}</Button>)}</div></div>
          {questions.length > 0 && <ol aria-label={t("itv.outline.questionsFor", { name: group.title })} className="mt-4 divide-y divide-border rounded-xl border border-border">{questions.map((question, index) => <li key={question.start} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-2 px-3 py-2 sm:flex sm:items-center">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold">{index + 1}</span>
            <textarea rows={1} ref={node => { const key = `${group.headingId}:${index}`; if (node) questionRefs.current.set(key, node); else questionRefs.current.delete(key); }} aria-label={t("itv.outline.edit", { count: index + 1 })} disabled={pending} value={question.text} onChange={(event) => onChange(document.markdown.slice(0, question.textStart) + event.target.value.replace(/[\r\n]/gu, "") + document.markdown.slice(question.textEnd))} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }} className="min-h-9 min-w-0 w-full flex-1 resize-none overflow-y-auto rounded-md bg-transparent px-2 py-1 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <div className="col-start-2 flex justify-end gap-1 sm:contents">
            {([-1, 1] as const).map((direction) => <Button key={direction} variant="ghost" size="icon" disabled={pending || index + direction < 0 || index + direction >= questions.length} aria-label={t(direction === -1 ? "itv.outline.moveUp" : "itv.outline.moveDown", { count: index + 1 })} onClick={() => {
              const other = questions[index + direction]; if (!other) return;
              const first = direction === -1 ? other : question; const second = direction === -1 ? question : other;
              onChange(document.markdown.slice(0, first.textStart) + second.text + document.markdown.slice(first.textEnd, second.textStart) + first.text + document.markdown.slice(second.textEnd));
            }}>{direction === -1 ? <ArrowUp className="size-4" aria-hidden /> : <ArrowDown className="size-4" aria-hidden />}</Button>)}
            <Button variant="ghost" size="icon" disabled={pending} aria-label={t("itv.outline.delete", { count: index + 1 })} onClick={() => {
              const tail = document.markdown.slice(question.end);
              const lineBreak = tail.startsWith("\r\n") ? 2 : tail.startsWith("\n") ? 1 : 0;
              onChange(document.markdown.slice(0, question.start) + document.markdown.slice(question.end + lineBreak));
            }}><Trash2 className="size-4" aria-hidden /></Button></div>
          </li>)}</ol>}
          {questions.length === 0 && <p className="mt-6 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{t("itv.outline.noQuestions")}</p>}
          <Button className="mt-3 w-full" variant="outline" disabled={pending} onClick={() => {
            const newline = document.markdown.includes("\r\n") ? "\r\n" : "\n";
            addedQuestion.current = `${group.headingId}:${questions.length}`;
            onChange(document.markdown.slice(0, group.end) + `${newline}${questions.length + 1}. ${t("itv.outline.newQuestion")}${newline}` + document.markdown.slice(group.end));
          }}>{t("itv.outline.add")}</Button>
        </article>;
      }) : !isGenerating && <div className="rounded-xl border border-border p-5"><p className="py-12 text-center text-sm text-muted-foreground">{t("itv.outline.empty")}</p></div>}</section>
    </div>
    <InterviewStepActions><ActionButton variant="outline" loading={false} icon={<RotateCcw className="size-4" aria-hidden />} disabled={pending} onClick={onGenerate}>{t("itv.outline.generate")}</ActionButton><ActionButton variant="outline" loading={loadingAction === "save"} disabled={pending || !document.markdown.trim()} onClick={onSave}>{t("itv.outline.save")}</ActionButton><ActionButton variant="primary" loading={loadingAction === "confirm"} icon={<ArrowRight className="size-4" aria-hidden />} disabled={pending || !groups.length} onClick={onConfirm}>{t("itv.outline.confirm")}</ActionButton></InterviewStepActions>
  </div>;
}
