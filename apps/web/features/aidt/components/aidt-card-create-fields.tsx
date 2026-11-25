"use client";

import { TagField, commitDraft } from "@/components/ui/tag-input";
import * as React from "react";
import { aidtCardTagLimits as limits, cardTagPrefix, readAidtEntityCardTags, updateAidtEntityCardTags } from "./aidt-entity-card";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

export function useAidtCreateTags(draft: AidtUiStageDraft) {
  const [tags, setTags] = React.useState<readonly string[]>([]);
  const [entry, setEntry] = React.useState("");
  const [editError, setEditError] = React.useState(false);
  function applyTags(next: AidtUiStageDraft, id: string) {
    const wanted = commitDraft(tags, entry, limits);
    const tagged = updateAidtEntityCardTags(next, id, wanted);
    return wanted.length && readAidtEntityCardTags(tagged.fields, id).length !== wanted.length ? null : tagged;
  }
  const known = new Map<string, number>();
  for (const key of Object.keys(draft.fields)) {
    if (!key.startsWith(cardTagPrefix)) continue;
    for (const tag of readAidtEntityCardTags(draft.fields, key.slice(cardTagPrefix.length))) known.set(tag, (known.get(tag) ?? 0) + 1);
  }
  return {
    reset(id?: string) { setTags(id ? readAidtEntityCardTags(draft.fields, id) : []); setEntry(""); setEditError(false); },
    apply(next: AidtUiStageDraft, id: string) {
      const tagged = applyTags(next, id);
      if (!tagged) throw new Error("标签未保存");
      return tagged;
    },
    applyEdit: applyTags,
    validateEdit(next: AidtUiStageDraft, id: string) {
      const valid = applyTags(next, id) !== null;
      setEditError(!valid);
      return valid;
    },
    editError,
    field: <TagField label="卡片标签" {...limits} value={tags} onChange={setTags} knownTags={known} draft={entry} onDraftChange={setEntry} noteFor={count => count + " 张卡片"} testIdPrefix="card-create-tag" />,
  };
}

export function AidtCardSources({ label, options, selected, select }: { label: string; options: readonly { id: string; title: string }[]; selected: readonly string[]; select: (ids: string[]) => void }) {
  return <fieldset className="space-y-2"><legend className="text-13 font-medium">{label}</legend>
    {options.map(option => <label key={option.id} className="flex items-start gap-2 text-13"><input type="checkbox" checked={selected.includes(option.id)} onChange={event => select(event.target.checked ? [...selected, option.id] : selected.filter(id => id !== option.id))} />{option.title}</label>)}
    {!options.length && <p className="text-12 text-muted-foreground">暂无可引用的已确认产物。</p>}
  </fieldset>;
}
