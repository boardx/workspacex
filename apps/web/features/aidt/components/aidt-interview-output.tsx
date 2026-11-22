"use client";

import { aidtInterviewTitle } from "@repo/contracts/aidt-stages";
import { AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX } from "@repo/contracts/aidt-test-research";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { previewAidtPdf } from "../lib/aidt-print-preview";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { getAidtInterviewFinding, hasAidtInterviewFinding, isAidtInterviewConfirmed, isAidtObservation, readAidtInterviews, readAidtInterviewTranscript, readAidtInterviewMaterials, readAidtInterviewPhoto } from "../lib/aidt-interviews";
import { AidtInterviewGuideExport } from "./aidt-interview-guide-export";

import type { AidtImageAttachmentState } from "./aidt-image-attachment-picker";
import { AidtResearchMaterialPreview } from "./aidt-research-material";

export function AidtInterviewOutput({ projectId, entityId, draft, frozenSourceId, photoAllowed = true }: {
  projectId: string; entityId: string; draft: AidtUiStageDraft; frozenSourceId?: string | null; photoAllowed?: boolean;
}) {
  const interview = readAidtInterviews(draft.fields).find(item => item.id === entityId);
  const printable = React.useRef<HTMLElement>(null);
  const live = React.useRef({ draft, projectId, entityId, photoAllowed });
  live.current = { draft, projectId, entityId, photoAllowed };
  const [image, setImage] = React.useState<{ key: string; state: AidtImageAttachmentState } | null>(null);
  const [showSource, setShowSource] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  if (!interview) return <p role="status">找不到此访谈的产物。</p>;
  const observation = isAidtObservation(interview);
  const synthetic = Object.hasOwn(draft.fields, AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + entityId);
  const subject = observation ? "观察" : "访谈";
  const finding = getAidtInterviewFinding(draft, interview);
  const transcript = readAidtInterviewTranscript(draft.fields, entityId);
  const confirmed = Boolean(interview.consent?.notes) && isAidtInterviewConfirmed(draft.fields, entityId);
  const material = readAidtInterviewMaterials(draft.fields, entityId, projectId).find(item => item.key === transcript?.sourceKey);
  const reviewedMaterial = transcript?.checked && transcript.text.trim() && transcript.locator.trim() && interview.consent?.notes
    && material && !material.reference.mime.startsWith("image/") && (!material.reference.mime.startsWith("audio/") || interview.consent.audio) ? material : null;
  const quote = !observation && finding.quote.trim() && reviewedMaterial && transcript?.text.includes(finding.quote.trim()) ? finding.quote.trim() : "";
  const summary = observation || finding.headlineKind === "student-summary" ? finding.headline.trim() : "";
  const headline = quote || summary;
  const hasFinding = Boolean(interview.consent?.notes) && hasAidtInterviewFinding(draft, interview);
  const photo = photoAllowed ? readAidtInterviewPhoto(draft, interview, projectId) : undefined;
  const photoKey = photo ? JSON.stringify([projectId, entityId, photo.reference]) : "";
  const photoState = image?.key === photoKey ? image.state : undefined;
  const onImageState = (state: AidtImageAttachmentState) => setImage(previous =>
    previous?.key === photoKey && previous.state.src === state.src && previous.state.failed === state.failed
      ? previous : { key: photoKey, state },
  );
  const interpretation = draft.fields["interviewInterpretation:" + entityId];
  const frozenPhoto = Boolean(frozenSourceId && photo?.reference.artifactId === frozenSourceId);
  const frozenSource = material && material.reference.artifactId === frozenSourceId && interview.consent?.notes
    && !material.reference.mime.startsWith("image/") && (!material.reference.mime.startsWith("audio/") || interview.consent.audio) ? material.reference : null;
  return <section aria-label={`本次${subject}产物`} data-testid="aidt-interview-output" className="space-y-5">
    <h3 className="text-16 font-semibold">{observation ? interview.displayName || interview.code : aidtInterviewTitle(interview.code, interview.displayName)} · {subject}产物</h3>
    {frozenSourceId && !frozenPhoto && (frozenSource ? <AidtResearchMaterialPreview projectId={projectId} reference={frozenSource} quote={quote} /> : <p role="alert">此访谈版本无法查看该原件。</p>)}
    <section data-testid="aidt-interview-question-list" className="space-y-2"><h4 className="font-medium">{observation ? "观察计划与关注点" : "访谈问题清单"}</h4>
      <p className="text-12 text-muted-foreground">{interview.guideConfirmed ? "学生已确认" : "草稿"}</p>
      {interview.adopted ? <ol className="list-decimal space-y-2 pl-5 text-13">{interview.adopted.split(/\n+/).filter(Boolean).map((item, index) => <li key={index}>{item}</li>)}</ol> : <p className="text-13 text-muted-foreground">{observation ? "尚无已采纳的观察计划。" : "尚无问题清单。"}</p>}
      {interview.guideConfirmed && <AidtInterviewGuideExport kind={observation ? "observation" : "interview"} scopeKey={entityId} guide={interview.original} adoptedGuide={[interview.code, interview.topic, interview.adopted].filter(Boolean).join("\n\n")} />}
    </section>
    <section data-testid="aidt-interview-finding" className="space-y-2 border-t border-border pt-4">
      <article ref={printable} className="space-y-3 rounded-lg border border-border bg-card p-3">
        {synthetic && <p className="text-12 text-muted-foreground">合成音频软件测试 · 非真人访谈，内容不作为真实用户证据。</p>}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="font-medium">{interview.code} · {observation ? "观察发现卡" : "人物发现卡"}</h4>
          {hasFinding && <p className="text-12 text-muted-foreground">{confirmed ? "已核对" : "草稿"}</p>}
        </div>
        {photo ? <figure className="rounded-md bg-muted/30 p-2">
          <AidtResearchMaterialPreview projectId={projectId} reference={photo.reference}
            alt={`${interview.code} 的授权${subject}照片`} onImageState={onImageState} />
        </figure> : <p className="rounded-md border border-dashed border-border px-3 py-2 text-12 text-muted-foreground">
          暂无授权照片。
        </p>}
        {hasFinding ? <>
          {headline && <div className="space-y-1">
            <p className="text-12 text-muted-foreground">{quote ? synthetic ? "合成转写摘录" : "受访者原话" : "学生概括"}</p>
            {quote
              ? <blockquote className="break-words border-l-2 border-border pl-3 text-16 font-medium">“{quote}”</blockquote>
              : <p className="whitespace-pre-wrap break-words text-16 font-medium">{summary}</p>}
          </div>}
          {!observation && !quote && <p className="text-12 text-muted-foreground">{synthetic ? "暂无已校对的合成转写摘录。" : "暂无已校对的受访者原话。"}</p>}
          <div className="space-y-1"><h5 className="text-13 font-medium">具体情况</h5>
            <p className="whitespace-pre-wrap break-words text-13">{finding.context.trim() || "待记录具体情况。"}</p>
          </div>
          <details className="text-13">
            <summary className="cursor-pointer">发现详情与来源</summary>
            <dl>
              {quote && summary && summary !== quote && <div className="mt-2">
                <dt className="text-12 text-muted-foreground">学生概括</dt><dd className="whitespace-pre-wrap break-words">{summary}</dd>
              </div>}
              {interpretation && <div className="mt-2">
                <dt className="text-12 text-muted-foreground">学生的解释</dt><dd className="whitespace-pre-wrap break-words">{interpretation}</dd>
              </div>}
              <div className="mt-2">
                <dt className="text-12 text-muted-foreground">材料定位</dt>
                <dd className="break-words">{reviewedMaterial ? [reviewedMaterial.reference.name, transcript?.locator].filter(Boolean).join(" · ") : "待校对原件及位置。"}</dd>
              </div>
            </dl>
          </details>
        </> : <p className="text-13 text-muted-foreground">尚无{subject}发现。{reviewedMaterial ? "摘录已校对，请在 Chat 中说说你观察到了什么。" : ""}</p>}
      </article>
      {hasFinding && reviewedMaterial && !frozenSourceId && <>
        <Button variant="ghost" size="sm" aria-expanded={showSource === reviewedMaterial.key}
          onClick={() => setShowSource(showSource === reviewedMaterial.key ? null : reviewedMaterial.key)}>
          {showSource === reviewedMaterial.key ? `收起${subject}原件` : `查看${subject}原件`}
        </Button>
        {showSource === reviewedMaterial.key && <AidtResearchMaterialPreview projectId={projectId} reference={reviewedMaterial.reference} quote={quote} />}
      </>}
      {confirmed && <Button variant="outline" size="sm" disabled={Boolean(photo) && !photoState?.src && !photoState?.failed} onClick={async () => {
        const element = printable.current;
        if (!element) return;
        setError("");
        const document = element.cloneNode(true) as HTMLElement;
        document.querySelectorAll("details").forEach(detail => { detail.open = true; });
        const photoPreview = document.querySelector("figure");
        if (photoPreview && photoState?.failed) photoPreview.textContent = "授权照片暂不可读取。";
        photoPreview?.querySelector("details")?.remove();
        photoPreview?.querySelector("a[download]")?.remove();
        const printedPhoto = document.querySelector<HTMLImageElement>("figure img");
        if (printedPhoto) printedPhoto.style.cssText = "max-width:100%;max-height:70mm;object-fit:contain";
        try { await previewAidtPdf(document, interview.code + (observation ? " 观察发现卡" : " 人物发现卡"), {
          isCurrent: () => printable.current === element && draft === live.current.draft
            && projectId === live.current.projectId && entityId === live.current.entityId && photoAllowed === live.current.photoAllowed,
        }); }
        catch { setError("打印预览未能打开，请重试。"); }
      }}>{observation ? "导出观察发现卡 PDF" : "导出人物发现卡 PDF"}</Button>}
      {error && <p role="alert">{error}</p>}
    </section>
  </section>;
}
