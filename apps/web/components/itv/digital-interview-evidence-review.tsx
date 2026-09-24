"use client";

import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";

export function DigitalInterviewEvidenceReview({ view }: { readonly view: DigitalInterviewWorkflowView }) {
  return <section data-testid="itv-evidence-review" className="mt-5 rounded-xl border border-border p-4"><h3 className="font-semibold">目标 × 专家证据覆盖</h3>
    <p className="mt-1 text-sm text-muted-foreground">所有结论应能回到具体专家、问题与回答；缺口不会被自动包装成确定结论。</p>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">目标</th><th className="p-2">专家</th><th className="p-2">状态</th><th className="p-2">回答 / 发现 / 反例</th></tr></thead><tbody>{view.quality.evidenceCoverage.map((cell) => <tr key={`${cell.goalId}-${cell.expertId}`} className="border-t border-border"><td className="p-2">{cell.goalId}</td><td className="p-2">{cell.expertId}</td><td className="p-2">{cell.status}</td><td className="p-2">{cell.answerCount} / {cell.findingCount} / {cell.counterexampleCount}</td></tr>)}</tbody></table></div>
    <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">数字专家内容为探索性模拟，不替代真实用户证据；关键决策仍需真实访谈验证。</p>
  </section>;
}
