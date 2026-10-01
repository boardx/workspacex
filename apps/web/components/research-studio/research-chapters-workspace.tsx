"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { research as C } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prepareResearchOutline, researchPlanTitle, researchQuestionsForTitle } from "@/lib/guided-research-markdown";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";

type Outline = GuidedResearchRuntime["outline"];
export function ResearchChaptersWorkspace({ runtime, disabled, onSave, onNext, onBack, onDirtyChange }: {
  runtime: GuidedResearchRuntime; disabled: boolean; onSave: (value: Outline) => void;
  onOptimize: (value: Outline) => void; onNext: () => void; onBack?: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [chapters, setChapters] = React.useState(runtime.outline);
  const [selectedId, setSelectedId] = React.useState(runtime.outline.find((chapter) => chapter.enabled)?.id);
  const previous = React.useRef(runtime.outline);
  React.useEffect(() => {
    if (JSON.stringify(previous.current) !== JSON.stringify(runtime.outline)) {
      previous.current = runtime.outline; setChapters(runtime.outline);
    }
  }, [runtime.outline]);
  const enabled = chapters.filter((chapter) => chapter.enabled).sort((a, b) => a.order - b.order);
  const selected = enabled.find((chapter) => chapter.id === selectedId) ?? enabled[0];
  const index = enabled.findIndex((chapter) => chapter.id === selected?.id);
  const changed = JSON.stringify(chapters) !== JSON.stringify(runtime.outline);
  const valid = C.GuidedResearchRuntimeDraft.safeParse({ node: "outline", value: chapters }).success;
  React.useEffect(() => { onDirtyChange?.(changed); }, [changed, onDirtyChange]);
  React.useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  function patch(value: Partial<Outline[number]>) {
    setChapters((items) => items.map((chapter) => chapter.id === selected?.id ? { ...chapter, ...value } : chapter));
  }
  function move(offset: number) {
    const target = enabled[index + offset];
    if (!selected || !target) return;
    const next = [...chapters].sort((a, b) => a.order - b.order);
    const from = next.findIndex((chapter) => chapter.id === selected.id), to = next.findIndex((chapter) => chapter.id === target.id);
    [next[from], next[to]] = [next[to]!, next[from]!];
    setChapters(next.map((chapter, order) => ({ ...chapter, order })));
  }
  return <section className="space-y-4" data-testid="research-chapters-workspace">
    <div className="grid items-start gap-4 rounded-xl border bg-card p-5 md:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
      <nav aria-label="报告章节" className="space-y-4">
        <h2 className="text-lg font-bold">报告章节</h2>
        <ol className="list-none space-y-2">{enabled.map((chapter, position) => <li key={chapter.id}>
          <Button variant="ghost" aria-pressed={chapter.id === selected?.id} disabled={disabled} onClick={() => setSelectedId(chapter.id)} className={`h-auto w-full justify-start whitespace-normal text-left ${chapter.id === selected?.id ? "bg-muted" : ""}`}>
            {position + 1}. {researchPlanTitle(chapter.title)}
          </Button>
          {chapter.subsections?.length ? <ol className="ml-4 mt-1 list-none space-y-1 text-sm text-muted-foreground">{chapter.subsections.map((sub, subIndex) => <li key={sub.id}>{position + 1}.{subIndex + 1} <span>{researchPlanTitle(sub.title)}</span></li>)}</ol> : null}
        </li>)}</ol>
        <Button variant="outline" disabled={disabled || chapters.length >= 30} onClick={() => {
          const id = crypto.randomUUID(); setChapters((items) => [...items, { id, title: "新章节", enabled: true, order: items.length, questions: researchQuestionsForTitle("新章节") }]); setSelectedId(id);
        }}><Plus className="mr-2 size-4" />新增章节</Button>
      </nav>
      {selected && <article className="space-y-4" data-testid="research-selected-chapter">
        <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">第 {index + 1} 章</h3><div className="flex gap-1">
          <Button size="icon" variant="ghost" aria-label="章节上移" disabled={disabled || index <= 0} onClick={() => move(-1)}><ArrowUp className="size-4" /></Button>
          <Button size="icon" variant="ghost" aria-label="章节下移" disabled={disabled || index >= enabled.length - 1} onClick={() => move(1)}><ArrowDown className="size-4" /></Button>
          <Button size="icon" variant="ghost" aria-label="删除章节" disabled={disabled || enabled.length <= 1} onClick={() => setChapters((items) => items.filter((item) => item.id !== selected.id).map((item, order) => ({ ...item, order })))}><Trash2 className="size-4" /></Button>
        </div></div>
        <label className="block space-y-2 text-sm font-medium">章节标题<Input aria-label="章节标题" value={selected.title} maxLength={200} disabled={disabled} onChange={(event) => patch({ title: event.target.value })} /></label>
        <ol className="list-none space-y-3">{selected.subsections?.map((sub, subIndex) => <li key={sub.id} className="flex items-center gap-2">
          <span className="shrink-0 text-sm text-muted-foreground">{index + 1}.{subIndex + 1}</span>
          <Input aria-label={`小章节 ${index + 1}.${subIndex + 1}`} value={sub.title} maxLength={200} disabled={disabled} onChange={(event) => patch({ subsections: selected.subsections!.map((item) => item.id === sub.id ? { ...item, title: event.target.value } : item) })} />
          <Button size="icon" variant="ghost" aria-label={`删除小章节 ${index + 1}.${subIndex + 1}`} disabled={disabled} onClick={() => { const remaining = selected.subsections!.filter((item) => item.id !== sub.id); patch({ subsections: remaining.length ? remaining : undefined }); }}><Trash2 className="size-4" /></Button>
        </li>)}</ol>
        <Button variant="outline" disabled={disabled || (selected.subsections?.length ?? 0) >= 8} onClick={() => patch({ subsections: [...(selected.subsections ?? []), { id: crypto.randomUUID(), title: "新小章节", questions: researchQuestionsForTitle("新小章节") }] })}><Plus className="mr-2 size-4" />新增小章节</Button>
      </article>}
    </div>
    <div className="flex flex-wrap justify-end gap-3">{changed && <Button variant="primary" disabled={disabled || !valid} onClick={() => onSave(prepareResearchOutline(chapters, runtime.outline))}>保存章节结构</Button>}{onBack && <Button variant="outline" disabled={disabled || changed} onClick={onBack}>上一步</Button>}<Button variant="primary" disabled={disabled || changed} onClick={onNext}>下一步：生成报告</Button></div>
  </section>;
}
