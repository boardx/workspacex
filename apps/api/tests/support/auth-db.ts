/**
 * Fixtures for the `auth` bundle (F19, and whatever F20/F21/F22 need next).
 *
 * A separate file from `support/db.ts` on purpose: four auth features are being built in
 * parallel, and `db.ts` is imported by every kernel test. Adding to it is a three-way merge
 * waiting to happen, and a merge that goes wrong inside a fixture file surfaces as other
 * people's tests failing for reasons that have nothing to do with their change.
 *
 * ⚠ Everything here runs as the OWNER. That is not laziness -- `app_rw` deliberately holds
 * no INSERT on `invite_codes` (migration 0010: issuance is offline per O-29), so a fixture
 * that seeded codes through the app role could not exist. That the app role cannot mint a
 * code is itself asserted, in `invite-code-redeem-atomic.test.ts`.
 */
import { INVITE_CODE_VALIDITY_MS } from "../../src/domain/auth/registration";
import { asOwner } from "./db";

/** 14 characters, because that is what the schema and the contract both require. */
export function makeCode(seed: string): string {
  const body = seed.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return (body + "0000000000000").slice(0, 14);
}

export interface IssueOptions {
  readonly batchId?: string;
  /** Defaults to now + 90 days (O-29). Pass a past date to fixture an expired code. */
  readonly expiresAt?: Date;
  readonly revokedAt?: Date | null;
}

export async function issueInviteCode(code: string, opts: IssueOptions = {}): Promise<string> {
  const expiresAt = opts.expiresAt ?? new Date(Date.now() + INVITE_CODE_VALIDITY_MS);
  await asOwner((c) =>
    c.query(
      `INSERT INTO invite_codes (code, batch_id, expires_at, revoked_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE
         SET batch_id = EXCLUDED.batch_id,
             expires_at = EXCLUDED.expires_at,
             revoked_at = EXCLUDED.revoked_at,
             redeemed_by_user_id = NULL,
             redeemed_at = NULL,
             created_org_id = NULL`,
      [code, opts.batchId ?? "test-batch", expiresAt, opts.revokedAt ?? null],
    ),
  );
  return code;
}

export interface InviteCodeRow {
  code: string;
  redeemed_by_user_id: string | null;
  redeemed_at: Date | null;
  created_org_id: string | null;
  revoked_at: Date | null;
  expires_at: Date;
}

export async function readInviteCode(code: string): Promise<InviteCodeRow | null> {
  return asOwner(async (c) => {
    const r = await c.query<InviteCodeRow>(`SELECT * FROM invite_codes WHERE code = $1`, [code]);
    return r.rows[0] ?? null;
  });
}

export interface CredentialRow {
  user_id: string;
  email: string;
  display_name: string;
  password_hash: string;
  email_verified_at: Date | null;
}

export async function readCredentialByEmail(email: string): Promise<CredentialRow | null> {
  return asOwner(async (c) => {
    const r = await c.query<CredentialRow>(
      `SELECT * FROM credentials WHERE email = lower($1)`,
      [email],
    );
    return r.rows[0] ?? null;
  });
}

export interface VerificationRow {
  token: string;
  user_id: string;
  email: string;
  expires_at: Date;
  consumed_at: Date | null;
  delivered_at: Date | null;
}

export async function readVerificationTokens(userId: string): Promise<VerificationRow[]> {
  return asOwner(async (c) => {
    const r = await c.query<VerificationRow>(
      `SELECT * FROM email_verification_tokens WHERE user_id = $1 ORDER BY enqueued_at`,
      [userId],
    );
    return r.rows;
  });
}

/** Every organization whose row exists, for a set of ids. The count is what V3 asserts. */
export async function countOrganizations(ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return asOwner(async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM organizations WHERE id = ANY($1::text[])`,
      [ids],
    );
    return Number(r.rows[0]?.n ?? "0");
  });
}

/**
 * Organizations created by a given invite code, found through the code's own back pointer
 * AND through the memberships -- two independent routes to the same answer.
 *
 * ⚠ Asking `invite_codes.created_org_id` alone would be circular for V3: the whole failure
 * mode is that TWO organizations got created while the code records ONE redeemer. Counting
 * memberships for the candidate users is what actually catches it.
 */
export async function orgsOwnedBy(userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  return asOwner(async (c) => {
    const r = await c.query<{ org_id: string }>(
      `SELECT org_id FROM org_memberships WHERE user_id = ANY($1::text[]) AND org_role = 'admin'`,
      [userIds],
    );
    return r.rows.map((x) => x.org_id);
  });
}

/**
 * Scoped cleanup -- never a global TRUNCATE, for the reason `support/db.ts` gives at length:
 * vitest runs files in parallel against one database and a global wipe deletes another
 * file's fixtures mid-test.
 */
export async function resetAuthFixtures(opts: {
  codes?: readonly string[];
  emailLike?: string;
  orgIds?: readonly string[];
}): Promise<void> {
  await asOwner(async (c) => {
    if (opts.codes?.length) {
      await c.query(`DELETE FROM invite_codes WHERE code = ANY($1::text[])`, [opts.codes]);
    }
    if (opts.emailLike) {
      // ON DELETE CASCADE from credentials carries the verification tokens.
      await c.query(`DELETE FROM credentials WHERE email LIKE $1`, [opts.emailLike]);
    }
    if (opts.orgIds?.length) {
      await c.query(`DELETE FROM organizations WHERE id = ANY($1::text[])`, [opts.orgIds]);
    }
  });
}

/**
 * Delete organizations created during a test whose ids were generated at random.
 *
 * `newOrgId()` produces `org-<16 hex>`, so a test cannot enumerate them up front. It CAN
 * enumerate the users it registered, and every registration makes its user an admin of
 * exactly one organization -- so the memberships are the index.
 */
export async function resetOrgsOwnedBy(userIds: readonly string[]): Promise<void> {
  const orgIds = await orgsOwnedBy(userIds);
  if (orgIds.length > 0) await resetAuthFixtures({ orgIds });
}
