/**
 * `RegistrationRepository` on PostgreSQL -- where invariant I-4 actually lives.
 *
 * ⚠ open-self-serve-registration delta (issue #1929): `createAccountAndOrg` (the open,
 * invite-free path this delta added) no longer touches `invite_codes` at all -- there is no
 * code to redeem. The conditional-UPDATE statement below is now exclusively
 * `joinExistingUserToNewOrg`'s (F22: an existing account spending a code for a SECOND org),
 * which is untouched by this delta. The header below describes that surviving path.
 *
 * ## The whole feature is the shape of ONE statement
 *
 * ```sql
 * UPDATE invite_codes SET redeemed_by_user_id = $1, ... WHERE code = $2 AND redeemed_by_user_id IS NULL
 * ```
 *
 * ...and the assertion that it affected exactly one row. `usecases.md` prescribes this
 * literally, and prescribes what NOT to do just as literally: **do not SELECT then UPDATE**.
 *
 * Why it matters more than it looks. Under READ COMMITTED, two transactions running the
 * conditional UPDATE against the same code serialise on the row lock: the second one waits,
 * then re-evaluates its WHERE clause against the committed row (EvalPlanQual), sees
 * `redeemed_by_user_id` is no longer NULL, and matches zero rows. Exactly one winner, from
 * the database, with no application coordination at all.
 *
 * SELECT-then-UPDATE has a window between the two statements where both transactions have
 * seen "unredeemed". Both then update, both commit, and **two organizations exist**. There
 * is no exception, no constraint violation and no log line: both users log in normally,
 * both see an organization, and the invite code shows one redeemer. The only way to find it
 * is to count organizations -- which is why the acceptance is a count, and why it has to be
 * made with genuinely concurrent transactions rather than two sequential calls.
 *
 * ## Why everything is in one method
 *
 * See `application/auth/ports.ts`. I-4 says the four writes are indivisible; a method
 * boundary between any two of them is a place a future refactor can put a commit.
 *
 * ## Tenant tables: written, never read
 *
 * This file INSERTs into `organizations` and `org_memberships`, so `lint-permission-paths`
 * sees it -- correctly, its rule is keyword-anchored on INTO/UPDATE/FROM/JOIN and does not
 * distinguish reads from writes. It is on that script's allowlist with the argument that a
 * `Guarded<T>` protects DISCLOSURE and this path discloses nothing: at the moment it runs,
 * the organization does not exist yet and there is no requester to judge against.
 *
 * ⚠ That argument is only true while the file stays write-only, and "it is write-only" is
 * the kind of premise that quietly stops holding. So it is not left as a claim:
 * `tests/auth/registration-repo-is-write-only.test.ts` parses this file and fails if any
 * statement touching a tenant table is not an INSERT. The exemption carries its own gate.
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import {
  insertPersonalLocalOrg,
  newLocalOrgId,
} from "../identity/pg-identity-repository";
import type {
  BootstrapFirstUserInput,
  BootstrapFirstUserResult,
  CreateAccountAndOrgInput,
  CreateAccountAndOrgResult,
  JoinNewOrgInput,
  JoinNewOrgResult,
  RegistrationRepository,
} from "../../application/auth/ports";

/**
 * Thrown inside the transaction to force a rollback, caught outside and turned into a
 * contracted result.
 *
 * ⚠ Why an exception rather than an early `return`: `withTenant` COMMITS whatever the
 * callback returns. Returning `{ ok: false }` from inside would commit the organization
 * and the credential that were already inserted -- i.e. it would produce precisely the
 * half organization I-4 forbids, while the caller was told the registration failed. The
 * only way out of a transaction that must not commit is to throw.
 */
class Rollback extends Error {
  constructor(readonly reason: "invite-code-invalid" | "email-taken" | "bootstrap-unavailable") {
    super(reason);
  }
}

