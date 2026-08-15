/**
 * `voteFeedback` —— 投票 / 撤票（I-F2）。
 *
 * ⚠ 用例很薄，**薄是结论不是省事**：幂等的落点是主键
 * `PRIMARY KEY (feedback_id, voter_id)`，票数的落点是 `COUNT(*)`。
 * 在这里再写一次「查一下投过没有，没投过才加」，会制造一个在并发下与数据库不一致
 * 的第二判据——而它平时看起来完全正确。
 *
 * ⚠ 先 `findById` 是为了把「这条反馈不存在 / 不在本组织」变成一个具名的 404，
 *   而不是让一个违反外键的 INSERT 冒到全局异常过滤器里变成 500。
 */
import type { ProductFeedbackRepository } from "./ports";
import { FeedbackNotFoundError } from "./triage-feedback";

export interface VoteFeedbackInput {
  readonly feedbackId: string;
  readonly voterId: string;
  readonly voted: boolean;
}

export async function voteFeedback(
  deps: { readonly repo: ProductFeedbackRepository },
  input: VoteFeedbackInput,
): Promise<{ readonly feedbackId: string; readonly votes: number; readonly votedByMe: boolean }> {
  const existing = await deps.repo.findById(input.feedbackId, input.voterId);
  if (existing === null) throw new FeedbackNotFoundError();

  const out = await deps.repo.setVote(input.feedbackId, input.voterId, input.voted);
  return { feedbackId: input.feedbackId, votes: out.votes, votedByMe: out.votedByMe };
}
