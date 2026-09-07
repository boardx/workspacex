"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { GuidedResearchRuntimeDraft as Draft } from "@/lib/guided-research-api";
type DirectionDraft = Extract<Draft, { node: "directions" }>;
type OutlineDraft = Extract<Draft, { node: "outline" }>;
const directionFields = { decisionQuestions: "决策问题", hypotheses: "待验证假设", comparisonDimensions: "比较维度", evidenceNeeds: "证据需求" } as const;
const outlineFields = { objective: "章节目标", analysisApproach: "分析方法", expectedOutput: "预期产出" } as const;
const lines = (value: string) => value === "" ? [] : value.split("\n");
function TextField({ label, value, disabled, onChange, list = false }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; list?: boolean }) {
  const id = React.useId();
  const invalid = list && value !== "" && (lines(value).length > 12 || lines(value).some((item) => item.length === 0 || item.length > 1000));
  return <div className="space-y-1.5"><label htmlFor={id} className="text-12 font-medium">{label}{list && <span className="ml-1 font-normal text-muted-foreground">（每行一项）</span>}</label><Textarea id={id} aria-label={label} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} rows={3} maxLength={list ? 12012 : 2000} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />{invalid && <p id={`${id}-error`} role="alert" className="text-12 text-destructive">最多填写 12 项，每项 1–1000 字，请删除空行或补齐内容。</p>}</div>;
}
export function ResearchDirectionsEditor({ draft, disabled, onChange }: { draft: DirectionDraft; disabled: boolean; onChange: (draft: DirectionDraft) => void }) {
  const patch = (index: number, value: Partial<DirectionDraft["value"][number]>) => onChange({ ...draft, value: draft.value.map((item, position) => position === index ? { ...item, ...value } : item) });
  return <div className="space-y-3" data-testid="research-directions">
    <Button variant="outline" disabled={disabled || draft.value.length >= 20} onClick={() => onChange({ ...draft, value: [...draft.value, { id: crypto.randomUUID(), title: "新研究方向", description: "补充研究重点", enabled: true, order: draft.value.length, decisionQuestions: [], hypotheses: [], comparisonDimensions: [], evidenceNeeds: [] }] })}>添加研究方向</Button>
    {draft.value.map((item, index) => <section key={item.id} className="space-y-3 rounded-lg border border-border bg-card p-4" aria-label={`研究方向 ${index + 1}`}>
      <div className="flex items-center justify-between gap-3"><label className="flex gap-2 text-12"><input type="checkbox" checked={item.enabled} disabled={disabled} onChange={(event) => patch(index, { enabled: event.target.checked })} />纳入研究</label><Button variant="ghost" disabled={disabled || draft.value.length <= 1} onClick={() => onChange({ ...draft, value: draft.value.filter((entry) => entry.id !== item.id) })}>删除方向</Button></div>
      <Input aria-label="研究方向" value={item.title} disabled={disabled} onChange={(event) => patch(index, { title: event.target.value })} />
      <Textarea aria-label="方向说明" value={item.description} rows={2} disabled={disabled} onChange={(event) => patch(index, { description: event.target.value })} />
      <details className="border-t border-border pt-3"><summary className="cursor-pointer text-12 font-medium">研究设计 · 问题、假设与证据<span className="ml-2 text-muted-foreground">可编辑</span></summary><div className="mt-4 grid gap-4 lg:grid-cols-2">{(Object.keys(directionFields) as (keyof typeof directionFields)[]).map((field) => <TextField key={field} label={directionFields[field]} list value={(item[field] ?? []).join("\n")} disabled={disabled} onChange={(value) => patch(index, { [field]: lines(value) })} />)}</div></details>
    </section>)}
  </div>;
}
export function ResearchOutlineEditor({ draft, disabled, onChange }: { draft: OutlineDraft; disabled: boolean; onChange: (draft: OutlineDraft) => void }) {
  const patch = (index: number, value: Partial<OutlineDraft["value"][number]>) => onChange({ ...draft, value: draft.value.map((item, position) => position === index ? { ...item, ...value } : item) });
  return <div className="space-y-3" data-testid="research-outline">
    <Button variant="outline" disabled={disabled || draft.value.length >= 30} onClick={() => onChange({ ...draft, value: [...draft.value, { id: crypto.randomUUID(), title: "新章节", questions: ["需要回答什么问题？"], enabled: true, order: draft.value.length, objective: "回答本章研究问题并支持决策", analysisApproach: "对比来源证据，检验假设并说明局限", expectedOutput: "有来源支持的分析结论与行动建议", subsections: [{ id: crypto.randomUUID(), title: "关键问题分析", questions: ["有哪些证据支持或反驳本章判断？"] }] }] })}>添加章节</Button>
    {draft.value.map((item, index) => <section key={item.id} className="space-y-3 rounded-lg border border-border bg-card p-4" aria-label={`报告章节 ${index + 1}`}>
      <div className="flex items-center justify-between gap-3"><label className="flex gap-2 text-12"><input type="checkbox" checked={item.enabled} disabled={disabled} onChange={(event) => patch(index, { enabled: event.target.checked })} />纳入报告</label><Button variant="ghost" disabled={disabled || draft.value.length <= 1} onClick={() => onChange({ ...draft, value: draft.value.filter((entry) => entry.id !== item.id) })}>删除章节</Button></div>
      <Input aria-label="章节标题" disabled={disabled} value={item.title} onChange={(event) => patch(index, { title: event.target.value })} />
      <Textarea aria-label="章节研究问题（每行一个）" disabled={disabled} value={item.questions.join("\n")} onChange={(event) => patch(index, { questions: lines(event.target.value) })} />
      <details className="border-t border-border pt-3"><summary className="cursor-pointer text-12 font-medium">研究设计与小节 · {item.subsections?.length ?? 0} 个小节</summary><div className="mt-4 space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">{(Object.keys(outlineFields) as (keyof typeof outlineFields)[]).map((field) => <TextField key={field} label={outlineFields[field]} value={item[field] ?? ""} disabled={disabled} onChange={(value) => patch(index, { [field]: value === "" ? undefined : value })} />)}</div>
        <div className="space-y-3"><h3 className="text-12 font-semibold">章节小节</h3>{item.subsections?.map((subsection, position) => <div key={subsection.id} className="space-y-3 rounded-md border border-border bg-muted/20 p-3" aria-label={`小节 ${position + 1}`}>
          <div className="flex items-center gap-2"><Input aria-label="小节标题" value={subsection.title} disabled={disabled} onChange={(event) => patch(index, { subsections: item.subsections!.map((entry, i) => i === position ? { ...entry, title: event.target.value } : entry) })} /><Button variant="ghost" disabled={disabled} onClick={() => { const remaining = item.subsections!.filter((entry) => entry.id !== subsection.id); patch(index, { subsections: remaining.length ? remaining : undefined }); }}>删除小节</Button></div>
          <TextField label="小节研究问题" list value={subsection.questions.join("\n")} disabled={disabled} onChange={(value) => patch(index, { subsections: item.subsections!.map((entry, i) => i === position ? { ...entry, questions: lines(value) } : entry) })} />
        </div>)}<Button variant="outline" disabled={disabled || (item.subsections?.length ?? 0) >= 8} onClick={() => patch(index, { subsections: [...(item.subsections ?? []), { id: crypto.randomUUID(), title: "新小节", questions: ["本小节需要核实哪些证据？"] }] })}>添加小节</Button></div>
      </div></details>
    </section>)}
  </div>;
}
export function ResearchDesignPreview({ draft }: { draft: DirectionDraft | OutlineDraft }) {
  return <ul className="space-y-3">{draft.value.map((item) => <li key={item.id} className="space-y-2"><strong>{item.title}</strong>{"description" in item ? <><p>{item.description}</p>{(Object.keys(directionFields) as (keyof typeof directionFields)[]).map((field) => item[field]?.length ? <div key={field}><span className="font-medium">{directionFields[field]}：</span><ul className="list-disc pl-4">{item[field]!.map((text, index) => <li key={index}>{text}</li>)}</ul></div> : null)}</> : <><p>{item.questions.join("；")}</p>{(Object.keys(outlineFields) as (keyof typeof outlineFields)[]).map((field) => item[field] ? <p key={field}><span className="font-medium">{outlineFields[field]}：</span>{item[field]}</p> : null)}{item.subsections?.map((section) => <div key={section.id} className="border-l border-border pl-3"><strong>{section.title}</strong><p>{section.questions.join("；")}</p></div>)}</>}</li>)}</ul>;
}