/**
 * The redemption statement.
 *
 * ⚠ Before the open-self-serve-registration delta this was shared by TWO entry points
 * (F19's invite registration and F22's join-second-org); now only `joinExistingUserToNewOrg`
 * uses it. Still extracted into its own constant so there is exactly ONE conditional UPDATE
 * in this file. I-4 is a property of this statement's shape -- `WHERE ...
 * AND redeemed_by_user_id IS NULL`, assert one row -- and
 * `one-code-one-org-concurrency.test.ts` layer 2 exists precisely because the forbidden
 * SELECT-then-UPDATE shape lets BOTH racers through with no error anywhere. A second copy
 * of this statement is a second chance to write that shape, in a path whose concurrency
 * nobody re-tested.
 */
const REDEEM_SQL = `UPDATE invite_codes
      SET redeemed_by_user_id = $1, redeemed_at = now(), created_org_id = $2
    WHERE code = $3
      AND redeemed_by_user_id IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
    RETURNING code`;

/** PostgreSQL SQLSTATE 23505 = unique_violation. */
function uniqueViolationConstraint(e: unknown): string | null {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" ? (err.constraint ?? "") : null;
}

export class PgRegistrationRepository implements RegistrationRepository {
  constructor(private readonly db: DatabasePort) {}

  async isFirstUserBootstrapAvailable(): Promise<boolean> {
    return this.db.withoutTenant(async (s) => {
      const state = await s.query<{ available: boolean }>(
        `SELECT NOT EXISTS (SELECT 1 FROM auth_bootstrap_state WHERE singleton = true)
             AND NOT EXISTS (SELECT 1 FROM credentials) AS available`,
      );
      return state.rows[0]?.available === true;
    });
  }

  async bootstrapFirstUser(input: BootstrapFirstUserInput): Promise<BootstrapFirstUserResult> {
    try {
      await this.db.withTenant(input.orgId, (s) => this.writeBootstrap(s, input));
      return { ok: true, userId: input.userId, orgId: input.orgId };
    } catch (e) {
      if (e instanceof Rollback) {
        if (e.reason === "invite-code-invalid") throw e;
        return { ok: false, reason: e.reason };
      }
      throw e;
    }
  }

