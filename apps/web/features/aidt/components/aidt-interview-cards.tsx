"use client";

import { aidtInterviewTitle } from "@repo/contracts/aidt-stages";
import * as React from "react";
import { AidtCardHeader, AidtCardStatus, AidtEntityCard } from "./aidt-entity-card";
import { ArrowUpRight, ListChecks, MessagesSquare, Paperclip, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TagFilterBar } from "@/components/ui/tag-filter-bar";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TagField, commitDraft } from "@/components/ui/tag-input";
import { aggregateTags, hasTag, matchesQuery, sameTag } from "@/lib/tag-utils";
import { archiveAidtInterview, interviewTagsLimit, isAidtInterviewArchived, isAidtInterviewConfirmed, isAidtObservation, readAidtInterviewMaterials, readAidtInterviews, writeAidtInterview, type AidtInterview } from "../lib/aidt-interviews";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

type Update = (change: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void;

function restoreDialogOpener(event: Event, target: HTMLElement | null) {
  event.preventDefault();
  if (target?.isConnected && !target.matches(":disabled") && !target.closest("[inert]")) target.focus({ preventScroll: true });
}

export interface InterviewDetails { displayName: string; tags: string[]; kind?: AidtInterview["kind"] }
export function InterviewCardEditor({ record, knownTags, close, save, source, returnFocusTo }: { returnFocusTo?: HTMLElement | null; source?: string; record?: AidtInterview; knownTags: Map<string, number>; close: () => void; save: (details: InterviewDetails) => void | Promise<boolean> }) {
  const [opener] = React.useState<HTMLElement | null>(() => returnFocusTo ?? (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const [name, setName] = React.useState(record?.displayName ?? "");
  const [tags, setTags] = React.useState<readonly string[]>(record?.tags ?? []);
  const [draftTag, setDraftTag] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [kind, setKind] = React.useState<NonNullable<AidtInterview["kind"]>>(record?.kind ?? "interview");
  const observation = kind === "observation";
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const saved = save({ displayName: name.trim(), tags: [...commitDraft(tags, draftTag, interviewTagsLimit)],
        ...(record ? record.kind ? { kind: record.kind } : {} : { kind }),
      });
      if (saved && !await saved) setFailed(true);
      else close();
    } catch { setFailed(true); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}><DialogContent onCloseAutoFocus={event => restoreDialogOpener(event, opener)}>
    <DialogTitle>{record ? observation ? "编辑观察卡" : "编辑访谈卡" : observation ? "新建观察" : "新建访谈"}</DialogTitle>
    <DialogDescription>{observation ? record ? record.code + " · 观察资料" : "记录一次真实观察。用简短名称说明观察的对象或情境。" : record ? record.code + " · 受访者资料" : "可以使用化名，留空则显示受访者编号。"}</DialogDescription>
    <form className="space-y-5" onSubmit={submit}>
      {!record && <fieldset disabled={busy} className="space-y-2"><legend className="text-13 font-medium">研究方式</legend><div className="flex gap-5"><label className="flex items-center gap-2 text-13"><input type="radio" name="aidt-research-kind" value="interview" checked={!observation} onChange={() => setKind("interview")} />访谈</label><label className="flex items-center gap-2 text-13"><input type="radio" name="aidt-research-kind" value="observation" checked={observation} onChange={() => setKind("observation")} />观察</label></div></fieldset>}
      <label className="block text-13 font-medium">{observation ? "观察对象或情境名称" : "受访者姓名或化名"}<input className="mt-2 w-full rounded-control border border-border bg-background px-3 py-2" value={name} maxLength={80} placeholder={observation ? "例如：午间排队取餐" : "例如：小林"} onChange={event => setName(event.target.value)} /></label>
      {source && <div className="text-13"><p className="font-medium">来源研究问题</p><p>{source}</p></div>}
      {knownTags.size > 0 && <div role="group" aria-label="已有标签" className="flex flex-wrap gap-2">{[...knownTags.keys()].map(tag => {
        const selected = hasTag(tags, tag);
        return <Button type="button" key={tag} variant={selected ? "primary" : "outline"} size="xs" className="h-auto max-w-full whitespace-normal break-all rounded-full py-1.5" aria-pressed={selected} disabled={!selected && tags.length >= interviewTagsLimit.maxTags} onClick={() => setTags(selected ? tags.filter(value => !sameTag(value, tag)) : [...tags, tag])}>{tag}</Button>;
      })}</div>}
      <TagField label={observation ? "观察标签" : "访谈标签"} {...interviewTagsLimit} value={tags} onChange={setTags} knownTags={knownTags} draft={draftTag} onDraftChange={setDraftTag} noteFor={count => count + " 个研究记录"} testIdPrefix="interview-tag" />
      {failed && <p role="alert">{observation ? "观察" : "访谈"}未能保存。请重试创建。</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={close}>取消</Button><Button type="submit" disabled={busy}>{record ? "保存修改" : observation ? "创建观察" : "创建访谈"}</Button></div>
    </form>
  </DialogContent></Dialog>;
}

export function AidtInterviewCards({ records, projectId, draft, readOnly, onOpen, update, savedIds }: {
  savedIds?: ReadonlySet<string>; records: readonly AidtInterview[]; projectId: string; draft: AidtUiStageDraft; readOnly: boolean; onOpen: (id: string) => void; update: Update;
}) {
  const [tag, selectTag] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [showArchived, setShowArchived] = React.useState(false);
  const actionOpener = React.useRef<HTMLElement | null>(null);
  const [action, setAction] = React.useState<{ id: string; mode: "edit" | "remove" } | null>(null);
  const active = records.filter(record => !isAidtInterviewArchived(draft.fields, record.id));
  const archived = records.filter(record => isAidtInterviewArchived(draft.fields, record.id));
  const knownTags = aggregateTags(active);
  const filter = knownTags.has(tag) && !showArchived ? tag : "";
  const filtering = !showArchived && Boolean(filter || query.trim());
  const clear = () => { selectTag(""); setQuery(""); };
  const visible = (showArchived ? archived : active).filter(record => showArchived
    || (!filter || hasTag(record.tags ?? [], filter)) && matchesQuery(query, [], record.tags ?? []));
  const subject = active.find(record => record.id === action?.id);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <span className="mr-auto text-13 font-medium">{showArchived ? "已移除" : active.some(isAidtObservation) ? "全部研究记录" : "全部访谈"} · {visible.length}</span>

      {(archived.length > 0 || showArchived) && <Button type="button" size="sm" variant="ghost" onClick={() => { clear(); setShowArchived(!showArchived); }}>{showArchived ? "返回访谈" : "查看已移除"}</Button>}
    </div>
    {!showArchived && active.length > 0 && <div className="flex items-center gap-2"><Input aria-label="搜索卡片标签" placeholder="搜索标签" value={query} onChange={event => setQuery(event.currentTarget.value)} />{filtering && <Button type="button" size="sm" variant="ghost" onClick={clear}>清除筛选</Button>}</div>}
    {!showArchived && knownTags.size > 0 && <TagFilterBar tags={[...knownTags].map(([tag, count]) => ({ tag, count }))} selected={filter ? [filter] : []} onChange={next => next.length ? selectTag(next[0]!) : clear()} prefix="aidt-interview" business="卡片" mode="single" allActive={!filtering} />}
    {!visible.length && <div role="status" className="grid justify-items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/30 px-5 py-10 text-center"><Users aria-hidden className="size-6 text-muted-foreground" /><h5 className="font-medium">{filtering ? "没有匹配的研究记录" : showArchived ? "没有已移除的访谈" : "尚无访谈卡"}</h5>{!showArchived && !filtering && <p className="text-13 text-muted-foreground">点击「新建访谈」建立第一张受访者卡。</p>}</div>}
    <ul aria-label="访谈卡片" className="grid gap-4 sm:grid-cols-2">{visible.map(record => {
      const observation = isAidtObservation(record);
      const removed = isAidtInterviewArchived(draft.fields, record.id);
      const confirmed = isAidtInterviewConfirmed(draft.fields, record.id);
      const saved = !savedIds || savedIds.has(record.id);
      const status = removed ? "已归档" : confirmed ? "发现卡已核对" : record.guideConfirmed ? observation ? "观察计划已确认 · 发现待核对" : "清单已确认 · 发现待核对" : observation ? "观察计划草稿" : "提纲草稿";
      const materials = readAidtInterviewMaterials(draft.fields, record.id, projectId).length;
      return <AidtEntityCard key={record.id} entityId={record.id} className="relative" useSharedTags={false}
        action={!removed && <Button type="button" size="sm" disabled={!saved} title={saved ? undefined : "保存到小组后可打开对话"} variant="primary" className="after:absolute after:inset-0 after:rounded-2xl after:content-['']" aria-label={aidtInterviewTitle(record.code, record.displayName) + (observation ? " 打开观察 · " : " 打开访谈 · ") + status} onClick={() => onOpen(record.id)}><MessagesSquare aria-hidden className="size-4" />{saved ? observation ? "打开观察" : "打开访谈" : "先保存到小组"}<ArrowUpRight aria-hidden className="size-3" /></Button>}
        management={!readOnly && !removed && <>
          <Button type="button" size="sm" variant="ghost" className="relative z-10" title={observation ? "修改观察名称和标签" : "修改受访者姓名和标签"} onClick={event => { actionOpener.current = event.currentTarget; setAction({ id: record.id, mode: "edit" }); }}><Pencil aria-hidden className="size-4" />改名与标签</Button>
          <Button type="button" size="sm" variant="ghost" className="relative z-10" aria-label={observation ? "删除观察卡" : "删除访谈卡"} title={observation ? "删除观察卡" : "删除访谈卡"} onClick={event => { actionOpener.current = event.currentTarget; setAction({ id: record.id, mode: "remove" }); }}><Trash2 aria-hidden className="size-4" /></Button>
        </>}>
        <AidtCardHeader label={record.code}><AidtCardStatus confirmed={confirmed && !removed}>{status}</AidtCardStatus></AidtCardHeader>
        <h5 className="break-words text-16 font-semibold">{record.displayName || ((observation ? "观察 " : "受访者 ") + record.code)}</h5>
        {observation && <p className="text-12 text-muted-foreground">观察记录</p>}
        {record.goal && <p className="line-clamp-2 break-words text-13 text-muted-foreground">{record.goal}</p>}
        {!!record.tags?.length && <div className="flex flex-wrap gap-1">{record.tags.map(value => <span key={value} className="max-w-full break-all rounded-full bg-muted px-2 py-0.5 text-11">{value}</span>)}</div>}
        <div className="flex flex-wrap items-center gap-3 text-12 text-muted-foreground"><span className="inline-flex items-center gap-1"><ListChecks aria-hidden className="size-4" />{record.guideConfirmed ? observation ? "观察关注点已确认" : "提纲已确认" : record.original ? observation ? "观察计划已起草" : "提纲已起草" : observation ? "待写观察关注点" : "待写提纲"}</span><span className="inline-flex items-center gap-1"><Paperclip aria-hidden className="size-4" />{materials} 份材料</span></div>
      </AidtEntityCard>;
    })}</ul>
    {subject && !readOnly && action?.mode === "edit" && <InterviewCardEditor returnFocusTo={actionOpener.current} record={subject} knownTags={knownTags} save={details => update(old => {
      const current = readAidtInterviews(old.fields).find(row => row.id === subject.id);
      return !current || isAidtInterviewArchived(old.fields, current.id) ? old : writeAidtInterview(old, { ...current, ...details });
    })} close={() => setAction(null)} />}
    {subject && !readOnly && action?.mode === "remove" && <Dialog open onOpenChange={open => { if (!open) setAction(null); }}><DialogContent onCloseAutoFocus={event => restoreDialogOpener(event, actionOpener.current)}>
      <DialogTitle>{isAidtObservation(subject) ? "删除观察卡？" : "删除访谈卡？"}</DialogTitle><DialogDescription>{subject.displayName || subject.code} 将移至「已移除」。已有引用和保存的材料将保留。</DialogDescription>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setAction(null)}>取消</Button><Button variant="destructive" onClick={() => { update(old => archiveAidtInterview(old, subject.id)); setAction(null); }}>确认删除</Button></div>
    </DialogContent></Dialog>}
  </div>;
}
