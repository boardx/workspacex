/**
 * PostgreSQL implementations of the three `auth` repositories.
 *
 * ## Why these use `withoutTenant`
 *
 * Every other repository in this codebase goes through `withTenant`, and doing so is
 * normally non-negotiable. These three are the exception, for a structural reason rather
 * than a convenient one: a credential, a login attempt and a reset token all exist BEFORE
 * any organization is known. Login has to find the credential in order to discover which
 * organizations the user belongs to -- there is no org id to scope by, and inventing one
 * would be circular.
 *
 * `withoutTenant`'s doc comment warns that business queries must not use it because RLS is
 * fail-closed and an unscoped read silently returns zero rows. That warning is about tables
 * that HAVE a tenant policy. These tables have none by design (migration 0010 declares the
 * `kernel-no-tenant-data:` exemption on each, so `kernel_tenant_table_audit()` reports them
 * as `exempt-declared-no-tenant-data` rather than as holes), so there is nothing to fail
 * closed on and no silent-empty-result hazard.
 *
 * ## Why `permission-filter` is not involved
 *
 * `lint-permission-paths` requires files naming a TENANT-CARRYING table to hand back
 * `Guarded<T>`. None of these three is tenant-carrying (the lint derives that list from the
 * migrations, so this is checked, not asserted by me). More to the point, a credential is
 * not tenant content to be disclosed to a requester -- it is the thing that establishes who
 * the requester is. Running it through the authorization filter would be circular in the
 * same way `pg-identity-repository` is, and that file is on the lint's allowlist for exactly
 * this reason.
 *
 * ## What must never appear here
 *
 * No query returns `password_hash` to anywhere but `PasswordHasher.verify`, and no code
 * path in this file logs a row. I-2 says the password must never appear in plaintext or in
 * a reversible encoding anywhere -- and the hash itself is not something to scatter around
 * either, since it is offline-attackable.
 */
import { createHash } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  CredentialRepository,
  CredentialRow,
  LoginAttemptRepository,
  ResetTokenRepository,
} from "../../application/auth/ports";
import type { LoginAttempt } from "../../domain/auth/lockout";

export class PgCredentialRepository implements CredentialRepository {
  constructor(private readonly db: DatabasePort) {}

  async findByEmail(email: string): Promise<CredentialRow | null> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{
        user_id: string; email: string; password_hash: string; email_verified_at: Date | null; display_name: string;
        avatar_url: string | null;
      }>(
        "SELECT user_id, email, password_hash, email_verified_at, display_name, avatar_url FROM credentials WHERE email = $1",
        [email],
      );
      return toRow(r.rows[0]);
    });
  }

  async findByUserId(userId: string): Promise<CredentialRow | null> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{
        user_id: string; email: string; password_hash: string; email_verified_at: Date | null; display_name: string;
        avatar_url: string | null;
      }>(
        "SELECT user_id, email, password_hash, email_verified_at, display_name, avatar_url FROM credentials WHERE user_id = $1",
        [userId],
      );
      return toRow(r.rows[0]);
    });
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db.withoutTenant((s) =>
      s.query("UPDATE credentials SET password_hash = $2, updated_at = now() WHERE user_id = $1", [
        userId,
        passwordHash,
      ]),
    );
  }

  /**
   * `updateOwnProfile`（#638 delta，迭代 1）——改名就是改这一列，`credentials` 表没有
   * 独立的 users 表（delta 背景实测）。`RETURNING` 整行，让调用方拿到与 `find*` 同形的
   * `CredentialRow`，不必再多查一次。
   */
  async updateDisplayName(userId: string, displayName: string): Promise<CredentialRow | null> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{
        user_id: string; email: string; password_hash: string; email_verified_at: Date | null; display_name: string;
        avatar_url: string | null;
      }>(
        `UPDATE credentials SET display_name = $2, updated_at = now()
          WHERE user_id = $1
        RETURNING user_id, email, password_hash, email_verified_at, display_name, avatar_url`,
        [userId, displayName],
      );
      return toRow(r.rows[0]);
    });
  }

  /**
   * `updateOwnProfile`（#638 delta，迭代 2）—— 落 `uploadOwnAvatar` 签发的 artifact。
   * `avatarArtifactId`/`avatarUrl` 均传 null 时清空头像回默认（外键置空，不删
   * `user_avatars` 那一行——对象存储里的字节仍然存在，只是不再被任何 credentials 指向，
   * 与 F04 的"不做级联硬删除"同一处置）。
   */
  async updateAvatar(
    userId: string,
    avatarArtifactId: string | null,
    avatarUrl: string | null,
  ): Promise<CredentialRow | null> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{
        user_id: string; email: string; password_hash: string; email_verified_at: Date | null; display_name: string;
        avatar_url: string | null;
      }>(
        `UPDATE credentials SET avatar_artifact_id = $2, avatar_url = $3, updated_at = now()
          WHERE user_id = $1
        RETURNING user_id, email, password_hash, email_verified_at, display_name, avatar_url`,
        [userId, avatarArtifactId, avatarUrl],
      );
      return toRow(r.rows[0]);
    });
  }
}

