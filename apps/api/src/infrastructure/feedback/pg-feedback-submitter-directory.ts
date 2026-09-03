/**
 * FB-2 —— 从反馈的 `submittedBy`（= `credentials.user_id`）查回一个能收信的邮箱。
 *
 * ⚠ `credentials` 是 `kernel-no-tenant-data`（见 `0010-auth-credentials-sessions.sql`
 *   头注）：账号不按组织分区，所以这里**不经过 `withTenant`**——不是漏了 RLS，
 *   是这张表本来就不受组织边界管辖,同 `pg-registration-repository.ts` 读它的方式。
 * ⚠ 找不到就回 `null`，不抛错。账号被清理、`submitted_by` 指向一个已经不存在的
 *   `credentials` 行是可能发生的（该表不加 FK,同 `product_feedback.submitted_by`
 *   不加 FK 的理由）——"这条反馈没有能通知到的人"是一个用例层用 best-effort
 *   语义就能吸收的正常情况，不是一个要终止分诊流程的错误。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { FeedbackSubmitterDirectory } from "../../application/feedback/notification-ports";

export class PgFeedbackSubmitterDirectory implements FeedbackSubmitterDirectory {
  constructor(private readonly db: DatabasePort) {}

  async emailForUserId(userId: string): Promise<string | null> {
    return this.db.withoutTenant(async (s) => {
      const { rows } = await s.query<{ email: string }>(
        `SELECT email FROM credentials WHERE user_id = $1`,
        [userId],
      );
      return rows[0]?.email ?? null;
    });
  }

  async displayNamesForUserIds(userIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (userIds.length === 0) return new Map();
    return this.db.withoutTenant(async (s) => {
      const { rows } = await s.query<{ user_id: string; display_name: string | null; email: string }>(
        `SELECT user_id, display_name, email FROM credentials WHERE user_id = ANY($1::text[])`,
        [userIds],
      );
      const out = new Map<string, string>();
      for (const r of rows) {
        // 没设显示名时退回邮箱 @ 前那一段——同头像/成员列表处的既有习惯：一个可读的
        // 标识胜过把整个邮箱铺在后台列表上。
        const name = (r.display_name ?? "").trim() || r.email.split("@")[0] || r.email;
        out.set(r.user_id, name);
      }
      return out;
    });
  }
}
