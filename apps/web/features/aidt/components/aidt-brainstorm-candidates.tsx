"use client";
import * as React from "react";
import { isAidtGreetingText } from "@repo/contracts/aidt-stages";
import { AIDT_CANDIDATE_ACTIONS } from "@repo/contracts/aidt-candidate-request";
import { AIDT_BRAINSTORM_METHOD_GUIDES, AIDT_BRAINSTORM_METHODS, readAidtBrainstorm, type AidtBrainstorm } from "@repo/contracts/aidt-brainstorm";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { AidtCandidatePicker } from "./aidt-candidate-picker";
import { useAidtCandidateRequest, type AidtCandidateProvenance, type AidtCandidateTurn } from "../lib/use-aidt-candidate-request";
import { addAidtBrainstormCandidates, readAidtBrainstormCandidateReply } from "../lib/aidt-brainstorm";
import { readAidtStage } from "../lib/live-aidt-stages";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

type Idea = { title: string; description: string };
const sourceKey = (projectId: string, draft: AidtUiStageDraft, id: string): string | null => {
  const session = readAidtBrainstorm(draft.fields, id);
  return !session || session.archived ? null : JSON.stringify([projectId, session, draft.ideas.filter(idea => session.candidates.includes(idea.id)).map(idea => [idea.id, idea.title, idea.description])]);
};


