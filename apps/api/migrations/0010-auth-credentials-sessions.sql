-- 0010 F20/F21 auth: credentials, login attempts, password reset tokens
--
-- Contract: phases/phase-00-shared-kernel/contracts/auth/{domain,usecases}.md
--
-- ## Why none of these tables has `org_id`
--
-- `auth` answers "who are you"; `identity` answers "what may you do" (domain §0). A
-- credential exists BEFORE any organization context does -- login has to find the row in
-- order to discover which organizations the user belongs to, so scoping the lookup by
-- organization is circular. O-12 also says one account may belong to several
-- organizations, so there is no single org_id to put here even in principle.
--
-- That means these tables cannot be RLS-filtered, which `kernel_tenant_table_audit()`
-- (migration 0004) correctly reports as `UNTENANTED_BUT_GRANTED` unless the table carries
-- a WRITTEN exemption. Each one below declares it, and says what the claim actually is.
-- The claim is narrow on purpose: "no tenant dimension", NOT "harmless".
--
-- ## Replayable
--
-- Every statement is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE, because `migrate:check`
-- replays each file ignoring the version table.

/* ─────────────────────────── credentials ─────────────────────────── */

-- There is no `users` table in this schema: `org_memberships.user_id` is free text, and
-- the account itself had no home until now. This IS that home, so `user_id` has no FK to
-- point at -- stated rather than left looking like an omission.
CREATE TABLE IF NOT EXISTS credentials (
  user_id           text PRIMARY KEY,
  -- Stored ALREADY lowercase-normalised (domain §1: "唯一，小写规范化后比较").
  -- The unique index below is on the column itself rather than on lower(email) because
  -- storing a non-normalised value and comparing case-insensitively lets two rows differ
  -- only by case -- at which point "which one owns the password" has no answer.
  -- ⚠ 两处 CHECK 都要，且不冗余（合并 F19/F20 两份定义时取的是并集，2026-07-29）：
  --   · 唯一索引挡住重复；
  --   · 这条 CHECK 挡住「存进去时没规范化」。少了它，值可以是混合大小写，
  --     而将来某个作者写的 `WHERE email = $1` 会查不到一个真实存在的账号，
  --     并报「无此用户」——一个没有人会怀疑到大小写上的 bug。
  email             text NOT NULL CHECK (email = lower(email)),
  -- 显示名与凭据 1:1。本模型没有独立的 users 表，另起一张只为放它，
  -- 就是在为一个不存在的概念建表。
  display_name      text NOT NULL,
  -- ⚠ Algorithm and parameters are part of the contract (domain I-2): argon2id, or bcrypt
  -- with cost >= 12. A bcrypt hash self-describes its cost in the `$2a$NN$` prefix, so the
  -- CHECK below is a real constraint and not a comment: a row written by a future
  -- implementation that quietly lowered the cost cannot be inserted.
  --
  -- The alternative -- asserting the cost only in a unit test of the hasher -- leaves the
  -- TABLE willing to accept anything, and a migration/backfill/manual fix does not run the
  -- hasher.
  password_hash     text NOT NULL
    CONSTRAINT credentials_hash_is_slow CHECK (
      -- bcrypt with a two-digit cost of at least 12 ...
      (password_hash ~ '^\$2[aby]\$(1[2-9]|[2-9][0-9])\$' )
      -- ... or argon2id, if a future implementation swaps the hasher.
      OR (password_hash ~ '^\$argon2id\$')
    ),
  -- null = unverified. An unverified account MUST NOT be able to log in (I-8 / UC-1.5 R7).
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS credentials_email_uniq ON credentials (email);

COMMENT ON TABLE credentials IS
  'kernel-no-tenant-data: an account exists before and across organizations (O-12: one '
  'account, many orgs), and login must find the row in order to DISCOVER which orgs it '
  'belongs to -- scoping this lookup by org_id would be circular. What is tenant-scoped is '
  'org_memberships, which is RLS-enforced. No column here belongs to one tenant. '
  'NOTE this is not a claim that the table is harmless: it holds email + password hash, '
  'and every read path is confined to infrastructure/auth/pg-credential-repository.ts.';

/* ─────────────────────────── login_attempts ─────────────────────────── */

-- The evidence lockout is computed from (domain: `LoginAttempt`).
--
-- ⚠ Counted by EMAIL, not by IP. Per-IP counting locks out an entire shared office behind
-- one NAT while an attacker rotates source addresses for free -- it inverts who gets hurt.
--
-- ⚠ This is a DELIBERATE DEVIATION from uc-1-1 R4 E1, which says to count on BOTH account
-- and source IP. domain.md's `LoginAttempt` (signed 2026-07-30) says email and explicitly
-- argues against IP. Two signed documents disagree; the contract bundle is the later and
-- more specific one, so it wins here, and the conflict is reported rather than silently
-- resolved. Adding the IP dimension later is one nullable column plus one more query.
CREATE TABLE IF NOT EXISTS login_attempts (
  id      bigserial PRIMARY KEY,
  -- lowercase-normalised, same as credentials.email. Deliberately NOT a foreign key:
  -- failures against an email that does not exist must be recorded too, otherwise the
  -- row's absence is itself a signal that the account does not exist.
  email   text NOT NULL,
  at      timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL CHECK (outcome IN ('ok', 'bad-credential'))
);

-- The lockout query is "attempts for this email since T", so the index has to be ordered.
CREATE INDEX IF NOT EXISTS login_attempts_email_at_idx ON login_attempts (email, at DESC);

COMMENT ON TABLE login_attempts IS
  'kernel-no-tenant-data: failed and successful login attempts keyed by email. An attempt '
  'happens before any organization is known -- indeed before it is known whether the '
  'account exists at all -- so it has no tenant dimension to filter on.';

/* ───────────────────── password_reset_tokens ───────────────────── */

-- ⚠ The column is `token_hash`, not `token`.
--
-- A reset token is a bearer credential: whoever holds it can take over the account. Storing
-- it in the clear means a database dump, a read-replica, a log of a slow query, or a backup
-- on someone's laptop is a pile of working account-takeover links. Hashing costs nothing
-- here (the token is high-entropy, so a fast hash is enough -- unlike a password, it is not
-- guessable) and removes the whole class.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES credentials (user_id) ON DELETE CASCADE,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  -- issued_at + AUTH_POLICY.resetLinkHours (O-28 ④: 1 hour, single use).
  expires_at timestamptz NOT NULL,
  -- non-null = already used. Single-use is enforced by a CONDITIONAL UPDATE in the
  -- repository (`WHERE used_at IS NULL` + rowCount === 1), not by a read-then-write:
  -- the read-then-write has a window in which two concurrent requests both see NULL.
  used_at    timestamptz
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id);

