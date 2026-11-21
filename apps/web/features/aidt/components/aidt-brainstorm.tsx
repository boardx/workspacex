"use client";

import * as React from "react";
import Link from "next/link";
import { AIDT_BRAINSTORM_CANDIDATE_LIMIT, AIDT_BRAINSTORM_METHODS, AIDT_BRAINSTORM_PREFIX, aidtBrainstormTitle, readAidtBrainstorm, readAidtBrainstorms, type AidtBrainstorm } from "@repo/contracts/aidt-brainstorm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AidtEntityCard, AidtNewEntityCardButton } from "./aidt-entity-card";
import { useAidtCreateTags } from "./aidt-card-create-fields";
import { Input } from "@/components/ui/input";
import { addAidtBrainstormCandidates, confirmAidtBrainstormSelection, createAidtBrainstorm, readAidtBrainstormProposals, readAidtBrainstormSelection } from "../lib/aidt-brainstorm";
import { readAidtDefinition } from "../lib/aidt-definition";
import { readAidtIdeaDirectory } from "../lib/aidt-idea-handoff";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import type { AidtSharedStage } from "../lib/live-aidt-stages";

type SaveDraft = (change: (old: AidtUiStageDraft) => AidtUiStageDraft) => Promise<boolean>;
type Message = { id: string; role: string; content?: unknown };

