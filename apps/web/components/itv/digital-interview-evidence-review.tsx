"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";

export function DigitalInterviewEvidenceReview({ view, pending, onReview }: { readonly view: DigitalInterviewWorkflowView;
  readonly pending?: boolean; readonly onReview?: (status: "approved" | "changes_requested", note: string | null) => void }) {
  const [note, setNote] = React.useState(view.reportReview?.note ?? "");
  const blocked = !view.researchBrief || view.quality.evidenceCoverage.some((cell) => cell.status === "missing");
  return <section data-testid="itv-evidence-review" className="mt-5 rounded-xl border border-border bg-card p-5"><header><p className="text-xs font-medium text-primary">证据与复核</p><h3 className="mt-1 font-semibold">目标 × 专家证据覆盖</h3>
    <p className="mt-1 text-sm text-muted-foreground">所有结论应能回到具体专家、问题与回答；缺口不会被自动包装成确定结论。</p></header>
    {view.quality.evidenceCoverage.length === 0 ? <div data-testid="itv-evidence-review-blocked" className="mt-4 rounded-lg border border-dashed border-warning/40 bg-warning/5 p-4 text-sm"><p className="font-medium">尚无可展示的目标与专家证据覆盖</p><p className="mt-1 text-muted-foreground">报告可以阅读，但在补齐学习目标、专家回答和可追溯发现前不能批准。</p></div> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">目标</th><th className="p-2">专家</th><th className="p-2">状态</th><th className="p-2">回答 / 发现 / 反例</th></tr></thead><tbody>{view.quality.evidenceCoverage.map((cell) => { const Icon = cell.status === "supported" ? CheckCircle2 : cell.status === "missing" ? XCircle : CircleAlert; return <tr key={`${cell.goalId}-${cell.expertId}`} className="border-t border-border"><td className="p-2">{cell.goalId}</td><td className="p-2">{cell.expertId}</td><td className="p-2"><span className="inline-flex items-center gap-1"><Icon className="size-4" aria-hidden />{cell.status}</span></td><td className="p-2">{cell.answerCount} / {cell.findingCount} / {cell.counterexampleCount}</td></tr>; })}</tbody></table></div>}
    <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">数字专家内容为探索性模拟，不替代真实用户证据；关键决策仍需真实访谈验证。</p>
    <div className="mt-4 border-t border-border pt-4"><p className="text-sm font-medium">人工复核：{view.reportReview?.status ?? "pending"}</p><label className="mt-3 grid gap-2 text-sm">复核备注<textarea className="rounded-lg border border-input bg-background px-3 py-2" rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>{blocked && <p className="mt-2 text-sm text-destructive">存在缺失证据或旧版报告，当前不能批准。</p>}<div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={pending} onClick={() => onReview?.("changes_requested", note.trim() || null)}>要求修改</Button><Button variant="primary" disabled={pending || blocked} onClick={() => onReview?.("approved", note.trim() || null)}>批准报告</Button></div></div>
  </section>;
}
