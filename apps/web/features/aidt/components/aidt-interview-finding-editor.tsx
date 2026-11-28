"use client";

import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX } from "@repo/contracts/aidt-test-research";
import { interviewDiscoveryOrigin } from "../lib/aidt-interview-discovery";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import type { AidtUiStageDraft, AidtDiscoveryCardDraft } from "../lib/aidt-ui-drafts";
import {
  aidtInterviewFindingMissing, aidtInterviewMaterialKey, confirmAidtInterviewFinding,
  getAidtInterviewFinding, isAidtInterviewArchived, isAidtInterviewConfirmed, isAidtObservation,
  readAidtInterviewMaterials, readAidtInterviewPhoto, readAidtInterviews,
  setAidtInterviewPhoto, writeAidtInterview, writeAidtInterviewFinding,
  writeAidtInterviewMaterial, type AidtInterview,
} from "../lib/aidt-interviews";
import { AidtResearchMaterialControl, AidtResearchMaterialPreview } from "./aidt-research-material";

type Props = {
  projectId: string;
  interview: AidtInterview;
  draft: AidtUiStageDraft;
  readOnly: boolean;
  manualGuideHref?: string;
  update: (mutate: (previous: AidtUiStageDraft) => AidtUiStageDraft) => void;
};

/** One person, one photo, one finding and its concrete situation. Evidence stays secondary. */
export function AidtInterviewFindingEditor({ projectId, interview, draft, readOnly, update, manualGuideHref }: Props) {
  const [showMissing, setShowMissing] = useState(false);
  const { id, code } = interview;
  const observation = isAidtObservation(interview);
  const synthetic = Object.hasOwn(draft.fields, AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + id);
  const finding = getAidtInterviewFinding(draft, interview);
  const photo = readAidtInterviewPhoto(draft, interview, projectId);
  const materials = readAidtInterviewMaterials(draft.fields, id, projectId);
  const editable = !readOnly && !!interview.consent?.notes;
  const missing = aidtInterviewFindingMissing(draft, interview, projectId);
  const confirmed = isAidtInterviewConfirmed(draft.fields, id);
  const aiOrigin = interviewDiscoveryOrigin(draft, id, projectId);
  const interpretationKey = `interviewInterpretation:${id}`;
  const fieldId = `aidt-finding-${id}`;
  const patch = (values: Partial<AidtDiscoveryCardDraft>) => {
    if (!editable) return;
    update(old => {
      const current = readAidtInterviews(old.fields).find(item => item.id === id);
      return current?.consent?.notes && !isAidtInterviewArchived(old.fields, id)
        ? writeAidtInterviewFinding(old, current, values) : old;
    });
  };

  if (!interview.consent?.notes) return <section aria-label={observation ? "观察发现卡" : "人物发现卡"} data-testid="aidt-interview-finding-editor" className="rounded-xl border border-border bg-card p-4 sm:p-5">
    <p className="text-13">当前文字材料未获使用授权，发现正文与来源已隐藏。</p>
    {synthetic && <p className="mt-2 text-12 text-muted-foreground">合成音频软件测试 · 非真人访谈，内容不作为真实用户证据。</p>}
  </section>;

  return <section aria-label={observation ? "观察发现卡" : "人物发现卡"} className="space-y-5 rounded-xl border border-border bg-card p-4 sm:p-5" data-testid="aidt-interview-finding-editor">
    {synthetic && <p className="text-12 text-muted-foreground">合成音频软件测试 · 非真人访谈，内容不作为真实用户证据。</p>}
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-12 text-muted-foreground">{code}</p><h5 className="mt-1 text-16 font-semibold">{observation ? "观察发现卡" : "人物发现卡"}</h5></div>
      {confirmed && <span className="text-12 text-muted-foreground">已核对</span>}
    </div>

    <div className="space-y-3" aria-label="发现卡照片">
      {photo ? <AidtResearchMaterialPreview projectId={projectId} reference={photo.reference} alt={`${code} 的授权${observation ? "观察现场" : "访谈"}照片`} compact />
        : <div className="flex min-h-24 items-center gap-3 rounded-lg bg-muted/40 p-4" data-testid="empty">
          <ImagePlus aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          <div><p className="text-13">添加一张现场照片</p><p className="mt-1 text-12 text-muted-foreground">照片可暂缺，不生成虚构人物。</p></div>
        </div>}
      <Checkbox checked={!!interview.consent?.photos} disabled={readOnly} label={observation ? "已获相应授权共享现场照片" : "已获受访者授权共享照片"} onChange={event => {
          const photos = event.currentTarget.checked;
          update(old => {
            const current = readAidtInterviews(old.fields).find(item => item.id === id);
            if (!current || isAidtInterviewArchived(old.fields, id)) return old;
            return writeAidtInterview(old, { ...current, consent: {
              notes: false, audio: false, ...current.consent, observedAt: new Date().toISOString(), photos,
            } });
          });
        }} />
      {interview.consent?.photos && <AidtResearchMaterialControl
        key={JSON.stringify([id, interview.consent.observedAt])}
        projectId={projectId} label={`${code}发现卡照片`} appearance="photo" imagesOnly onlyLocalMaterials
        readOnly={readOnly || Object.keys(draft.fields).length >= 95}
        value={photo?.reference} selectionScope={JSON.stringify([id, interview.consent.observedAt])}
        localMaterials={materials.map(item => item.reference)}
        onChange={reference => {
          if (readOnly) return;
          update(old => {
            const current = readAidtInterviews(old.fields).find(item => item.id === id);
            if (!current?.consent?.photos || isAidtInterviewArchived(old.fields, id) || reference && reference.projectId !== projectId) return old;
            if (!reference) return setAidtInterviewPhoto(old, id, "", projectId);
            const key = aidtInterviewMaterialKey(id, `${encodeURIComponent(reference.artifactId)}:${encodeURIComponent(reference.versionId)}`);
            return setAidtInterviewPhoto(writeAidtInterviewMaterial(old, id, key, JSON.stringify(reference)), id, key, projectId);
          });
        }} />}
    </div>

    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2"><Label htmlFor={fieldId + "-headline"}>一句发现</Label><span className="text-11 text-muted-foreground">{finding.headlineKind === "quote" ? synthetic ? "合成转写摘录 · 需核对" : "受访者原话 · 需核对" : aiOrigin ? "AI 归纳 · 学生已选择" : "学生概括"}</span></div>
      <Input id={fieldId + "-headline"} aria-label="一句发现" value={finding.headline} maxLength={500} disabled={!editable}
        placeholder={observation ? "这次观察中最值得保留的行为或现象是什么？" : "这位受访者最让你记住的发现是什么？"} onChange={event => patch({ headline: event.currentTarget.value })} />
    </div>
    <div className="space-y-2">
      <Label htmlFor={fieldId + "-context"}>具体情况</Label>
      <Textarea id={fieldId + "-context"} aria-label="具体情况" value={finding.context} maxLength={1700} disabled={!editable} rows={3}
        placeholder="记录当时的场景、经过和实际行为。" onChange={event => patch({ context: event.currentTarget.value })} />
    </div>

    <details className="border-t border-border pt-3 text-12" data-testid="aidt-finding-sources">
      <summary className="cursor-pointer rounded-md text-muted-foreground transition-colors hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{observation ? "观察依据与来源" : "原话与来源"}</summary>
      <div className="mt-4 space-y-4">
        {observation ? <p>观察发现使用学生概括；实际行为、情境与学生解释分别记录，不补写受访者原话。</p> : <><div className="space-y-2"><p>标题来源</p><Select aria-label="标题来源" value={finding.headlineKind} disabled={!editable}
          options={[{ value: "student-summary", label: "学生概括" }, { value: "quote", label: synthetic ? "合成转写摘录" : "受访者原话" }]}
          onValueChange={value => patch({ headlineKind: value === "quote" ? "quote" : "student-summary" })} /></div>
        <div className="space-y-2"><Label htmlFor={fieldId + "-quote"}>{synthetic ? "可定位的合成转写摘录" : "可定位的受访者原话"}</Label>
          <Textarea id={fieldId + "-quote"} value={finding.quote} maxLength={800} disabled={!editable} rows={2} onChange={event => patch({ quote: event.currentTarget.value })} /></div></>}
        <div className="space-y-2"><Label htmlFor={fieldId + "-interpretation"}>学生的解释</Label>
          <Textarea id={fieldId + "-interpretation"} value={draft.fields[interpretationKey] ?? ""} maxLength={1700} disabled={!editable} rows={2} onChange={event => {
            const interpretation = event.currentTarget.value;
            if (!editable) return;
            update(old => {
              const current = readAidtInterviews(old.fields).find(item => item.id === id);
              if (!current?.consent?.notes || isAidtInterviewArchived(old.fields, id)) return old;
              const next = writeAidtInterviewFinding(old, current, {});
              return { ...next, fields: { ...next.fields, [interpretationKey]: interpretation } };
            });
          }} /></div>
        <p className="break-words text-muted-foreground">{finding.sourceRef || "尚未关联已校对的原始材料。"} 在右侧「{observation ? "材料" : "录音与转录"}」中核对原件、摘录与位置。</p>
      </div>
    </details>
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" disabled={!editable || confirmed} aria-describedby={`${fieldId}-confirmation`} onClick={() => {
        setShowMissing(missing.length > 0);
        if (!missing.length) update(old => confirmAidtInterviewFinding(old, id, projectId));
      }}>{observation ? "确认观察发现卡" : "确认人物发现卡"}</Button>
      <p id={`${fieldId}-confirmation`} role="status" className="text-12 text-muted-foreground">{confirmed ? "已确认；后续修改会保留为新草稿。" : missing.length ? `还差 ${missing.length} 项 · 点击确认查看详情。` : "可确认并保存。"} </p>
    </div>
    {showMissing && !confirmed && missing.length > 0 && <div role="alert" className="mt-2 space-y-2 text-12">
      <ul className="list-disc space-y-1 pl-5">{missing.map(item => <li key={item}>{item}</li>)}</ul>
      {manualGuideHref && !interview.guideConfirmed && !interview.adopted.trim() && <a href={manualGuideHref} className="text-primary underline">
        {observation ? "前往手动录入观察关注点" : "前往手动录入访谈问题"}
      </a>}
    </div>}
  </section>;
}
