-- 0010 F19: invite codes, credentials, email verification (UC-1.5 / contracts/auth)
--
-- Three tables, and NONE of them carries `org_id`. That is not an oversight, it is the
-- shape of the problem:
--
--   * an invite code exists BEFORE any organization does -- that is its entire purpose
--   * a credential belongs to a PERSON, and O-12 ruled `user <-> organization` is
--     one-to-many, so pinning a credential to one org would contradict the ruling
--   * a verification token belongs to a credential, which belongs to nobody's tenant
--
-- ## Why that matters, and what it costs
--
-- `kernel_tenant_table_audit()` (migration 0004) reports any table the runtime role can
-- read that has NO tenant key as `UNTENANTED_BUT_GRANTED` -- "a cross-tenant hole BY
-- CONSTRUCTION, because there is nothing to filter on". That verdict is CORRECT about
-- these three, and the audit is right to demand an answer rather than a shrug.
--
-- So each of them carries a `kernel-no-tenant-data:` COMMENT that states what it holds and
-- what a compromised `app_rw` would actually get. Migration 0004's own reasoning is why the
-- claim goes on the table rather than into an allowlist: an allowlist is edited by the
-- person trying to make a gate go green, which is the worst possible moment to be making a
-- security judgement quietly.
--
-- ⚠ The comments below are deliberately NOT the words "no tenant data, nothing to see" --
-- two of these tables genuinely expose something, and the comment says what.
--
-- ## Least privilege, expressed as grants
--
-- `invite_codes` gets SELECT + UPDATE and NOT INSERT/DELETE. Issuance is offline (O-29:
-- "签发方 = 平台运营方，线下签发"), so the runtime role has no business minting codes.
-- SELECT is unavoidable: `UPDATE ... WHERE code = $1` needs SELECT on the column it filters
-- on. This is asserted, not just written -- see auth/invite-code-redeem-atomic.test.ts.
--
-- Replayable: every statement is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE, because
-- migrate:check replays each file ignoring the version table.

/* ─────────────────────────── invite_codes ─────────────────────────── */

CREATE TABLE IF NOT EXISTS invite_codes (
  -- 14 characters (UC-1.5). The alphabet is deliberately unconstrained here for the same
  -- reason the contract's `InviteCodeValue` only checks length: nothing in domain.md fixes
  -- one, and a server-side alphabet check would reject legitimate offline-issued codes with
  -- a bare 400 -- which looks like "the code your salesperson gave you does not work".
  code            text PRIMARY KEY CHECK (length(code) = 14),
  -- O-29: batch_id only, for traceability and bulk revocation. No batch UI in phase-1.
  batch_id        text,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  -- O-29: one-time, valid 90 days. Expiry is a COLUMN rather than a computed
  -- `issued_at + 90 days` so that re-issuing with a different window does not require a
  -- migration, and so an expired code stays expired if the policy is later lengthened.
  expires_at      timestamptz NOT NULL,
  -- O-29: revocation is a third state, distinct from redeemed and from expired. V11 says
  -- all three must be INDISTINGUISHABLE to the caller -- which is an application-level
  -- promise (one error code), not a schema-level one. Keeping them separate here is what
  -- makes the audit trail able to answer "why did this code stop working".
  revoked_at      timestamptz,

  -- The redemption fact. Both columns move together or neither does.
  redeemed_by_user_id text,
  redeemed_at         timestamptz,
  -- Which organization this code produced (domain.md `InviteCode.createdOrgId`).
  --
  -- ⚠ ON DELETE SET NULL, not CASCADE: deleting an organization must NOT delete the record
  -- that a code was spent. "One code, one organization" (I-4) would otherwise be defeated
  -- by deleting the org -- the code row would vanish and the code would be reusable.
  -- SET NULL keeps `redeemed_at` non-null, which is what the conditional UPDATE tests.
  created_org_id      text REFERENCES organizations (id) ON DELETE SET NULL,

  -- A code is either redeemed (who + when) or not (neither). A row with a redeemer and no
  -- timestamp is not a stricter state, it is an unreadable one -- and the audit question
  -- "when was this spent" would have no answer.
  CONSTRAINT invite_codes_redemption_is_atomic
    CHECK ((redeemed_by_user_id IS NULL) = (redeemed_at IS NULL)),
  -- An organization cannot have been created by a code that was never redeemed.
  CONSTRAINT invite_codes_org_implies_redeemed
    CHECK (created_org_id IS NULL OR redeemed_by_user_id IS NOT NULL)
);

