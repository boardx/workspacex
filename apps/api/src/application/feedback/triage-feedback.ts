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
 * ## 2026-08-30 新增两条副作用,2026-09-02 再加第三条,都挂在"状态真的变了"（`outcome.kind === "changed"`）之后
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
 * ⚠ **2026-08-31 补(PR #2431 二轮独立审查阻断项①)**:`current.githubIssueUrl === null`
 *   这个判断本身不是原子的——两个并发的分诊请求可能都读到 null,都去建 issue,
 *   同一条反馈挂出两张票。所以真正下判断、真正调 GitHub 之前,先原子地
 *   `deps.repo.claimGithubIssueCreation` 认领一次;认领失败(另一个并发请求正在办
 *   或已经办完)就当作"这条反馈的 issue 创建已经在别处发生",抛
 *   `FeedbackIssueInProgressError`(409),**不**再退化成"忽略、直接改状态"——
 *   那会让状态变了但没人知道 issue 到底建没建成。认领成功后调 GitHub 失败,
 *   显式 `releaseGithubIssueClaim` 放行下一次重试,不等 5 分钟的过期窗口。
 *   完整的原子性论证与"解决了什么、没解决什么"见迁移
 *   `20260831010000_fb2_feedback_github_issue_claim.sql` 头注。
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
 *
 * ### ③ 这条反馈已经挂着 issue 时,跟着状态同步它的开关 —— **best-effort,同②**
 *
 * 转 `已修复` 关闭并标 `completed`,转 `不做` 关闭并标 `not_planned`,转回
 * `待处理`/`已进入迭代` 重新打开(`targetGithubIssueState`)。**跟①不是同一条纪律**:
 * ①建 issue fail closed,是因为"状态改了但没人知道 issue 建没建成"是假象;这里
 * GitHub issue 的开关**从属于**反馈状态这个已经落库的事实,不是反过来,所以失败只
 * 记日志(`syncGithubIssueState`)。没有新增返回字段暴露"这次同步成不成功"——想知道
 * GitHub 上现在到底是什么状态,调 `getFeedbackGithubIssue` 现查(不落库,理由见该
 * 用例头注),不能靠这次响应里的某个布尔:那个布尔只能代表"这次调用有没有报错",
 * 不能代表"GitHub 上现在是什么状态",两者一混就是又一份可能对不上的副本。
 *
 * ⚠ 幂等重放**也不同步**:状态没变,没有什么新状态需要同步给 GitHub。
 *
 * ⚠ **已知限制,登记、不在这轮修**(2026-09-02 独立审查提出,issue #2500 记录):
 *   同步失败之后没有持久 outbox/重试调度——反馈状态与 GitHub issue 开关短暂不一致
 *   的窗口是真实存在的,管理员在这条反馈上再次触发任何一次状态转移时会重新尝试
 *   同步(因为每次转移都会跑一遍这段逻辑),但如果之后再也没有转移动作,这个窗口
 *   不会自愈,只能靠管理员手动点「查看 GitHub 状态」现查发现、去 GitHub 上手动改。
 *   与②(状态变更邮件)是同一类"本地事实已经落库、外部系统只是尽力同步"的权衡,
 *   不为了堵这个口子新增一张持久化的 outbox 表/后台调度任务。
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
  type GithubIssueStateTarget,
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
/**
 * 认领失败——另一个并发请求正在建这条反馈的 issue,或已经建完了(`findById` 读到
 * `null` 与 `claimGithubIssueCreation` 真正执行之间,别的请求抢先完成了整个流程)。
 * 不是这次请求的错,但也不能假装"顺便"成功——调用方(前端)据此提示"请刷新后再看"。
 */
export class FeedbackIssueInProgressError extends Error {
  constructor() {
    super("another request is already creating (or has already created) this feedback's github issue");
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

  // ① 转「已进入迭代」且带了 issueDraft 且这条反馈还没有 issue ⇒ 先认领、再建。
  // 认领失败 = 并发冲突,直接失败,不悄悄跳过(那会让状态变了但没人知道 issue
  // 到底建没建成)。认领成功后建失败,fail closed 且释放认领——理由见文件头①/⚠。
  let githubIssueUrl = current.githubIssueUrl;
  let githubIssueNumber = current.githubIssueNumber;
  if (outcome.to === "已进入迭代" && input.issueDraft !== null && current.githubIssueUrl === null) {
    const claimed = await deps.repo.claimGithubIssueCreation(input.feedbackId);
    if (!claimed) throw new FeedbackIssueInProgressError();
    try {
      const created = await deps.githubIssues.create(input.issueDraft);
      githubIssueUrl = created.url;
      githubIssueNumber = created.number;
      await deps.repo.setGithubIssue(input.feedbackId, created);
    } catch (e) {
      await deps.repo.releaseGithubIssueClaim(input.feedbackId);
      const cause = e instanceof GithubIssueCreationError ? e : new GithubIssueCreationError(null);
      throw new FeedbackIssueCreationFailedError(cause);
    }
  }

  await deps.repo.updateStatus(input.feedbackId, outcome.to, outcome.reason);

  // ③ best-effort 跟着状态同步 GitHub issue 的开关——见文件头注③。状态已经落库,
  //   这里的任何失败都不影响上面那次事实,只记日志。
  if (githubIssueNumber !== null) {
    await syncGithubIssueState(deps, {
      feedbackId: input.feedbackId,
      issueNumber: githubIssueNumber,
      status: outcome.to,
    });
  }

  // ② best-effort 通知——状态已经落库,这里的任何失败都不再影响上面那次事实。
  // ⚠ 顺序:必须在 `appendStatusEvent` **之前**——事件行要把"这次到底有没有发出去、
  //   发的是什么"一起落进同一行历史（迁移 20260902110613），而不是只活在这次 HTTP
  //   响应的 `notified` 字段里、下次刷新页面就再也查不到。状态**已经**落库
  //   （上面 `updateStatus` 那一行），所以先跑通知、再写事件行,不影响"状态变更是
  //   否成功"这件已经成立的事实,只是让事件行能把结果一并记下来。
  const notification = await notifySubmitter(deps, {
    feedbackId: input.feedbackId,
    submittedBy: current.submittedBy,
    title: current.title,
    status: outcome.to,
    reason: outcome.reason,
  });

  await deps.repo.appendStatusEvent({
    id: deps.newEventId(),
    feedbackId: input.feedbackId,
    fromStatus: outcome.from,
    toStatus: outcome.to,
    reason: outcome.reason,
    actorId: input.actorId,
    notified: notification.notified,
    emailSubject: notification.subject,
    emailText: notification.text,
  });

  return { feedbackId: input.feedbackId, status: outcome.to, notified: notification.notified, githubIssueUrl };
}

/** `outcome.to` → GitHub issue 该处在什么开关状态。纯函数,方便单测直接断言映射表。 */
export function targetGithubIssueState(status: FeedbackStatus): GithubIssueStateTarget {
  if (status === "已修复") return { state: "closed", stateReason: "completed" };
  if (status === "不做") return { state: "closed", stateReason: "not_planned" };
  return { state: "open" }; // 待处理 / 已进入迭代——都算「还开着」
}

async function syncGithubIssueState(
  deps: TriageFeedbackDeps,
  input: { readonly feedbackId: string; readonly issueNumber: number; readonly status: FeedbackStatus },
): Promise<void> {
  try {
    await deps.githubIssues.setState(input.issueNumber, targetGithubIssueState(input.status));
  } catch (e) {
    // ⚠ 吞掉但不静默——同 `notifySubmitter` 的纪律:状态变更(上面已经 return 过)
    //   不因为这里失败而回滚,也没有"回滚"这回事。值班能顺着这条日志查 GitHub 侧故障。
    deps.logger.error("feedback triage: github issue state sync failed (best-effort, transition already committed)", {
      traceId: "feedback-triage-github-sync",
      feedbackId: input.feedbackId,
      issueNumber: input.issueNumber,
      targetStatus: input.status,
      err: e,
    });
  }
}

/**
 * ⚠ 返回值不再是裸布尔——`appendStatusEvent`（迁移 20260902110613）要把"发的是什么"
 *   一起存进事件行，`subject`/`text` 因此是返回形状的一部分，不只是内部细节。
 *   `notified: false` 时 `subject`/`text` 恒 `null`——没发出去,自然没有"发了什么"
 *   可存,这是 `StatusEvent.emailSubject`/`emailText` 那条 nullable 契约的来源。
 */
async function notifySubmitter(
  deps: TriageFeedbackDeps,
  input: {
    readonly feedbackId: string;
    readonly submittedBy: string;
    readonly title: string;
    readonly status: FeedbackStatus;
    readonly reason: string | null;
  },
): Promise<{ readonly notified: boolean; readonly subject: string | null; readonly text: string | null }> {
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
      return { notified: false, subject: null, text: null };
    }
    const { subject, text } = statusChangeEmail(input);
    await deps.mail.send({ to: email, subject, text });
    return { notified: true, subject, text };
  } catch (e) {
    // ⚠ 吞掉,但**不是静默吞掉**——按 AGENTS.md 的纪律「失败了但不能被静默吞掉」,
    //   这里用 error 级别记清楚是哪条反馈、发给谁失败了,值班能顺着这条日志查供应商故障,
    //   而分诊本身(上面已经 return 过的状态变更)不会因为这行 catch 受到任何影响。
    deps.logger.error("feedback triage: status-change notification failed (best-effort, transition already committed)", {
      traceId: "feedback-triage-notify",
      feedbackId: input.feedbackId,
      err: e,
    });
    // ⚠ subject/text 仍是 null,不是"我们本来想发这个但失败了"——`notified: false`
    //   与两者恒为 null 是同一件事的两个投影(见本函数头注),失败与"没有可通知的人"
    //   在这一点上不该有区别:历史记录里存的应当是"实际发出去的"，不是"曾经打算发的"。
    return { notified: false, subject: null, text: null };
  }
}
