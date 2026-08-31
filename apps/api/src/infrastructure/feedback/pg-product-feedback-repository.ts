/**
 * FB-2 —— 反馈的 PostgreSQL 适配器。
 *
 * 落到 `product_feedback` / `product_feedback_votes` / `product_feedback_status_events`
 * （迁移 `20260815140000_fb2_product_feedback.sql`）。
 *
 * ⚠ 每个方法恰好一次 `withTenant`，本文件没有 `withoutTenant`——业务仓储用它
 *   等于关掉 RLS 后读到「没有数据」而不是报错（同 `pg-thread-mount-store.ts`）。
 * ⚠ 每个 WHERE 仍然带 `org_id = $1`，即使 RLS 已经在挡。第二道防线。
 *
 * ## 正文出门时被 `guard()` 包住
 *
 * 这是本文件通过 `lint-permission-paths` 的方式，也是它**应该**通过的方式：
 * 反馈正文是租户内容，`Guarded<string>` 让「忘了判 D3 就投影出去」在类型上
 * 就写不出来（载荷只能经 `discloseDecided` 取出）。其余列（标题/票数/状态）
 * 按 D3 本来就是全组织可见的，不包——见 `application/feedback/ports.ts` 的
 * `FeedbackRow` 头注。
 *
 * ## 票数是 join 出来的，不是列（I-F2）
 *
 * 每个读方法都带 `LEFT JOIN LATERAL (SELECT count(*) …)`。代价是每行一次子查询；
 * 收益是不存在「计数列与真实票行对不上」这种没有解法的正确性问题。
 * `product_feedback_votes (org_id, feedback_id)` 上的索引是这件事的性能兜底。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { guard } from "../../application/security/permission-filter";
import { toOrgId } from "../../domain/org-id";
import type { FeedbackStatus } from "../../domain/feedback/product-feedback";
import type {
  FeedbackCounts,
  FeedbackRow,
  FeedbackScope,
  FeedbackTarget,
  NewFeedback,
  ProductFeedbackRepository,
  ProductFeedbackRepositoryFactory,
  StatusEvent,
} from "../../application/feedback/ports";

interface FeedbackDbRow {
  readonly id: string;
  readonly submitted_by: string;
  readonly kind: string;
  readonly target_kind: string;
  readonly target_agent_id: string | null;
  readonly target_skill_id: string | null;
  readonly target_label: string | null;
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly status_reason: string | null;
  readonly occurred_route: string | null;
  readonly app_version: string | null;
  readonly created_at: Date | string;
  readonly votes: string | number;
  readonly voted_by_me: boolean;
  readonly github_issue_url: string | null;
  readonly github_issue_number: number | null;
}

/**
 * ⚠ 从三列还原判别联合，**遇到对不上的组合就抛**，不是「默认当 product」。
 *   迁移里的 CHECK 已经让这种行存不进来，所以真读到了就说明有人绕开了那道约束；
 *   静默当成 `product` 会把一条本该报警的数据损坏变成一条看起来正常的产品级反馈。
 */
function toTarget(row: FeedbackDbRow): FeedbackTarget {
  if (row.target_kind === "product") return { kind: "product" };
  if (row.target_kind === "agent" && row.target_agent_id !== null) {
    return { kind: "agent", agentId: row.target_agent_id };
  }
  if (row.target_kind === "skill" && row.target_skill_id !== null) {
    return { kind: "skill", skillId: row.target_skill_id };
  }
  throw new Error(`product_feedback ${row.id}: target columns violate the pairing CHECK`);
}

function toRow(row: FeedbackDbRow): FeedbackRow {
  return {
    id: row.id,
    submittedBy: row.submitted_by,
    // 列上有 CHECK (kind IN ('缺陷','需求'))，读回来只可能是这两个之一。
    kind: row.kind as "缺陷" | "需求",
    target: toTarget(row),
    targetLabel: row.target_label,
    title: row.title,
    detail: guard({ kind: "feedback", id: row.id }, row.detail),
    status: row.status as FeedbackStatus,
    statusReason: row.status_reason,
    // `count(*)` 在 pg 驱动里是 bigint → 字符串。`Number(...)` 而不是 `parseInt`：
    // 后者对 "12abc" 返回 12，把一个本该炸掉的驱动异常变成一个看起来正常的票数。
    votes: Number(row.votes),
    votedByMe: row.voted_by_me,
    occurredRoute: row.occurred_route,
    appVersion: row.app_version,
    createdAt: new Date(row.created_at).toISOString(),
    githubIssueUrl: row.github_issue_url,
    githubIssueNumber: row.github_issue_number,
  };
}

