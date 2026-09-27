"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, FileText, GripVertical, Plus, Sparkles, Target, CircleHelp, List } from "lucide-react";
import { research as C } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
import { ResearchReportMarkdown } from "./guided-research-report-document";
import { researchReportDocument } from "@/lib/research-report-document";

type Outline = GuidedResearchRuntime["outline"];
export function ResearchChaptersWorkspace({ runtime, disabled, onSave, onOptimize, onNext, onBack, onDirtyChange }: { runtime: GuidedResearchRuntime; disabled: boolean; onSave: (value: Outline) => void; onOptimize: (value: Outline) => void; onNext: () => void; onBack?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [chapters, setChapters] = React.useState(runtime.outline);
  const [selectedId, setSelectedId] = React.useState(runtime.outline.find((chapter) => chapter.enabled)?.id);
  const previousServerOutline = React.useRef(runtime.outline);
  React.useEffect(() => {
    if (JSON.stringify(previousServerOutline.current) !== JSON.stringify(runtime.outline)) {
      previousServerOutline.current = runtime.outline;
      setChapters(runtime.outline);
    }
  }, [runtime.outline]);
  const enabled = chapters.filter((chapter) => chapter.enabled);
  const selected = enabled.find((chapter) => chapter.id === selectedId) ?? enabled[0];
  const index = enabled.findIndex((chapter) => chapter.id === selected?.id);
  const changed = JSON.stringify(chapters) !== JSON.stringify(runtime.outline);
  React.useEffect(() => { onDirtyChange?.(changed); }, [changed, onDirtyChange]);
  React.useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  const valid = C.GuidedResearchRuntimeDraft.safeParse({ node: "outline", value: chapters }).success;
  const report = runtime.report ? researchReportDocument(runtime.report, runtime.sources, runtime.outline) : null;
  const body = report?.sections.find((section) => section.sectionId === selected?.id)?.body
    .split(/\n\s*\n/).find((paragraph) => paragraph.trim() && !/^\s*#{1,6}\s/.test(paragraph));
  const taskIds = new Set(runtime.tasks.filter((task) => task.sectionId === selected?.id).map((task) => task.id));
  const sources = runtime.sources.filter((source) => source.decision !== "excluded" && taskIds.has(source.taskId));
  function patch(value: Partial<Outline[number]>) { setChapters((items) => items.map((chapter) => chapter.id === selected?.id ? { ...chapter, ...value } : chapter)); }
  function move(offset: number) {
    const target = enabled[index + offset];
    if (!selected || !target) return;
    const next = [...chapters]; const from = next.findIndex((chapter) => chapter.id === selected.id); const to = next.findIndex((chapter) => chapter.id === target.id);
    [next[from], next[to]] = [next[to]!, next[from]!];
    setChapters(next.map((chapter, order) => ({ ...chapter, order })));
  }
  return <section className="space-y-5" data-testid="research-chapters-workspace">
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(16rem,0.9fr)_minmax(0,1.8fr)_minmax(18rem,1fr)]">
      <aside className="rounded-xl border bg-card p-5 shadow-sm"><h2 className="mb-5 text-2xl font-bold">报告章节 <span className="text-base font-normal text-muted-foreground">（{enabled.length} 个章节）</span></h2><div className="space-y-2">{enabled.map((chapter, position) => <Button key={chapter.id} variant="ghost" aria-label={`${position + 1}. ${chapter.title}`} aria-pressed={chapter.id === selected?.id} disabled={disabled} onClick={() => setSelectedId(chapter.id)} className={`h-auto w-full justify-start whitespace-normal px-2 py-2 text-left text-lg ${chapter.id === selected?.id ? "bg-muted" : ""}`}><GripVertical className="mr-2 size-5 shrink-0 text-muted-foreground" /><span className="mr-3 rounded border px-2 py-1">{position + 1}</span>{chapter.title}</Button>)}</div><div className="mt-8 space-y-3"><Button variant="outline" className="h-11 w-full text-lg" disabled={disabled || chapters.length >= 30} onClick={() => { const id = crypto.randomUUID(); setChapters((items) => [...items, { id, title: "新章节", enabled: true, order: items.length, questions: ["需要回答什么问题？"], objective: "回答本章研究问题" }]); setSelectedId(id); }}><Plus className="mr-2 size-5" />新增章节</Button><Button variant="outline" className="h-11 w-full text-lg" disabled={disabled || !valid} onClick={() => onOptimize(chapters)}><Sparkles className="mr-2 size-5" />AI 优化结构</Button></div></aside>
      {selected && <article className="space-y-4 rounded-xl border bg-card p-6 shadow-sm" data-testid="research-selected-chapter"><div className="flex items-start justify-between gap-4 border-b pb-5"><h2 className="text-3xl font-bold">第 {index + 1} 章 {selected.title}</h2><div className="flex gap-2"><Button size="icon" variant="outline" aria-label="章节上移" disabled={disabled || index <= 0} onClick={() => move(-1)}><ArrowUp className="size-4" /></Button><Button size="icon" variant="outline" aria-label="章节下移" disabled={disabled || index >= enabled.length - 1} onClick={() => move(1)}><ArrowDown className="size-4" /></Button></div></div>
        <section className="space-y-2 border-b pb-4"><h3 className="flex items-center gap-3 text-lg font-bold"><Target className="size-6" />章节目标</h3><p className="pl-9 text-base leading-relaxed text-muted-foreground">{selected.objective}</p></section>
        <section className="space-y-2 border-b pb-4"><h3 className="flex items-center gap-3 text-lg font-bold"><CircleHelp className="size-6" />需要回答的关键问题</h3><ol className="list-inside list-decimal space-y-1 pl-9 text-base text-muted-foreground">{selected.questions.map((question, questionIndex) => <li key={questionIndex}>{question}</li>)}</ol></section>
        <section className="space-y-2"><h3 className="flex items-center gap-3 text-lg font-bold"><List className="size-6" />建议小节结构</h3>{selected.subsections?.length ? <ol className="list-inside list-decimal space-y-1 text-base text-muted-foreground">{selected.subsections.map((section) => <li key={section.id}>{section.title}</li>)}</ol> : <p className="text-lg text-muted-foreground">当前章节尚未生成小节结构，可通过 AI 优化补充。</p>}</section>
        <section className="rounded-xl bg-muted/40 p-5"><h3 className="mb-3 flex items-center gap-3 text-lg font-bold"><Sparkles className="size-6" />AI 生成的章节摘要</h3>{body && report ? <ResearchReportMarkdown text={body} references={report.references} /> : <p className="text-lg leading-relaxed text-muted-foreground">{selected.expectedOutput ?? "完成资料研究后，基于真实证据生成本章节内容。"}</p>}</section>
        <details><summary className="cursor-pointer text-sm font-medium">编辑章节内容</summary><div className="mt-4 space-y-4"><div><label htmlFor="chapter-title" className="mb-2 block text-sm font-medium">章节标题</label><Input id="chapter-title" value={selected.title} maxLength={200} disabled={disabled} onChange={(event) => patch({ title: event.target.value })} /></div><Textarea aria-label="章节目标" value={selected.objective ?? ""} disabled={disabled} maxLength={2000} onChange={(event) => patch({ objective: event.target.value || undefined })} className="min-h-24 text-base leading-relaxed" /><Textarea aria-label="章节研究问题（每行一个）" value={selected.questions.join("\n")} disabled={disabled} onChange={(event) => patch({ questions: event.target.value.split("\n") })} className="min-h-28 text-base leading-relaxed" /></div></details>
      </article>}
      <aside className="space-y-4"><section className="rounded-xl border bg-card p-6 shadow-sm"><h2 className="flex items-center justify-between text-2xl font-bold"><span className="flex items-center gap-3"><FileText className="size-6" />关键证据</span><span className="text-lg text-muted-foreground">{sources.length} 条</span></h2><p className="mt-4 text-lg text-muted-foreground">本章基于以下来源与资料：</p><ul className="mt-3 space-y-3 text-base">{sources.map((source) => <li key={source.id}><a className="underline underline-offset-4" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}</ul>{!sources.length && <p className="mt-3 text-muted-foreground">本章暂无关联来源，需要补充证据。</p>}</section><section className="rounded-xl border bg-card p-6 shadow-sm"><h2 className="text-xl font-bold">章节说明</h2><p className="mt-3 text-lg leading-relaxed text-muted-foreground">{selected?.analysisApproach ?? "按章节目标回答关键问题，保留证据引用与研究局限，确保与全文结论一致。"}</p></section><section className="rounded-xl border bg-card p-6 shadow-sm"><h2 className="text-xl font-bold">AI 建议</h2><p className="mt-3 text-lg leading-relaxed text-muted-foreground">修改章节后需要重新确认研究计划并检索相关资料；历史报告会保留，不会直接改写已有证据。</p></section></aside>
    </div>
    <div className="flex flex-wrap justify-end gap-3">{changed && <><p className="mr-auto self-center text-sm text-muted-foreground">结构修改尚未保存，保存后需重新完成资料研究。</p><Button disabled={disabled || !valid} onClick={() => onSave(chapters)}>保存章节结构</Button></>}{onBack && <Button variant="outline" className="h-12 px-6 text-lg" disabled={disabled || changed} onClick={onBack}>上一步</Button>}<Button className="h-12 px-6 text-lg" disabled={disabled || changed} onClick={onNext}>下一步：生成报告</Button></div>
  </section>;
}
