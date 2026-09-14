import { z } from "zod";

export const INBOX_TAG_MAX_LENGTH = 32;
export const INBOX_TAGS_MAX_COUNT = 20;
export const InboxTag = z.string().trim().min(1).max(INBOX_TAG_MAX_LENGTH);
/** User classification must never become a coordination/review instruction. */
export const isFeedbackClassificationTag = (tag: string): boolean => !/^(status|review|owner|agent|role|coordination|area|wave|cap):|^(parallel-safe|passing|blocked|in-progress)$/i.test(tag);
export const FeedbackTags = z.array(InboxTag.refine(
  isFeedbackClassificationTag,
  "请使用分类标签，不使用内部协作标签",
)).max(INBOX_TAGS_MAX_COUNT).transform((tags) =>
  tags.filter((tag, index) => tags.findIndex((other) => other.toLowerCase() === tag.toLowerCase()) === index),
);

/** Creation adds classification labels only; never interpret user tags as workflow state. */
export function feedbackGithubLabels(kind: string | null, labels: readonly string[], tags: readonly string[]): string[] {
  const system = ["user-feedback", ...(kind === "缺陷" ? ["bug"] : kind === "需求" ? ["enhancement"] : [])];
  return [...new Map([...system, ...labels, ...tags].map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && isFeedbackClassificationTag(tag))
    .map((tag) => [tag.toLowerCase(), tag])).values()];
}
