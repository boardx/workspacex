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
import type { OrgId } from "../../domain/org-id";
import { decideFeedbackDetailVisibility } from "./feedback-detail-decision";
import type { FeedbackAttachmentRepository } from "./attachment-ports";
import type { FeedbackSubmitterDirectory } from "./notification-ports";
import type { FeedbackScope, ProductFeedbackRepository } from "./ports";

export type FeedbackItemView = z.infer<typeof feedbackLoop.FeedbackItem>;
type FeedbackAttachmentView = FeedbackItemView["attachments"][number];

export interface ListFeedbackDeps {
  readonly repo: ProductFeedbackRepository;
  /** 每一次可见性判定都有自己的 id（R10 ④：「为什么给你看到这条」要能回溯） */
  readonly newDecisionId: () => string;
  /**
   * FB-5——未注入时 `attachments` 字段一律投影成空数组，行为与附件功能之前逐字节
   * 相同。**附件与正文走同一条 D3 可见性门控**：图片是反馈正文的一部分（用户口述/
   * 描述问题时贴的截图），不是标题/票数那类恒对全组织可见的展示性上下文——
   * `detail === null` 的行，`attachments` 也一律是空数组，理由与"未脱敏的图片可能
   * 含客户数据"这条 FB-5 的已知限制直接相关：可见性门控是唯一现在就生效的防线。
   */
  readonly attachments?: FeedbackAttachmentRepository;
  readonly orgId?: OrgId;
  /** 提交人显示名——同 `attachments`：只对正文可见的行查，未注入时恒 `null`。 */
  readonly submitters?: FeedbackSubmitterDirectory;
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

  const projected = rows.map((row) => {
    const decision = decideFeedbackDetailVisibility({
      decisionId: deps.newDecisionId(),
      viewerId: input.viewerId,
      viewerOrgRole: input.viewerOrgRole,
      viewerTeamId: input.viewerTeamId,
      submittedBy: row.submittedBy,
    });
    const outcome = discloseDecided(row.detail, decision);
    return { row, disclosed: isDisclosed(outcome), detail: isDisclosed(outcome) ? outcome.payload : null };
  });

  // 一次批量查询取回"这批里、正文对本次请求者可见的那些反馈"的附件——见
  // `ListFeedbackDeps.attachments` 头注：附件与正文同一条门控。未注入仓储/无
  // orgId/这批里没有任何一条可见时，跳过这次查询（空数组本来就是正确答案）。
  const disclosedIds = projected.filter((p) => p.disclosed).map((p) => p.row.id);
  const attachmentsByFeedbackId = new Map<string, FeedbackAttachmentView[]>();
  if (deps.attachments !== undefined && deps.orgId !== undefined && disclosedIds.length > 0) {
    const found = await deps.attachments.findByFeedbackIds(deps.orgId, disclosedIds);
    for (const a of found) {
      if (a.feedbackId === null) continue;
      const list = attachmentsByFeedbackId.get(a.feedbackId) ?? [];
      list.push({ id: a.id, url: `/feedback/attachments/${a.id}`, mime: a.contentType });
      attachmentsByFeedbackId.set(a.feedbackId, list);
    }
  }

  // 提交人显示名与附件同一条门控：只查这批里正文可见的行。
  const submitterNames: ReadonlyMap<string, string> = deps.submitters !== undefined && disclosedIds.length > 0
    ? await deps.submitters.displayNamesForUserIds(
        [...new Set(projected.filter((p) => p.disclosed).map((p) => p.row.submittedBy))],
      )
    : new Map();

  return projected.map(({ row, disclosed, detail }) => ({
    id: row.id,
    kind: row.kind,
    target: row.target,
    targetLabel: row.targetLabel,
    title: row.title,
    // ⚠ `null` 在契约里恒等于「无权查看」——因为落库的正文非空（迁移里的 CHECK）。
    detail,
    status: row.status,
    statusReason: row.statusReason,
    votes: row.votes,
    votedByMe: row.votedByMe,
    submittedByMe: row.submittedBy === input.viewerId,
    submitterName: disclosed ? (submitterNames.get(row.submittedBy) ?? null) : null,
    occurredRoute: row.occurredRoute,
    appVersion: row.appVersion,
    createdAt: row.createdAt,
    githubIssueUrl: row.githubIssueUrl,
    githubIssueNumber: row.githubIssueNumber,
    attachments: attachmentsByFeedbackId.get(row.id) ?? [],
  }));
}
