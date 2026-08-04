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
           SELECT id, user_id, consumed_at, superseded_at, expires_at
             FROM email_verification_challenges
            WHERE token_digest = $1
            FOR UPDATE
         ), consumed AS (
           UPDATE email_verification_challenges c
              SET consumed_at = $2
             FROM target t
            WHERE c.id = t.id AND c.consumed_at IS NULL
              AND t.superseded_at IS NULL AND t.expires_at > $2
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
    proofChallengeId: string | null;
    challengeId: string;
    tokenDigest: string;
    outboxId: string;
    expiresAt: Date;
    now: Date;
  }): Promise<boolean> {
    return this.db.withoutTenant(async (s) => {
      // Exists and absent addresses take the same serialization/query skeleton. The advisory
      // lock also closes the concurrent-resend window: the rate check happens after the lock.
      await s.query(`SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))`, [input.email]);
      // Lock in the same order as confirmDigest (challenge, then credential). Whichever
      // operation wins makes the other's predicate false after the lock wait.
      const proof = await s.query<{ user_id: string }>(
        `SELECT user_id FROM email_verification_challenges
          WHERE id = $1 AND consumed_at IS NULL AND superseded_at IS NULL AND expires_at > $2
          FOR UPDATE`,
        [input.proofChallengeId, input.now],
      );
      const candidate = await s.query<{ user_id: string }>(
        `SELECT user_id FROM credentials
          WHERE user_id = $1 AND email = lower($2) AND email_verified_at IS NULL
          FOR UPDATE`,
        [proof.rows[0]?.user_id ?? null, input.email],
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
              AND daily.issuance_kind = 'resend'
              AND daily.created_at > $2::timestamptz - interval '24 hours'
         ) < 5 AS allowed`,
        [rateSubject, input.now],
      );
      if (!userId || rate.rows[0]?.allowed !== true) return false;
      await s.query(
        `UPDATE mail_outbox o
            SET status = 'cancelled', failure_category = 'challenge_superseded', claimed_at = NULL
           FROM email_verification_challenges c
          WHERE o.challenge_id = c.id AND c.user_id = $1
            AND c.consumed_at IS NULL AND c.superseded_at IS NULL
            AND o.status IN ('pending', 'retryable', 'delivering')`,
        [userId],
      );
      await s.query(
        `UPDATE email_verification_challenges SET superseded_at = $2
          WHERE user_id = $1 AND consumed_at IS NULL AND superseded_at IS NULL`,
        [userId, input.now],
      );
      await s.query(
        `INSERT INTO email_verification_challenges
          (id, token_digest, user_id, expires_at, created_at, issuance_kind)
         VALUES ($1, $2, $3, $4, $5, 'resend')`,
        [input.challengeId, input.tokenDigest, userId, input.expiresAt, input.now],
      );
      await s.query(
        `INSERT INTO mail_outbox (id, challenge_id, template, recipient, created_at, next_attempt_at)
         VALUES ($1, $2, 'email-verification', lower($3), $4, $4)`,
        [input.outboxId, input.challengeId, input.email, input.now],
      );
      return true;
    });
  }

  async claimDue(now: Date): Promise<MailOutboxMessage | null> {
    return this.db.withoutTenant(async (s) => {
      await s.query(
        `UPDATE mail_outbox o
            SET status = 'cancelled', failure_category = CASE
              WHEN c.superseded_at IS NOT NULL THEN 'challenge_superseded'
              WHEN c.consumed_at IS NOT NULL THEN 'challenge_consumed'
              ELSE 'challenge_expired'
            END,
            claimed_at = NULL
           FROM email_verification_challenges c
          WHERE o.challenge_id = c.id
            AND o.status IN ('pending', 'retryable', 'delivering')
            AND (c.superseded_at IS NOT NULL OR c.consumed_at IS NOT NULL OR c.expires_at <= $1)`,
        [now],
      );
      const result = await s.query<{
        id: string; challenge_id: string; recipient: string; attempt_count: number;
      }>(
        `WITH due AS (
           SELECT o.id FROM mail_outbox o
             JOIN email_verification_challenges c ON c.id = o.challenge_id
            WHERE c.consumed_at IS NULL AND c.superseded_at IS NULL AND c.expires_at > $1
              AND ((o.status IN ('pending', 'retryable') AND o.next_attempt_at <= $1)
                OR (o.status = 'delivering' AND o.claimed_at < $1 - interval '5 minutes'))
            ORDER BY o.next_attempt_at, o.created_at
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
