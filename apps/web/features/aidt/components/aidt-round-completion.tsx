"use client";
import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { AidtStep } from "../lib/project-aidt";
import { aidtUiStageSummary, type AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import type { useAidtSharedStages } from "../lib/use-aidt-shared-stages";
import { AIDT_ROUND_COMPLETION_FIELD, aidtRoundPayload, aidtRoundDigest, aidtRoundConfirmation, aidtRoundMissingOutput } from "../lib/aidt-round-completion";

/** Explicit student review + the normal CAS save. A failed save never enables Continue. */
export function AidtRoundCompletion({ projectId, step, draft, controller: c, readOnly, onConfirm, nextHref }: {
  projectId: string; step: AidtStep; draft: AidtUiStageDraft;
  controller: ReturnType<typeof useAidtSharedStages>; readOnly: boolean; onConfirm: (record: string) => void; nextHref: string | null;
}) {
  const payload = aidtRoundPayload(projectId, step.id, draft, c.sourceStageRevisions);
  const [hash, setHash] = React.useState<{ payload: string; digest?: string; failed?: boolean } | null>(null);
  const pending = React.useRef<string | null>(null);
  const [retry, setRetry] = React.useState(0);
  const [fileReview, setFileReview] = React.useState<{ payload: string; checked: boolean } | null>(null);
  React.useEffect(() => {
    let active = true;
    void aidtRoundDigest(payload).then(digest => { if (active) setHash({ payload, digest }); }).catch(() => { if (active) setHash({ payload, failed: true }); });
    return () => { active = false; };
  }, [payload, retry]);
  const digest = hash?.payload === payload ? hash.digest : undefined;
  const filesRequired = step.id === 4 || step.id === 5;
  const record = digest ? aidtRoundConfirmation(projectId, step.id, digest, filesRequired) : null;
  const confirmed = Boolean(record && draft.fields[AIDT_ROUND_COMPLETION_FIELD] === record);
  const filesChecked = !filesRequired || confirmed || Boolean(fileReview?.payload === payload && fileReview.checked);
  const missing = aidtRoundMissingOutput(step.id, draft, { projectId, cards: c.stages[2]?.content.draft.discoveryCards, cardsRevision: c.stages[2]?.revision });
  const complete = !missing && confirmed && c.matchesServer && c.server?.content.draft.fields[AIDT_ROUND_COMPLETION_FIELD] === record;
  React.useEffect(() => {
    if (!pending.current) return;
    if (pending.current !== payload || readOnly) { pending.current = null; return; }
    if (confirmed && c.canSave && !missing) { pending.current = null; void c.saveCurrent(); }
  }, [payload, confirmed, c, readOnly, missing]);
  return <section className="space-y-3 border-t border-border pt-4" aria-label="本轮成果确认" data-testid="aidt-round-completion">
    <div className="flex items-center justify-between gap-3"><h3 className="text-14 font-semibold">{complete ? "本轮成果已确认并保存" : "确认本轮成果"}</h3>{complete && <span className="text-12 text-muted-foreground">V{c.server?.revision}</span>}</div>
    <details className="text-12 text-muted-foreground"><summary className="cursor-pointer">查看本轮产出</summary><p className="mt-2 whitespace-pre-wrap break-words">{aidtUiStageSummary(step.id, draft) || "尚无学生成果"}</p></details>
    <p role="status" className="text-12 text-muted-foreground">{missing ?? (complete ? "已记录编辑者核对；仍可返回修订，不代表全员同意或研究已验证。" : confirmed ? "确认记录尚未保存；保存成功后继续。" : "核对本轮产出与缺口后确认。修改内容或来源后需重新确认。")}</p>
    {filesRequired && !complete && <label className="flex items-start gap-2 text-12"><input type="checkbox" checked={filesChecked} disabled={readOnly || c.write.phase === "saving"} onChange={event => { setFileReview({ payload, checked: event.currentTarget.checked }); if (!event.currentTarget.checked && confirmed) onConfirm(""); }} />{step.id === 4 ? "我已核对至少三份不同点子的PDF，并能查看入选点子的描述单" : "我已打开并核对实际用于测试的原型版本"}（学生核对）</label>}
    {hash?.payload === payload && hash.failed && <p role="alert" className="text-12">暂时无法核对本轮内容。<Button variant="ghost" size="sm" onClick={() => setRetry(value => value + 1)}>重试核对</Button></p>}
    {complete ? nextHref && <Button asChild size="sm" variant="primary"><Link href={nextHref}>{step.id === 6 ? "整理小组报告" : `继续第${step.id + 1}步`}</Link></Button> : <Button size="sm" disabled={readOnly || Boolean(missing) || !record || !filesChecked || !c.canSave || c.write.phase === "saving"} onClick={() => {
      if (readOnly || missing || !record || !filesChecked || !c.canSave) return;
      if (confirmed) void c.saveCurrent();
      else { pending.current = payload; onConfirm(record); }
    }}>{c.write.phase === "saving" ? "正在保存确认…" : confirmed ? "重试保存确认" : "确认本轮成果并保存"}</Button>}
  </section>;
}
