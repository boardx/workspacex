"use client";

import { aidtInterviewTitle } from "@repo/contracts/aidt-stages";
import * as React from "react";
import { ArrowUpRight, ListChecks, MessagesSquare, Paperclip, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TagField, commitDraft } from "@/components/ui/tag-input";
import { aggregateTags, hasTag, sameTag } from "@/lib/tag-utils";
import { archiveAidtInterview, interviewTagsLimit, isAidtInterviewArchived, isAidtInterviewConfirmed, readAidtInterviewMaterials, readAidtInterviews, writeAidtInterview, type AidtInterview } from "../lib/aidt-interviews";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

type Update = (change: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void;

export interface InterviewDetails { displayName: string; tags: string[] }
export function InterviewCardEditor({ record, knownTags, close, save }: { record?: AidtInterview; knownTags: Map<string, number>; close: () => void; save: (details: InterviewDetails) => void }) {
  const [name, setName] = React.useState(record?.displayName ?? "");
  const [tags, setTags] = React.useState<readonly string[]>(record?.tags ?? []);
  const [draftTag, setDraftTag] = React.useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    save({ displayName: name.trim(), tags: [...commitDraft(tags, draftTag, interviewTagsLimit)] });
    close();
  };
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent>
    <DialogTitle>{record ? "编辑访谈卡" : "新建访谈"}</DialogTitle>
    <DialogDescription>{record ? record.code + " · 受访者资料" : "可以使用化名，留空则显示受访者编号。"}</DialogDescription>
    <form className="space-y-5" onSubmit={submit}>
      <label className="block text-13 font-medium">受访者姓名或化名<input className="mt-2 w-full rounded-control border border-border bg-background px-3 py-2" value={name} maxLength={80} placeholder="例如：小林" onChange={event => setName(event.target.value)} /></label>
      {knownTags.size > 0 && <div role="group" aria-label="已有标签" className="flex flex-wrap gap-2">{[...knownTags.keys()].map(tag => {
        const selected = hasTag(tags, tag);
        return <Button type="button" key={tag} variant={selected ? "primary" : "outline"} size="xs" className="h-auto max-w-full whitespace-normal break-all rounded-full py-1.5" aria-pressed={selected} disabled={!selected && tags.length >= interviewTagsLimit.maxTags} onClick={() => setTags(selected ? tags.filter(value => !sameTag(value, tag)) : [...tags, tag])}>{tag}</Button>;
      })}</div>}
      <TagField label="访谈标签" {...interviewTagsLimit} value={tags} onChange={setTags} knownTags={knownTags} draft={draftTag} onDraftChange={setDraftTag} noteFor={count => count + " 个访谈"} testIdPrefix="interview-tag" />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={close}>取消</Button><Button type="submit">{record ? "保存修改" : "创建访谈"}</Button></div>
    </form>
  </DialogContent></Dialog>;
}

