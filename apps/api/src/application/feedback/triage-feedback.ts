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
 * ### ④ 状态变更 + 「这次转移发生过」这一行历史 —— 与状态本身**同一个事务**
 *
 * 2026-09-02 独立审查 P0(两轮):第一版把 `appendStatusEvent` 排在②之后(要把
 * ②真实的通知结果一并存进这一行,见⑤),但仍然是独立的一次 `withTenant`——
 * 状态更新成功、写这一行历史失败,会让状态真的变了但流水里**永久**没有对应
 * 的一行。这不是"次要记录丢了细节",是"这件事发生过"这条事实本身消失。
 *
 * 修法(`ProductFeedbackRepository.transitionStatusWithEvent`):UPDATE 状态
 * 与 INSERT 这一行历史收进**同一次 `withTenant` 调用**(= 同一个数据库事务),
 * 要么一起提交、要么一起回滚,不再有"状态变了但历史没写"的中间态。事件行
 * 落库时 `notified` 先诚实写 `false`——这一刻还没跑②,不知道邮件发没发。
 *
 * ⚠ 通知邮件的发送本身(②)**不能**并进这同一个事务:它必须在状态**已经落库**
 *   之后才能发生(不能在状态生效前就告诉用户"变了"),而"状态落库"与"这一行
 *   历史存在"这两件事恰恰是这次要保证同时成立的那两件——所以②天然只能排在
 *   ④之后。
 *
 * ### ⑤ 回填②的通知结果 —— best-effort,同②③的纪律,但丢的只是"细节"不是"事实"
 *
 * ④已经保证"这次转移发生过"这一行历史不会丢。②跑完之后,`markStatusEventNotified`
 * 只回填**那一行已经存在**的 `notified`/`email_subject`/`email_text` 三列——
 * 不是新插一行。这一步失败只记日志,不影响调用方拿到的结果(状态变更与②的结果
 * 已经是既成事实):最坏情况是这一行历史永远停在插入时的 `notified: false`
 * (保守地"看起来没发通知"),而不是①②③那种"这件事本身查无此事"。
 *
 * ⚠ **已知限制,登记、不在这轮修**(2026-09-02 独立审查提出,issue #2510 记录,
 *   把这条与②③的同类限制/#2500 一起收敛成统一 outbox):⑤失败没有重试补写,
 *   界面上能看到的证据只有值班日志里的一条 `feedback-triage-append-event`
 *   error;两个并发的同源转移请求仍可能各自读到旧状态、各自发一封通知邮件、
 *   各自写一行历史(这条表的行级 append-only 语义与"同一次转移最多发生一次
 *   通知"是两件事,后者目前没有行锁/CAS 保护)——与①②③是同一类"本地已落库、
 *   次要记录/同步只是尽力"的权衡,不为了堵这几个口子单独新增一张持久化的
 *   outbox 表/幂等 worker。
 *
 * ⚠ **已知限制,登记、不在这轮修**(2026-09-02 独立审查提出,issue #2500 记录):
 *   同步失败之后没有持久 outbox/重试调度——反馈状态与 GitHub issue 开关短暂不一致
 *   的窗口是真实存在的,管理员在这条反馈上再次触发任何一次状态转移时会重新尝试
 *   同步(因为每次转移都会跑一遍这段逻辑),但如果之后再也没有转移动作,这个窗口
 *   不会自愈,只能靠管理员手动点「查看 GitHub 状态」现查发现、去 GitHub 上手动改。
 *   与②(状态变更邮件)是同一类"本地事实已经落库、外部系统只是尽力同步"的权衡,
 *   不为了堵这个口子新增一张持久化的 outbox 表/后台调度任务。
 *
 * ### ⑥(2026-09-03)建 issue 时把这条反馈的图片附件一起推给 GitHub —— best-effort
 *
 * 反馈附件的下载 URL(`/feedback/attachments/:id`)要 `Authorization` 头才读得到
 * 字节;GitHub 渲染 issue 正文时是**匿名**抓图,那个内部 URL 它根本抓不到。所以
 * ①认领成功、真正调 `githubIssues.create` 之前,先把这条反馈已认领的图片附件
 * 逐张推给 GitHub(`GithubIssueImageUploader.uploadImage`,Contents API,细节见
 * `notification-ports.ts`),把换回来的 `raw.githubusercontent.com` 直链拼成
 * `![](url)` 追加到管理员编辑过的 `issueDraft.body` 末尾。
 *
 * ⚠ **这条一度被独立 review 拦下过、又由人类明确改判**(见 `notification-ports.ts`
 *   头注同一条 2026-09-03 记录):`boardx/workspacex` 是公开仓库,反馈附件受 D3
 *   权限判定保护,推进去等于让内容对任何人可见、且不可撤回。人类知情后仍然要求
 *   "图片要真的显示在 issue 里,上传到 GitHub 自己的服务器,不建独立托管服务"——
 *   这是记录在案的产品取舍,不是这个用例自己的判断,后续收紧需要另一次人类决策。
 *
 * ⚠ 与①**不是同一条纪律**:①是"issue 本身建没建成"fail closed,这里是"issue
 *   正文里有没有带图"——没有任何一张图片上传成功,不该拦住 issue 本身被建出来,
 *   所以整段(含单张图片各自的失败)都是 best-effort,只记日志(见
 *   `withAttachmentImages`)。没有附件时**原样**返回 `draft`,不追加空行——这也是
 *   "管理员编辑过的正文是原样传给 GitHub"那条既有断言仍然成立的原因。
 */
import {
  canTriage,
  triage,
  type FeedbackStatus,
} from "../../domain/feedback/product-feedback";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import type { LoggerPort } from "../ports/logger.port";
import type { TransactionalMailTransport } from "../notifications/transactional-mail-ports";
import type { ObjectStore } from "../artifact/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { decideFeedbackDetailVisibility } from "./feedback-detail-decision";
import type { FeedbackAttachmentRepository, FeedbackAttachmentRow } from "./attachment-ports";
import {
  GithubIssueCreationError,
  type FeedbackSubmitterDirectory,
  type GithubIssueCreator,
  type GithubIssueDraft,
  type GithubIssueImageUploader,
  type GithubIssueStateTarget,
} from "./notification-ports";
import type { ProductFeedbackRepository } from "./ports";

/**
 * `image/png` → `.png` 等——拼 GitHub 仓库里的文件名要用得到。
 * ⚠ UC-17.8 D3 之后附件还可能是 PDF / 文本，但这一步（⑥）推的是**图片**——`![](url)` 只对图片有
 *   意义，PDF/文本推上去 GitHub 也渲染不出来。不在这张表里的类型直接跳过，不是报错。
 */
type GithubImageMime = "image/png" | "image/jpeg" | "image/webp";
const ATTACHMENT_EXTENSION: Record<GithubImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
function isGithubImage(contentType: FeedbackAttachmentRow["contentType"]): contentType is GithubImageMime {
  return contentType in ATTACHMENT_EXTENSION;
}

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
  /** 建 issue 前把附件图片推给 GitHub、换回可匿名访问的 URL——见文件头 ⑥。 */
  readonly imageUploader: GithubIssueImageUploader;
  readonly attachments: FeedbackAttachmentRepository;
  readonly objectStore: ObjectStore;
  readonly newDecisionId: () => string;
}

export interface TriageFeedbackInput {
  readonly feedbackId: string;
  /** 建 issue 时读这条反馈的附件字节要用——见文件头 ⑥。 */
  readonly orgId: OrgId;
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
  /**
   * ⑥ 建 issue 时,这条反馈的哪些图片附件没能内嵌进正文——恒是数组(可能为空),
   * 不是 `null`/`undefined`:没有走①这条分支(未转开发/幂等重放/已有 issue)时
   * 天然没有任何图片要传,是"没有警告"而不是"这次没检查"。调用方(后台屏)据此
   * 决定要不要提示"issue 已创建,但以下图片未能内嵌"——见文件头 ⑥。
   */
  readonly imageUploadWarnings: readonly string[];
}

function statusChangeEmail(input: {
  readonly title: string;
  readonly status: FeedbackStatus;
  readonly reason: string | null;
}): { readonly subject: string; readonly text: string } {
  // ⚠ 2026-09-04 #2682:此前 subject 里只有状态、没有标题——收信人在邮件列表/通知里
  //   只看得到「你的反馈状态已更新为『已修复』」，同时提交过多条反馈时完全分不清
  //   说的是哪一条,要点开正文才知道。标题是用户当初自己填的、最直观的识别信息,
  //   拼进 subject 里让收件箱一栏就能认出来,不必逐封点开对照。
  const subject = `你的反馈《${input.title}》状态已更新为「${input.status}」`;
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
      imageUploadWarnings: [],
    };
  }

  // ① 转「已进入迭代」且带了 issueDraft 且这条反馈还没有 issue ⇒ 先认领、再建。
  // 认领失败 = 并发冲突,直接失败,不悄悄跳过(那会让状态变了但没人知道 issue
  // 到底建没建成)。认领成功后建失败,fail closed 且释放认领——理由见文件头①/⚠。
  let githubIssueUrl = current.githubIssueUrl;
  let githubIssueNumber = current.githubIssueNumber;
  // ⑥ 恒是数组——没有走进①这条分支就没有任何图片要传,是"没有警告"而不是
  //   "这次没检查",见 `TriageFeedbackResult.imageUploadWarnings` 头注。
  let imageUploadWarnings: readonly string[] = [];
  if (outcome.to === "已进入迭代" && input.issueDraft !== null && current.githubIssueUrl === null) {
    const claimed = await deps.repo.claimGithubIssueCreation(input.feedbackId);
    if (!claimed) throw new FeedbackIssueInProgressError();
    try {
      // ⑥ best-effort:把这条反馈的图片附件推给 GitHub、把 `![](url)` 拼进正文
      //   末尾——见文件头 ⑥ 与 `notification-ports.ts` 里 `GithubIssueImageUploader`
      //   头注(含 2026-09-03 人类决策记录)。**不是** fail closed:图片是"锦上添花",
      //   没有任何一张图片上传成功也不该拦住 issue 本身被建出来(那是①已经保护的、
      //   更重要的不变量)——但每一次失败都要收进 `imageUploadWarnings` 带回前端,
      //   不能只留一条日志:管理员看到的是"issue 建出来了",没有任何东西会主动
      //   告诉他"图片其实没跟着过去",这正是本次改动要补的可见性缺口。
      const { draft, warnings } = await withAttachmentImages(deps, {
        orgId: input.orgId,
        feedbackId: input.feedbackId,
        viewerId: input.actorId,
        viewerOrgRole: input.actorOrgRole,
        submittedBy: current.submittedBy,
        draft: input.issueDraft,
      });
      imageUploadWarnings = warnings;
      const created = await deps.githubIssues.create(draft);
      githubIssueUrl = created.url;
      githubIssueNumber = created.number;
      await deps.repo.setGithubIssue(input.feedbackId, created);
    } catch (e) {
      await deps.repo.releaseGithubIssueClaim(input.feedbackId);
      const cause = e instanceof GithubIssueCreationError ? e : new GithubIssueCreationError(null);
      throw new FeedbackIssueCreationFailedError(cause);
    }
  }

  // ④ 状态变更 + 「这次转移发生过」这一行历史,**同一个数据库事务**——见接口
  //   `transitionStatusWithEvent` 头注(2026-09-02 独立审查 P0):分两次独立
  //   `withTenant` 调用时,前者成功、后者失败会让状态真的变了但一行历史都没有,
  //   这条历史事实本身永久缺失。收进同一个事务之后,这两者要么一起提交、要么
  //   一起回滚,不再有中间态。事件行落库时 `notified` 先诚实写 `false`——这一刻
  //   还没发邮件(下面②才发)。
  const eventId = deps.newEventId();
  await deps.repo.transitionStatusWithEvent(input.feedbackId, outcome.to, outcome.reason, {
    id: eventId,
    feedbackId: input.feedbackId,
    fromStatus: outcome.from,
    toStatus: outcome.to,
    reason: outcome.reason,
    actorId: input.actorId,
  });

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
  const notification = await notifySubmitter(deps, {
    feedbackId: input.feedbackId,
    submittedBy: current.submittedBy,
    title: current.title,
    status: outcome.to,
    reason: outcome.reason,
  });

  // ⚠ 只回填④那一行已经存在的历史的通知结果——不是新插一行,失败也不再
  //   让整条历史消失(④的原子写入已经保证"转移发生过"这件事本身不会丢),
  //   最坏情况只是 `notified` 保守地停在插入时的 `false`。真失败了记日志——
  //   残余风险(回填失败、没有重试补写)登记在案,见 issue #2510。
  try {
    await deps.repo.markStatusEventNotified(eventId, notification.notified, notification.subject, notification.text);
  } catch (e) {
    deps.logger.error(
      "feedback triage: markStatusEventNotified failed (best-effort, status change + event row already committed)",
      { traceId: "feedback-triage-append-event", feedbackId: input.feedbackId, err: e },
    );
  }

  return {
    feedbackId: input.feedbackId,
    status: outcome.to,
    notified: notification.notified,
    githubIssueUrl,
    imageUploadWarnings,
  };
}

