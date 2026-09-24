"use client";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Activity = NonNullable<GuidedResearchRuntime["activity"]>[number];
export function mergeActivityEvents(current: Activity[], incoming: Activity[]): Activity[] {
  return [...new Map([...current, ...incoming].map((event) => [event.id, event])).values()].sort((left, right) => left.sequence - right.sequence);
}
type TrustRuntime = Pick<GuidedResearchRuntime, "planRevision" | "controlStatus" | "activity" | "coverage" | "claimEvidence" | "conflicts">;
export function GuidedResearchTrustConsole({ runtime, pending, onSteer }: { runtime: TrustRuntime; pending: boolean; onSteer: (action: "pause" | "resume") => void }) {
  return <section className="grid gap-4 xl:grid-cols-3" aria-label="可信研究控制台">
    <Card><CardHeader><CardTitle className="text-base">章节覆盖</CardTitle></CardHeader><CardContent data-testid="research-coverage-matrix" className="space-y-2">
      {runtime.coverage?.length ? runtime.coverage.map((item) => <div key={item.questionId} className="rounded-md border p-3 text-sm"><strong>{item.status === "answered" ? "已回答" : item.status === "weak" ? "证据较弱" : "缺失"}</strong><p>{item.reasons.join("；")}</p></div>) : <p className="text-sm text-muted-foreground">覆盖数据尚未生成</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">实时活动</CardTitle></CardHeader><CardContent className="space-y-3">
      <div data-testid="research-steering-controls" className="flex gap-2"><Button size="sm" variant="outline" disabled={pending || runtime.controlStatus === "paused"} onClick={() => onSteer("pause")}>暂停研究</Button><Button size="sm" variant="outline" disabled={pending || runtime.controlStatus !== "paused"} onClick={() => onSteer("resume")}>继续研究</Button></div>
      <ol data-testid="research-activity-trace" className="space-y-2 text-sm">{runtime.activity?.length ? runtime.activity.map((event) => <li key={event.id} className="border-l-2 pl-3"><span className="font-medium">{event.stage}</span> · {event.summary}</li>) : <li className="text-muted-foreground">暂无执行轨迹</li>}</ol>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">证据与冲突</CardTitle></CardHeader><CardContent className="space-y-4">
      <div data-testid="research-claim-evidence" className="space-y-2">{runtime.claimEvidence?.length ? runtime.claimEvidence.map((item) => <blockquote key={`${item.claimId}-${item.evidenceId}`} tabIndex={0} className="rounded-md border p-3 text-sm"><p>{item.quote}</p><footer className="mt-1 text-xs text-muted-foreground">{item.sourceId} · {item.confidence ?? "置信度未知"}</footer></blockquote>) : <p className="text-sm text-muted-foreground">暂无可定位原文</p>}</div>
      <div data-testid="research-conflict-view" className="space-y-2">{runtime.conflicts?.length ? runtime.conflicts.map((item) => <div key={item.id} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{item.status === "open" ? "待解决冲突" : "已解决冲突"} · {item.sourceIds.join(" ↔ ")}</div>) : <p className="text-sm text-muted-foreground">没有检测到证据冲突</p>}</div>
    </CardContent></Card>
  </section>;
}