const SELECT_COLUMNS = `
  f.id, f.submitted_by, f.kind, f.target_kind, f.target_agent_id, f.target_skill_id,
  f.target_label, f.title, f.detail, f.status, f.status_reason,
  f.occurred_route, f.app_version, f.created_at,
  f.github_issue_url, f.github_issue_number,
  v.votes,
  EXISTS (
    SELECT 1 FROM product_feedback_votes mine
     WHERE mine.org_id = f.org_id AND mine.feedback_id = f.id AND mine.voter_id = $2
  ) AS voted_by_me`;

const VOTE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT count(*) AS votes FROM product_feedback_votes pv
     WHERE pv.org_id = f.org_id AND pv.feedback_id = f.id
  ) v ON true`;

class ScopedPgProductFeedbackRepository implements ProductFeedbackRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly orgId: string,
  ) {}

  async insert(record: NewFeedback): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      await s.query(
        `INSERT INTO product_feedback
           (id, org_id, submitted_by, kind, target_kind, target_agent_id, target_skill_id,
            target_label, title, detail, status, occurred_route, app_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'待处理',$11,$12)`,
        [
          record.id,
          this.orgId,
          record.submittedBy,
          record.kind,
          record.target.kind,
          record.target.kind === "agent" ? record.target.agentId : null,
          record.target.kind === "skill" ? record.target.skillId : null,
          record.targetLabel,
          record.title,
          record.detail,
          record.occurredRoute,
          record.appVersion,
        ],
      );
    });
  }

  /**
   * ⚠ 三种口径是**三个 WHERE 片段拼在同一条 SQL 上**，不是三条 SQL。
   *   三条 SQL 意味着 `SELECT_COLUMNS` 与 `VOTE_JOIN` 各抄三遍，
   *   而「某一份漏了 voted_by_me」在界面上表现为一个正常的「你还没投票」。
   */
  async list(scope: FeedbackScope, viewerId: string): Promise<readonly FeedbackRow[]> {
    const params: unknown[] = [this.orgId, viewerId];
    let predicate = "";
    if (scope.kind === "mine") {
      params.push(viewerId);
      predicate = ` AND f.submitted_by = $${params.length}`;
    } else if (scope.kind === "target") {
      const t = scope.target;
      if (t.kind === "product") {
        predicate = ` AND f.target_kind = 'product'`;
      } else if (t.kind === "agent") {
        params.push(t.agentId);
        predicate = ` AND f.target_kind = 'agent' AND f.target_agent_id = $${params.length}`;
      } else {
        params.push(t.skillId);
        predicate = ` AND f.target_kind = 'skill' AND f.target_skill_id = $${params.length}`;
      }
    }

    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<FeedbackDbRow>(
        `SELECT ${SELECT_COLUMNS}
           FROM product_feedback f ${VOTE_JOIN}
          WHERE f.org_id = $1${predicate}
          ORDER BY f.created_at DESC, f.id DESC`,
        params,
      );
      return rows.map(toRow);
    });
  }

  async findById(feedbackId: string, viewerId: string): Promise<FeedbackRow | null> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<FeedbackDbRow>(
        `SELECT ${SELECT_COLUMNS}
           FROM product_feedback f ${VOTE_JOIN}
          WHERE f.org_id = $1 AND f.id = $3`,
        [this.orgId, viewerId, feedbackId],
      );
      const row = rows[0];
      return row === undefined ? null : toRow(row);
    });
  }

  /**
   * ⚠ `ON CONFLICT DO NOTHING` / `DELETE`，然后**重新数一次**。
   *   不返回「本次是否真的改变了」——调用方需要的是最终票数，
   *   而「我加了一票所以是 N+1」在并发下是错的。
   */
  async setVote(
    feedbackId: string,
    voterId: string,
    voted: boolean,
  ): Promise<{ readonly votes: number; readonly votedByMe: boolean }> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      if (voted) {
        await s.query(
          `INSERT INTO product_feedback_votes (feedback_id, org_id, voter_id)
           VALUES ($1,$2,$3) ON CONFLICT (feedback_id, voter_id) DO NOTHING`,
          [feedbackId, this.orgId, voterId],
        );
      } else {
        await s.query(
          `DELETE FROM product_feedback_votes
            WHERE org_id = $2 AND feedback_id = $1 AND voter_id = $3`,
          [feedbackId, this.orgId, voterId],
        );
      }
      const { rows } = await s.query<{ votes: string | number; voted_by_me: boolean }>(
        `SELECT count(*) AS votes,
                bool_or(voter_id = $3) IS TRUE AS voted_by_me
           FROM product_feedback_votes
          WHERE org_id = $2 AND feedback_id = $1`,
        [feedbackId, this.orgId, voterId],
      );
      const row = rows[0];
      return {
        votes: row === undefined ? 0 : Number(row.votes),
        votedByMe: row === undefined ? false : row.voted_by_me,
      };
    });
  }

  async updateStatus(feedbackId: string, status: FeedbackStatus, reason: string | null): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      await s.query(
        `UPDATE product_feedback SET status = $3, status_reason = $4
          WHERE org_id = $2 AND id = $1`,
        [feedbackId, this.orgId, status, reason],
      );
    });
  }

  /**
   * ⚠ 只 UPDATE 这两列——迁移 `20260830120000_fb2_feedback_github_issue.sql` 把
   *   它们从"不可变列"名单里排除出去，正是为了让这次写回不撞触发器。
   */
  async setGithubIssue(feedbackId: string, issue: { readonly url: string; readonly number: number }): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      await s.query(
        `UPDATE product_feedback
            SET github_issue_url = $3, github_issue_number = $4, github_issue_claimed_at = NULL
          WHERE org_id = $2 AND id = $1`,
        [feedbackId, this.orgId, issue.url, issue.number],
      );
    });
  }

  /**
   * 多旧算"过期"：5 分钟。这个数字要盖住一次真实 GitHub REST 调用可能的最长耗时
   * （`FetchGithubIssueCreator` 自己的请求超时是 10s，5 分钟是给"调用方进程在
   * 拿到认领之后、真正发起请求之前又卡了一阵"这类更慢的异常路径留够余量），
   * 又不能长到"进程崩溃之后这条反馈要等很久才能被重试"——两者都不是精确科学，
   * 5 分钟是这两条约束之间一个不假装精确的选择。
   */
  private static readonly CLAIM_STALE_AFTER_SQL = `now() - interval '5 minutes'`;

  async claimGithubIssueCreation(feedbackId: string): Promise<boolean> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      // ⚠ 这一条 UPDATE 本身就是原子性的来源：Postgres 对同一行的并发 UPDATE
      //   互斥执行，两个并发事务里只有一个能把 `github_issue_claimed_at`
      //   从满足 WHERE 的旧值改成 `now()`，另一个的这条语句在它之后执行时
      //   WHERE 条件已经不再成立（除非它足够旧），`RETURNING` 因此是空集——
      //   不需要应用层加锁、不需要 `SELECT ... FOR UPDATE` 跨网络调用持锁。
      const { rows } = await s.query<{ id: string }>(
        `UPDATE product_feedback
            SET github_issue_claimed_at = now()
          WHERE org_id = $2 AND id = $1
            AND github_issue_url IS NULL
            AND (github_issue_claimed_at IS NULL
                 OR github_issue_claimed_at < ${ScopedPgProductFeedbackRepository.CLAIM_STALE_AFTER_SQL})
          RETURNING id`,
        [feedbackId, this.orgId],
      );
      return rows.length > 0;
    });
  }

  async releaseGithubIssueClaim(feedbackId: string): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      await s.query(
        `UPDATE product_feedback SET github_issue_claimed_at = NULL
          WHERE org_id = $2 AND id = $1`,
        [feedbackId, this.orgId],
      );
    });
  }

  async appendStatusEvent(event: StatusEvent): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      await s.query(
        `INSERT INTO product_feedback_status_events
           (id, org_id, feedback_id, from_status, to_status, reason, actor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [event.id, this.orgId, event.feedbackId, event.fromStatus, event.toStatus, event.reason, event.actorId],
      );
    });
  }

  /**
   * ⚠ 五个数**一次查询派生**（契约 `getFeedbackCounts` 逐字）。
   *   分五次 `SELECT count(*) WHERE status = …` 的话，五次之间有写入窗口，
   *   于是 `total` 可能不等于四个分状态之和——而界面会把那个不等式直接显示给人看。
   */
  async counts(): Promise<FeedbackCounts> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<{
        total: string | number;
        pending: string | number;
        iterating: string | number;
        fixed: string | number;
        declined: string | number;
      }>(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE status = '待处理')     AS pending,
                count(*) FILTER (WHERE status = '已进入迭代') AS iterating,
                count(*) FILTER (WHERE status = '已修复')     AS fixed,
                count(*) FILTER (WHERE status = '不做')       AS declined
           FROM product_feedback WHERE org_id = $1`,
        [this.orgId],
      );
      const row = rows[0];
      return {
        total: Number(row?.total ?? 0),
        待处理: Number(row?.pending ?? 0),
        已进入迭代: Number(row?.iterating ?? 0),
        已修复: Number(row?.fixed ?? 0),
        不做: Number(row?.declined ?? 0),
      };
    });
  }
}

export class PgProductFeedbackRepository implements ProductFeedbackRepositoryFactory {
  constructor(private readonly db: DatabasePort) {}

  forOrg(orgId: string): ProductFeedbackRepository {
    return new ScopedPgProductFeedbackRepository(this.db, orgId);
  }
}