/** `catch (e)` 里统一取一句人能看的失败原因——日志与 `imageUploadWarnings` 共用同一句话。 */
function describeUploadFailure(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * ⑥ best-effort:这条反馈已认领的图片附件,逐张推给 GitHub、把 `![](url)` 追加到
 * `draft.body` 末尾。没有附件 ⇒ 原样返回 `draft`(不追加空行)——这正是
 * `triage-feedback.test.ts` 那条"管理员编辑过的正文是**原样**传给 GitHub"用例
 * 仍然成立的原因:默认 fake 的附件仓储返回空列表,body 不会被这里改动。
 *
 * 单张图片的任何一步失败(读不到字节、GitHub 拒绝)都只跳过那一张,不影响其余
 * 图片,更不影响 issue 本身被建出来——理由见调用处 ⑥ 的注释。**但每一次跳过
 * 都要落进返回的 `warnings`**(不是只记一条 `logger.error`):日志只有值班能看,
 * 而管理员在弹层里看到"issue 已创建"就会以为图片一起带过去了——这正是这次改动
 * 要补的可见性缺口,`imageUploadWarnings` 让这件事在响应里诚实可见。
 */
async function withAttachmentImages(
  deps: TriageFeedbackDeps,
  input: {
    readonly orgId: OrgId;
    readonly feedbackId: string;
    readonly viewerId: string;
    readonly viewerOrgRole: OrgRole | null;
    readonly submittedBy: string;
    readonly draft: GithubIssueDraft;
  },
): Promise<{ readonly draft: GithubIssueDraft; readonly warnings: readonly string[] }> {
  let rows;
  try {
    rows = await deps.attachments.findByFeedbackIds(input.orgId, [input.feedbackId]);
  } catch (e) {
    deps.logger.error("feedback triage: attachment lookup failed (best-effort, issue creation continues)", {
      traceId: "feedback-triage-attachment-image",
      feedbackId: input.feedbackId,
      err: e,
    });
    return { draft: input.draft, warnings: [`附件列表读取失败,图片未能内嵌(${describeUploadFailure(e)})`] };
  }
  if (rows.length === 0) return { draft: input.draft, warnings: [] };

  const imageUrls: string[] = [];
  const warnings: string[] = [];
  for (const row of rows) {
    try {
      if (row.objectKey === null) continue; // 未认领的附件不会出现在这里,防御性判断
      // 与正文用**同一条**判定(D3)——同 `download-feedback-attachment.ts` 的既有
      // 纪律:两处各写一遍"谁能看附件"的规则,其中一处漏改就是这条规则事实上分岔
      // 成两条而没人发现。调用方(triageFeedback)已经先过了 `canTriage`,这里恒
      // 放行,但判定本身仍然走同一处代码,不绕开 `Guarded`。
      const decision = decideFeedbackDetailVisibility({
        decisionId: deps.newDecisionId(),
        viewerId: input.viewerId,
        viewerOrgRole: input.viewerOrgRole,
        viewerTeamId: null,
        submittedBy: input.submittedBy,
      });
      const disclosed = discloseDecided(row.objectKey, decision);
      if (!isDisclosed(disclosed)) {
        warnings.push(`附件 ${row.id}:无权限读取,未能内嵌`);
        continue;
      }
      const bytes = await deps.objectStore.get(disclosed.payload);
      if (bytes === null) {
        warnings.push(`附件 ${row.id}:字节已不在对象存储中,未能内嵌`);
        continue;
      }
      if (!isGithubImage(row.contentType)) continue; // 非图片附件不推 GitHub(不算失败),见 ATTACHMENT_EXTENSION 头注
      const uploaded = await deps.imageUploader.uploadImage({
        path: `feedback-attachments/${row.id}.${ATTACHMENT_EXTENSION[row.contentType]}`,
        content: bytes,
        contentType: row.contentType,
      });
      imageUrls.push(uploaded.url);
    } catch (e) {
      deps.logger.error("feedback triage: attachment image upload failed (best-effort, issue creation continues)", {
        traceId: "feedback-triage-attachment-image",
        feedbackId: input.feedbackId,
        attachmentId: row.id,
        err: e,
      });
      warnings.push(`附件 ${row.id}:推送到 GitHub 失败(${describeUploadFailure(e)})`);
    }
  }
  if (imageUrls.length === 0) return { draft: input.draft, warnings };
  return {
    draft: { ...input.draft, body: `${input.draft.body}\n\n${imageUrls.map((u) => `![](${u})`).join("\n")}` },
    warnings,
  };
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
