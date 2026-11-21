"use client";

import { FileText } from "lucide-react";
import { readAidtProblemDirections } from "../lib/aidt-problem-directions";
import { PROBLEM_SOURCE_OPTIONS, readProblemSources } from "../lib/aidt-problem-reflection";
import { AIDT_OUTPUTS, type AidtUiStageDraft } from "../lib/aidt-ui-drafts";

/** Display only the persisted, scoped stage fields. Teaching and confirmation live in Chat. */
export function AidtProblemWorkspace({ draft, revision, confirmed }: {
  draft: AidtUiStageDraft; revision?: number; confirmed: boolean;
}) {
  const { fields } = draft;
  const sources = readProblemSources(fields.problemSources).selected;
  const directions = readAidtProblemDirections(fields.problemDirections);
  const rows = [
    ["原始命题", fields.initial],
    ["研究价值", fields.whyWorthStudying],
    ["问题来源", PROBLEM_SOURCE_OPTIONS.filter(source => sources.includes(source.value)).map(source => source.label).join("、")],
    ["来源依据", fields.sourceDetails],
    ["已知情况", fields.known],
    ["待核实", fields.sourceUncertainty],
    ["下一步行动", fields.nextAction],
    ...AIDT_OUTPUTS[1]!.fields.filter(field => !["initial", "rewrittenTheme"].includes(field.id)).map(field => [field.label, fields[field.id]]),
  ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));
  const populated = rows.length > 0 || directions.length > 0 || Boolean(fields.rewrittenTheme);
  return <section aria-label="工作坊问题产物" data-testid="aidt-stage-output" className="space-y-4">
    <h2 className="flex items-center gap-2 text-16 font-semibold tracking-tight"><FileText aria-hidden className="size-4" />工作坊主题命题</h2>
    {populated ? <>
      <p className="text-12 text-muted-foreground">{confirmed ? "方向已确认" : "草稿"}{revision && ` · V${revision}`}</p>
      {fields.rewrittenTheme && <p className="whitespace-pre-wrap break-words text-16 font-semibold">{fields.rewrittenTheme}</p>}
      <dl className="space-y-3">{rows.map(([label, value]) => <div key={label}>
        <dt className="text-12 text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words text-13">{value}</dd>
      </div>)}</dl>
      {directions.length > 0 && <details className="text-12"><summary>候选研究方向</summary>
        <ul className="mt-2 space-y-1">{directions.map(direction => <li key={direction.id}>
          {direction.title} · {direction.source === "ai" ? "AI 建议" : "小组讨论"}{direction.id === fields.problemDirectionId && " · 已选"}
        </li>)}</ul></details>}
    </> : <p role="status" className="text-13 text-muted-foreground">尚无工作坊问题草稿。</p>}
  </section>;
}
