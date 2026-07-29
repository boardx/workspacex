/**
 * Registration domain rules -- the innermost layer of the `auth` bundle (F19 / UC-1.5).
 *
 * Everything here is a pure function over values. No database, no HTTP, no clock that is
 * not passed in. That is what makes the invariants below assertable without a fixture.
 *
 * ## What lives here and what deliberately does not
 *
 * Here: email normalization, the organization-id shape, the redemption verdict.
 * NOT here: the transaction. I-4 ("redeem + create org + create owner membership + create
 * credential are ONE transaction") is a property of a sequence of writes, and a pure
 * function cannot hold it. Pretending otherwise -- a `redeem()` domain function that
 * "represents" the transaction -- would produce a green domain test for the one invariant
 * that can only fail in the database. It is asserted where it lives, against real
 * concurrent transactions, in tests/auth/one-code-one-org-concurrency.test.ts.
 */
import { randomBytes } from "node:crypto";
import { toOrgId, type OrgId } from "../org-id";

/**
 * Email normalization -- lower-cased, trimmed.
 *
 * domain.md: "唯一，小写规范化后比较". Done once, here, so that the uniqueness index, the
 * lookup and the stored value all agree. Two of the three agreeing is the failure mode:
 * `Alice@x.com` registers, `alice@x.com` is told the address is free, and the unique index
 * then rejects the insert with a 500 instead of `EMAIL_TAKEN`.
 *
 * ⚠ Deliberately NOT doing gmail-style dot/plus folding. That would make `a+work@x.com` and
 * `a@x.com` the same account, which is true for Gmail and false for most mail servers --
 * and being wrong in that direction means refusing a legitimate registration with
 * `EMAIL_TAKEN` for an address the user does not own.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Why the org id is generated rather than derived from the organization's name.
 *
 * A name-derived id leaks the name into every URL and log line, collides (E5 explicitly
 * allows two organizations to share a name), and changes meaning if the name is edited.
 * The prototype's `org_8f21` is a random suffix for the same reason.
 *
 * ⚠ The prototype writes `org_8f21` with an UNDERSCORE, and `domain/org-id.ts` forbids
 * underscores (`^[a-z0-9][a-z0-9-]{0,63}$`). `OrgId` wins: it is the value that goes into
 * `SET LOCAL app.current_org`, i.e. the input to every RLS policy in the schema, and
 * widening it to please a prototype screenshot would widen the tenant key itself. Logged as
 * contract gap C5 rather than silently resolved either way.
 *
 * 16 hex characters = 64 bits. Not a security boundary (org ids are not secrets -- RLS is
 * the boundary), just enough that collisions are not a thing anyone has to think about.
 */
export function newOrgId(): OrgId {
  return toOrgId(`org-${randomBytes(8).toString("hex")}`);
}

/** Same reasoning as `newOrgId`: opaque, not derived from the email. 128 bits. */
export function newUserId(): string {
  return `u-${randomBytes(16).toString("hex")}`;
}

/**
 * The verification token. **This one IS a secret** -- possession of it verifies an address.
 *
 * 256 bits from a CSPRNG. UC-1.5 R9: "验证令牌均为高熵随机值，不可预测".
 * base64url rather than hex so it stays a reasonable length in a URL.
 */
export function newVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Why the reason for a failed redemption is NOT returned.
 *
 * There are three distinct ways a code can fail: it does not exist, it was already
 * redeemed, it expired or was revoked. The application collapses all three into one
 * `INVITE_CODE_INVALID` (usecases.md; V9 and V11 both require it).
 *
 * This function exists to make that collapse a single place rather than a habit. A caller
 * gets a boolean; there is nothing for it to accidentally forward to the client.
 *
 * ⚠ It is NOT the enforcement of I-4. It cannot be: by the time this function has returned
 * `true`, another transaction may already have redeemed the code. Enforcement is the
 * conditional UPDATE in the repository -- see the note there. This is the shape of the
 * check for the cases a query CAN answer (expiry, revocation), stated in one place so the
 * SQL and the tests do not each invent their own.
 */
export interface InviteCodeState {
  readonly redeemedByUserId: string | null;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date;
}

export function isRedeemable(state: InviteCodeState, now: Date): boolean {
  if (state.redeemedByUserId !== null) return false;
  if (state.revokedAt !== null) return false;
  return state.expiresAt.getTime() > now.getTime();
}

/** O-29: an invite code is valid for 90 days from issuance. */
export const INVITE_CODE_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;
