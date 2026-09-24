import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Quality = NonNullable<GuidedResearchRuntime["qualityScore"]>;
type Readiness = NonNullable<GuidedResearchRuntime["publicationReadiness"]>;
const labels: Array<[keyof Pick<Quality, "citationCoverage" | "authority" | "recency" | "crossValidation">, string]> = [
  ["citationCoverage", "引用覆盖"], ["authority", "来源权威"], ["recency", "时效性"], ["crossValidation", "交叉验证"],
];
export function GuidedResearchReadiness({ quality, readiness }: { quality: Quality; readiness: Readiness }) {
  return <Card className={readiness.status === "limited" ? "border-amber-300" : "border-emerald-300"}>
    <CardHeader><CardTitle className="flex items-center justify-between gap-3 text-base"><span>发布质量门</span><span data-testid="research-publication-readiness" className="text-sm">{readiness.status === "ready" ? "可发布" : "带限制完成"}</span></CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <dl data-testid="research-quality-score" className="grid grid-cols-2 gap-2 md:grid-cols-4">{labels.map(([key, label]) => <div key={key} className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold">{quality[key] === null ? "暂无数据" : `${quality[key]}%`}</dd></div>)}</dl>
      {readiness.blockers.length > 0 && <ul className="list-disc pl-5 text-sm text-amber-900">{readiness.blockers.map((item) => <li key={item}>{item}</li>)}</ul>}
      {readiness.warnings.length > 0 && <ul className="list-disc pl-5 text-sm text-muted-foreground">{readiness.warnings.map((item) => <li key={item}>{item}</li>)}</ul>}
      {quality.explanations.length > 0 && <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">查看评分口径</summary><ul className="mt-2 list-disc pl-5">{quality.explanations.map((item) => <li key={item}>{item}</li>)}</ul></details>}
    </CardContent>
  </Card>;
}