export function AidtBrainstormDirectory({ definition, draft, readOnly, href, onOpen, saveDraft }: {
  definition?: AidtSharedStage | null;
  draft: AidtUiStageDraft;
  readOnly: boolean;
  href: (id: string) => string;
  onOpen: (id: string) => void;
  saveDraft: SaveDraft;
}) {
  const choices = definition ? readAidtDefinition(definition.content.draft.fields).hmws.filter(hmw => hmw.confirmed && !hmw.archived && hmw.text.trim()) : [];
  const sessions = readAidtBrainstorms(draft.fields);
  const tags = useAidtCreateTags(draft);
  const [action, setAction] = React.useState<{ kind: "create" } | { kind: "edit" | "delete"; session: AidtBrainstorm } | null>(null);
  const [title, setTitle] = React.useState("");
  const [hmw, setHmw] = React.useState("");
  const [method, setMethod] = React.useState<AidtBrainstorm["method"] | "">("");
  const [count, setCount] = React.useState("5");
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const draftId = React.useRef<{ key: string; id: string } | null>(null);
  const selected = choices.find(choice => choice.id === hmw);
  const planned = Number(count);
  const name = title.trim();
  const valid = action?.kind === "delete" || Boolean(name && (action?.kind === "edit" ? name !== action.session.title
    : selected && method && Number.isInteger(planned) && planned >= 1 && planned <= AIDT_BRAINSTORM_CANDIDATE_LIMIT));
  const style = "mt-1 w-full rounded-control border border-border bg-background p-2";
  const id = React.useId();
  const active = sessions.filter(session => !session.archived);
  const archived = sessions.filter(session => session.archived);

  function open(next: NonNullable<typeof action>) {
    tags.reset();
    setTitle(next.kind === "create" ? "" : aidtBrainstormTitle(next.session));
    setHmw("");
    setMethod("");
    setCount("5");
    setFailed(false);
    setAction(next);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || !valid || saving || readOnly) return;
    setSaving(true);
    setFailed(false);
    try {
      if (action.kind === "create") {
        if (!definition || !selected || !method) return;
        const key = JSON.stringify([name, selected.id, definition.revision, method, planned]);
        if (draftId.current?.key !== key) draftId.current = { key, id: `brainstorm-${crypto.randomUUID()}` };
        const session: AidtBrainstorm = { id: draftId.current.id, title: name,
          source: { id: selected.id, text: selected.text.trim(), revision: definition.revision },
          method, candidates: [], count: planned };
        if (!await saveDraft(old => tags.apply(createAidtBrainstorm(old, session), session.id))) { setFailed(true); return; }
        draftId.current = null;
        setAction(null);
        onOpen(session.id);
        return;
      }
      const { session: target } = action;
      if (!await saveDraft(old => {
        const existing = readAidtBrainstorm(old.fields, target.id);
        if (!existing || existing.archived) return old;
        const next = action.kind === "edit" ? { ...existing, title: name } : { ...existing, archived: true };
        return { ...old, fields: { ...old.fields, [AIDT_BRAINSTORM_PREFIX + target.id]: JSON.stringify(next) } };
      })) { setFailed(true); return; }
      setAction(null);
    } catch { setFailed(true); }
    finally { setSaving(false); }
  }

  return <section className="space-y-3" aria-label="头脑风暴">
    <header className="flex items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">头脑风暴</h2>
      {!readOnly && <AidtNewEntityCardButton disabled={!choices.length || saving} onClick={() => open({ kind: "create" })} />}
    </header>
    {!choices.length && <p className="text-13 text-muted-foreground">先在第 3 步确认一个 HMW。</p>}
    {active.length ? <ul className="grid gap-3 sm:grid-cols-2">{active.map(session => <AidtEntityCard key={session.id} entityId={session.id}>
      <Link className="block rounded-control px-4 py-3 transition-colors hover:bg-muted" href={href(session.id)} aria-label={`打开「${aidtBrainstormTitle(session)}」对话`}>
        <h3 className="break-words font-semibold">{aidtBrainstormTitle(session)}</h3>
        <p className="text-13">{AIDT_BRAINSTORM_METHODS[session.method]} · {session.candidates.length}/{session.count} 个候选</p>
        <p className="break-words text-12 text-muted-foreground">{session.source.text} · V{session.source.revision}</p>
      </Link>
      {!readOnly && <div className="flex justify-end gap-1 px-3 pb-2">
        <Button type="button" size="sm" variant="ghost" aria-label={`编辑 ${aidtBrainstormTitle(session)}`} onClick={() => open({ kind: "edit", session })}>编辑</Button>
        <Button type="button" size="sm" variant="ghost" aria-label={`删除 ${aidtBrainstormTitle(session)}`} onClick={() => open({ kind: "delete", session })}>删除</Button>
      </div>}
    </AidtEntityCard>)}</ul> : <p className="text-13 text-muted-foreground">暂无头脑风暴场次</p>}
    {archived.length > 0 && <details className="text-12"><summary>已删除场次（{archived.length}）</summary>
      <ul>{archived.map(session => <li key={session.id}>{aidtBrainstormTitle(session)}</li>)}</ul>
    </details>}
    <Dialog open={Boolean(action && !readOnly)} onOpenChange={open => { if (!open && !saving) setAction(null); }}>
      {action && <DialogContent>
        <DialogHeader>
          <DialogTitle>{action.kind === "create" ? "新建头脑风暴" : action.kind === "edit" ? "编辑头脑风暴" : "删除头脑风暴"}</DialogTitle>
          <DialogDescription>{action.kind === "delete" ? "删除后保留历史版本和点子。" : "为本轮讨论命名。"}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          {action.kind !== "delete" && <label className="block text-13">场次名称
            <Input className="mt-1" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} disabled={saving} />
          </label>}
          {action.kind === "create" && <>
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
          </>}
          {failed && <p role="alert" className="text-13 text-destructive">场次未能保存，请重试。</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setAction(null)}>取消</Button>
            <Button type="submit" variant={action.kind === "delete" ? "destructive" : "primary"} disabled={!valid || saving}>
              {saving ? "正在保存…" : action.kind === "create" ? "开始头脑风暴" : action.kind === "edit" ? "保存名称" : "确认删除"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>}
    </Dialog>
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
  const archived = Boolean(session.archived);
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
    if (readOnly || archived || loading || running || busy || attempted.current === proposalKey
      || addAidtBrainstormCandidates(draft, session.id, proposals) === draft) return;
    attempted.current = proposalKey;
    void persistCandidates();
  }, [archived, busy, draft, loading, persistCandidates, proposalKey, proposals, readOnly, running, session.id]);

  async function confirm() {
    if (!selected.length || unchanged || busy || readOnly || archived) return;
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
        <input type="checkbox" checked={selected.includes(idea.id)} disabled={readOnly || archived || busy || !selected.includes(idea.id) && selected.length >= 8} onChange={event =>
          setPicked(event.target.checked ? [...selected, idea.id] : selected.filter(id => id !== idea.id))} />
        <span><span className="block font-medium">{idea.title}</span><span className="text-muted-foreground">{idea.description}</span></span>
      </label></li>)}</ul>
      {!readOnly && !archived && <Button className="mt-3" size="sm" disabled={busy || selected.length === 0 || unchanged} onClick={() => void confirm()}>确认入选点子</Button>}
    </details>}
    {busy && <p role="status">正在保存…</p>}
    {failed && <p role="alert">保存失败。{addAidtBrainstormCandidates(draft, session.id, proposals) !== draft &&
      <Button variant="ghost" size="sm" onClick={() => void persistCandidates()}>重试保存候选</Button>}</p>}
    {nextHref && savedIds.length > 0 && unchanged && <Button asChild size="sm"><Link href={nextHref}>进入原型制作</Link></Button>}
  </section>;
}
