"use client";
import { useRef, useState } from "react";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Activity = NonNullable<GuidedResearchRuntime["activity"]>[number];
export function mergeActivityEvents(current: Activity[], incoming: Activity[]): Activity[] {
  return [...new Map([...current, ...incoming].map((event) => [event.id, event])).values()].sort((left, right) => left.sequence - right.sequence);
}
type TrustRuntime = Pick<GuidedResearchRuntime, "planRevision" | "controlStatus" | "activity" | "coverage" | "claimEvidence" | "conflicts">;
export function GuidedResearchTrustConsole({ runtime, pending, onSteer, onResolveConflict, compact = false }: { runtime: TrustRuntime; pending: boolean; onSteer: (action: "pause" | "resume") => void; onResolveConflict: (decision: { conflictId: string; action: "retain_uncertainty" | "prefer_source"; sourceId?: string; rationale: string }) => void; compact?: boolean }) {
  const [panel, setPanel] = useState<"coverage" | "activity" | "evidence">("coverage");
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const activityRef = useRef<Activity[]>([]);
  const activity = mergeActivityEvents(activityRef.current, runtime.activity ?? []);
  activityRef.current = activity;
  return <section aria-label="可信研究控制台">
    <div className={`mb-3 grid grid-cols-3 gap-2 ${compact ? "2xl:hidden" : "md:hidden"}`} role="tablist" aria-label="可信研究视图">{([['coverage', '覆盖'], ['activity', '活动'], ['evidence', '证据']] as const).map(([value, label]) => <Button key={value} size="sm" variant={panel === value ? "primary" : "outline"} role="tab" aria-selected={panel === value} onClick={() => setPanel(value)}>{label}</Button>)}</div>
    <div className={`grid gap-4 ${compact ? "2xl:grid-cols-3" : "md:grid-cols-3"}`}>
    <Card className={panel === "coverage" ? "block" : compact ? "hidden 2xl:block" : "hidden md:block"}><CardHeader><CardTitle className="text-base">章节覆盖</CardTitle></CardHeader><CardContent data-testid="research-coverage-matrix" className="space-y-2">
      {runtime.coverage?.length ? runtime.coverage.map((item) => <div key={item.questionId} className="rounded-md border p-3 text-sm"><strong>{item.status === "answered" ? "已回答" : item.status === "weak" ? "证据较弱" : "缺失"}</strong><p>{item.reasons.join("；")}</p></div>) : <p className="text-sm text-muted-foreground">覆盖数据尚未生成</p>}
    </CardContent></Card>
    <Card className={panel === "activity" ? "block" : compact ? "hidden 2xl:block" : "hidden md:block"}><CardHeader><CardTitle className="text-base">实时活动</CardTitle></CardHeader><CardContent className="space-y-3">
      <div data-testid="research-steering-controls" className="flex gap-2"><Button size="sm" variant="outline" disabled={pending || runtime.controlStatus === "paused"} onClick={() => onSteer("pause")}>暂停研究</Button><Button size="sm" variant="outline" disabled={pending || runtime.controlStatus !== "paused"} onClick={() => onSteer("resume")}>继续研究</Button></div>
      <ol data-testid="research-activity-trace" className="space-y-2 text-sm">{activity.length ? activity.map((event) => <li key={event.id} className="border-l-2 pl-3"><span className="font-medium">{event.stage}</span> · {event.summary}</li>) : <li className="text-muted-foreground">暂无执行轨迹</li>}</ol>
    </CardContent></Card>
    <Card className={panel === "evidence" ? "block" : compact ? "hidden 2xl:block" : "hidden md:block"}><CardHeader><CardTitle className="text-base">证据与冲突</CardTitle></CardHeader><CardContent className="space-y-4">
      <div data-testid="research-claim-evidence" className="space-y-2">{runtime.claimEvidence?.length ? runtime.claimEvidence.map((item) => <blockquote key={`${item.claimId}-${item.evidenceId}`} tabIndex={0} className="rounded-md border p-3 text-sm"><p>{item.quote}</p><footer className="mt-1 text-xs text-muted-foreground">{item.sourceId} · {item.confidence ?? "置信度未知"}</footer></blockquote>) : <p className="text-sm text-muted-foreground">暂无可定位原文</p>}</div>
      <div data-testid="research-conflict-view" className="space-y-2">{runtime.conflicts?.length ? runtime.conflicts.map((item) => { const rationale = rationales[item.id] ?? ""; const disabled = pending || !rationale.trim(); return <div key={item.id} className="rounded-md border border-destructive/40 bg-muted p-3 text-sm text-background-foreground"><p>{item.status === "open" ? "待解决冲突" : "已解决冲突"} · {item.sourceIds.join(" ↔ ")}</p>{item.status === "open" ? <><Textarea className="mt-2" aria-label={`冲突 ${item.id} 的裁决理由`} value={rationale} onChange={(event) => setRationales((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="说明为何采用该来源，或为何保留不确定" /><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={disabled} onClick={() => onResolveConflict({ conflictId: item.id, action: "retain_uncertainty", rationale: rationale.trim() })}>保留为不确定</Button>{item.sourceIds.map((sourceId) => <Button key={sourceId} size="sm" variant="outline" disabled={disabled} onClick={() => onResolveConflict({ conflictId: item.id, action: "prefer_source", sourceId, rationale: rationale.trim() })}>采用 {sourceId}</Button>)}</div></> : <p className="mt-1 text-xs text-muted-foreground">{item.resolution}</p>}</div>; }) : <p className="text-sm text-muted-foreground">没有检测到证据冲突</p>}</div>
    </CardContent></Card></div>
  </section>;
}
