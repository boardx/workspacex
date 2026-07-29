/**
 * `RegistrationRepository` on PostgreSQL -- where invariant I-4 actually lives.
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
import type {
  RedeemAndCreateOrgInput,
  RedeemAndCreateOrgResult,
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
  constructor(readonly reason: "invite-code-invalid" | "email-taken") {
    super(reason);
  }
}

/** PostgreSQL SQLSTATE 23505 = unique_violation. */
function uniqueViolationConstraint(e: unknown): string | null {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" ? (err.constraint ?? "") : null;
}

export class PgRegistrationRepository implements RegistrationRepository {
  constructor(private readonly db: DatabasePort) {}

  async redeemAndCreateOrg(input: RedeemAndCreateOrgInput): Promise<RedeemAndCreateOrgResult> {
    try {
      // The tenant context is the organization being CREATED. `organizations` and
      // `org_memberships` are FORCE RLS'd with `WITH CHECK (... = app.current_org)`, so the
      // inserts below are checked by the same policy that guards every other write -- the
      // registration path gets no privileged door.
      await this.db.withTenant(input.orgId, (s) => this.writeAll(s, input));
      return { ok: true, userId: input.userId, orgId: input.orgId };
    } catch (e) {
      if (e instanceof Rollback) return { ok: false, reason: e.reason };
      throw e;
    }
  }

  /**
   * The transaction body. Ordering is load-bearing; each step says why it is where it is.
   */
  private async writeAll(s: TenantSession, input: RedeemAndCreateOrgInput): Promise<void> {
    // (1) Credential first.
    //
    // Not for correctness -- a later failure rolls this back either way -- but because
    // `EMAIL_TAKEN` is the cheap, common, non-contended failure, and failing it here means
    // a doomed registration never touches the invite-code row. Under concurrent load,
    // taking the contended lock first and then discovering a duplicate email would make
    // every other redeemer of that code wait on a transaction that was never going to win.
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

    // (4) Redemption -- the conditional UPDATE. See the file header.
    //
    // It is LAST because `created_org_id` references `organizations`, so the row it points
    // at has to exist. That ordering also means both racers create their organization
    // provisionally and exactly one commits, which is the literal statement of I-4: the
    // loser leaves no half organization because it leaves no organization at all.
    //
    // ⚠ `expires_at > now()` and `revoked_at IS NULL` are in the same WHERE clause rather
    // than checked separately, so expiry and revocation are also decided atomically, and
    // all three failures produce the same zero-row outcome -- which is what makes V9 and
    // V11 ("expired/revoked/absent are indistinguishable") true by construction rather than
    // by the application remembering to collapse three branches into one message.
    //
    // ⚠ RETURNING + row count, not `rowCount`: `TenantSession` exposes rows only. Asserting
    // `rows.length === 1` is the same assertion; `RETURNING code` keeps the payload to a
    // value the caller already had.
    const redeemed = await s.query<{ code: string }>(
      `UPDATE invite_codes
          SET redeemed_by_user_id = $1, redeemed_at = now(), created_org_id = $2
        WHERE code = $3
          AND redeemed_by_user_id IS NULL
          AND revoked_at IS NULL
          AND expires_at > now()
        RETURNING code`,
      [input.userId, input.orgId, input.code],
    );
    if (redeemed.rows.length !== 1) throw new Rollback("invite-code-invalid");

    // (5) Queue the verification email, in the same transaction.
    //
    // This is what lets the contract's `emailVerificationSent: z.literal(true)` be honest:
    // if this write fails, everything above rolls back and no account exists (UC-1.5 V6:
    // "不产生可用账号"). An SMTP call here could not do that -- its failure would arrive
    // after the commit, leaving an organization behind and a caller told nothing was sent.
    //
    // ⚠ "Sent" therefore means "durably enqueued". The relay that drains
    // `email_verification_tokens WHERE delivered_at IS NULL` does not exist in phase-00;
    // that is reported, not implied.
    await s.query(
      `INSERT INTO email_verification_tokens (token, user_id, email, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.verificationToken, input.userId, input.email, input.verificationExpiresAt],
    );
  }

  /**
   * Consume a verification token and mark the address verified -- one statement, so the two
   * cannot come apart.
   *
   * A CTE rather than two queries: `UPDATE ... WHERE consumed_at IS NULL` is the same
   * conditional-write pattern as the redemption, for the same reason (two clicks on the
   * same link must not both count), and chaining the credential update off its RETURNING
   * means a crash cannot leave a spent token with an unverified account.
   *
   * ⚠ Runs `withoutTenant`: neither table carries `org_id`, and there is no organization in
   * scope at verification time -- the user clicks a link from their mail client with no
   * session. `withoutTenant`'s doc warns it reads zero rows for tenant tables (fail-closed);
   * that warning is exactly why the credential tables are not tenant tables.
   */
  async confirmEmailVerification(token: string, now: Date): Promise<{ userId: string } | null> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<{ user_id: string }>(
        `WITH consumed AS (
           UPDATE email_verification_tokens
              SET consumed_at = $2
            WHERE token = $1
              AND consumed_at IS NULL
              AND expires_at > $2
            RETURNING user_id
         )
         UPDATE credentials c
            SET email_verified_at = COALESCE(c.email_verified_at, $2)
           FROM consumed
          WHERE c.user_id = consumed.user_id
          RETURNING c.user_id`,
        [token, now],
      );
      // Zero rows covers absent, expired and already-consumed alike -- one outcome for
      // three causes, deliberately (domain/auth/email-verification.ts).
      return r.rows.length === 1 ? { userId: r.rows[0]!.user_id } : null;
    });
  }
}
