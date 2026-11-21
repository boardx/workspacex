"use client";

import * as React from "react";
import Link from "next/link";
import { AIDT_BRAINSTORM_CANDIDATE_LIMIT, AIDT_BRAINSTORM_METHODS, readAidtBrainstorms, type AidtBrainstorm } from "@repo/contracts/aidt-brainstorm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AidtEntityCard } from "./aidt-entity-card";
import { useAidtCreateTags } from "./aidt-card-create-fields";
import { addAidtBrainstormCandidates, confirmAidtBrainstormSelection, createAidtBrainstorm, readAidtBrainstormProposals, readAidtBrainstormSelection } from "../lib/aidt-brainstorm";
import { readAidtIdeaDirectory, type AidtIdeaHmwSource } from "../lib/aidt-idea-handoff";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

type SaveDraft = (change: (old: AidtUiStageDraft) => AidtUiStageDraft) => Promise<boolean>;
type Message = { id: string; role: string; content?: unknown };

export function AidtBrainstormDirectory({ choices, draft, open, close, readOnly, href, onOpen, saveDraft }: {
  choices: readonly AidtIdeaHmwSource[];
  open: boolean;
  close: () => void;
  draft: AidtUiStageDraft;
  readOnly: boolean;
  href: (id: string) => string;
  onOpen: (id: string) => void;
  saveDraft: SaveDraft;
}) {
  const tags = useAidtCreateTags(draft);
  const sessions = readAidtBrainstorms(draft.fields);
  const [name, setName] = React.useState("");
  const [hmw, setHmw] = React.useState("");
  const [method, setMethod] = React.useState<AidtBrainstorm["method"] | "">("");
  const [count, setCount] = React.useState("5");
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const draftId = React.useRef<{ key: string; id: string } | null>(null);
  const selected = choices.find(choice => choice.id === hmw);
  const planned = Number(count);
  const valid = Boolean(name.trim() && selected && method && Number.isInteger(planned) && planned >= 1 && planned <= AIDT_BRAINSTORM_CANDIDATE_LIMIT);
  const style = "mt-1 w-full rounded-control border border-border bg-background p-2";
  const id = React.useId();

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !method || !valid || saving || readOnly) return;
    const key = JSON.stringify([name.trim(), selected.id, selected.revision, method, planned]);
    if (draftId.current?.key !== key) draftId.current = { key, id: `brainstorm-${crypto.randomUUID()}` };
    const session: AidtBrainstorm = { id: draftId.current.id,
      name: name.trim(), source: selected,
      method, candidates: [], count: planned };
    setSaving(true);
    setFailed(false);
    try {
      if (await saveDraft(old => tags.apply(createAidtBrainstorm(old, session), session.id))) {
        dismiss();
        onOpen(session.id);
      } else setFailed(true);
    } catch { setFailed(true); }
    finally { setSaving(false); }
  }

  function dismiss() {
    setName("");
    setHmw("");
    setMethod("");
    setCount("5");
    setFailed(false);
    tags.reset();
    draftId.current = null;
    close();
  }

  return <section className="space-y-3" aria-label="头脑风暴">
    <h2 className="text-lg font-semibold">头脑风暴</h2>
    <Dialog open={open && !readOnly} onOpenChange={next => { if (!next && !saving) dismiss(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>新建头脑风暴</DialogTitle>
          <DialogDescription>从已确认的 HMW 发散出新的点子。</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={start}>
          <label className="block text-13">场次名称
            <Input className="mt-1" value={name} maxLength={120} onChange={event => setName(event.currentTarget.value)} disabled={saving} autoFocus />
          </label>
          {tags.field}
          <label className="block text-13">HMW
            <select className={style} value={hmw} onChange={event => setHmw(event.target.value)} disabled={saving}>
              <option value="">选择已确认的 HMW</option>
              {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.text}</option>)}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-13">发散方法
              <select className={style} value={method} onChange={event => setMethod(event.target.value as typeof method)} disabled={saving}>
                <option value="">选择一种方法</option>
                {Object.entries(AIDT_BRAINSTORM_METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block text-13" htmlFor={id}>希望探索的点子数
              <Input className="mt-1" id={id} type="number" min={1} max={AIDT_BRAINSTORM_CANDIDATE_LIMIT} value={count} onChange={event => setCount(event.target.value)} disabled={saving} />
            </label>
          </div>
          <DialogFooter><Button type="button" variant="ghost" disabled={saving} onClick={dismiss}>取消</Button>
          <Button type="submit" disabled={!valid || saving}>{saving ? "正在创建…" : "开始头脑风暴"}</Button></DialogFooter>
          {failed && <p role="alert" className="text-13 text-destructive">场次未能保存，请重试。</p>}
          {!choices.length && <p className="text-13 text-muted-foreground">先在第 3 步确认一个 HMW。</p>}
        </form>
      </DialogContent>
    </Dialog>
    {sessions.length > 0 && <ul className="grid gap-3 sm:grid-cols-2">{sessions.map(session => <AidtEntityCard key={session.id} entityId={session.id}>
      <Link className="block rounded-control border border-border px-3 py-2 text-13 transition-colors hover:bg-muted" href={href(session.id)}>
        <span className="block font-medium">{session.name ?? AIDT_BRAINSTORM_METHODS[session.method]}</span>
        <span className="block text-muted-foreground">{AIDT_BRAINSTORM_METHODS[session.method]} · {session.candidates.length}/{session.count} 个候选</span>
        <span className="block break-words text-muted-foreground">{session.source.text} · V{session.source.revision}</span>
      </Link>
    </AidtEntityCard>)}</ul>}
  </section>;
}

function sessionIdeas(session: AidtBrainstorm, draft: AidtUiStageDraft) {
  const active = new Set(readAidtIdeaDirectory(draft).filter(idea => !idea.archived).map(idea => idea.id));
  return session.candidates.flatMap(id => draft.ideas.filter(idea => idea.id === id && active.has(id)));
}

export function AidtBrainstormOutput({ projectId, session, draft }: { projectId: string; session: AidtBrainstorm; draft: AidtUiStageDraft }) {
  const ideas = sessionIdeas(session, draft);
  const choice = readAidtBrainstormSelection(draft);
  const selected = choice?.session.id === session.id ? choice.selectedIds : [];
  return <section className="space-y-3" aria-label="头脑风暴产物" data-testid="aidt-brainstorm-output">
    <h3 className="font-semibold">{AIDT_BRAINSTORM_METHODS[session.method]} · {ideas.length} 个候选{selected.length > 0 && ` · 入选 ${selected.length}`}</h3>
    <p className="text-13">{session.source.text} · <Link className="text-primary underline"
      href={`/aidt/${encodeURIComponent(projectId)}?${new URLSearchParams({ step: "3", entity: session.source.id, entityRevision: String(session.source.revision) })}`}>第 3 步 V{session.source.revision}</Link></p>
    {ideas.length ? <ol className="list-decimal space-y-2 pl-5 text-13">{ideas.map(idea => <li key={idea.id}>
      <span className="font-medium">{idea.title}</span>{selected.includes(idea.id) && <span className="ml-2 text-primary">入选</span>}
      <p className="text-muted-foreground">{idea.description}</p>
    </li>)}</ol> : <p className="text-13 text-muted-foreground">在对话中贡献第一个想法。</p>}
  </section>;
}

export function AidtBrainstormConversation({ session, draft, messages, loading, running, readOnly, saveDraft, nextHref }: {
  session: AidtBrainstorm;
  draft: AidtUiStageDraft;
  messages: readonly Message[];
  loading: boolean;
  running: boolean;
  readOnly: boolean;
  saveDraft: SaveDraft;
  nextHref?: string;
}) {
  const ideas = sessionIdeas(session, draft);
  const saved = readAidtBrainstormSelection(draft);
  const savedIds = saved?.session.id === session.id ? saved.selectedIds : [];
  const [picked, setPicked] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const attempted = React.useRef<string | null>(null);
  const proposals = React.useMemo(() => readAidtBrainstormProposals(messages, session.id), [messages, session.id]);
  const proposalKey = JSON.stringify(proposals);
  const selected = (picked ?? savedIds).filter(id => ideas.some(idea => idea.id === id));
  const unchanged = selected.length === savedIds.length && selected.every(id => savedIds.includes(id));

  const persistCandidates = React.useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try { if (!await saveDraft(old => addAidtBrainstormCandidates(old, session.id, proposals))) setFailed(true); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  }, [proposals, saveDraft, session.id]);

  React.useEffect(() => {
    if (readOnly || loading || running || busy || attempted.current === proposalKey
      || addAidtBrainstormCandidates(draft, session.id, proposals) === draft) return;
    attempted.current = proposalKey;
    void persistCandidates();
  }, [busy, draft, loading, persistCandidates, proposalKey, proposals, readOnly, running, session.id]);

  async function confirm() {
    if (!selected.length || unchanged || busy || readOnly) return;
    setBusy(true);
    setFailed(false);
    try {
      if (await saveDraft(old => confirmAidtBrainstormSelection(old, session.id, selected))) setPicked(null);
      else setFailed(true);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }

  return <section className="space-y-2 rounded-container border border-border p-3 text-13" aria-label="筛选点子">
    <p>{AIDT_BRAINSTORM_METHODS[session.method]} · {ideas.length}/{session.count} 个候选</p>
    {ideas.length > 0 && <details>
      <summary className="cursor-pointer font-medium">筛选点子 · 已选 {selected.length}</summary>
      <p className="py-2 text-muted-foreground">在对话中比较点子，勾选要带入原型的候选。</p>
      <ul className="space-y-2">{ideas.map(idea => <li key={idea.id}><label className="flex items-start gap-2">
        <input type="checkbox" checked={selected.includes(idea.id)} disabled={readOnly || busy || !selected.includes(idea.id) && selected.length >= 8} onChange={event =>
          setPicked(event.target.checked ? [...selected, idea.id] : selected.filter(id => id !== idea.id))} />
        <span><span className="block font-medium">{idea.title}</span><span className="text-muted-foreground">{idea.description}</span></span>
      </label></li>)}</ul>
      {!readOnly && <Button className="mt-3" size="sm" disabled={busy || selected.length === 0 || unchanged} onClick={() => void confirm()}>确认入选点子</Button>}
    </details>}
    {busy && <p role="status">正在保存…</p>}
    {failed && <p role="alert">保存失败。{addAidtBrainstormCandidates(draft, session.id, proposals) !== draft &&
      <Button variant="ghost" size="sm" onClick={() => void persistCandidates()}>重试保存候选</Button>}</p>}
    {nextHref && savedIds.length > 0 && unchanged && <Button asChild size="sm"><Link href={nextHref}>进入原型制作</Link></Button>}
  </section>;
}
