"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { previewAidtText } from "../lib/aidt-print-preview";
import { isAidtProblemControlText } from "@repo/contracts/aidt-stages";
import { FileText, Printer } from "lucide-react";
import { readAidtProblemDirections } from "../lib/aidt-problem-directions";
import { PROBLEM_SOURCE_OPTIONS, readProblemSources, formatAidtProblemReflectionMarkdown } from "../lib/aidt-problem-reflection";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

/** Display only the persisted, scoped stage fields. Teaching and confirmation live in Chat. */
export function AidtProblemWorkspace({ draft, revision, confirmed, projectId }: {
  draft: AidtUiStageDraft; revision?: number; confirmed: boolean; projectId?: string;
}) {
  const { fields } = draft;
  const session = useOptionalSession()?.session;
  const sources = readProblemSources(fields.problemSources).selected;
  const directions = readAidtProblemDirections(fields.problemDirections);
  const original = fields.initial && !isAidtProblemControlText(fields.initial) ? fields.initial : undefined;
  const rows = [
    ["研究价值", fields.whyWorthStudying],
    ["问题来源", PROBLEM_SOURCE_OPTIONS.filter(source => sources.includes(source.value)).map(source => source.label).join("、")],
    ["来源依据", fields.sourceDetails],
    ["已知情况", fields.known],
    ["待核实", fields.sourceUncertainty],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));
  const selected = directions.find(direction => direction.id === fields.problemDirectionId);
  const theme = fields.rewrittenTheme?.trim() || original;
  const populated = Boolean(theme || rows.length || directions.length);
  const printable = populated && revision && revision > 0 && projectId && session?.userId
    ? ["# 工作坊主题命题", `${confirmed ? "方向已确认" : "已保存草稿"} · V${revision}`, "", ...formatAidtProblemReflectionMarkdown(draft)].join("\n") : "";
  const scope = JSON.stringify([session?.currentOrgId, session?.userId, projectId, revision, printable]);
  const current = React.useRef(scope); current.current = scope;
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <section aria-label="工作坊问题产物" data-testid="aidt-stage-output" className="space-y-4">
    <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-16 font-semibold tracking-tight"><FileText aria-hidden className="size-4" />工作坊主题命题</h2>
      {printable && <Button type="button" size="sm" variant="ghost" onClick={() => { void previewAidtText(printable, `工作坊主题命题 · V${revision}`, { isCurrent: () => mounted.current && current.current === scope, defaultPaper: "A4" }); }}><Printer aria-hidden className="mr-1 size-3.5" />打印</Button>}
    </div>
    {populated ? <>
      <p className="text-12 text-muted-foreground">{confirmed ? "方向已确认" : "草稿"}{revision && ` · V${revision}`}</p>
      {theme && <p className="whitespace-pre-wrap break-words text-16 font-semibold">{theme}</p>}
      {selected && <p className="text-13">本轮方向 · {selected.title}</p>}
      {(rows.length > 0 || (original && original !== theme)) && <details className="text-13">
        <summary className="cursor-pointer font-medium">选题反思</summary>
        <dl className="mt-2 space-y-2">
          {original && original !== theme && <div><dt className="text-12 text-muted-foreground">原始命题</dt><dd className="whitespace-pre-wrap break-words">{original}</dd></div>}
          {rows.map(([label, value]) => <div key={label}><dt className="text-12 text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}
        </dl>
      </details>}
      {directions.length > 0 && <details className="text-12"><summary>候选研究方向</summary>
        <ul className="mt-2 space-y-1">{directions.map(direction => <li key={direction.id}>
          {direction.title} · {direction.source === "ai" ? "AI 建议" : "小组讨论"}{direction.id === fields.problemDirectionId && " · 已选"}
        </li>)}</ul></details>}
    </> : <p role="status" className="text-13 text-muted-foreground">尚无工作坊问题草稿。</p>}
  </section>;
}
