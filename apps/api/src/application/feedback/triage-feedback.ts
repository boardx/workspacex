/**
 * `triageFeedback` —— 分诊(改状态)。**组织管理员,且只有组织管理员**。
 *
 * 状态机在 `domain/feedback/product-feedback.ts`;这里只负责把它的裁决接到仓储上,
 * 并保证**改状态与写流水是同一次动作**:只落库不写事件,等于把「谁在什么时候
 * 把它改成不做、理由是什么」丢掉,而那正是这条闭环唯一能回答提交人的东西。
 *
 * ⚠ 幂等重放(目标状态 = 当前状态)**既不落库也不写事件**。
 *   管理员点两次「进迭代」不该在流水里留下两条转移——那个数字读起来像是有人在反复改判。
 *
 * ⚠ `FeedbackNotFoundError` 同时覆盖「不存在」与「不可见」(同 `SKILL_NOT_FOUND`
 *   的纪律:404 非 403,不泄露存在性)。这里不需要额外做可见性判断的原因是
 *   仓储绑定了租户 + RLS:跨组织的 id 查出来就是 null。
 *
 * ## 2026-08-30 新增两条副作用,都挂在"状态真的变了"（`outcome.kind === "changed"`）之后
 *
 * ### ① 转 `已进入迭代` 时建 GitHub issue —— **fail closed**
 *
 * 这一条**不是** best-effort:管理员在弹层里编辑完标题/正文/标签、点了确认,
 * 他的心智模型是"这一下同时做了两件事:改状态 + 建 issue"。如果 issue 建失败还让
 * 状态悄悄改成功,分诊的人会以为开发那边已经有一张票在跟踪,而实际上什么都没有——
 * 这比"分诊失败,请重试"更危险,因为它是一个没人会去主动核实的假象。所以 issue
 * 创建**在持久化状态变更之前**执行,失败就整个用例失败、状态原样不动、`DEPENDENCY_UNAVAILABLE`
 * 冒泡给控制器(契约 `triageFeedback.err` 里本来就有这一条)。
 *
 * ⚠ 只在**目标状态是 `已进入迭代`** 且调用方**带了 `issueDraft`** 且**这条反馈还没有
 *   issue**(`current.githubIssueUrl === null`)三个条件都成立时才建——后两个分别对应
 *   「没有弹层就没有草稿,不该在没人editability 编辑的情况下凭空建一个」与「同一条
 *   反馈来回 已进入迭代⇄待处理⇄已进入迭代 不该每次都建一张新 issue」。
 *
 * ### ② 任意转移都尽力发一封状态变更邮件 —— **best-effort,失败不影响主流程**
 *
 * 这一条与①相反:状态变更是**已经发生的事实**(要么是这次改的,要么是幂等重放前
 * 就已经生效的),给提交人发一封通知邮件是"顺带告诉他一声",不是这个事实成立的
 * 前提条件。所以它在状态**已经落库之后**才执行,包在 try/catch 里——失败只记日志、
 * 把 `notified` 设成 `false`,**绝不**抛出到调用方,更**绝不**触发任何回滚(状态变更
 * 已经提交,没有"回滚"这回事,也不该有——用户点了"转开发"、系统确实转了,这件事
 * 不能因为邮件服务超时就变成没发生过)。
 *
 * ⚠ **幂等重放不发邮件**:状态没变,没有什么新鲜事值得通知别人。
 */
import {
  canTriage,
  triage,
  type FeedbackStatus,
} from "../../domain/feedback/product-feedback";
import type { OrgRole } from "../../domain/identity/roles";
import type { LoggerPort } from "../ports/logger.port";
import type { TransactionalMailTransport } from "../notifications/transactional-mail-ports";
import {
  GithubIssueCreationError,
  type FeedbackSubmitterDirectory,
  type GithubIssueCreator,
  type GithubIssueDraft,
} from "./notification-ports";
import type { ProductFeedbackRepository } from "./ports";

export class FeedbackNotFoundError extends Error {}
export class FeedbackTriageForbiddenError extends Error {}
export class FeedbackTriageReasonRequiredError extends Error {}
export class FeedbackIllegalTransitionError extends Error {
  constructor(readonly from: FeedbackStatus, readonly to: FeedbackStatus) {
    super(`illegal feedback transition: ${from} -> ${to}`);
  }
}
/** GitHub issue 创建失败 —— ①是 fail closed,冒泡成契约里已有的 `DEPENDENCY_UNAVAILABLE`。 */
export class FeedbackIssueCreationFailedError extends Error {
  constructor(cause: unknown) {
    super("github issue creation failed, feedback status left unchanged");
    this.cause = cause;
  }
}

export interface TriageFeedbackDeps {
  readonly repo: ProductFeedbackRepository;
  readonly newEventId: () => string;
  readonly githubIssues: GithubIssueCreator;
  readonly submitterDirectory: FeedbackSubmitterDirectory;
  readonly mail: TransactionalMailTransport;
  readonly logger: LoggerPort;
}

export interface TriageFeedbackInput {
  readonly feedbackId: string;
  readonly status: FeedbackStatus;
  readonly reason: string | null;
  readonly actorId: string;
  readonly actorOrgRole: OrgRole | null;
  /** "转开发"弹层里管理员编辑过的最终文案。见文件头②。 */
  readonly issueDraft: GithubIssueDraft | null;
}