COMMENT ON TABLE password_reset_tokens IS
  'kernel-no-tenant-data: one-time password reset tokens, keyed by user. Password reset '
  'happens with no session and therefore no organization context; the row has no tenant '
  'dimension. Tokens are stored HASHED, so this table cannot be replayed into account '
  'takeover even by someone holding a dump.';

/* ──────────────── kernel_user_org_ids: the "which orgs am I in" read ──────────────── */

-- ⚠ THIS FIXES A LATENT DEFECT IN `PgIdentityRepository.listMemberships` (F01).
--
-- That method reads `org_memberships` through `withoutTenant`, and its comment says "RLS
-- therefore does not help here". RLS does not merely fail to help -- it BLOCKS the query
-- outright. The policy is `USING (org_id = current_setting('app.current_org', true))`, and
-- with the setting unset that comparison is NULL, so the fail-closed policy matches nothing.
-- Under the runtime role the method returns `[]` unconditionally.
--
-- It was never caught because it had no caller and no test: F20's login is the first thing
-- that ever needed "which organizations does this account belong to". Measured before
-- writing this function:
--     app_rw, no tenant context -> 0 rows
--     owner,  no tenant context -> 1 row
--
-- ## Why a SECURITY DEFINER function rather than loosening the policy
--
-- The question "which organizations does user X belong to" is inherently cross-tenant --
-- O-12 says one account may belong to several -- so there is no org_id to scope it by. The
-- alternatives were:
--
--   (a) add a self-read policy to `org_memberships`. It would have to key off a session
--       setting for "current user", which does not exist, and adding one puts a SECOND
--       identity variable next to `app.current_org` -- two things that must agree, which is
--       how cross-tenant reads get introduced.
--   (b) run the query as the owner. That reintroduces exactly the owner/runtime collapse
--       F18 calls the number one cause of "we thought RLS was on but it wasn't".
--   (c) this: one function, one purpose, one user_id parameter, returning ONLY org ids and
--       roles -- no names, no counts, nothing about the organizations themselves.
--
-- (c) keeps the blast radius written down and reviewable, in the same style as
-- `kernel_tenant_table_audit()`. The caller cannot widen it: there is no way to ask this
-- function for anyone else's memberships in bulk, or for anything but ids and roles.
--
-- ⚠ It takes `p_user_id` from the application, so it is only as safe as the caller's claim
-- about who the caller is. In F20 that claim comes from a verified password or a validated
-- session token, which is the strongest form available. Recorded so the next caller knows
-- what it is trusting.

