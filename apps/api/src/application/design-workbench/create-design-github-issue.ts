/**
 * `createDesignGithubIssue`（2026-09-05「转开发」）—— 把一个已推送的设计方案变成一张
 * GitHub issue，让「高级用户做原型 → 推送到收件箱 → 交给开发」这条链路走完最后一步。
 *
 * ## 为什么这条用例存在
 *
 * 在它之前，设计方案推送到收件箱之后就是一条**死条目**：契约 `inbox.ts` 的
 * `InboxGithubRef` 头注逐字写着「设计方案：本轮恒 `null`」，收件箱 drawer 对
 * `kind === "design"` 的条目不提供任何操作。方案看得见、交不出去。
 *
 * ## 形状照抄 `triageFeedback` 的建 issue 半程，不发明第二套
 *
 * 认领 → 建 → 回填，失败释放认领并 fail closed——与 `triage-feedback.ts` 那段（经过
 * 二轮独立审查、见 `20260831010000` 迁移头注）**同一套**。差别只有三处，都是本用例
 * 特有的前置条件，不是对那套流程的改写：
 *   ① 权限是 **owner**（同 `pushToInbox`），不是"组织管理员"——设计方案的写侧口径就是
 *      owner（契约文件头【待确认点 1】）。
 *   ② 必须**已推送**（`DesignProjectNotPushedError`）。理由见契约 `PROJECT_NOT_PUSHED`：
 *      让「GitHub 上每一张设计票都能在收件箱里找到对应条目」成为结构性保证。
 *   ③ **不幂等**，已有 issue 直接报错（`DesignIssueAlreadyExistsError`），不 upsert
 *      也不静默返回已有的那张。理由见契约那个错误码的说明。
 *
 * ## 不做的事（如实登记，不是遗漏）
 *
 *   · **不传图片**。`triageFeedback` 有 `withAttachmentImages` 那一段（把反馈的图片附件
 *     推给 GitHub 再内嵌进正文），设计方案今天**没有附件**这个概念（`design_projects`
 *     没有附件表，契约 `DesignProject` 也没有这个字段），没有东西可传。
 *   · **不发邮件**。反馈那条线之所以发，是因为有"提交人"这个角色在等回音。设计方案的
 *     owner 就是**发起这次转开发的人本人**——给自己发一封"你刚点的按钮成功了"的邮件
 *     没有信息量。来源反馈的提交人在 `pushToInbox` 那一步已经收到过「已生成设计方案」
 *     （B6.3）；「这个方案进开发了」要不要再发一封，是产品决策，不在本用例擅自加。
 *   · **不写状态事件**。设计方案没有状态事件表（同 `push-to-inbox.ts` 头注记录过的
 *     那条：`product_feedback_status_events` 的 CHECK 装不下非状态转移的事件）。
 *     「已转开发」这件事的可见形式就是那张 issue 本身 + 收件箱 stage 变成 `doing`。
 */
import { GithubIssueCreationError, type GithubIssueCreator, type GithubIssueDraft } from "../feedback/notification-ports";
import {
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  projectDesignProject,
  ownerNamesFor,
  type DesignProjectDeps,
  type DesignProjectView,
} from "./project-shared";

/** 契约 `PROJECT_NOT_PUSHED`——还没推送到收件箱的方案不能转开发。 */
export class DesignProjectNotPushedError extends Error {}
/** 契约 `DESIGN_ISSUE_ALREADY_EXISTS`。 */
export class DesignIssueAlreadyExistsError extends Error {}
/** 契约 `DESIGN_ISSUE_IN_PROGRESS`——并发认领没抢到。 */
export class DesignIssueInProgressError extends Error {}
/** 契约 `DESIGN_ISSUE_CREATION_FAILED`——GitHub 那侧失败，认领已释放。 */
export class DesignIssueCreationFailedError extends Error {
  constructor(readonly cause: GithubIssueCreationError) {
    super("design github issue creation failed");
  }
}

export interface CreateDesignGithubIssueDeps extends DesignProjectDeps {
  readonly githubIssues: GithubIssueCreator;
}

export async function createDesignGithubIssue(
  deps: CreateDesignGithubIssueDeps,
  input: {
    readonly projectId: string;
    readonly ownerId: string;
    readonly draft: GithubIssueDraft;
  },
): Promise<{ readonly project: DesignProjectView }> {
  const current = await deps.projects.get(input.projectId);
  if (current === null) throw new DesignProjectNotFoundError();
  if (current.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();
  if (!current.pushed) throw new DesignProjectNotPushedError();
  if (current.githubIssueNumber !== null) throw new DesignIssueAlreadyExistsError();

  // 认领失败 = 并发冲突。直接失败，**不**悄悄跳过——那会让调用方以为建成了却查不到
  // issue（同 `triage-feedback.ts` ① 的原话）。
  const claimed = await deps.projects.claimGithubIssueCreation(input.projectId, input.ownerId);
  if (!claimed) throw new DesignIssueInProgressError();

  let updated;
  try {
    // ⚠ `draft` 原样交给 GitHub，不用方案内容覆盖它：人类在弹层里改过的标题/正文才是
    //   这次要建的东西（同 `triageFeedback.in.issueDraft` 头注「否则『可编辑』就是一句空话」）。
    const created = await deps.githubIssues.create(input.draft);
    updated = await deps.projects.setGithubIssue(input.projectId, input.ownerId, created);
  } catch (e) {
    await deps.projects.releaseGithubIssueClaim(input.projectId, input.ownerId);
    throw new DesignIssueCreationFailedError(
      e instanceof GithubIssueCreationError ? e : new GithubIssueCreationError(null),
    );
  }
  // 建成功但回填时行没了/owner 变了：issue 已经在 GitHub 上，库里却挂不上。释放认领让
  // 重试有机会，然后如实报错——**不**假装成功（那会让一张孤儿 issue 永远没人知道）。
  if (updated === null) {
    await deps.projects.releaseGithubIssueClaim(input.projectId, input.ownerId);
    throw new DesignProjectNotFoundError();
  }

  deps.logger?.info("design project handed to development", {
    traceId: "design-create-github-issue",
    projectId: updated.id,
    ownerId: updated.ownerId,
    issueNumber: updated.githubIssueNumber,
    linkedFeedback: updated.linkedFeedbackId !== null,
  });

  const names = await ownerNamesFor(deps, [updated.ownerId]);
  return { project: projectDesignProject(updated, names.get(updated.ownerId) ?? null) };
}
