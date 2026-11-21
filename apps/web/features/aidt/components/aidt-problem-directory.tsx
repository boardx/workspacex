"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addAidtProblem, archiveAidtProblem, listAidtProblems } from "../lib/aidt-problem-entities";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

export function AidtProblemDirectory({ draft, savedDraft, update, href, readOnly }: {
  draft: AidtUiStageDraft;
  savedDraft?: AidtUiStageDraft;
  update: (mutate: (old: AidtUiStageDraft) => AidtUiStageDraft) => void;
  href: (id: string) => string;
  readOnly: boolean;
}) {
  const [title, setTitle] = React.useState("");
  const saved = new Set(savedDraft ? listAidtProblems(savedDraft).filter(item => !item.archived).map(item => item.id) : []);
  const items = listAidtProblems(draft);
  return <section className="space-y-3" data-testid="aidt-problem-directory">
    {!readOnly && <form className="flex flex-wrap gap-2" onSubmit={event => {
      event.preventDefault();
      if (!title.trim()) return;
      const id = crypto.randomUUID();
      update(old => addAidtProblem(old, id, title));
      setTitle("");
    }}>
      <Input className="max-w-md" aria-label="问题名称" maxLength={120} value={title} onChange={event => setTitle(event.target.value)} />
      <Button variant="outline" type="submit" disabled={!title.trim()}>新建问题</Button>
    </form>}
    {items.length === 0 && <p className="text-13 text-muted-foreground">新建问题后，打开该问题的工作坊对话。</p>}
    <ul className="space-y-2">{items.map(item => <li key={item.id} className="flex flex-wrap items-center gap-2">
      {item.archived ? <span>{item.title} · 已归档</span>
        : saved.has(item.id) ? <Button asChild variant="outline"><Link href={href(item.id)}>{item.title}</Link></Button>
        : <span>{item.title} · 待保存</span>}
      {saved.has(item.id) && !item.archived && !readOnly && <Button type="button" size="sm" variant="ghost"
        onClick={() => update(old => archiveAidtProblem(old, item.id))}>归档问题</Button>}
    </li>)}</ul>
  </section>;
}
