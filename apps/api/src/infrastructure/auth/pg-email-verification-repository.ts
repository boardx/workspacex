import type { DatabasePort } from "../../application/ports/database.port";
import type {
  EmailVerificationRepository,
  MailOutboxMessage,
  VerificationConfirmation,
} from "../../application/auth/email-verification-ports";

export class PgEmailVerificationRepository implements EmailVerificationRepository {
  constructor(private readonly db: DatabasePort) {}

  async confirmDigest(digest: string, now: Date): Promise<VerificationConfirmation> {
    return this.db.withoutTenant(async (s) => {
      const result = await s.query<{ completed: boolean }>(
        `WITH target AS (
           SELECT id, user_id, consumed_at, expires_at
             FROM email_verification_challenges
            WHERE token_digest = $1
            FOR UPDATE
         ), consumed AS (
           UPDATE email_verification_challenges c
              SET consumed_at = $2
             FROM target t
            WHERE c.id = t.id AND c.consumed_at IS NULL AND t.expires_at > $2
            RETURNING c.user_id
         ), verified AS (
           UPDATE credentials c
              SET email_verified_at = COALESCE(c.email_verified_at, $2)
             FROM consumed
            WHERE c.user_id = consumed.user_id
         )
         SELECT (t.consumed_at IS NOT NULL OR EXISTS (SELECT 1 FROM consumed)) AS completed
           FROM target t`,
        [digest, now],
      );
      return { outcome: result.rows[0]?.completed === true ? "completed" : "invalid" };
    });
  }

  async requestResend(input: {
    email: string;
    challengeId: string;
    tokenDigest: string;
    outboxId: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void> {
    await this.db.withoutTenant(async (s) => {
      // Exists and absent addresses take the same serialization/query skeleton. The advisory
      // lock also closes the concurrent-resend window: the rate check happens after the lock.
      await s.query(`SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))`, [input.email]);
      const candidate = await s.query<{ user_id: string }>(
        `SELECT c.user_id FROM credentials c
          WHERE c.email = lower($1) AND c.email_verified_at IS NULL`,
        [input.email],
      );
      const userId = candidate.rows[0]?.user_id;
      const rateSubject = userId ?? `missing:${input.email}`;
      const rate = await s.query<{ allowed: boolean }>(
        `SELECT NOT EXISTS (
           SELECT 1 FROM email_verification_challenges recent
            WHERE recent.user_id = $1
              AND recent.created_at > $2::timestamptz - interval '60 seconds'
         ) AND (
           SELECT count(*) FROM email_verification_challenges daily
            WHERE daily.user_id = $1
              AND daily.created_at > $2::timestamptz - interval '24 hours'
         ) < 5 AS allowed`,
        [rateSubject, input.now],
      );
      if (!userId || rate.rows[0]?.allowed !== true) return;
      await s.query(
        `UPDATE email_verification_challenges SET consumed_at = COALESCE(consumed_at, $2)
          WHERE user_id = $1 AND consumed_at IS NULL`,
        [userId, input.now],
      );
      await s.query(
        `INSERT INTO email_verification_challenges
          (id, token_digest, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [input.challengeId, input.tokenDigest, userId, input.expiresAt, input.now],
      );
      await s.query(
        `INSERT INTO mail_outbox (id, challenge_id, template, recipient, created_at, next_attempt_at)
         VALUES ($1, $2, 'email-verification', lower($3), $4, $4)`,
        [input.outboxId, input.challengeId, input.email, input.now],
      );
    });
  }

  async claimDue(now: Date): Promise<MailOutboxMessage | null> {
    return this.db.withoutTenant(async (s) => {
      const result = await s.query<{
        id: string; challenge_id: string; recipient: string; attempt_count: number;
      }>(
        `WITH due AS (
           SELECT id FROM mail_outbox
            WHERE (status IN ('pending', 'retryable') AND next_attempt_at <= $1)
               OR (status = 'delivering' AND claimed_at < $1 - interval '5 minutes')
            ORDER BY next_attempt_at, created_at
            FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE mail_outbox o
            SET status = 'delivering', claimed_at = $1, attempt_count = attempt_count + 1
           FROM due WHERE o.id = due.id
         RETURNING o.id, o.challenge_id, o.recipient, o.attempt_count`,
        [now],
      );
      const row = result.rows[0];
      return row ? {
        id: row.id,
        challengeId: row.challenge_id,
        recipient: row.recipient,
        attemptCount: row.attempt_count,
      } : null;
    });
  }

  async markDelivered(id: string, providerMessageId: string, at: Date): Promise<void> {
    await this.db.withoutTenant((s) => s.query(
      `UPDATE mail_outbox SET status = 'delivered', delivered_at = $2,
         provider_message_id = $3, failure_category = NULL
       WHERE id = $1 AND status = 'delivering'`,
      [id, at, providerMessageId],
    ).then(() => undefined));
  }

  async markFailed(input: {
    id: string; at: Date; category: string; retryable: boolean; nextAttemptAt: Date;
  }): Promise<void> {
    await this.db.withoutTenant((s) => s.query(
      `UPDATE mail_outbox SET status = $2, failure_category = $3,
         next_attempt_at = $4, claimed_at = NULL
       WHERE id = $1 AND status = 'delivering'`,
      [input.id, input.retryable ? "retryable" : "failed", input.category, input.nextAttemptAt],
    ).then(() => undefined));
  }
}
