"use client";

import { aidtInterviewTitle } from "@repo/contracts/aidt-stages";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { printResearchPdf } from "@/lib/research-report-export";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { getAidtInterviewFinding, hasAidtInterviewFinding, isAidtInterviewConfirmed, readAidtInterviews, readAidtInterviewTranscript, readAidtInterviewMaterials } from "../lib/aidt-interviews";
import { AidtInterviewGuideExport } from "./aidt-interview-guide-export";

import { AidtResearchMaterialPreview } from "./aidt-research-material";

export function AidtInterviewOutput({ projectId, entityId, draft, frozenSourceId }: { projectId: string; entityId: string; draft: AidtUiStageDraft; frozenSourceId?: string | null }) {
  const interview = readAidtInterviews(draft.fields).find(item => item.id === entityId);
  const printable = React.useRef<HTMLElement>(null);
  const live = React.useRef(draft);
  live.current = draft;
  const [showSource, setShowSource] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  if (!interview) return <p role="status">找不到此访谈的产物。</p>;
  const finding = getAidtInterviewFinding(draft, interview);
  const transcript = readAidtInterviewTranscript(draft.fields, entityId);
  const confirmed = Boolean(interview.consent?.notes) && isAidtInterviewConfirmed(draft.fields, entityId);
  const material = readAidtInterviewMaterials(draft.fields, entityId, projectId).find(item => item.key === transcript?.sourceKey);
  const reviewedMaterial = transcript?.checked && transcript.text.trim() && transcript.locator.trim() && interview.consent?.notes
    && material && !material.reference.mime.startsWith("image/") && (!material.reference.mime.startsWith("audio/") || interview.consent.audio) ? material : null;
  const quote = reviewedMaterial && transcript?.text.includes(finding.quote) ? finding.quote : "";
  const hasFinding = hasAidtInterviewFinding(draft, interview);
  const fields = [["标题来源", finding.headlineKind === "quote" ? "受访者原话" : "学生概括"], ["一句发现", finding.headline], ["具体情况", finding.context], ["受访者原话", quote], ["学生的解释", draft.fields["interviewInterpretation:" + entityId]], ["材料定位", reviewedMaterial ? [reviewedMaterial.reference.name, transcript?.locator].filter(Boolean).join(" · ") : ""], ["授权照片", interview.consent?.photos ? finding.photoRef : ""]];
  const missing = [!finding.headline.trim() && "你在 Chat 中写下的一句发现", !finding.context.trim() && "观察发生的具体情况", !reviewedMaterial && "已校对的摘录及其位置"].filter(Boolean);
  const frozenSource = material && material.reference.artifactId === frozenSourceId && interview.consent?.notes
    && (!material.reference.mime.startsWith("audio/") || interview.consent.audio) && (!material.reference.mime.startsWith("image/") || interview.consent.photos) ? material.reference : null;
  return <section aria-label="本次访谈产物" data-testid="aidt-interview-output" className="space-y-5">
    <h3 className="text-16 font-semibold">{aidtInterviewTitle(interview.code, interview.displayName)} · 访谈产物</h3>
    {frozenSourceId && (frozenSource ? <AidtResearchMaterialPreview projectId={projectId} reference={frozenSource} quote={quote} /> : <p role="alert">此访谈版本无法查看该原件。</p>)}
    <section data-testid="aidt-interview-question-list" className="space-y-2"><h4 className="font-medium">访谈问题清单</h4>
      <p className="text-12 text-muted-foreground">{interview.guideConfirmed ? "学生已确认" : "草稿"}</p>
      {interview.adopted ? <ol className="list-decimal space-y-2 pl-5 text-13">{interview.adopted.split(/\n+/).filter(Boolean).map((item, index) => <li key={index}>{item}</li>)}</ol> : <p className="text-13 text-muted-foreground">尚无问题清单。</p>}
      {interview.guideConfirmed && <AidtInterviewGuideExport scopeKey={entityId} guide={interview.original} adoptedGuide={[interview.code, interview.topic, interview.adopted].filter(Boolean).join("\n\n")} />}
    </section>
    <section data-testid="aidt-interview-finding" className="space-y-2 border-t border-border pt-4">
      <article ref={printable}><h4 className="font-medium">{interview.code} · 人物发现卡</h4>{hasFinding ? <>
        <p className="text-12 text-muted-foreground">{confirmed ? "已核对" : "草稿"}</p>
        {finding.headline && <p className="whitespace-pre-wrap break-words text-13">{finding.headline}</p>}
        {!confirmed && missing.length > 0 && <p className="text-12 text-muted-foreground">待补充：{missing.join("、")}</p>}
        <details className="mt-2 text-13"><summary className="cursor-pointer">发现详情与来源</summary>
          <dl>{fields.filter(([label, value]) => label !== "一句发现" && value).map(([label, value]) => <div key={label} className="mt-2"><dt className="text-12 text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>
        </details>
      </> : <p className="text-13 text-muted-foreground">尚无访谈发现。{reviewedMaterial ? "摘录已校对，请在 Chat 中说说你观察到了什么。" : ""}</p>}</article>
      {hasFinding && reviewedMaterial && !frozenSourceId && <>
        <Button variant="ghost" size="sm" aria-expanded={showSource === reviewedMaterial.key}
          onClick={() => setShowSource(showSource === reviewedMaterial.key ? null : reviewedMaterial.key)}>
          {showSource === reviewedMaterial.key ? "收起访谈原件" : "查看访谈原件"}
        </Button>
        {showSource === reviewedMaterial.key && <AidtResearchMaterialPreview projectId={projectId} reference={reviewedMaterial.reference} quote={quote} />}
      </>}
      {confirmed && <Button variant="outline" size="sm" onClick={async () => {
        const element = printable.current;
        if (!element) return;
        setError("");
        const document = element.cloneNode(true) as HTMLElement;
        document.querySelectorAll("details").forEach(detail => { detail.open = true; });
        try { await printResearchPdf(document, interview.code + " 人物发现卡", { isCurrent: () => printable.current === element && draft === live.current }); }
        catch { setError("打印预览未能打开，请重试。"); }
      }}>导出人物发现卡 PDF</Button>}
      {error && <p role="alert">{error}</p>}
    </section>
  </section>;
}
