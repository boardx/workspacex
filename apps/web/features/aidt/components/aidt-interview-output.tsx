"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { printResearchPdf } from "@/lib/research-report-export";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { getAidtInterviewFinding, isAidtInterviewConfirmed, readAidtInterviews, readAidtInterviewTranscript, readAidtInterviewMaterials } from "../lib/aidt-interviews";
import { AidtInterviewGuideExport } from "./aidt-interview-guide-export";

export function AidtInterviewOutput({ projectId, entityId, draft }: { projectId: string; entityId: string; draft: AidtUiStageDraft }) {
  const interview = readAidtInterviews(draft.fields).find(item => item.id === entityId);
  const printable = React.useRef<HTMLElement>(null);
  const live = React.useRef(draft);
  live.current = draft;
  const [error, setError] = React.useState("");
  if (!interview) return <p role="status">找不到此访谈的产物。</p>;
  const finding = getAidtInterviewFinding(draft, interview);
  const transcript = readAidtInterviewTranscript(draft.fields, entityId);
  const confirmed = Boolean(interview.consent?.notes) && isAidtInterviewConfirmed(draft.fields, entityId);
  const material = readAidtInterviewMaterials(draft.fields, entityId, projectId).find(item => item.key === transcript?.sourceKey);
  const hasFinding = interview.consent?.notes && !!(finding.headline || finding.context || finding.quote || draft.fields["interviewInterpretation:" + entityId]);
  const fields = [["标题来源", finding.headlineKind === "quote" ? "受访者原话" : "学生概括"], ["一句发现", finding.headline], ["具体情况", finding.context], ["受访者原话", finding.quote], ["学生的解释", draft.fields["interviewInterpretation:" + entityId]], ["材料定位", material ? [material.reference.name, transcript?.locator].filter(Boolean).join(" · ") : ""], ["授权照片", interview.consent?.photos ? finding.photoRef : ""]];
  return <section aria-label="本次访谈产物" data-testid="aidt-interview-output" className="space-y-5">
    <h3 className="text-16 font-semibold">{interview.code} · 访谈产物</h3>
    <section data-testid="aidt-interview-question-list" className="space-y-2"><h4 className="font-medium">访谈问题清单</h4>
      <p className="text-12 text-muted-foreground">{interview.guideConfirmed ? "学生已确认" : "草稿"}</p>
      {interview.adopted ? <ol className="list-decimal space-y-2 pl-5 text-13">{interview.adopted.split(/\n+/).filter(Boolean).map((item, index) => <li key={index}>{item}</li>)}</ol> : <p className="text-13 text-muted-foreground">尚无问题清单。</p>}
      {interview.guideConfirmed && <AidtInterviewGuideExport scopeKey={entityId} guide={interview.original} adoptedGuide={[interview.code, interview.topic, interview.adopted].filter(Boolean).join("\n\n")} />}
    </section>
    <section data-testid="aidt-interview-finding" className="space-y-2 border-t border-border pt-4">
      <article ref={printable}><h4 className="font-medium">{interview.code} · 人物发现卡</h4>{hasFinding ? <>
        <p className="text-12 text-muted-foreground">{confirmed ? "已核对" : "草稿"}</p>
        <dl>{fields.filter(([, value]) => value).map(([label, value]) => <div key={label} className="mt-3"><dt className="text-12 text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap text-13">{value}</dd></div>)}</dl>
      </> : <p className="text-13 text-muted-foreground">尚无访谈发现。</p>}</article>
      {confirmed && <Button variant="outline" size="sm" onClick={async () => {
        const element = printable.current;
        if (!element) return;
        setError("");
        try { await printResearchPdf(element, interview.code + " 人物发现卡", { isCurrent: () => printable.current === element && draft === live.current }); }
        catch { setError("打印预览未能打开，请重试。"); }
      }}>导出人物发现卡 PDF</Button>}
      {error && <p role="alert">{error}</p>}
    </section>
  </section>;
}