function toRow(
  row:
    | {
        user_id: string; email: string; password_hash: string; email_verified_at: Date | null;
        display_name: string; avatar_url: string | null;
      }
    | undefined,
): CredentialRow | null {
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    emailVerifiedAt: row.email_verified_at,
    avatarUrl: row.avatar_url,
  };
}

export class PgLoginAttemptRepository implements LoginAttemptRepository {
  constructor(private readonly db: DatabasePort) {}

  async recentFor(email: string, since: Date): Promise<readonly LoginAttempt[]> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{ at: Date; outcome: string }>(
        "SELECT at, outcome FROM login_attempts WHERE email = $1 AND at > $2 ORDER BY at DESC",
        [email, since],
      );
      return r.rows.map((row) => ({
        at: row.at.getTime(),
        outcome: row.outcome as LoginAttempt["outcome"],
      }));
    });
  }

  async record(email: string, outcome: LoginAttempt["outcome"], at: Date): Promise<void> {
    await this.db.withoutTenant((s) =>
      s.query("INSERT INTO login_attempts (email, at, outcome) VALUES ($1, $2, $3)", [email, at, outcome]),
    );
  }
}

/**
 * Reset tokens are stored HASHED.
 *
 * SHA-256 rather than bcrypt, and that is not an inconsistency with I-2: a password is
 * low-entropy and guessable, so it needs a deliberately slow hash. A reset token is 256
 * bits of CSPRNG output, so there is nothing to guess and a fast hash is sufficient -- and
 * a slow one here would add ~100ms to a path that runs on every reset link click for no
 * security gain.
 *
 * What the hashing buys: a database dump, a read replica or a backup contains no working
 * account-takeover links.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class PgResetTokenRepository implements ResetTokenRepository {
  constructor(private readonly db: DatabasePort) {}

  async issue(userId: string, token: string, expiresAt: Date): Promise<void> {
    await this.db.withoutTenant((s) =>
      s.query(
        "INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
        [hashToken(token), userId, expiresAt],
      ),
    );
  }

  /**
   * ONE conditional UPDATE, and the row is only consumed if `rowCount` says we won.
   *
   * The SELECT-then-UPDATE shape has a window in which two concurrent requests both observe
   * `used_at IS NULL`, and "single use" silently becomes "twice" -- the same failure shape
   * usecases.md warns about for invite-code redemption (I-4). Making the condition part of
   * the UPDATE means the database, not the application, decides who won.
   *
   * ⚠ Expiry is part of the same predicate. Checking it separately, before the UPDATE, is a
   * second read-then-act window.
   */
  async consume(token: string, now: Date): Promise<{ userId: string } | null> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{ user_id: string }>(
        `UPDATE password_reset_tokens
            SET used_at = $2
          WHERE token_hash = $1
            AND used_at IS NULL
            AND expires_at > $2
        RETURNING user_id`,
        [hashToken(token), now],
      );
      const row = r.rows[0];
      return row ? { userId: row.user_id } : null;
    });
  }

  async countIssuedSince(userId: string, since: Date): Promise<number> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM password_reset_tokens WHERE user_id = $1 AND issued_at > $2",
        [userId, since],
      );
      return Number(r.rows[0]?.n ?? "0");
    });
  }

  async latestIssuedAt(userId: string): Promise<Date | null> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{ issued_at: Date }>(
        "SELECT issued_at FROM password_reset_tokens WHERE user_id = $1 ORDER BY issued_at DESC LIMIT 1",
        [userId],
      );
      return r.rows[0]?.issued_at ?? null;
    });
  }
}
