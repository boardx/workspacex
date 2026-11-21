"use client";

import * as React from "react";
import { AidtEntityCard, AidtNewEntityCardButton } from "./aidt-entity-card";
import Link from "next/link";
import { ArrowUpRight, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AIDT_PROBLEM_TITLE_MAX_LENGTH, addAidtProblem, archiveAidtProblem, canAddAidtProblem, listAidtProblems, renameAidtProblem } from "../lib/aidt-problem-entities";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import type { useAidtSharedStages } from "../lib/use-aidt-shared-stages";

type ProblemAction = { kind: "create" | "edit" | "delete"; id: string; original: string };
const actionTitles = { create: "新建问题", edit: "编辑问题", delete: "删除问题" };

export function AidtProblemDirectory({ draft, href, controller, readOnly }: {
  draft: AidtUiStageDraft;
  href: (id: string) => string;
  controller: Pick<ReturnType<typeof useAidtSharedStages>, "write" | "needsBaseReview" | "saveDraft">;
  readOnly: boolean;
}) {
  const [action, setAction] = React.useState<ProblemAction | null>(null);
  const [title, setTitle] = React.useState("");
  const [error, setError] = React.useState(false);
  const titleId = React.useId();
  const headingId = React.useId();
  const heading = React.useRef<HTMLHeadingElement>(null);
  const createButton = React.useRef<HTMLButtonElement>(null);
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  const focusCard = React.useRef<string | null>(null);

  const items = listAidtProblems(draft).filter(item => !item.archived);
  const saving = controller.write.phase === "saving";
  const atCapacity = !canAddAidtProblem(draft);
  const mutationsDisabled = saving || controller.needsBaseReview;
  const creating = action?.kind === "create";
  const deleting = action?.kind === "delete";
  const current = action && items.find(item => item.id === action.id);
  const trimmedTitle = title.trim();
  const canSubmit = !readOnly && !mutationsDisabled && (creating
    ? !atCapacity && Boolean(trimmedTitle)
    : Boolean(current && (deleting || (trimmedTitle && trimmedTitle !== current.title))));

  function open(next: ProblemAction, target: HTMLButtonElement) {
    trigger.current = target;
    setAction(next);
    setTitle(next.original);
    setError(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || !canSubmit) return;
    setError(false);
    const { kind, id } = action;
    const saved = await controller.saveDraft(old => kind === "create" ? addAidtProblem(old, id, trimmedTitle)
      : kind === "edit" ? renameAidtProblem(old, id, trimmedTitle) : archiveAidtProblem(old, id));
    if (saved) {
      if (kind === "create") focusCard.current = id;
      setAction(null);
    } else setError(true);
  }

  const create = !readOnly && <AidtNewEntityCardButton ref={createButton} disabled={mutationsDisabled || atCapacity}
    onClick={event => open({ kind: "create", id: crypto.randomUUID(), original: "" }, event.currentTarget)} />;

  return <section aria-labelledby={headingId} className="space-y-4" data-testid="aidt-problem-directory">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 ref={heading} tabIndex={-1} id={headingId} className="text-xl font-semibold">问题列表</h2>
      {items.length > 0 && create}
    </header>
    {items.length === 0 ? <div className="flex flex-col items-center gap-4 rounded-container border border-dashed border-border bg-muted px-5 py-12 text-center" data-testid="empty">
      <div className="grid size-12 place-items-center rounded-container border border-border bg-card text-primary"><MessageSquare className="size-6" aria-hidden /></div>
      <div className="space-y-1.5">
        <h3 className="text-16 font-semibold">{readOnly ? "暂无问题" : "先新建一个问题"}</h3>
        <p className="text-13 text-muted-foreground">{readOnly ? "小组新建的问题会显示在这里。" : "写下小组想了解的问题，再打开卡片进入工作坊。"}</p>
      </div>
      {create}
    </div> : <ul className="grid gap-3 sm:grid-cols-2">
      {items.map(item => <AidtEntityCard key={item.id} entityId={item.id}>
        <Link id={`aidt-problem-card-${item.id}`} href={href(item.id)} aria-label={item.title}
          className="group flex flex-1 gap-3 rounded-container p-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <span className="grid size-9 shrink-0 place-items-center rounded-control bg-muted text-primary"><MessageSquare className="size-4" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-16 font-semibold leading-snug">{item.title}</h3>
            <p className="mt-2 text-12 text-muted-foreground">打开工作坊</p>
          </div>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />
        </Link>
        {!readOnly && <div className="flex flex-wrap justify-end gap-1 border-t border-border px-3 py-2">
          <Button type="button" size="sm" variant="ghost" aria-label={`编辑问题 ${item.title}`} disabled={mutationsDisabled}
            onClick={event => open({ kind: "edit", id: item.id, original: item.title }, event.currentTarget)}><Pencil className="size-3.5" aria-hidden />编辑</Button>
          <Button type="button" size="sm" variant="ghost" aria-label={`删除问题 ${item.title}`} disabled={mutationsDisabled}
            onClick={event => open({ kind: "delete", id: item.id, original: item.title }, event.currentTarget)}><Trash2 className="size-3.5" aria-hidden />删除</Button>
        </div>}
      </AidtEntityCard>)}
    </ul>}
    {atCapacity && !readOnly && <p role="status" className="text-13 text-muted-foreground">本步已达到小组草稿容量上限。</p>}
    <Dialog open={Boolean(action && !readOnly)} onOpenChange={open => { if (!open && !saving) setAction(null); }}>
      {action && <DialogContent hideClose onCloseAutoFocus={event => {
        event.preventDefault();
        const card = focusCard.current && document.getElementById(`aidt-problem-card-${focusCard.current}`);
        const previous = trigger.current?.isConnected && !trigger.current.disabled ? trigger.current : null;
        (card || previous || (!createButton.current?.disabled && createButton.current) || heading.current)?.focus();
        focusCard.current = null;
      }}>
        <DialogHeader>
          <DialogTitle>{actionTitles[action.kind]}</DialogTitle>
          <DialogDescription className="break-words">{deleting
            ? `删除「${action.original}」后，它将从问题列表移除。已保存的历史版本和引用会保留。`
            : creating ? "创建后，小组成员可以打开这张卡片继续讨论。" : "改名后，仍可从卡片进入原有的工作坊对话。"}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          {!deleting && <div className="space-y-2">
            <label htmlFor={titleId} className="block text-13 font-medium">问题名称</label>
            <Input id={titleId} maxLength={AIDT_PROBLEM_TITLE_MAX_LENGTH} value={title} disabled={saving}
              placeholder={creating ? "例如：新同学如何找到合适的自习空间？" : undefined}
              onChange={event => setTitle(event.currentTarget.value)} />
          </div>}
          {error && <p role="alert" className="text-13 text-destructive" data-testid="err-aidt-problem-save">{controller.needsBaseReview
            ? "另一位成员更新了问题列表。请关闭弹窗，核对最新版本后再操作。"
            : "操作尚未确认，请重试。"}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setAction(null)}>{controller.needsBaseReview ? "关闭" : "取消"}</Button>
            <Button type="submit" variant={deleting ? "destructive" : "primary"} disabled={!canSubmit}>
              {saving ? "正在保存…" : creating ? "创建问题" : deleting ? "确认删除" : "保存修改"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>}
    </Dialog>
  </section>;
}