-- Partial index on the only lookup the runtime performs: an unredeemed, unrevoked code.
CREATE INDEX IF NOT EXISTS invite_codes_open_idx
  ON invite_codes (code) WHERE redeemed_by_user_id IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE invite_codes IS
  'kernel-no-tenant-data: pre-tenant issuance records. An invite code exists BEFORE any '
  'organization does, so it cannot carry a NOT NULL org_id -- and a NULLABLE one would make '
  'the RLS policy `org_id = current_setting(...)` reject exactly the unredeemed rows that '
  'redemption has to find, i.e. the feature could not work at all. '
  'WHAT app_rw CAN ACTUALLY SEE HERE, stated rather than glossed over: the full code values, '
  'and `created_org_id` -- a backward pointer revealing that some organization id exists. '
  'It holds no organization CONTENT, no membership and no permission. app_rw is granted '
  'SELECT+UPDATE only (never INSERT/DELETE) because issuance is offline per O-29, so a '
  'compromised runtime role can spend an existing code but cannot mint one.';

/* ─── credentials 由 0010-auth-credentials-sessions.sql 拥有 ───────────
 *
 * 两个并行 feature（F19 注册、F20 登录）各建过一张 `credentials`。
 * `CREATE TABLE IF NOT EXISTS` 会让**后跑的那个静默变成空操作**——
 * 于是它的约束一条都不生效，而失败要等到某次 INSERT 才浮出来。
 *
 * 归属裁决（2026-07-29）：归 F20 那份，因为它把「口令必须是慢哈希」做成了
 * **表级 CHECK**——连 owner 都插不进弱哈希。F19 那份缺这条。
 * 同时把 F19 独有的两样并了进去：`email = lower(email)` 的 CHECK 与 `display_name`。
 * 取并集比二选一强，且两边的理由都成立。
 *
 * 排序也改了：credentials/sessions 排 0010，本文件排 0011，
 * 否则本文件先跑、上面那个空操作就会发生。
 */
/* ──────────────────── email_verification_tokens ──────────────────── */

-- The token AND the outbox entry, in one table, on purpose.
--
-- `RedeemInviteAndCreateOrg.out.emailVerificationSent` is `z.literal(true)` -- the contract
-- makes "we did not send it" unrepresentable, so the operation must FAIL rather than return
-- a success body that overstates what happened (UC-1.5 E4: 邮件发送失败必须显式提示，
-- 不得静默成功).
--
-- An SMTP call cannot deliver that guarantee: it happens outside the transaction, so a
-- failure leaves an organization created and a caller told nothing was sent -- exactly the
-- half-state I-4 exists to prevent. Enqueueing durably INSIDE the transaction does deliver
-- it: if the enqueue fails, the whole registration rolls back and no account exists.
--
-- ⚠ So `emailVerificationSent: true` means "durably enqueued for delivery", NOT "an SMTP
-- server accepted it". The relay that drains this table is NOT part of phase-00 and is
-- reported as a gap. Saying so here, in the schema, because the alternative -- a Mailer
-- that logs and returns success -- would make the contract's literal `true` a lie that no
-- test could catch.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  -- High-entropy random, not guessable (UC-1.5 R9). Primary key so a duplicate is a
  -- constraint violation rather than an overwrite.
  token        text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES credentials (user_id) ON DELETE CASCADE,
  -- Denormalized on purpose: this row is also the outbox entry, and an outbox entry has to
  -- record where it was addressed at the time it was queued. If the credential's email is
  -- later corrected, the already-queued message still went to the old address, and the
  -- audit answer must be the old address.
  email        text NOT NULL,
  -- 24 hours, one-time (O-28, UC-1.5 R9). A column rather than a computed window for the
  -- same reason as invite_codes.expires_at.
  expires_at   timestamptz NOT NULL,
  -- One-time use: non-null means spent. Same shape as redemption -- a marker, not a delete,
  -- so "this link was already used" stays answerable.
  consumed_at  timestamptz,
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  -- Set by the (not-yet-existing) relay. NULL = still in the outbox.
  delivered_at timestamptz
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx
  ON email_verification_tokens (user_id);
-- The relay's query, and the assertion that the outbox is real.
CREATE INDEX IF NOT EXISTS email_verification_tokens_pending_idx
  ON email_verification_tokens (enqueued_at) WHERE delivered_at IS NULL;

COMMENT ON TABLE email_verification_tokens IS
  'kernel-no-tenant-data: verification links for credentials, which are themselves '
  'pre-tenant. Doubles as the outbox: a row with delivered_at IS NULL is a message queued '
  'but not yet relayed. WHAT app_rw CAN ACTUALLY SEE: unconsumed verification tokens and '
  'the addresses they were queued to -- i.e. a compromised runtime role could verify an '
  'email it does not control. That is bounded by expiry (24h) and by the token being '
  'single-use, and it grants no organization access on its own: verification only flips '
  'credentials.email_verified_at. No tenant content is reachable from this table.';

/* ─────────────────────────── grants ─────────────────────────── */

-- ⚠ No INSERT and no DELETE on invite_codes. Issuance is offline (O-29) and a spent code is
-- evidence, so the runtime role may spend a code and may not create or destroy one.
GRANT SELECT, UPDATE ON invite_codes TO app_rw;
GRANT SELECT, INSERT, UPDATE ON credentials TO app_rw;
GRANT SELECT, INSERT, UPDATE ON email_verification_tokens TO app_rw;
