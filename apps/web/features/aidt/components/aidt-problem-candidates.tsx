"use client";
import * as React from "react";
import { AIDT_PROBLEM_CANDIDATE_SOURCE_FIELD } from "@repo/contracts/aidt-candidate-request";
import { StageContent } from "@repo/contracts/aidt-stages";
import { Button } from "@/components/ui/button";
import { AidtCandidatePicker } from "./aidt-candidate-picker";
import { useAidtCandidateRequest, type AidtCandidateProvenance, type AidtCandidateTurn } from "../lib/use-aidt-candidate-request";
import { problemReflectionMissingFields } from "../lib/aidt-problem-reflection";
import { listAidtProblems, readAidtProblemEntityDraft, updateAidtProblemEntity } from "../lib/aidt-problem-entities";
import { readAidtProblemDirections } from "../lib/aidt-problem-directions";
import { readInterviewDiscoveryCandidates } from "../lib/aidt-interview-discovery";
import { readAidtStage, saveAidtStage, type AidtSharedStage } from "../lib/live-aidt-stages";

const sourceKey = (stage: AidtSharedStage, id: string) => {
  if (!listAidtProblems(stage.content.draft).some(item => item.id === id && !item.archived)) return null;
  const draft = readAidtProblemEntityDraft(stage.content.draft, id);
  return problemReflectionMissingFields(draft).length ? null : JSON.stringify([stage.projectId, id, stage.revision, Object.entries(draft.fields).sort(([a], [b]) => a.localeCompare(b))]);
};