export function AidtInterviewCards({ records, projectId, draft, readOnly, onOpen, update, savedIds }: {
  savedIds?: ReadonlySet<string>; records: readonly AidtInterview[]; projectId: string; draft: AidtUiStageDraft; readOnly: boolean; onOpen: (id: string) => void; update: Update;
}) {
  const [tag, selectTag] = React.useState("");
  const [showArchived, setShowArchived] = React.useState(false);
  const [action, setAction] = React.useState<{ id: string; mode: "edit" | "remove" } | null>(null);
  const active = records.filter(record => !isAidtInterviewArchived(draft.fields, record.id));
  const archived = records.filter(record => isAidtInterviewArchived(draft.fields, record.id));
  const knownTags = aggregateTags(active);
  const filter = knownTags.has(tag) && !showArchived ? tag : "";
  const visible = (showArchived ? archived : active).filter(record => !filter || hasTag(record.tags ?? [], filter));
  const subject = active.find(record => record.id === action?.id);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <span className="mr-auto text-13 font-medium">{showArchived ? "已移除" : "全部访谈"} · {visible.length}</span>
      {!showArchived && active.length > 0 && <div role="group" aria-label="筛选标签" className="flex min-w-0 flex-wrap gap-2">
        {["", ...knownTags.keys()].map(value => <Button type="button" key={value} size="xs" variant={filter === value ? "primary" : "outline"} aria-pressed={filter === value} className="h-auto max-w-full whitespace-normal break-all rounded-full py-1.5" onClick={() => selectTag(value)}>{value || "全部"}</Button>)}
      </div>}
      {(archived.length > 0 || showArchived) && <Button type="button" size="sm" variant="ghost" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "返回访谈" : "查看已移除"}</Button>}
    </div>
    {!visible.length && <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/30 px-5 py-10 text-center"><Users aria-hidden className="size-6 text-muted-foreground" /><h5 className="font-medium">{showArchived ? "没有已移除的访谈" : "尚无访谈卡"}</h5>{!showArchived && <p className="text-13 text-muted-foreground">点击「新建访谈」建立第一张受访者卡。</p>}</div>}
    <ul aria-label="访谈卡片" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map(record => {
      const removed = isAidtInterviewArchived(draft.fields, record.id);
      const confirmed = isAidtInterviewConfirmed(draft.fields, record.id);
      const saved = !savedIds || savedIds.has(record.id);
      const status = removed ? "已归档" : confirmed ? "发现卡已核对" : record.guideConfirmed ? "清单已确认 · 发现待核对" : "提纲草稿";
      const materials = readAidtInterviewMaterials(draft.fields, record.id, projectId).length;
      return <li key={record.id} className="relative flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm">
        <div className="flex items-center justify-between gap-2"><span className="rounded-md bg-primary/10 px-2 py-1 text-12 font-semibold text-primary">{record.code}</span><span className="text-12 text-muted-foreground">{status}</span></div>
        <h5 className="break-words text-16 font-semibold">{record.displayName || ("受访者 " + record.code)}</h5>
        {record.goal && <p className="line-clamp-2 break-words text-13 text-muted-foreground">{record.goal}</p>}
        {!!record.tags?.length && <div className="flex flex-wrap gap-1">{record.tags.map(value => <span key={value} className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-11">{value}</span>)}</div>}
        <div className="mt-auto flex flex-wrap items-center gap-3 text-12 text-muted-foreground"><span className="inline-flex items-center gap-1"><ListChecks aria-hidden className="size-4" />{record.guideConfirmed ? "提纲已确认" : record.original ? "提纲已起草" : "待写提纲"}</span><span className="inline-flex items-center gap-1"><Paperclip aria-hidden className="size-4" />{materials} 份材料</span></div>
        <div className="flex items-center gap-1 border-t border-border pt-3">
          {!removed && <Button type="button" size="sm" disabled={!saved} title={saved ? undefined : "保存到小组后可打开对话"} variant="secondary" className="mr-auto after:absolute after:inset-0 after:rounded-2xl after:content-['']" aria-label={aidtInterviewTitle(record.code, record.displayName) + " 打开访谈 · " + status} onClick={() => onOpen(record.id)}><MessagesSquare aria-hidden className="size-4" />{saved ? "打开访谈" : "先保存到小组"}<ArrowUpRight aria-hidden className="size-3" /></Button>}
          {!readOnly && !removed && <>
            <Button type="button" size="sm" variant="ghost" className="relative z-10" title="修改受访者姓名和标签" onClick={() => setAction({ id: record.id, mode: "edit" })}><Pencil aria-hidden className="size-4" />改名与标签</Button>
            <Button type="button" size="sm" variant="ghost" className="relative z-10" aria-label="删除访谈卡" title="删除访谈卡" onClick={() => setAction({ id: record.id, mode: "remove" })}><Trash2 aria-hidden className="size-4" /></Button>
          </>}
        </div>
      </li>;
    })}</ul>
    {subject && !readOnly && action?.mode === "edit" && <InterviewCardEditor record={subject} knownTags={knownTags} save={details => update(old => {
      const current = readAidtInterviews(old.fields).find(row => row.id === subject.id);
      return !current || isAidtInterviewArchived(old.fields, current.id) ? old : writeAidtInterview(old, { ...current, ...details });
    })} close={() => setAction(null)} />}
    {subject && !readOnly && action?.mode === "remove" && <Dialog open onOpenChange={open => { if (!open) setAction(null); }}><DialogContent>
      <DialogTitle>删除访谈卡？</DialogTitle><DialogDescription>{subject.displayName || subject.code} 将移至「已移除」。已有引用和保存的材料将保留。</DialogDescription>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setAction(null)}>取消</Button><Button variant="destructive" onClick={() => { update(old => archiveAidtInterview(old, subject.id)); setAction(null); }}>确认删除</Button></div>
    </DialogContent></Dialog>}
  </div>;
}
