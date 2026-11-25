"use client";

import { Pencil, Trash2 } from "lucide-react";

import * as React from "react";
import Link from "next/link";
import { AIDT_BRAINSTORM_CANDIDATE_LIMIT, AIDT_BRAINSTORM_METHODS, AIDT_BRAINSTORM_METHOD_GUIDES, AIDT_BRAINSTORM_PREFIX, aidtBrainstormTitle, readAidtBrainstorm, readAidtBrainstorms, type AidtBrainstorm } from "@repo/contracts/aidt-brainstorm";
import { AidtConfirmAction } from "./aidt-confirm-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AidtCardFilters, AidtCardHeader, AidtCardStatus, AidtEntityCard, AidtNewEntityCardButton } from "./aidt-entity-card";
import { useAidtCreateTags } from "./aidt-card-create-fields";
import { Input } from "@/components/ui/input";
import { addAidtBrainstormCandidates, confirmAidtBrainstormCompletion, confirmAidtBrainstormSelection, createAidtBrainstorm, readAidtBrainstormProposals, readAidtBrainstormSelection, readAidtBrainstormSelectionForSession, readAidtConfirmedBrainstormRounds, aidtBrainstormRoundClassificationDraft, confirmAidtBrainstormClassification } from "../lib/aidt-brainstorm";
import { readAidtDefinition } from "../lib/aidt-definition";
import { readAidtIdeaDirectory, readAidtIdeaHmwSource, readAidtIdeaSheetIds } from "../lib/aidt-idea-handoff";
import { isAidtIdeaChatConfirmed } from "../lib/aidt-idea-chat";
import { isAidtResearchImage, parseAidtResearchMaterial, researchMaterialKey } from "../lib/aidt-research-material-reference";
import { AIDT_IDEA_CLASSIFICATION_FIELDS, aidtIdeaClassificationFor, readAidtIdeaClassification } from "../lib/aidt-idea-classification";
import { AidtBrainstormCandidates } from "./aidt-brainstorm-candidates";
import { AidtSavedTextPrint } from "./aidt-saved-text-print";
import { AidtIdeaClassification } from "./aidt-idea-classification";
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
  const methodGuide = method ? AIDT_BRAINSTORM_METHOD_GUIDES[method] : undefined;
  const name = title.trim();
  const valid = action?.kind === "delete" || Boolean(name && (action?.kind === "edit" ? true
    : selected && method && Number.isInteger(planned) && planned >= 1 && planned <= AIDT_BRAINSTORM_CANDIDATE_LIMIT));
  const style = "mt-1 w-full rounded-control border border-border bg-background p-2";
  const id = React.useId();
  const active = sessions.filter(session => !session.archived);
  const archived = sessions.filter(session => session.archived);

  function open(next: NonNullable<typeof action>) {
    tags.reset(next.kind === "edit" ? next.session.id : undefined);
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
        const updated = { ...old, fields: { ...old.fields, [AIDT_BRAINSTORM_PREFIX + target.id]: JSON.stringify(next) } };
        return action.kind === "edit" ? tags.apply(updated, target.id) : updated;
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
    <AidtCardFilters />
    {!choices.length && <p className="text-13 text-muted-foreground">先在第 3 步确认一个 HMW。</p>}
    {active.length ? <ul className="grid gap-4 sm:grid-cols-2">{active.map(session => <AidtEntityCard key={session.id} entityId={session.id}
      action={<Button asChild variant="primary" size="sm"><Link href={href(session.id)} aria-label={`打开「${aidtBrainstormTitle(session)}」对话`}>打开场次</Link></Button>}
      management={!readOnly && <>
        <Button type="button" size="sm" variant="outline" aria-label={`编辑 ${aidtBrainstormTitle(session)}`} onClick={() => open({ kind: "edit", session })}><Pencil aria-hidden className="size-4" />改名与标签</Button>
        <Button type="button" size="sm" variant="outline" aria-label={`删除 ${aidtBrainstormTitle(session)}`} onClick={() => open({ kind: "delete", session })}><Trash2 aria-hidden className="size-4" /></Button>
      </>}>
      <AidtCardHeader label={AIDT_BRAINSTORM_METHODS[session.method]}><AidtCardStatus>已保存</AidtCardStatus></AidtCardHeader>
      <h3 className="break-words text-16 font-semibold">{aidtBrainstormTitle(session)}</h3>
      <p className="break-words text-12 text-muted-foreground">{session.candidates.length}/{session.count} 个候选 · {session.source.text} · V{session.source.revision}</p>
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
          {action.kind !== "delete" && tags.field}
          {action.kind === "create" && <>
            <label className="block text-13">HMW
              <select className={style} value={hmw} onChange={event => setHmw(event.target.value)} disabled={saving}>
                <option value="">选择已确认的 HMW</option>
                {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.text}</option>)}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-13">发散方法
                <select className={style} value={method} onChange={event => {
                  const next = event.target.value as typeof method;
                  setMethod(next);
                }} disabled={saving}>
                  <option value="">选择一种方法</option>
                  {Object.entries(AIDT_BRAINSTORM_METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-13" htmlFor={id}>希望探索的点子数
                <Input className="mt-1" id={id} type="number" min={1} max={AIDT_BRAINSTORM_CANDIDATE_LIMIT} value={count} onChange={event => setCount(event.target.value)} disabled={saving} />
              </label>
            </div>
            {methodGuide && <div className="space-y-1 text-12 text-muted-foreground" data-testid="aidt-brainstorm-method-guide"><p>{methodGuide.description}</p><p>{methodGuide.startPrompt}</p></div>}
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
  const formal = readAidtConfirmedBrainstormRounds(draft, projectId, { sessionId: session.id, includeArchived: true })[0];
  const ideas = formal?.ideas ?? sessionIdeas(session, draft);
  const choice = readAidtBrainstormSelectionForSession(draft, session.id);
  const selected = formal?.selectedIds ?? choice?.selectedIds ?? [];
  const source = formal?.source ?? session.source;
  return <section className="space-y-3" aria-label="头脑风暴产物" data-testid="aidt-brainstorm-output">
    <h3 className="font-semibold">{AIDT_BRAINSTORM_METHODS[formal?.method ?? session.method]} · {ideas.length} 个候选{selected.length > 0 && ` · 入选 ${selected.length}`}</h3>
    <p className="text-13">{source.text} · <Link className="text-primary underline"
      href={`/aidt/${encodeURIComponent(projectId)}?${new URLSearchParams({ step: "3", entity: source.id, entityRevision: String(source.revision) })}`}>第 3 步 V{source.revision}</Link></p>
    {ideas.length ? <ol className="list-decimal space-y-2 pl-5 text-13">{ideas.map(idea => <li key={idea.id}>
      <span className="font-medium">{idea.title}</span>{selected.includes(idea.id) && <span className="ml-2 text-primary">入选</span>}
      <p className="text-muted-foreground">{idea.description}</p>
    </li>)}</ol> : <p className="text-13 text-muted-foreground">在对话中贡献第一个想法。</p>}
  </section>;
}

export function AidtBrainstormConversation({ projectId, session, draft, messages, loading, running, readOnly, saveDraft, nextHref }: {
  projectId: string;
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
  const saved = readAidtBrainstormSelectionForSession(draft, session.id);
  const formal = readAidtConfirmedBrainstormRounds(draft, projectId, { sessionId: session.id, includeArchived: true })[0];
  const savedIds = saved?.selectedIds ?? [];
  const [picked, setPicked] = React.useState<string[] | null>(null);
  const [reviewed, setReviewed] = React.useState<string[] | null>(null);
  const [classificationEdit, setClassificationEdit] = React.useState<{ base: string; fields: Record<string, string> } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const attempted = React.useRef<string | null>(null);
  const proposals = React.useMemo(() => readAidtBrainstormProposals(messages, session.id), [messages, session.id]);
  const proposalKey = JSON.stringify(proposals);
  const selected = (picked ?? savedIds).filter(id => ideas.some(idea => idea.id === id));
  const unchanged = selected.length === savedIds.length && selected.every(id => savedIds.includes(id));
  const activeIds = new Set(readAidtIdeaDirectory(draft).filter(idea => !idea.archived).map(idea => idea.id));
  const descriptionIdeas = draft.ideas.filter(idea => {
    const source = readAidtIdeaHmwSource(draft, idea.id);
    const owner = readAidtBrainstorms(draft.fields).find(record => record.candidates.includes(idea.id));
    return !owner?.archived && activeIds.has(idea.id) && source?.id === session.source.id && source.revision === session.source.revision && source.text === session.source.text;
  });
  const imageReady = (ideaId: string) => {
    const image = parseAidtResearchMaterial(draft.fields[researchMaterialKey("idea", ideaId)]);
    return image?.projectId === projectId && isAidtResearchImage(image);
  };
  const reviewableIds = descriptionIdeas.filter(idea => isAidtIdeaChatConfirmed(draft, idea.id) && imageReady(idea.id)).map(idea => idea.id);
  const savedSheetIds = formal?.sheetIds ?? (readAidtBrainstormSelection(draft)?.session.id === session.id ? readAidtIdeaSheetIds(draft) : []);
  const reviewedIds = (reviewed ?? savedSheetIds).filter(id => reviewableIds.includes(id));
  const sameReviewed = reviewedIds.length === savedSheetIds.length && reviewedIds.every(id => savedSheetIds.includes(id));
  const roundClassification = aidtBrainstormRoundClassificationDraft(draft, session.id, reviewedIds);
  const classificationBase = JSON.stringify([Object.values(AIDT_IDEA_CLASSIFICATION_FIELDS).map(key => roundClassification.fields[key]), roundClassification.ideas.map(idea => [idea.id, idea.title, idea.description])]);
  const editingClassification = classificationEdit?.base === classificationBase ? classificationEdit.fields : null;
  const classificationDraft = editingClassification ? { ...roundClassification, fields: { ...roundClassification.fields, ...editingClassification } } : roundClassification;
  const classSignature = (value: AidtUiStageDraft) => {
    const classification = readAidtIdeaClassification(value);
    return JSON.stringify(value.ideas.map(idea => [idea.id, idea.title, classification.tags[idea.id] ?? [], classification.reasons[idea.id] ?? ""]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  };
  const matchesFormal = Boolean(formal && readAidtIdeaClassification(roundClassification).confirmed
    && classSignature(roundClassification) === classSignature(formal.classificationDraft)
    && formal.selectedIds.length === savedIds.length && formal.selectedIds.every(id => savedIds.includes(id))
    && formal.ideas.every(idea => {
      const current = draft.ideas.find(item => item.id === idea.id);
      return current?.title === idea.title && current.description === idea.description
        && draft.fields[researchMaterialKey("idea", idea.id)] === formal.draft.fields[researchMaterialKey("idea", idea.id)];
    }));
  const completed = matchesFormal && unchanged && sameReviewed && !editingClassification;
  const canComplete = Boolean(saved && unchanged && savedIds.every(id => reviewedIds.includes(id)) && !editingClassification
    && confirmAidtBrainstormCompletion(draft, session.id, reviewedIds, projectId) !== draft);

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
      let accepted = false;
      const ok = await saveDraft(old => { const next = confirmAidtBrainstormSelection(old, session.id, selected); accepted = next !== old; return next; });
      if (ok && accepted) setPicked(null); else setFailed(true);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }

  async function complete() {
    if (!canComplete || busy || running || readOnly || archived) return;
    setBusy(true); setFailed(false);
    try {
      let accepted = false;
      const ok = await saveDraft(old => { const next = confirmAidtBrainstormCompletion(old, session.id, reviewedIds, projectId); accepted = next !== old; return next; });
      if (ok && accepted) setReviewed(null); else setFailed(true);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }

  return <section className="space-y-2 rounded-container border border-border p-3 text-13" aria-label="筛选点子">
    <AidtBrainstormCandidates {...{ projectId, session, draft, messages, loading, running, readOnly, saveDraft }} />
    <p>{AIDT_BRAINSTORM_METHODS[session.method]} · {ideas.length}/{session.count} 个候选</p>
    {ideas.length > 0 && <details>
      <summary className="cursor-pointer font-medium">筛选点子 · 已选 {selected.length}</summary>
      <p className="py-2 text-muted-foreground">在对话中比较点子，勾选要带入原型的候选。</p>
      <ul className="space-y-2">{ideas.map(idea => <li key={idea.id}><label className="flex items-start gap-2">
        <input type="checkbox" checked={selected.includes(idea.id)} disabled={readOnly || archived || busy || !selected.includes(idea.id) && selected.length >= 8} onChange={event =>
          setPicked(event.target.checked ? [...selected, idea.id] : selected.filter(id => id !== idea.id))} />
        <span><span className="block font-medium">{idea.title}</span><span className="text-muted-foreground">{idea.description}</span></span>
      </label></li>)}</ul>
      {!readOnly && !archived && <AidtConfirmAction className="mt-3" size="sm" disabled={busy || (unchanged && selected.length > 0)} blocker={selected.length === 0 ? "请至少勾选一个要入选的点子。" : null} onConfirm={() => void confirm()}>确认入选点子</AidtConfirmAction>}
    </details>}
    {formal && <section aria-label="本轮已确认结果" className="space-y-2 border-t border-border pt-3"><p className="text-12 font-medium">本轮已确认 {formal.sheetIds.length} 份正式描述单</p>
      <details className="text-13"><summary className="cursor-pointer">查看已确认结果（后续草稿不会替换这里）</summary><ol className="mt-2 space-y-2">{formal.ideas.map(idea => <li key={idea.id}><p className="font-medium">{idea.title}{formal.selectedIds.includes(idea.id) && " · 原始入选"}</p><p className="whitespace-pre-wrap text-muted-foreground">{idea.description}</p></li>)}</ol></details>
      <AidtSavedTextPrint projectId={projectId} artifactKey={session.id} stageId={4} label="打印分类与选择" draft={draft} selectText={value => {
        const snapshot = readAidtConfirmedBrainstormRounds(value, projectId, { sessionId: session.id, includeArchived: true })[0];
        if (!snapshot) return null;
        return ["# 点子分类与选择", `本轮：${snapshot.title}`, `方法：${AIDT_BRAINSTORM_METHODS[snapshot.method]}`,
          `HMW：${snapshot.source.text}（第3步 V${snapshot.source.revision}）`,
          ...snapshot.classificationDraft.ideas.map(idea => { const classification = aidtIdeaClassificationFor(snapshot.classificationDraft, idea.id); return `${idea.title}：${classification.labels.join("、") || "暂未分类"}；分类理由：${classification.reason || "未记录"}`; }),
          "学生原始入选：", ...snapshot.selectedIds.map(id => `${id} · ${snapshot.ideas.find(item => item.id === id)?.title || "未记录"}`),
          "已审阅正式描述单：", ...snapshot.ideas.map(idea => `${idea.title}：${idea.description}`)].join("\n\n");
      }} />
    </section>}
    {!readOnly && !archived && !savedIds.length && <AidtConfirmAction size="sm" disabled={busy || running} blocker="请先在「筛选点子」中勾选点子并确认入选，再审阅描述单与分类。" onConfirm={() => void complete()}>确认完成本阶段</AidtConfirmAction>}
    {savedIds.length > 0 && <section className="space-y-3 border-t border-border pt-3" aria-label="完成描述单与分类">
      <p className="text-12 text-muted-foreground">入选选择已保存为草稿。先逐份完善并审阅至少三份不同的图文描述单，再确认学生分类；同一版本 HMW 下可跨方法整理，未入选的其他候选可以保留草稿，不必全部制作。</p>
      <ul className="space-y-2">{descriptionIdeas.map(idea => <li key={idea.id} className="space-y-1">
        <Link className="text-primary underline" href={`/aidt/${encodeURIComponent(projectId)}?${new URLSearchParams({ step: "4", entity: idea.id })}`}>完善描述单：{idea.title}</Link>
        <label className="flex items-center gap-2"><input type="checkbox" aria-label={`已审阅描述单：${idea.title}`}
          checked={reviewedIds.includes(idea.id)} disabled={readOnly || archived || busy || running || !reviewableIds.includes(idea.id) || !reviewedIds.includes(idea.id) && reviewedIds.length >= 8}
          onChange={event => setReviewed(event.target.checked ? [...reviewedIds, idea.id] : reviewedIds.filter(id => id !== idea.id))} />
          {reviewableIds.includes(idea.id) ? "已核对名称、原图及两三句描述" : "先在该点子中补图并确认两三句描述"}</label>
      </li>)}</ul>

      <AidtIdeaClassification draft={classificationDraft} readOnly={readOnly || archived || busy || running} onChange={next => {
        if (readOnly || archived || busy || running) return;
        const fields = Object.fromEntries(Object.values(AIDT_IDEA_CLASSIFICATION_FIELDS).map(key => [key, next.fields[key] ?? ""]));
        setClassificationEdit({ base: classificationBase, fields });
        // Keep typing/checkbox changes local; the existing explicit classification
        // confirmation persists the whole review once, without locking each keypress.
        if (fields[AIDT_IDEA_CLASSIFICATION_FIELDS.confirmed] !== "true") return;
        setBusy(true); setFailed(false);
        const failedReview = () => { setFailed(true); setClassificationEdit({ base: classificationBase,
          fields: { ...fields, [AIDT_IDEA_CLASSIFICATION_FIELDS.confirmed]: "" } }); };
        let accepted = false;
        void saveDraft(old => { const changed = confirmAidtBrainstormClassification(old, session.id, reviewedIds, fields); accepted = changed !== old; return changed; })
          .then(ok => { if (ok && accepted) setClassificationEdit(null); else failedReview(); }).catch(failedReview).finally(() => setBusy(false));
      }} />
      <p role="status">{completed ? "本阶段已确认完成。" : `已审阅 ${reviewedIds.length} 份描述单；至少需要三份，且入选点子须包含在其中。`}</p>
      {!readOnly && !archived && <AidtConfirmAction size="sm" disabled={busy || running || completed} blocker={!canComplete ? (!unchanged ? "请先确认入选点子。" : savedIds.some(id => !reviewedIds.includes(id)) || reviewedIds.length < 3 ? "请审阅至少三份描述单，并包含所有已入选点子。" : "请完成并确认点子分类，确保本轮产物已保存。") : null} onConfirm={() => void complete()}>确认完成本阶段</AidtConfirmAction>}
    </section>}
    {busy && <p role="status">正在保存…</p>}
    {failed && <p role="alert">保存未完成。当前草稿仍保留；请核对版本冲突或记录容量（字段总数与单字段长度不放宽）。{addAidtBrainstormCandidates(draft, session.id, proposals) !== draft &&
      <Button variant="ghost" size="sm" onClick={() => void persistCandidates()}>重试保存候选</Button>}</p>}
    {nextHref && formal && <Button asChild size="sm"><Link href={nextHref}>使用已确认轮进入原型制作</Link></Button>}
  </section>;
}