export interface TriageFeedbackResult {
  readonly feedbackId: string;
  readonly status: FeedbackStatus;
  readonly notified: boolean;
  readonly githubIssueUrl: string | null;
}

function statusChangeEmail(input: {
  readonly title: string;
  readonly status: FeedbackStatus;
  readonly reason: string | null;
}): { readonly subject: string; readonly text: string } {
  const subject = `你的反馈状态已更新为「${input.status}」`;
  const lines = [
    `你提交的反馈《${input.title}》状态已更新为「${input.status}」。`,
    input.reason !== null ? `处理说明:${input.reason}` : null,
  ].filter((line): line is string => line !== null);
  return { subject, text: lines.join("\n") };
}

export async function triageFeedback(
  deps: TriageFeedbackDeps,
  input: TriageFeedbackInput,
): Promise<TriageFeedbackResult> {
  // ⚠ 权限先判,仓储后动——与本仓 F119/F124/F125/#467/F176 同一条顺序纪律。
  //   反过来写的话,一次越权的分诊请求仍然会先把那条反馈读出来。
  if (!canTriage(input.actorOrgRole)) throw new FeedbackTriageForbiddenError();

  const current = await deps.repo.findById(input.feedbackId, input.actorId);
  if (current === null) throw new FeedbackNotFoundError();

  const outcome = triage({ current: current.status, next: input.status, reason: input.reason });
  if (outcome.kind === "rejected") {
    if (outcome.code === "TRIAGE_REASON_REQUIRED") throw new FeedbackTriageReasonRequiredError();
    throw new FeedbackIllegalTransitionError(outcome.from, outcome.to);
  }
  if (outcome.kind === "unchanged") {
    // 幂等重放:不建 issue、不发邮件——见文件头②末尾那条⚠。
    return {
      feedbackId: input.feedbackId,
      status: outcome.at,
      notified: false,
      githubIssueUrl: current.githubIssueUrl,
    };
  }

  // ① 转「已进入迭代」且带了 issueDraft 且这条反馈还没有 issue ⇒ 先建,建不成就整个用例失败。
  // fail closed,不落库——理由见文件头①。
  let githubIssueUrl = current.githubIssueUrl;
  if (outcome.to === "已进入迭代" && input.issueDraft !== null && current.githubIssueUrl === null) {
    try {
      const created = await deps.githubIssues.create(input.issueDraft);
      githubIssueUrl = created.url;
      await deps.repo.setGithubIssue(input.feedbackId, created);
    } catch (e) {
      const cause = e instanceof GithubIssueCreationError ? e : new GithubIssueCreationError(null);
      throw new FeedbackIssueCreationFailedError(cause);
    }
  }

  await deps.repo.updateStatus(input.feedbackId, outcome.to, outcome.reason);
  await deps.repo.appendStatusEvent({
    id: deps.newEventId(),
    feedbackId: input.feedbackId,
    fromStatus: outcome.from,
    toStatus: outcome.to,
    reason: outcome.reason,
    actorId: input.actorId,
  });

  // ② best-effort 通知——状态已经落库,这里的任何失败都不再影响上面那次事实。
  const notified = await notifySubmitter(deps, {
    feedbackId: input.feedbackId,
    submittedBy: current.submittedBy,
    title: current.title,
    status: outcome.to,
    reason: outcome.reason,
  });

  return { feedbackId: input.feedbackId, status: outcome.to, notified, githubIssueUrl };
}

async function notifySubmitter(
  deps: TriageFeedbackDeps,
  input: {
    readonly feedbackId: string;
    readonly submittedBy: string;
    readonly title: string;
    readonly status: FeedbackStatus;
    readonly reason: string | null;
  },
): Promise<boolean> {
  try {
    const email = await deps.submitterDirectory.emailForUserId(input.submittedBy);
    if (email === null) {
      // 账号已经不在了(见 `PgFeedbackSubmitterDirectory` 头注)——这不是失败,
      // 是"没有能通知到的人",日志里区分开,免得和真正的供应商故障混在一起排查。
      deps.logger.info("feedback triage: submitter has no resolvable email, skipping notification", {
        // ⚠ 没有请求级 traceId 可穿——这条日志发生在状态已经落库**之后**、best-effort
        //   通知这一步，与产生它的那次 HTTP 请求已经是两件事(同 `mail-outbox-worker.ts`
        //   用固定 traceId 的理由)。真正需要关联的键是 feedbackId，已经带了。
        traceId: "feedback-triage-notify",
        feedbackId: input.feedbackId,
      });
      return false;
    }
    const { subject, text } = statusChangeEmail(input);
    await deps.mail.send({ to: email, subject, text });
    return true;
  } catch (e) {
    // ⚠ 吞掉,但**不是静默吞掉**——按 AGENTS.md 的纪律「失败了但不能被静默吞掉」,
    //   这里用 error 级别记清楚是哪条反馈、发给谁失败了,值班能顺着这条日志查供应商故障,
    //   而分诊本身(上面已经 return 过的状态变更)不会因为这行 catch 受到任何影响。
    deps.logger.error("feedback triage: status-change notification failed (best-effort, transition already committed)", {
      traceId: "feedback-triage-notify",
      feedbackId: input.feedbackId,
      err: e,
    });
    return false;
  }
}