export function AidtBrainstormCandidates({ projectId, session, draft, messages, loading, running, readOnly, saveDraft }: {
  projectId: string; session: AidtBrainstorm; draft: AidtUiStageDraft; messages: readonly AidtCandidateTurn[]; loading: boolean; running: boolean; readOnly: boolean;
  saveDraft: (change: (old: AidtUiStageDraft) => AidtUiStageDraft) => Promise<boolean>;
}) {
  const token = useOptionalSession()?.session?.sessionToken;
  const source = sourceKey(projectId, draft, session.id);
  const hasStudent = messages.some(turn => turn.role === "user" && typeof turn.content === "string" && turn.content.trim() && !isAidtGreetingText(turn.content) && !Object.values(AIDT_CANDIDATE_ACTIONS).some(header => (turn.content as string).startsWith(header + "\n")));
  const [edit, setEdit] = React.useState<{ source: string; value: Idea; provenance: AidtCandidateProvenance } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const live = React.useRef(true);
  const savingRequest = React.useRef<AbortController | null>(null);
  React.useEffect(() => { live.current = true; return () => { live.current = false; savingRequest.current?.abort(); }; }, []);
  const latest = React.useRef({ source, readOnly }); latest.current = { source, readOnly };
  const guide = AIDT_BRAINSTORM_METHOD_GUIDES[session.method];
  const controller = useAidtCandidateRequest<Idea>({ kind: "ideation", projectId, entityId: session.id, sourceKey: source, messages, loading, running,
    enabled: !readOnly && !session.archived && hasStudent && !!token && !edit && !saving && session.candidates.length < session.count,
    disabledReason: edit ? "先保存或放弃当前独立点子草稿，再继续 AI 候选。" : !hasStudent ? "先按本轮方法写下自己的第一轮点子，再请 AI 协助拓展。" : session.candidates.length >= session.count ? "本轮候选数量已达到计划，请先整理、分类与选择已有点子。" : "当前场次只读或来源尚未就绪。",
    instruction: `围绕本场次已冻结的 HMW 和方法‘${AIDT_BRAINSTORM_METHODS[session.method]}’继续拓展学生已经贡献的想法。方法指导：${guide.description}。只遵循当前场次方法；换位和类比是待验证假设，不是访谈事实。最多给 ${Math.min(3, Math.max(1, session.count - session.candidates.length))} 个不同候选，不否定、评分、分类、投票或替我选。沿用 aidt-ideas JSON 围栏格式 {"sessionId":"${session.id}","candidates":[{"title":"点子名称","description":"两三句核心说明"}]}。当前仅预览，我选择并编辑之后才会主动保存。`,
    parseReply: text => readAidtBrainstormCandidateReply(text, session.id),
    readCurrentSource: async signal => { if (!token) return null; const { stage } = await readAidtStage(projectId, 4, token, signal); return stage ? sourceKey(projectId, stage.content.draft, session.id) : null; },
  });
  const save = async () => {
    if (!edit || saving || readOnly || running || !token || edit.source !== source || edit.value.title.trim().length < 2 || edit.value.description.trim().length < 5) return;
    setSaving(true); setStatus("");
    const abort = new AbortController(); savingRequest.current = abort;
    try {
      const { stage } = await readAidtStage(projectId, 4, token, abort.signal);
      if (!live.current || abort.signal.aborted) return;
      if (!stage || sourceKey(projectId, stage.content.draft, session.id) !== edit.source || latest.current.source !== edit.source || latest.current.readOnly) { setStatus("本场次已有更新，本地候选保留，请先核对最新版本。"); return; }
      const item = { title: edit.value.title.trim(), description: edit.value.description.trim() };
      let accepted = false;
      const saved = await saveDraft(old => {
        if (sourceKey(projectId, old, session.id) !== edit.source) return old;
        const next = addAidtBrainstormCandidates(old, session.id, [{ messageId: edit.provenance.messageId, items: [item] }]);
        accepted = next !== old;
        return next;
      });
      if (!live.current || abort.signal.aborted) return;
      if (!saved || !accepted) { setStatus("该点子未能保存，可能与已有点子重复、场次已更新或容量已满。文字仍保留。"); return; }
      setEdit(null); setStatus("所选点子已保存，分类、投票和三份图文描述单仍需学生按原流程完成。");
    } catch { if (live.current && !abort.signal.aborted) setStatus("点子未保存，本地文字仍保留，请核对后重试。"); }
    finally { if (live.current) setSaving(false); }
  };
  return <div className="space-y-3">
    <AidtCandidatePicker title="按本轮方法拓展点子" actionLabel="AI 提供点子候选" controller={controller} hasExisting={!!edit} renderCandidate={idea => <><p className="font-medium">{idea.title}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{idea.description}</p></>} onAdopt={(value, provenance) => { if (!latest.current.source || provenance.sourceKey !== latest.current.source || latest.current.readOnly) throw new Error("AIDT_CANDIDATE_SOURCE_CHANGED"); setEdit({ value: { ...value }, provenance, source: provenance.sourceKey }); setStatus(""); }} />
    {edit && <section className="space-y-3 rounded-xl border border-border p-4" aria-label="所选点子的可编辑草稿"><p className="text-12 text-muted-foreground">AI 辅助候选 · 先编辑再保存。已有点子、分类与入选结果保留。</p>
      <label className="block text-13">点子名称<input className="mt-1 w-full rounded-control border border-border bg-background p-2" value={edit.value.title} maxLength={120} disabled={saving} onChange={event => { const title = event.currentTarget.value; setEdit(old => old ? { ...old, value: { ...old.value, title } } : old); }} /></label>
      <label className="block text-13">两三句核心说明<textarea className="mt-1 w-full rounded-control border border-border bg-background p-2" rows={3} value={edit.value.description} maxLength={1000} disabled={saving} onChange={event => { const description = event.currentTarget.value; setEdit(old => old ? { ...old, value: { ...old.value, description } } : old); }} /></label>
      {edit.source !== source && <p role="status" className="text-12">场次来源已更新，本地文字保留，请先核对。</p>}
      <div className="flex gap-2"><Button type="button" size="sm" disabled={saving || running || readOnly || edit.source !== source || edit.value.title.trim().length < 2 || edit.value.description.trim().length < 5} onClick={() => void save()}>{saving ? "保存中…" : "保存所选点子"}</Button><Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEdit(null)}>放弃此草稿</Button></div>
    </section>}
    {status && <p role="status" className="text-12">{status}</p>}
  </div>;
}
