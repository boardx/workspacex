/**
 * FB-2 补——定时对账：每隔一段时间，把「已进入迭代」且挂着 GitHub issue 的反馈
 * 拿去现查一次 issue 是不是已经关闭，关了就自动转「已修复」并通知提交人来验收。
 *
 * `triage-feedback.ts` 头注登记的 issue #2500 正是这个缺口：「同步失败之后没有
 * 持久 outbox/重试调度……这个窗口不会自愈，只能靠管理员手动点『查看 GitHub 状态』
 * 现查发现」。这份端口 + `reconcile-closed-github-issues.ts` 用例就是那条被登记、
 * 一直没做的自愈路径的正向落地——**方向与 `triageFeedback` 的③相反**：那边是
 * 分诊时把反馈状态**推**给 GitHub；这里是定时把 GitHub 的状态**拉**回反馈。
 *
 * ## 为什么这是一个独立端口，不是 `ProductFeedbackRepository` 的一个新方法
 *
 * `ProductFeedbackRepository` 是**按组织构造的**（`forOrg`，见 `ports.ts` 头注）——
 * 一次调用只看得到一个租户。这份定时对账天然是**跨组织**的：进程不知道、也不该
 * 关心"现在轮到哪个组织"，它要的是"全平台有哪些反馈需要被检查"。给按组织构造的
 * 仓储加一个"跨组织列出"方法，等于在一个类型上就该构造不出跨租户读的接口里
 * 开一个能读别人组织的洞——这正是 `ports.ts` 头注那段论证要防的事，不能在这里
 * 反过来破。所以这是一个**不绑租户**的独立端口，专门服务这一个系统级维护任务。
 *
 * ## 为什么它只读四个字段，不读 `detail`
 *
 * 这个端口的实现允许绕开 RLS 读取全平台数据（见 pg 实现头注），这是**信任边界的
 * 例外**，例外要开得越窄越好：这里只选 `id`/`org_id`/`submitted_by`/`title`/
 * `github_issue_number` 五列——都是 D3 判定下"全组织可见"的字段（见
 * `application/feedback/ports.ts` 的 `FeedbackRow` 头注），不碰 `detail`（仅管理员
 * /提交人可见的正文）。真正要改状态、要读正文，走回 `ProductFeedbackRepository.forOrg`
 * ——那条路仍然是租户内的，仍然过 RLS 第二道防线。
 */

export interface FeedbackGithubIssueCandidate {
  readonly orgId: string;
  readonly feedbackId: string;
  readonly submittedBy: string;
  readonly title: string;
  readonly githubIssueNumber: number;
}

export interface FeedbackGithubIssueScanner {
  /**
   * 全平台范围内，状态为「已进入迭代」且挂着 GitHub issue 的反馈。
   * ⚠ 不做分页——同 `GithubIssueCreator` 头注里"没有第五个批量方法"那条克制的
   *   反面：这里恰恰需要一次看到全部候选，但候选集合本身有界（只有"进了迭代
   *   且没关闭"的反馈才会一直留在这个集合里，修完/判定不做都会从这个集合消失），
   *   真长到需要分页时再加，不提前设计一个用不上的游标参数。
   */
  listOpenLinkedToGithubIssue(): Promise<readonly FeedbackGithubIssueCandidate[]>;
}

export const FEEDBACK_GITHUB_ISSUE_SCANNER = Symbol("FeedbackGithubIssueScanner");
