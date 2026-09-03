/**
 * FB-2 补——`FeedbackGithubIssueScanner` 的 pg 实现。
 *
 * ⚠ **2026-09-03（PR #2580 独立复核阻断项①）**：这个文件**曾经**直接
 *   `SELECT ... FROM product_feedback` 包在 `withoutTenant` 里——语法能过静态
 *   lint（那道 lint 只查表名/列名，查不出运行时行为），但 `product_feedback`
 *   跟每张租户表一样挂着 `FORCE ROW LEVEL SECURITY`：`withoutTenant` 不设置
 *   `app.current_org`，策略 `org_id = current_setting('app.current_org', true)`
 *   因此恒不满足，**返回的永远是零行**——见 `DatabasePort.withoutTenant` 自己的
 *   头注："业务查询必须不用这个：策略是 fail-closed 的，读到的是看起来正常的
 *   『没有数据』"。这个 worker 从建出来那一刻起就没有真的同步过任何东西，只是
 *   不报错、看起来在正常轮询——这正是那条头注警告的确切失效模式。
 *
 *   真正的修法是迁移 `20260903130000_fb2_feedback_github_issue_poll_definer.sql`
 *   的 `kernel_read_open_feedback_with_github_issue()`——一个 `SECURITY DEFINER`
 *   函数，`WHERE` 条件焊死在函数体内部（不接受任何参数），绕开 RLS 的方式与
 *   `kernel_org_is_writable`/`kernel_user_org_ids` 相同，理由见该迁移头注。
 *   本文件现在**不再直接命名 `product_feedback`**，只调用这一个函数——这不只是
 *   绕开了 RLS 的坑，也让"这个文件能读到哪些列"从"我保证只 SELECT 这五列"这句
 *   承诺，收紧成"这个函数的返回类型只有这五列，物理上选不出别的"。
 *
 * ⚠ 仍然只经手五个字段（见端口文件头注），不碰 `detail`——函数返回类型本身
 *   就没有那一列，双重收窄。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  FeedbackGithubIssueCandidate,
  FeedbackGithubIssueScanner,
} from "../../application/feedback/github-issue-poll-ports";

interface CandidateDbRow {
  readonly id: string;
  readonly org_id: string;
  readonly submitted_by: string;
  readonly title: string;
  readonly github_issue_number: number;
}

export class PgFeedbackGithubIssueScanner implements FeedbackGithubIssueScanner {
  constructor(private readonly db: DatabasePort) {}

  async listOpenLinkedToGithubIssue(): Promise<readonly FeedbackGithubIssueCandidate[]> {
    return this.db.withoutTenant(async (s) => {
      const { rows } = await s.query<CandidateDbRow>(
        `SELECT id, org_id, submitted_by, title, github_issue_number
           FROM kernel_read_open_feedback_with_github_issue()`,
      );
      return rows.map(
        (r): FeedbackGithubIssueCandidate => ({
          orgId: r.org_id,
          feedbackId: r.id,
          submittedBy: r.submitted_by,
          title: r.title,
          githubIssueNumber: r.github_issue_number,
        }),
      );
    });
  }
}
