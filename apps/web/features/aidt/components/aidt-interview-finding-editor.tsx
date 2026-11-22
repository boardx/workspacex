"use client";

import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import type { AidtUiStageDraft, AidtDiscoveryCardDraft } from "../lib/aidt-ui-drafts";
import {
  aidtInterviewFindingReady, aidtInterviewMaterialKey, confirmAidtInterviewFinding,
  getAidtInterviewFinding, isAidtInterviewArchived, isAidtInterviewConfirmed,
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
  update: (mutate: (previous: AidtUiStageDraft) => AidtUiStageDraft) => void;
};

/** One person, one photo, one finding and its concrete situation. Evidence stays secondary. */
export function AidtInterviewFindingEditor({ projectId, interview, draft, readOnly, update }: Props) {
  const { id, code } = interview;
  const finding = getAidtInterviewFinding(draft, interview);
  const photo = readAidtInterviewPhoto(draft, interview, projectId);
  const materials = readAidtInterviewMaterials(draft.fields, id, projectId);
  const editable = !readOnly && !!interview.consent?.notes;
  const confirmed = isAidtInterviewConfirmed(draft.fields, id);
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

  return <section aria-label="人物发现卡" className="space-y-5 rounded-xl border border-border bg-card p-4 sm:p-5" data-testid="aidt-interview-finding-editor">
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-12 text-muted-foreground">{code}</p><h5 className="mt-1 text-16 font-semibold">人物发现卡</h5></div>
      {confirmed && <span className="text-12 text-muted-foreground">已核对</span>}
    </div>

    <div className="space-y-3" aria-label="发现卡照片">
      {photo ? <AidtResearchMaterialPreview projectId={projectId} reference={photo.reference} alt={`${code} 的授权访谈照片`} compact />
        : <div className="flex min-h-24 items-center gap-3 rounded-lg bg-muted/40 p-4" data-testid="empty">
          <ImagePlus aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          <div><p className="text-13">添加一张现场照片</p><p className="mt-1 text-12 text-muted-foreground">照片可暂缺，不生成虚构人物。</p></div>
        </div>}
      <Checkbox checked={!!interview.consent?.photos} disabled={readOnly} label="已获受访者授权共享照片" onChange={event => {
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
      <div className="flex items-center justify-between gap-2"><Label htmlFor={fieldId + "-headline"}>一句发现</Label><span className="text-11 text-muted-foreground">{finding.headlineKind === "quote" ? "受访者原话 · 需核对" : "学生概括"}</span></div>
      <Input id={fieldId + "-headline"} aria-label="一句发现" value={finding.headline} maxLength={500} disabled={!editable}
        placeholder="这位受访者最让你记住的发现是什么？" onChange={event => patch({ headline: event.currentTarget.value })} />
    </div>
    <div className="space-y-2">
      <Label htmlFor={fieldId + "-context"}>具体情况</Label>
      <Textarea id={fieldId + "-context"} aria-label="具体情况" value={finding.context} maxLength={1700} disabled={!editable} rows={3}
        placeholder="记录当时的场景、经过和实际行为。" onChange={event => patch({ context: event.currentTarget.value })} />
    </div>

    <details className="border-t border-border pt-3 text-12" data-testid="aidt-finding-sources">
      <summary className="cursor-pointer rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">原话与来源</summary>
      <div className="mt-4 space-y-4">
        <div className="space-y-2"><p>标题来源</p><Select aria-label="标题来源" value={finding.headlineKind} disabled={!editable}
          options={[{ value: "student-summary", label: "学生概括" }, { value: "quote", label: "受访者原话" }]}
          onValueChange={value => patch({ headlineKind: value === "quote" ? "quote" : "student-summary" })} /></div>
        <div className="space-y-2"><Label htmlFor={fieldId + "-quote"}>可定位的受访者原话</Label>
          <Textarea id={fieldId + "-quote"} value={finding.quote} maxLength={800} disabled={!editable} rows={2} onChange={event => patch({ quote: event.currentTarget.value })} /></div>
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
        <p className="break-words text-muted-foreground">{finding.sourceRef || "尚未关联已校对的原始材料。"} 在右侧「资料」中核对原件、摘录与位置。</p>
      </div>
    </details>
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" disabled={!editable || confirmed || !aidtInterviewFindingReady(draft, interview, projectId)} onClick={() => update(old => confirmAidtInterviewFinding(old, id, projectId))}>确认人物发现卡</Button>
      <p className="text-12 text-muted-foreground">{confirmed ? "已确认；后续修改会保留为新草稿。" : "核对访谈清单与原始材料后确认。"}</p>
    </div>
  </section>;
}
