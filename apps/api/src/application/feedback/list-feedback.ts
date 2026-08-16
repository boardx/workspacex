/**
 * `listFeedback` —— 读反馈列表（FB-2 / FB-3 左列 / chat 内「这个 skill 的反馈」）。
 *
 * 三种口径（`mine` / `org` / `target`）共用**同一条**路径，因为它们的权限形状
 * 只在一个地方不同：`detail` 给不给。分三条路径写的话，D3 那条规则会有三份实现，
 * 而只要有一份写反，泄露的是别人的反馈正文。
 *
 * ## 正文是**逐行**过 `discloseDecided` 的
 *
 * ⚠ 不是「先判一次『这个人是不是管理员』，是就整批给全文」。管理员那一支确实
 *   整批都过，但**非管理员那一支里混着他自己提的那些**——那些必须给全文。
 *   一次性的批判定会把这件事漏掉，而漏掉的方向是「自己写的字自己看不见」，
 *   在测试里长得像一个无害的 UI 小问题。
 *
 * ⚠ 被挡下的行**照常出现在列表里**，只是 `detail: null`。
 *   把它们整行滤掉会让票数与「本周 N 条」对不上，而对不上的那一侧无从解释。
 */
import type { feedbackLoop } from "@repo/contracts";
import type { z } from "zod";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { OrgRole } from "../../domain/identity/roles";
import { decideFeedbackDetailVisibility } from "./feedback-detail-decision";
import type { FeedbackScope, ProductFeedbackRepository } from "./ports";

export type FeedbackItemView = z.infer<typeof feedbackLoop.FeedbackItem>;

export interface ListFeedbackDeps {
  readonly repo: ProductFeedbackRepository;
  /** 每一次可见性判定都有自己的 id（R10 ④：「为什么给你看到这条」要能回溯） */
  readonly newDecisionId: () => string;
}

export interface ListFeedbackInput {
  readonly scope: FeedbackScope;
  readonly viewerId: string;
  /** null = 不是本组织成员 */
  readonly viewerOrgRole: OrgRole | null;
  readonly viewerTeamId: string | null;
}

export async function listFeedback(
  deps: ListFeedbackDeps,
  input: ListFeedbackInput,
): Promise<readonly FeedbackItemView[]> {
  const rows = await deps.repo.list(input.scope, input.viewerId);

  return rows.map((row) => {
    const decision = decideFeedbackDetailVisibility({
      decisionId: deps.newDecisionId(),
      viewerId: input.viewerId,
      viewerOrgRole: input.viewerOrgRole,
      viewerTeamId: input.viewerTeamId,
      submittedBy: row.submittedBy,
    });
    const outcome = discloseDecided(row.detail, decision);

    return {
      id: row.id,
      kind: row.kind,
      target: row.target,
      targetLabel: row.targetLabel,
      title: row.title,
      // ⚠ `null` 在契约里恒等于「无权查看」——因为落库的正文非空（迁移里的 CHECK）。
      detail: isDisclosed(outcome) ? outcome.payload : null,
      status: row.status,
      statusReason: row.statusReason,
      votes: row.votes,
      votedByMe: row.votedByMe,
      submittedByMe: row.submittedBy === input.viewerId,
      occurredRoute: row.occurredRoute,
      appVersion: row.appVersion,
      createdAt: row.createdAt,
    };
  });
}