DROP FUNCTION IF EXISTS kernel_user_org_ids(text);

CREATE FUNCTION kernel_user_org_ids(p_user_id text)
RETURNS TABLE (org_id text, org_role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Pinned search_path: a SECURITY DEFINER function that resolves names through the caller's
-- search_path can be pointed at an attacker-created `public.org_memberships` in a schema
-- they control. This is the standard hardening and it is not optional for DEFINER functions.
SET search_path = public, pg_temp
AS $$
  SELECT m.org_id, m.org_role
    FROM org_memberships m
   WHERE m.user_id = p_user_id;
$$;

COMMENT ON FUNCTION kernel_user_org_ids(text) IS
  'F20: the cross-organization "which orgs is this account in" read. Returns ids and roles '
  'only, for exactly one user. SECURITY DEFINER because the question has no tenant to scope '
  'by (O-12: one account, many orgs) and org_memberships is fail-closed under RLS. Callers '
  'must have already authenticated the user_id they pass.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠ 「表已存在」的补齐 —— 这不是防御性编程，是一次真实事故的修法。
--
-- F19 与 F20 并行开发，各建了一份 `credentials`。合并时保留了 F20 这份（约束更强），
-- 并把 F19 的迁移改名为 0011。但**已经跑过旧迁移的库里 `credentials` 已经存在**，
-- 于是上面的 `CREATE TABLE IF NOT EXISTS` **静默变成空操作**——表在、列在、
-- 而 `credentials_hash_is_slow` 这条 CHECK 从来没被创建。
--
-- 症状不是报错，是 `password-hash-invariant.test.ts` 里「数据库拒绝弱哈希」那几条
-- **在新库上绿、在老库上红**，或者更糟：在老库上根本没人跑那几条，
-- 于是生产库长期允许写入 cost < 12 的哈希，而 I-2 声称它不允许。
--
-- ⇒ 无条件补齐。CHECK 是幂等可判定的：约束在就跳过，不在就加。
-- 加不上（说明库里已有违规行）时**故意让迁移失败**——把一张声称满足 I-2
-- 而实际不满足的表放行，比迁移失败危险得多。
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'credentials'::regclass AND conname = 'credentials_hash_is_slow'
  ) THEN
    ALTER TABLE credentials ADD CONSTRAINT credentials_hash_is_slow CHECK (
      (password_hash ~ '^\$2[aby]\$(1[2-9]|[2-9][0-9])\$')
      OR (password_hash ~ '^\$argon2id\$')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'credentials'::regclass AND conname = 'credentials_email_normalised'
  ) THEN
    -- 老库里这条是匿名 CHECK（列级写法），补齐时给它一个名字，
    -- 以后再判定就不必去比对表达式文本。
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'credentials'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%lower(email)%'
    ) THEN
      ALTER TABLE credentials
        ADD CONSTRAINT credentials_email_normalised CHECK (email = lower(email));
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credentials' AND column_name = 'display_name'
  ) THEN
    -- 先可空加列、回填、再收紧：老库里已有行，直接 NOT NULL 会失败。
    ALTER TABLE credentials ADD COLUMN display_name text;
    UPDATE credentials SET display_name = user_id WHERE display_name IS NULL;
    ALTER TABLE credentials ALTER COLUMN display_name SET NOT NULL;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION kernel_user_org_ids(text) TO app_rw;

/* ─────────────────────────── grants ─────────────────────────── */

-- The runtime role reads and writes all three. It still owns nothing and still cannot run
-- DDL (0001), so the F18 asymmetry is unchanged.
GRANT SELECT, INSERT, UPDATE, DELETE ON credentials TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON login_attempts TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE login_attempts_id_seq TO app_rw;