  private async writeBootstrap(s: TenantSession, input: BootstrapFirstUserInput): Promise<void> {
    // A transaction-scoped PostgreSQL lock, not an in-process mutex: every API replica
    // competes for the same gate, and the lock is released automatically on rollback.
    await s.query("SELECT pg_advisory_xact_lock(hashtextextended('workspacex.auth.bootstrap-first-user', 0))");
    const existing = await s.query<{ consumed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM auth_bootstrap_state WHERE singleton = true)
           OR EXISTS (SELECT 1 FROM credentials) AS consumed`,
    );
    if (existing.rows[0]?.consumed !== false) throw new Rollback("bootstrap-unavailable");

    // The durable marker is independent of credentials on purpose: account cleanup must
    // never reopen the seed-admin path. It rolls back with every other bootstrap write.
    await s.query(
      "INSERT INTO auth_bootstrap_state (singleton, consumed_at) VALUES (true, $1)",
      [input.emailVerifiedAt],
    );

    try {
      await s.query(
        `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.userId, input.email, input.displayName, input.passwordHash, input.emailVerifiedAt],
      );
    } catch (e) {
      if (uniqueViolationConstraint(e) === "credentials_email_uniq") throw new Rollback("email-taken");
      throw e;
    }

    await s.query(`INSERT INTO organizations (id, name, kind) VALUES ($1, $2, 'organization')`, [
      input.orgId,
      input.orgName,
    ]);
    await s.query(
      `INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, 'admin', NULL)`,
      [input.userId, input.orgId],
    );

    const localOrgId = newLocalOrgId();
    await s.query("SELECT set_config('app.current_org', $1, true)", [localOrgId]);
    await insertPersonalLocalOrg(s, {
      orgId: localOrgId,
      userId: input.userId,
      displayName: input.displayName,
    });
    await s.query("SELECT set_config('app.current_org', $1, true)", [input.orgId]);
  }

  /**
   * open-self-serve-registration delta (issue #1929): the same transaction as the removed
   * `redeemAndCreateOrg`, minus the invite-code redemption step. See `writeCreateAccountAndOrg`
   * for what changed and why the ordering argument still holds without a code to redeem.
   */
  async createAccountAndOrg(input: CreateAccountAndOrgInput): Promise<CreateAccountAndOrgResult> {
    try {
      // The tenant context is the organization being CREATED. `organizations` and
      // `org_memberships` are FORCE RLS'd with `WITH CHECK (... = app.current_org)`, so the
      // inserts below are checked by the same policy that guards every other write -- the
      // registration path gets no privileged door.
      await this.db.withTenant(input.orgId, (s) => this.writeCreateAccountAndOrg(s, input));
      return { ok: true, userId: input.userId, orgId: input.orgId };
    } catch (e) {
      if (e instanceof Rollback) {
        if (e.reason === "email-taken") return { ok: false, reason: e.reason };
        throw e;
      }
      throw e;
    }
  }

  /**
   * The transaction body. Ordering is load-bearing; each step says why it is where it is.
   *
   * ⚠ open-self-serve-registration delta: the former step (4), the conditional UPDATE that
   * redeemed an invite code, is GONE -- there is no code to redeem. I-4 ("credential +
   * organization + owner membership are one transaction") still holds for what remains; it
   * just no longer has a contended row to serialize four concurrent racers on. The only
   * remaining contention is the `credentials_email_uniq` unique index, handled by step (1)
   * below exactly as before.
   */
  private async writeCreateAccountAndOrg(s: TenantSession, input: CreateAccountAndOrgInput): Promise<void> {
    // (1) Credential first.
    //
    // Not for correctness -- a later failure rolls this back either way -- but because
    // `EMAIL_TAKEN` is the cheap, common failure, and failing it here means a doomed
    // registration never touches `organizations` or `org_memberships` at all.
    try {
      await s.query(
        `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
         VALUES ($1, $2, $3, $4, NULL)`,
        [input.userId, input.email, input.displayName, input.passwordHash],
      );
    } catch (e) {
      // Only the email index means "taken". Any other unique violation is a genuine bug
      // (e.g. a user-id collision) and must surface as a 500 rather than be reported to
      // the caller as a duplicate address they do not have.
      if (uniqueViolationConstraint(e) === "credentials_email_uniq") throw new Rollback("email-taken");
      throw e;
    }

    // ⚠ `email_verified_at` is written explicitly as NULL rather than left to the column
    // default. The default IS null, so this is redundant -- and that is the point: I-8
    // ("未验证邮箱的账号不能登录") depends on new accounts starting unverified, and a
    // requirement that holds only because nobody set the column is a requirement one
    // careless `INSERT ... DEFAULT` away from silently inverting.

    // (2) The organization. Under `app.current_org = input.orgId`, so the RLS WITH CHECK
    // passes only because the row's own id matches the tenant context.
    await s.query(`INSERT INTO organizations (id, name, kind) VALUES ($1, $2, 'organization')`, [
      input.orgId,
      input.orgName,
    ]);

    // (3) The creator becomes the FIRST ADMIN (UC-1.5 R3 step 5).
    //
    // `team_id` is NULL: a brand new organization has no teams, and O-12's "one person, one
    // team per org" is about membership in an existing team, not about inventing one.
    await s.query(
      `INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, 'admin', NULL)`,
      [input.userId, input.orgId],
    );

    // (3b) The PERSONAL-LOCAL organization -- "注册即有" (F16 / invariant I-2).
    //
    // ⚠ In THIS transaction, not after it. A follow-up call would leave a window in which an
    // account exists without a local organization, and nothing downstream checks for that
    // state: every later path assumes the organization is there, so the users whose
    // registration was interrupted would simply have a broken account with no error anywhere.
    //
    // The two INSERTs live in `pg-identity-repository.ts` rather than being spelled out here,
    // so the `kind = 'personal-local'` / `owner_user_id` / membership triple has exactly one
    // definition. That also keeps this file write-only against tenant tables, which is the
    // premise its lint-permission-paths exemption rests on (and which
    // `registration-repo-is-write-only.test.ts` enforces).
    //
    // The tenant setting is re-pointed for the duration and then restored: `set_config(...,
    // true)` is transaction-local, and the statements that follow are the invited
    // organization's, not the local one's.
    const localOrgId = newLocalOrgId();
    await s.query("SELECT set_config('app.current_org', $1, true)", [localOrgId]);
    await insertPersonalLocalOrg(s, {
      orgId: localOrgId,
      userId: input.userId,
      displayName: input.displayName,
    });
    await s.query("SELECT set_config('app.current_org', $1, true)", [input.orgId]);

    // (4) Queue the verification email, in the same transaction.
    //
    // This is what lets the contract's `verificationDelivery: "queued"` be honest:
    // if this write fails, everything above rolls back and no account exists (UC-1.5 V6:
    // "不产生可用账号"). An SMTP call here could not do that -- its failure would arrive
    // after the commit, leaving an organization behind and a caller told nothing was sent.
    //
    // The bearer itself is never written: the digest and a non-secret challenge id are.
    await s.query(
      `INSERT INTO email_verification_challenges (id, token_digest, user_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.verificationChallengeId, input.verificationTokenDigest, input.userId, input.verificationExpiresAt],
    );
    await s.query(
      `INSERT INTO mail_outbox (id, challenge_id, template, recipient)
       VALUES ($1, $2, 'email-verification', $3)`,
      [input.verificationOutboxId, input.verificationChallengeId, input.email],
    );
  }

  /**
   * F22 / O-12: an existing account spends a new code and becomes admin of a SECOND org.
   *
   * ## What is NOT here, and why that is the assertion
   *
   * No `INSERT INTO credentials`. O-12: "此时**不新建账号**" -- the failure mode is a second
   * account on the same address, which then makes "同一人登录进的是同一账号" (UC-1.1) false
   * without anything erroring: both accounts work, and the user's organizations are split
   * across two logins depending on which password they happen to remember.
   * `multi-org-membership.test.ts` asserts the credential count is unchanged, which is
   * UC-1.5 V10 ① word for word.
   *
   * ## Still one transaction, and still the conditional UPDATE
   *
   * I-4 does not get weaker because the account already exists: two people spending the same
   * code must still produce exactly one organization. Same statement (`REDEEM_SQL`), same
   * ordering rule -- redemption LAST, because `created_org_id` references the organization.
   *
   * ⚠ Write-only against tenant tables, like the rest of this file, so the
   * `lint-permission-paths` allowlist entry and `registration-repo-is-write-only.test.ts`
   * both still hold. The caller's identity is established by the Guard before this runs;
   * nothing here reads tenant content to decide anything.
   */
  async joinExistingUserToNewOrg(input: JoinNewOrgInput): Promise<JoinNewOrgResult> {
    try {
      await this.db.withTenant(input.orgId, async (s) => {
        await s.query(
          `INSERT INTO organizations (id, name, kind) VALUES ($1, $2, 'organization')`,
          [input.orgId, input.orgName],
        );
        // Admin of the organization they created (UC-1.5 R3 step 5, same as registration).
        // `team_id` NULL: a brand new organization has no teams.
        await s.query(
          `INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, 'admin', NULL)`,
          [input.userId, input.orgId],
        );
        const redeemed = await s.query<{ code: string }>(REDEEM_SQL, [
          input.userId,
          input.orgId,
          input.code,
        ]);
        if (redeemed.rows.length !== 1) throw new Rollback("invite-code-invalid");
      });
      return { ok: true, orgId: input.orgId };
    } catch (e) {
      // `email-taken` is unreachable on this path (no credential is written), but the union
      // is narrowed rather than cast: a Rollback carrying it would mean this method grew a
      // credential insert, and silently reporting that as an invalid code would hide it.
      if (e instanceof Rollback && e.reason === "invite-code-invalid") {
        return { ok: false, reason: "invite-code-invalid" };
      }
      throw e;
    }
  }

}
