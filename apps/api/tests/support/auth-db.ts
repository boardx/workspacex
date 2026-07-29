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
      // ⚠ REAL organizations only (F16, 2026-07-29).
      //
      // Registration now creates TWO organizations per account: the invited one and the
      // user's personal-local one, in the same transaction. Every F19 assertion here is about
      // "how many organizations did this invite code produce", and including the local one
      // would turn "exactly one" into "two" everywhere -- reported as a broken invariant when
      // the invariant is intact.
      //
      // The filter is on `kind`, not on a name pattern: `kind` is what the CHECK constraint
      // and the unique index key off, so this query and the database agree by construction.
      // `personalLocalOrgsOwnedBy` below is how a test asks about the other one.
      `SELECT m.org_id FROM org_memberships m
         JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = ANY($1::text[]) AND m.org_role = 'admin'
          AND o.kind <> 'personal-local'`,
      [userIds],
    );
    return r.rows.map((x) => x.org_id);
  });
}

/**
 * The personal-local organizations these users own (F16 / I-2).
 *
 * Separate from `orgsOwnedBy` rather than a flag on it, because the two answer different
 * questions and a boolean parameter would make every call site's meaning depend on an
 * argument nobody reads. Used for cleanup and by F19's rollback assertions, which now have to
 * say that the LOCAL organization rolled back too.
 */
export async function personalLocalOrgsOwnedBy(userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  return asOwner(async (c) => {
    const r = await c.query<{ id: string }>(
      `SELECT id FROM organizations WHERE owner_user_id = ANY($1::text[]) AND kind = 'personal-local'`,
      [userIds],
    );
    return r.rows.map((x) => x.id);
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

/* ─────────────────────────── F22 组织生命周期 ─────────────────────────── */

export interface OrgLifecycleRowRaw {
  id: string;
  status: string;
  disabled_at: Date | null;
  retention_until: Date | null;
}

/**
 * 直接读 `organizations` 的生命周期列。
 *
 * ⚠ 以 owner（superuser，绕过 RLS）读，因为断言的对象是**库里到底落了什么**——
 * 走应用路径读回来再断言，等于用被测代码证明被测代码。
 * 「留存截止日期 = 停用时刻 + 契约常量」这条单一事实源门控只有这样读才成立。
 */
export async function readOrgLifecycle(orgId: string): Promise<OrgLifecycleRowRaw | null> {
  return asOwner(async (c) => {
    const r = await c.query<OrgLifecycleRowRaw>(
      `SELECT id, status, disabled_at, retention_until FROM organizations WHERE id = $1`,
      [orgId],
    );
    return r.rows[0] ?? null;
  });
}

/** 这批邮箱下有几个账号。UC-1.5 V10 ① 逐字：「账号表记录数不变」。 */
export async function countCredentials(emailLike: string): Promise<number> {
  return asOwner(async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM credentials WHERE email LIKE $1`,
      [emailLike],
    );
    return Number(r.rows[0]?.n ?? "0");
  });
}

/** 某账号的全部组织成员关系。多组织归属唯一的落地形态。 */
export async function membershipsOf(
  userId: string,
): Promise<{ org_id: string; org_role: string }[]> {
  return asOwner(async (c) => {
    const r = await c.query<{ org_id: string; org_role: string }>(
      `SELECT org_id, org_role FROM org_memberships WHERE user_id = $1 ORDER BY org_id`,
      [userId],
    );
    return r.rows;
  });
}

/**
 * 迁移 0012 冻结了哪些表 —— **从 catalog 问库，不从迁移文件里读**。
 *
 * 门控要回答的是「库现在是什么样」，而不是「迁移文件里写了什么」。
 * 两者会分叉：`CREATE TABLE IF NOT EXISTS` 在表已存在时静默空操作，
 * 迁移文件里的约束一条都不生效（0010 末尾记录的正是这次事故）。
 */
export async function frozenTableAudit(): Promise<
  { table: string; ins: number; upd: number; del: number }[]
> {
  return asOwner(async (c) => {
    const r = await c.query<{ table: string; ins: string; upd: string; del: string }>(
      `WITH tenant AS (
         SELECT c.relname::text AS name
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND EXISTS (
              SELECT 1 FROM pg_constraint con
               JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
               WHERE con.conrelid = c.oid AND con.contype = 'f'
                 AND a.attname = 'org_id' AND array_length(con.conkey, 1) = 1
            )
       )
       SELECT t.name AS "table",
         (SELECT count(*)::text FROM pg_policies p
           WHERE p.schemaname='public' AND p.tablename=t.name AND p.permissive='RESTRICTIVE'
             AND p.cmd='INSERT' AND p.with_check LIKE '%kernel_org_is_writable%') AS ins,
         (SELECT count(*)::text FROM pg_policies p
           WHERE p.schemaname='public' AND p.tablename=t.name AND p.permissive='RESTRICTIVE'
             AND p.cmd='UPDATE' AND p.with_check LIKE '%kernel_org_is_writable%') AS upd,
         (SELECT count(*)::text FROM pg_policies p
           WHERE p.schemaname='public' AND p.tablename=t.name AND p.permissive='RESTRICTIVE'
             AND p.cmd='DELETE' AND p.qual LIKE '%kernel_org_is_writable%') AS del
         FROM tenant t ORDER BY 1`,
    );
    return r.rows.map((x) => ({
      table: x.table,
      ins: Number(x.ins),
      upd: Number(x.upd),
      del: Number(x.del),
    }));
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
  // BOTH kinds: the invited organization and the personal-local one that registration creates
  // alongside it. Cleaning only the first would leave a local organization per registered user
  // behind, and the unique index (I-2) would then fail the NEXT run for the same user id with
  // an error that says nothing about a stale fixture.
  const orgIds = [...(await orgsOwnedBy(userIds)), ...(await personalLocalOrgsOwnedBy(userIds))];
  if (orgIds.length > 0) await resetAuthFixtures({ orgIds });
}
