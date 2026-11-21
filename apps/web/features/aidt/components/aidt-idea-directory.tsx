"use client";
import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { archiveAidtIdea, createAidtIdea, readAidtIdeaDirectory } from "../lib/aidt-idea-handoff";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

export function AidtIdeaDirectory({ draft, saved, href, update, readOnly }: {
  draft: AidtUiStageDraft;
  saved: AidtUiStageDraft | undefined;
  href: (id: string) => string;
  update: (change: (old: AidtUiStageDraft) => AidtUiStageDraft) => void;
  readOnly: boolean;
}) {
  const [archive, setArchive] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const items = readAidtIdeaDirectory(draft);
  const savedIds = new Set(saved ? readAidtIdeaDirectory(saved).filter(item => !item.archived).map(item => item.id) : []);
  return <section aria-label="创意发散 · 点子列表" className="space-y-4" data-testid="aidt-idea-directory">
    {!readOnly && <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault();
      const newTitle = title.trim();
      if (!newTitle || items.length >= 8) return;
      const id = `idea-${crypto.randomUUID()}`;
      update(old => createAidtIdea(old, id, newTitle));
      setTitle("");
    }}>
      <label className="space-y-1 text-13">
        <span className="block">点子名称</span>
        <input maxLength={120} value={title} onChange={event => setTitle(event.currentTarget.value)}
          className="rounded-md border border-border bg-background p-2" />
      </label>
      <Button type="submit" disabled={!title.trim() || items.length >= 8}>新建点子</Button>
    </form>}
    {items.length === 0 ? <p role="status" className="text-13 text-muted-foreground">本轮还没有点子。</p> :
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map(item => <li key={item.id} className="rounded-lg border border-border p-3">
          <h3 className="break-words font-medium">{item.title}</h3>
          {savedIds.has(item.id) && !item.archived ? <Link className="text-13 text-primary underline" href={href(item.id)}>打开「{item.title}」对话</Link>
            : <p className="text-12 text-muted-foreground">{item.archived ? "已归档" : "保存到小组后可打开独立对话"}</p>}
          {!readOnly && !item.archived && (archive === item.id
            ? <div className="space-y-1" role="group" aria-label={`归档「${item.title}」`}>
              <p className="text-12">已保存的历史版本和引用仍可回看。</p>
              <Button size="sm" variant="outline" onClick={() => { update(old => archiveAidtIdea(old, item.id)); setArchive(null); }}>确认归档</Button>
              <Button size="sm" variant="ghost" onClick={() => setArchive(null)}>取消</Button>
            </div>
            : <Button size="sm" variant="ghost" onClick={() => setArchive(item.id)}>归档</Button>)}
        </li>)}
      </ul>}
  </section>;
}
