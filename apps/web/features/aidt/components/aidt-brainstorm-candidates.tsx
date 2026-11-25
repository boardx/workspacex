"use client";
import * as React from "react";
import { AIDT_BRAINSTORM_METHOD_GUIDES, AIDT_BRAINSTORM_METHODS, readAidtBrainstorm, type AidtBrainstorm } from "@repo/contracts/aidt-brainstorm";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { AidtCandidatePicker } from "./aidt-candidate-picker";
import { useAidtCandidateRequest, type AidtCandidateProvenance, type AidtCandidateTurn } from "../lib/use-aidt-candidate-request";
import { addAidtBrainstormCandidates, readAidtBrainstormCandidateReply } from "../lib/aidt-brainstorm";
import { createAidtIdeaConceptImage } from "../lib/aidt-idea-concept-image";
import { researchMaterialKey } from "../lib/aidt-research-material-reference";
import { readAidtStage } from "../lib/live-aidt-stages";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

type Idea = { title: string; description: string };
const validIdea = (idea: Idea) => idea.title.trim().length >= 2 && idea.description.trim().length >= 5;
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
  const [edit, setEdit] = React.useState<{ source: string; ideas: Idea[]; provenance: AidtCandidateProvenance } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const live = React.useRef(true);
  const savingRequest = React.useRef<AbortController | null>(null);
  React.useEffect(() => { live.current = true; return () => { live.current = false; savingRequest.current?.abort(); }; }, []);
  const latest = React.useRef({ source, readOnly }); latest.current = { source, readOnly };
  const guide = AIDT_BRAINSTORM_METHOD_GUIDES[session.method];
  const controller = useAidtCandidateRequest<Idea>({ kind: "ideation", projectId, entityId: session.id, sourceKey: source, messages, loading, running,
    enabled: !readOnly && !session.archived && !!token && !edit && !saving && session.candidates.length < session.count,
    disabledReason: edit ? "先保存或放弃所选点子草稿，再继续 AI 候选。" : session.candidates.length >= session.count ? "本轮候选数量已达到计划，请先整理、分类与选择已有点子。" : "当前场次只读或来源尚未就绪。",
    instruction: `围绕本场次已冻结的 HMW 和方法‘${AIDT_BRAINSTORM_METHODS[session.method]}’提供 AI 点子候选。已有学生点子时在其基础上拓展，否则直接从 HMW 出发给出起始候选，并标明它们是 AI 建议。方法指导：${guide.description}。只遵循当前场次方法；换位和类比是待验证假设，不是访谈事实。最多给 ${Math.min(3, Math.max(1, session.count - session.candidates.length))} 个不同候选，不否定、评分、分类、投票或替我选。沿用 aidt-ideas JSON 围栏格式 {"sessionId":"${session.id}","candidates":[{"title":"点子名称","description":"两三句核心说明"}]}。当前仅预览，我选择并编辑之后才会主动保存。`,
    parseReply: text => readAidtBrainstormCandidateReply(text, session.id),
    readCurrentSource: async signal => { if (!token) return null; const { stage } = await readAidtStage(projectId, 4, token, signal); return stage ? sourceKey(projectId, stage.content.draft, session.id) : null; },
  });
  const updateIdea = (index: number, change: Partial<Idea>) => {
    setEdit(old => old ? { ...old, ideas: old.ideas.map((idea, i) => i === index ? { ...idea, ...change } : idea) } : old);
  };
  const save = async () => {
    if (!edit || savingRequest.current || readOnly || running || !token || edit.source !== source || !edit.ideas.every(validIdea)) return;
    setSaving(true); setStatus("");
    const abort = new AbortController(); savingRequest.current = abort;
    const plan = (old: AidtUiStageDraft) => addAidtBrainstormCandidates(old, session.id, [{
      messageId: edit.provenance.messageId,
      items: edit.ideas.map(idea => ({ title: idea.title.trim(), description: idea.description.trim() })),
    }]);
    try {
      const { stage } = await readAidtStage(projectId, 4, token, abort.signal);
      if (!live.current || abort.signal.aborted) return;
      if (!stage || sourceKey(projectId, stage.content.draft, session.id) !== edit.source || latest.current.source !== edit.source || latest.current.readOnly) {
        setStatus("本场次已有更新，本地点子草稿已保留。");
        return;
      }
      const planned = plan(stage.content.draft);
      const newIdeas = planned.ideas.slice(stage.content.draft.ideas.length);
      if (newIdeas.length !== edit.ideas.length || Object.keys(planned.fields).length + newIdeas.length > 100) {
        setStatus("无法保存全部点子，请检查重复的标题或说明，以及场次剩余容量。");
        return;
      }
      const attachments = await Promise.all(newIdeas.map(async idea => [
        researchMaterialKey("idea", idea.id),
        JSON.stringify(await createAidtIdeaConceptImage({ projectId, sessionToken: token, signal: abort.signal }, idea)),
      ] as const));
      if (!live.current || abort.signal.aborted) return;
      let accepted = false;
      const saved = await saveDraft(old => {
        if (sourceKey(projectId, old, session.id) !== edit.source || latest.current.readOnly) return old;
        const next = plan(old);
        const added = next.ideas.slice(old.ideas.length);
        if (added.length !== newIdeas.length || added.some((idea, i) => idea.id !== newIdeas[i]?.id)
          || Object.keys(next.fields).length + added.length > 100) return old;
        accepted = true;
        return { ...next, fields: { ...next.fields, ...Object.fromEntries(attachments) } };
      });
      if (!live.current || abort.signal.aborted) return;
      if (!saved || !accepted) { setStatus("点子未保存，本地草稿已保留，请核对后重试。"); return; }
      setEdit(null);
      setStatus(`已保存 ${newIdeas.length} 个点子及其配图。可在各点子的描述单中换图。`);
    } catch {
      if (live.current && !abort.signal.aborted) setStatus("未能关联配图或保存点子，本地草稿已保留，请重试。");
      abort.abort();
    } finally {
      savingRequest.current = null;
      if (live.current) setSaving(false);
    }
  };

  return <div className="space-y-3">
    <AidtCandidatePicker title="按本轮方法拓展点子" actionLabel="AI 提供点子候选" controller={controller} hasExisting={false}
      batch={{ limit: session.count - session.candidates.length, adopt: indexes => controller.adoptMany(indexes, (ideas, provenance) => {
        if (provenance.sourceKey !== latest.current.source || latest.current.readOnly) throw new Error("AIDT_CANDIDATE_SOURCE_CHANGED");
        setEdit({ ideas: [...ideas], provenance, source: provenance.sourceKey });
        setStatus("");
      }) }}
      renderCandidate={idea => <><p className="font-medium">{idea.title}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{idea.description}</p></>} />
    {edit && <section className="space-y-3 rounded-xl border border-border p-4" aria-label="所选点子的可编辑草稿">
      <p className="text-12 text-muted-foreground">核对所选点子。保存时会为每个点子关联一张概念图，可在描述单中替换。</p>
      <fieldset disabled={saving || readOnly} className="space-y-3">
        <legend className="sr-only">编辑所选点子</legend>
        {edit.ideas.map((idea, index) => <div key={index} className="space-y-2 rounded-lg border border-border p-3">
          <label className="block text-13">点子名称<input className="mt-1 w-full rounded-control border border-border bg-background p-2" value={idea.title} maxLength={120} onChange={event => updateIdea(index, { title: event.currentTarget.value })} /></label>
          <label className="block text-13">两三句核心说明<textarea className="mt-1 w-full rounded-control border border-border bg-background p-2" rows={3} value={idea.description} maxLength={1000} onChange={event => updateIdea(index, { description: event.currentTarget.value })} /></label>
          {edit.ideas.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(old => old ? { ...old, ideas: old.ideas.filter((_, i) => i !== index) } : old)}>从本次保存中移除</Button>}
        </div>)}
      </fieldset>
      {edit.source !== source && <p role="status" className="text-12">场次来源已更新，本地文字已保留。</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={saving || running || readOnly || edit.source !== source || !edit.ideas.every(validIdea)} onClick={() => void save()}>{saving ? "正在配图并保存…" : "保存所选点子"}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEdit(null)}>放弃此草稿</Button>
      </div>
    </section>}
    {status && <p role="status" className="text-12">{status}</p>}
  </div>;
}