/** Optional assistance follows the student's own framing; only an explicit normal save persists edits. */
export function AidtProblemCandidates({ projectId, entityId, stage, sessionToken, messages, loading, running, onRefresh }: {
  projectId: string; entityId: string; stage: AidtSharedStage; sessionToken: string; messages: readonly AidtCandidateTurn[]; loading: boolean; running: boolean; onRefresh: () => void;
}) {
  const source = sourceKey(stage, entityId);
  const current = readAidtProblemEntityDraft(stage.content.draft, entityId);
  const [edit, setEdit] = React.useState<{ source: string; provenance: AidtCandidateProvenance; direction: string; theme: string } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const live = React.useRef(true);
  const savingRequest = React.useRef<AbortController | null>(null);
  React.useEffect(() => { live.current = true; return () => { live.current = false; savingRequest.current?.abort(); }; }, []);
  const latest = React.useRef({ source, stage }); latest.current = { source, stage };
  const controller = useAidtCandidateRequest<string>({ kind: "problem", projectId, entityId, sourceKey: source, messages, loading, running,
    enabled: !!source && !edit && !saving, disabledReason: edit ? "先保存或放弃当前独立草稿，再开始下一轮 AI 候选。" : "先用自己的话保存原始命题、选题理由和观察／抱怨／猜测来源，再请 AI 协助聚焦。",
    instruction: "先依据我已保存的原始命题、选题理由和来源反思，提供 1 至 3 个不同的可研究命题表达。不要替我编写选题理由、用户证据或 HMW，不宣布问题已证实。每项独立一行，格式为‘候选1：命题表达’，不超过 500 字。只给候选，等待我比较方向、修订和确认。",
    parseReply: readInterviewDiscoveryCandidates,
    readCurrentSource: async signal => { const { stage: saved } = await readAidtStage(projectId, 1, sessionToken, signal); return saved ? sourceKey(saved, entityId) : null; },
  });
  const adopt = (theme: string, provenance: AidtCandidateProvenance) => {
    if (!latest.current.source || provenance.sourceKey !== latest.current.source) throw new Error("AIDT_CANDIDATE_SOURCE_CHANGED");
    setEdit({ source: provenance.sourceKey, provenance, direction: theme.length <= 120 ? theme : "", theme }); setStatus("");
  };
  const save = async () => {
    if (!edit || saving || running || edit.source !== source || !edit.direction.trim() || !edit.theme.trim()) return;
    setSaving(true); setStatus("");
    const abort = new AbortController(); savingRequest.current = abort;
    try {
      const { stage: saved } = await readAidtStage(projectId, 1, sessionToken, abort.signal);
      if (!live.current || abort.signal.aborted) return;
      if (!saved || sourceKey(saved, entityId) !== edit.source || latest.current.source !== edit.source) { setStatus("来源版本已改变，本地文字保留。请核对最新命题后再保存。"); return; }
      const directionId = "ai-" + edit.provenance.requestId;
      const next = updateAidtProblemEntity(saved.content.draft, entityId, old => {
        const directions = readAidtProblemDirections(old.fields.problemDirections);
        const fields: Record<string, string> = { ...old.fields, rewrittenTheme: edit.theme.trim(), focus: edit.direction.trim(), problemDirectionId: directionId,
          problemDirections: JSON.stringify([...directions.filter(item => item.id !== directionId), { id: directionId, title: edit.direction.trim(), source: "ai" }]),
          [AIDT_PROBLEM_CANDIDATE_SOURCE_FIELD]: JSON.stringify({ rewrittenTheme: edit.theme.trim(), messageId: edit.provenance.messageId, threadId: edit.provenance.threadId, requestId: edit.provenance.requestId, kind: "ai-assisted-student-edited" }) };
        delete fields.roundCompletion; delete fields.problemReflectionConfirmed;
        return { ...old, fields };
      });
      if ((next.fields["problemDraft:" + entityId]?.length ?? 0) > 6000) { setStatus("当前问题记录已接近容量，请先精简候选和反思；本地文字保留。"); return; }
      await saveAidtStage({ projectId, stageId: 1, expectedRevision: saved.revision, operationId: crypto.randomUUID(), content: StageContent.parse({ ...saved.content, draft: next }), sourceStageRevisions: saved.sourceStageRevisions }, sessionToken, abort.signal);
      if (!live.current || abort.signal.aborted) return;
      setEdit(null); setStatus("问题草稿已保存，尚未确认本轮。请核对方向与反思，再使用本轮确认操作。"); onRefresh();
    } catch { if (live.current && !abort.signal.aborted) setStatus("草稿未保存，文字仍保留。请核对权限或版本冲突后重试。"); }
    finally { if (live.current) setSaving(false); }
  };
  return <div className="space-y-3">
    <AidtCandidatePicker title="聚焦本轮研究命题" actionLabel="AI 提供命题候选" controller={controller} renderCandidate={value => <p className="whitespace-pre-wrap break-words">{value}</p>} hasExisting={!!(edit?.theme || current.fields.rewrittenTheme)} onAdopt={adopt} />
    {edit && <section className="space-y-3 rounded-xl border border-border p-4" aria-label="命题候选的可编辑草稿"><p className="text-12 text-muted-foreground">AI 辅助表达 · 由学生选择和改写。原命题、选题理由与来源保留；保存草稿不表示研究已验证。</p>
      <label className="block text-13">本轮选择的研究方向<input className="mt-1 w-full rounded-control border border-border bg-background p-2" value={edit.direction} maxLength={120} disabled={saving} onChange={event => { const direction = event.currentTarget.value; setEdit(old => old ? { ...old, direction } : old); }} /></label>
      <label className="block text-13">学生重写命题<textarea className="mt-1 w-full rounded-control border border-border bg-background p-2" rows={3} value={edit.theme} maxLength={650} disabled={saving} onChange={event => { const theme = event.currentTarget.value; setEdit(old => old ? { ...old, theme } : old); }} /></label>
      {edit.source !== source && <p role="status" className="text-12">来源已更新，本地草稿仍保留。请先核对当前版本。</p>}
      <div className="flex gap-2"><Button type="button" size="sm" disabled={saving || running || edit.source !== source || !edit.direction.trim() || !edit.theme.trim()} onClick={() => void save()}>{saving ? "保存中…" : "保存本步草稿"}</Button><Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEdit(null)}>保留已保存内容，放弃此草稿</Button></div>
    </section>}
    {status && <p role="status" className="text-12">{status}</p>}
  </div>;
}
