import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Quality = NonNullable<GuidedResearchRuntime["qualityScore"]>;
type Readiness = NonNullable<GuidedResearchRuntime["publicationReadiness"]>;
export function researchCompletionLabel(completed: boolean, readiness: GuidedResearchRuntime["publicationReadiness"]): string {
  if (!completed) return "";
  if (!readiness) return "质量待评估";
  return readiness.status === "limited" ? "带限制完成" : "已完成";
}
export function researchLimitations(completed: boolean, readiness: GuidedResearchRuntime["publicationReadiness"]): string | undefined {
  if (!completed) return undefined;
  if (!readiness) return "旧版报告尚未经过发布质量门，结论与引用需要重新核验。";
  return readiness.status === "limited" ? [...readiness.blockers, ...readiness.warnings].join("；") : undefined;
}
const labels: Array<[keyof Pick<Quality, "citationCoverage" | "authority" | "recency" | "crossValidation">, string]> = [
  ["citationCoverage", "引用覆盖"], ["authority", "来源权威"], ["recency", "时效性"], ["crossValidation", "交叉验证"],
];
export function GuidedResearchReadiness({ quality, readiness }: { quality: Quality; readiness: Readiness }) {
  return <Card className={readiness.status === "limited" ? "border-destructive/40" : "border-border"}>
    <CardHeader><CardTitle className="flex items-center justify-between gap-3 text-base"><span>发布质量门</span><span data-testid="research-publication-readiness" className="text-sm">{readiness.status === "ready" ? "可发布" : "带限制完成"}</span></CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <dl data-testid="research-quality-score" className="grid grid-cols-2 gap-2 md:grid-cols-4">{labels.map(([key, label]) => <div key={key} className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold">{quality[key] === null ? "暂无数据" : `${quality[key]}%`}</dd></div>)}</dl>
      {readiness.blockers.length > 0 && <ul className="list-disc pl-5 text-sm text-destructive">{readiness.blockers.map((item) => <li key={item}>{item}</li>)}</ul>}
      {readiness.warnings.length > 0 && <ul className="list-disc pl-5 text-sm text-muted-foreground">{readiness.warnings.map((item) => <li key={item}>{item}</li>)}</ul>}
      {quality.explanations.length > 0 && <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">查看评分口径</summary><ul className="mt-2 list-disc pl-5">{quality.explanations.map((item) => <li key={item}>{item}</li>)}</ul></details>}
    </CardContent>
  </Card>;
}
