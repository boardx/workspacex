"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  canConfirmAidtIdeaSheets, invalidateAidtIdeaSheets, readAidtIdeaHandoff, readAidtIdeaHandoffIds,
  readAidtIdeaHmwSource, readAidtIdeaSheetIds, type AidtIdeaHmwSource,
} from "../lib/aidt-idea-handoff";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

export type AidtIdeaHandoffContext = {
  hmw?: AidtIdeaHmwSource;
  savedRevision?: number;
  matchesServer: boolean;
  nextHref: string;
};

type IdeaEditorProps = {
  context: AidtIdeaHandoffContext;
  draft: AidtUiStageDraft;
  readOnly: boolean;
  update: (change: (old: AidtUiStageDraft) => AidtUiStageDraft) => void;
};

export function AidtIdeaHmw({ context, draft, readOnly, update }: IdeaEditorProps) {
  const pinned = readAidtIdeaHmwSource(draft);
  const latest = context.hmw;
  return <section aria-label="本轮 HMW" className="space-y-2 rounded-lg border border-border p-3 text-13">
    <h4 className="font-semibold">本轮 HMW</h4>
    {pinned ? <p>第 3 步 V{pinned.revision} · {pinned.text}</p> : <p role="status">{latest?.text ?? "请先在第 3 步选择并保存一条 HMW。"}</p>}
    {!readOnly && !pinned && latest && <Button size="sm" variant="outline" onClick={() => update(old => {
      const next = invalidateAidtIdeaSheets(old);
      return { ...next, fields: { ...next.fields, ideaHmwSource: JSON.stringify(latest) } };
    })}>将此 HMW 用于本轮</Button>}
    {pinned && latest && latest.revision !== pinned.revision && <p className="text-12 text-muted-foreground">第 3 步已有 V{latest.revision}，本轮保留原引用。</p>}
  </section>;
}

export function AidtIdeaHandoff({ context, draft, projectId, reviewedSheetIds, readOnly, update }: IdeaEditorProps & {
  projectId: string;
  reviewedSheetIds: string[];
}) {
  const savedSheets = readAidtIdeaSheetIds(draft);
  const confirmedSheets = canConfirmAidtIdeaSheets(draft, savedSheets, projectId);
  const selectedIds = readAidtIdeaHandoffIds(draft);
  const handoff = readAidtIdeaHandoff(draft, projectId);
  return <section aria-label="描述单及原型交接" className="space-y-3 rounded-lg border border-border p-3 text-13">
    <h4 className="font-semibold">描述单及原型交接</h4>
    <p>先确认分类，逐份审阅至少三个点子的描述单。交接使用已关联到项目的原始图片。</p>
    {!confirmedSheets && !readOnly && <Button size="sm" variant="outline"
      disabled={!canConfirmAidtIdeaSheets(draft, reviewedSheetIds, projectId)}
      onClick={() => update(old => ({ ...old, fields: { ...old.fields, ideaSheetIds: JSON.stringify(reviewedSheetIds), ideaHandoffIds: "" } }))}>
      确认本轮描述单
    </Button>}
    {confirmedSheets && <fieldset className="space-y-2" disabled={readOnly}>
      <legend>带入原型的点子</legend>
      {draft.ideas.filter(idea => savedSheets.includes(idea.id)).map(idea => <label key={idea.id} className="flex items-center gap-2">
        <input type="checkbox" checked={selectedIds.includes(idea.id)} onChange={event => {
          const checked = event.currentTarget.checked;
          update(old => {
            const selected = new Set(readAidtIdeaHandoffIds(old));
            if (checked) selected.add(idea.id);
            else selected.delete(idea.id);
            return { ...old, fields: { ...old.fields, ideaHandoffIds: JSON.stringify([...selected]) } };
          });
        }} />
        {idea.title}
      </label>)}
    </fieldset>}
    {handoff && context.matchesServer && context.savedRevision ? <div className="flex flex-wrap items-center gap-2">
      <p role="status">已保存 V{context.savedRevision} · {handoff.selectedIds.length} 个点子</p>
      {!readOnly && <Button asChild size="sm"><Link href={context.nextHref}>带入原型制作</Link></Button>}
    </div> : handoff && <p role="status">保存到小组后，才能带入原型制作。</p>}
  </section>;
}
