/**
 * FB-2 补——`FeedbackGithubIssueScanner` 的 pg 实现。
 *
 * ⚠ **本文件用 `withoutTenant`**——`pg-product-feedback-repository.ts` 头注说
 *   「每个方法恰好一次 `withTenant`，本文件没有 `withoutTenant`」，这里是那条
 *   纪律**刻意**的例外，不是疏忽照抄错了文件：那条纪律防的是"业务用例误用
 *   `withoutTenant`，于是 RLS 关掉之后读到『没有数据』而不是报错"这类静默 bug；
 *   这里恰恰**需要**跨组织读——见端口文件头注"为什么是独立端口"。同一个 `db`
 *   实例上，业务仓储与这个系统级扫描器分别落在两份不同的纪律里，各自的头注
 *   解释各自的理由，不是同一份纪律被打破了。
 *
 * ⚠ 只选五列（见端口文件头注），不选 `detail`——即使 RLS 关掉了，
 *   查询本身也不去碰那一列，双重收窄。
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
           FROM product_feedback
          WHERE status = '已进入迭代' AND github_issue_number IS NOT NULL`,
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
