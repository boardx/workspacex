"use client";
import * as React from "react";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Intent = NonNullable<GuidedResearchRuntime["intent"]>;
type Policy = NonNullable<GuidedResearchRuntime["sourcePolicy"]>;
export function GuidedResearchIntentPlan({ initialIntent, initialPolicy, revision, disabled, onConfirm }: {
  initialIntent: Intent | undefined; initialPolicy: Policy | undefined; revision: number; disabled: boolean;
  onConfirm: (value: { intent: Intent; sourcePolicy: Policy; expectedRevision: number }) => void;
}) {
  const [decision, setDecision] = React.useState(initialIntent?.decision ?? "");
  const [criteria, setCriteria] = React.useState(initialIntent?.successCriteria.join("\n") ?? "");
  const [audience, setAudience] = React.useState(initialIntent?.audience ?? "");
  const [deliverable, setDeliverable] = React.useState(initialIntent?.deliverable ?? "研究报告");
  const [timeFrom, setTimeFrom] = React.useState(initialIntent?.timeframe.from ?? "");
  const [timeTo, setTimeTo] = React.useState(initialIntent?.timeframe.to ?? "");
  const [mode, setMode] = React.useState<Policy["mode"]>(initialPolicy?.mode ?? "prioritize");
  const [domains, setDomains] = React.useState(initialPolicy?.domains.join(", ") ?? "");
  const successCriteria = criteria.split("\n").map((item) => item.trim()).filter(Boolean);
  const domainList = domains.split(",").map((item) => item.trim()).filter(Boolean);
  const invalidTimeframe = Boolean((timeFrom && !/^\d{4}-\d{2}-\d{2}$/.test(timeFrom)) || (timeTo && !/^\d{4}-\d{2}-\d{2}$/.test(timeTo)) || (timeFrom && timeTo && timeFrom > timeTo));
  const invalidPolicy = mode === "restrict" && domainList.length === 0;
  return <Card data-testid="research-intent-card">
    <CardHeader><CardTitle className="text-base">确认研究边界</CardTitle></CardHeader>
    <CardContent className="grid gap-4 md:grid-cols-2">
      <label className="grid gap-1 text-sm">决策对象<Input value={decision} onChange={(event) => setDecision(event.target.value)} /></label>
      <label className="grid gap-1 text-sm">目标受众<Input value={audience} onChange={(event) => setAudience(event.target.value)} /></label>
      <label className="grid gap-1 text-sm">交付物<Input value={deliverable} onChange={(event) => setDeliverable(event.target.value)} /></label>
      <label className="grid gap-1 text-sm">时间范围起点<Input type="date" aria-label="时间范围起点" value={timeFrom} onChange={(event) => setTimeFrom(event.target.value)} /></label>
      <label className="grid gap-1 text-sm">时间范围终点<Input type="date" aria-label="时间范围终点" value={timeTo} onChange={(event) => setTimeTo(event.target.value)} /></label>
      <label className="grid gap-1 text-sm md:col-span-2">成功标准<Textarea value={criteria} onChange={(event) => setCriteria(event.target.value)} placeholder="每行一条" /></label>
      <fieldset className="grid gap-2 md:col-span-2" data-testid="research-source-policy">
        <legend className="text-sm font-medium">来源范围</legend>
        <div className="flex flex-wrap gap-4">{(["restrict", "prioritize", "open"] as const).map((value) => <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name="source-policy" checked={mode === value} onChange={() => setMode(value)} />{value === "restrict" ? "仅限指定站点" : value === "prioritize" ? "优先指定站点" : "公开网页"}</label>)}</div>
        <Input aria-label="指定站点" value={domains} onChange={(event) => setDomains(event.target.value)} placeholder="example.com, gov.cn" />
        {invalidPolicy && <p role="alert" className="text-sm text-destructive">仅限指定站点时至少填写一个域名。</p>}
      </fieldset>
      {invalidTimeframe && <p role="alert" className="text-sm text-destructive md:col-span-2">时间范围必须是有效日期，且起点不能晚于终点。</p>}
      <div data-testid="research-plan-editor" className="rounded-md border p-3 text-sm text-muted-foreground md:col-span-2">计划确认后生成版本 {revision + 1}；后续调整会保留旧版本。</div>
      <Button className="md:col-span-2" disabled={disabled || !decision.trim() || successCriteria.length === 0 || invalidPolicy || invalidTimeframe} onClick={() => onConfirm({
        expectedRevision: revision,
        intent: { decision: decision.trim(), audience: audience.trim(), timeframe: { ...(timeFrom.trim() ? { from: timeFrom.trim() } : {}), ...(timeTo.trim() ? { to: timeTo.trim() } : {}) }, deliverable: deliverable.trim(), successCriteria },
        sourcePolicy: { mode, domains: domainList, internalSourceIds: [], revision: (initialPolicy?.revision ?? 0) + 1 },
      })}>确认研究边界</Button>
    </CardContent>
  </Card>;
}
