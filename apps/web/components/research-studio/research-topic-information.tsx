"use client";

import * as React from "react";
import { Check, CalendarDays, MapPin } from "lucide-react";
import { research as C } from "@repo/contracts";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";

type Brief = GuidedResearchRuntime["brief"];
const focusOptions = ["市场增长质量", "政策确定性", "并网可行性", "竞争强度", "本地合作伙伴", "技术发展趋势", "投融资环境", "用户需求", "供应链能力", "法规与标准"];

export function ResearchTopicInformation({ brief, disabled, onSave, onDirtyChange }: { brief: Brief; disabled: boolean; onSave: (value: Brief) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [value, setValue] = React.useState(brief);
  const previousServerBrief = React.useRef(brief);
  React.useEffect(() => {
    if (JSON.stringify(previousServerBrief.current) !== JSON.stringify(brief)) {
      previousServerBrief.current = brief;
      setValue(brief);
    }
  }, [brief]);
  const selected = value.focus.split(/[、，,；;\n]/).map((item) => item.trim()).filter(Boolean);
  const valid = C.GuidedResearchBrief.safeParse(value).success;
  const changed = JSON.stringify(value) !== JSON.stringify(brief);
  React.useEffect(() => { onDirtyChange?.(changed); }, [changed, onDirtyChange]);
  React.useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  const field = (name: keyof Brief, text: string) => setValue((current) => ({ ...current, [name]: text }));
  return <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (valid && changed) onSave(value); }} data-testid="research-topic-information">
    <div className="space-y-1"><label htmlFor="research-topic" className="text-sm font-semibold">研究主题 <span className="text-destructive">*</span></label><Input id="research-topic" aria-label="研究主题" className="h-9 text-sm" maxLength={200} value={value.topic} disabled={disabled} onChange={(event) => field("topic", event.target.value)} /></div>
    <div className="space-y-1"><label htmlFor="research-goal" className="text-sm font-semibold">研究目标 <span className="text-destructive">*</span></label><div className="relative"><Textarea id="research-goal" className="min-h-20 pb-6 text-sm leading-snug" maxLength={2000} value={value.goal} disabled={disabled} onChange={(event) => field("goal", event.target.value)} /><p className="pointer-events-none absolute bottom-2 right-3 text-xs text-muted-foreground">{value.goal.length} / 2000</p></div></div>
    <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><label htmlFor="research-time" className="text-sm font-semibold">时间范围</label><div className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-2.5 size-4" aria-hidden /><Input id="research-time" className="h-9 pl-9 text-sm" value={value.timeRange} disabled={disabled} maxLength={200} onChange={(event) => field("timeRange", event.target.value)} /></div></div><div className="space-y-1"><label htmlFor="research-region" className="text-sm font-semibold">研究区域</label><div className="relative"><MapPin className="pointer-events-none absolute left-3 top-2.5 size-4" aria-hidden /><Input id="research-region" className="h-9 pl-9 text-sm" value={value.region} disabled={disabled} maxLength={200} onChange={(event) => field("region", event.target.value)} /></div></div></div>
    <fieldset className="space-y-2" disabled={disabled}><legend className="mb-1 text-sm font-semibold">重点关注（可多选）</legend><div className="flex flex-wrap gap-1.5">{[...new Set([...focusOptions, ...selected])].map((option) => <label key={option} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${selected.includes(option) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}><input type="checkbox" className="peer sr-only" checked={selected.includes(option)} onChange={(event) => field("focus", (event.target.checked ? [...selected, option] : selected.filter((item) => item !== option)).join("、"))} /><span className="flex size-4 items-center justify-center rounded-full border border-current peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2" aria-hidden>{selected.includes(option) && <Check className="size-3" />}</span>{option}</label>)}</div><details><summary className="cursor-pointer text-sm">其他重点关注</summary><Input aria-label="其他重点关注" placeholder="补充其他重点关注" value={value.focus} maxLength={2000} onChange={(event) => field("focus", event.target.value)} /></details></fieldset>
    {changed && <p className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">保存研究信息后将重新确认研究主题，后续结果会失效；已生成的历史报告会保留。</p>}
    {changed && <div className="flex justify-end"><Button type="submit" variant="primary" className="h-9 px-4 text-sm" disabled={disabled || !valid}>保存研究信息</Button></div>}
  </form>;
}
