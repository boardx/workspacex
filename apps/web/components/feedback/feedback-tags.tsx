"use client";
import { feedbackLoop } from "@repo/contracts";
import { TagInput, commitDraft } from "@/components/ui/tag-input";
export function commitFeedbackTags(tags: readonly string[], draft: string): string[] {
  return feedbackLoop.FeedbackTags.parse(commitDraft(tags, draft));
}
export function FeedbackTagsInput({ tags, onChange, draft, onDraftChange, disabled = false }: {
  tags: readonly string[]; onChange: (tags: readonly string[]) => void;
  draft: string; onDraftChange: (draft: string) => void; disabled?: boolean;
}) {
  const validation = feedbackLoop.FeedbackTags.safeParse(commitDraft(tags, draft));
  return <div className="flex flex-col gap-1.5">
    <span className="text-11 font-medium text-muted-foreground">标签</span>
    <TagInput value={tags} onChange={(next) => onChange(next.filter((t, i) => next.findIndex((v) => v.toLowerCase() === t.toLowerCase()) === i))}
      knownTags={new Map()} draft={draft} onDraftChange={onDraftChange} disabled={disabled}
      maxTags={feedbackLoop.INBOX_TAGS_MAX_COUNT} maxTagLength={feedbackLoop.INBOX_TAG_MAX_LENGTH} testIdPrefix="feedback-tags" />
    {!validation.success && <p role="alert" className="text-11 text-destructive">请使用普通分类标签（最多 {feedbackLoop.INBOX_TAGS_MAX_COUNT} 个），不使用内部协作标签。</p>}
  </div>;
}
