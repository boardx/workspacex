/**
 * F32 -- the download grant: what「短时效 + 绑定 principal + 一次性」means as data.
 *
 * Innermost layer. No I/O. This file holds the two things that must not be re-declared
 * anywhere else: the TTL, and the fact that only a HASH of the token is ever stored.
 *
 * ## N-24, restated as three properties
 *
 * The contract (`files.operations.issueDownloadUrl`) says: 短时效 + 绑定 principal + 一次性,
 * and 「不得签发可转发的长期公开链接」. `oneTime` is `z.literal(true)` -- the contract does not
 * have a value for "reusable link". So three properties, each with its own failure:
 *
 *   1. **short-lived**  -- the same link used after `expiresAt` fails (`DOWNLOAD_URL_EXPIRED`)
 *   2. **one-time**     -- the same link used twice fails (`DOWNLOAD_URL_CONSUMED`)
 *   3. **not forwardable** -- a link redeemed by anyone other than the principal it was issued
 *      to fails, so forwarding it to a colleague gains them nothing
 *
 * ⚠ (3) is why the grant stores `principalUserId`. Short-lived + one-time ALONE would still
 *   let a forwarded link work for whoever clicks first, which is the exact "可转发" the
 *   contract forbids -- and it would look fine in any test that only re-used the link as the
 *   original user.
 *
 * ## 🔴 The one-time check must live in the WHERE clause, not in front of it
 *
 * This is recorded here, in the domain, because it is a property of the design and not of one
 * repository method. A redemption written as
 *
 *     SELECT ... WHERE token_hash = $1;        -- is it unused?
 *     if (row.consumedAt !== null) throw ...;  -- application decides
 *     UPDATE ... SET consumed_at = now() WHERE token_hash = $1;
 *
 * is **broken under concurrency and reports nothing**: two requests both read `consumed_at IS
 * NULL`, both pass the check, both update, both download. No exception, no error, no log line
 * -- a one-time link used twice. F15's agent found exactly this shape in the invite path.
 *
 * ⇒ Redemption is ONE statement whose WHERE carries every condition:
 *
 *     UPDATE download_grants SET consumed_at = now()
 *      WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND ...
 *  RETURNING ...;
 *
 *   Zero rows returned is the refusal. `tests/files/download-url-short-lived-onetime.test.ts`
 *   runs both redemptions CONCURRENTLY and requires exactly one winner -- an assertion the
 *   read-then-write shape cannot pass.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * How long a download link lives.
 *
 * ⚠ **Single declaration site.** It is not in SQL (no `DEFAULT now() + interval '...'`) for
 * the same reason `invite_links.expires_at` is not: a database default would be a second
 * number, and the drift direction is always "someone changed the TypeScript and the column
 * default sat there unchanged". `expires_at` is computed here and written as a value.
 *
 * ⚠ The contract gives no number -- 「短时效」 with no figure, and F32 is not among the six
 *   `[待定]` numbers in `files.KNOWN_CONTRACT_GAPS.FS12`. 120 seconds is this implementation's
 *   choice: long enough for a browser to follow a redirect and start a transfer, short enough
 *   that a link pasted into a chat is dead before anybody reads it. It is a value that should
 *   be ratified, not a value the contract supplied.
 */
export const DOWNLOAD_URL_TTL_SECONDS = 120;

/** Raw token length. 32 bytes of CSPRNG output -- guessing is not an attack path. */
const TOKEN_BYTES = 32;

export interface IssuedToken {
  /** Goes into the URL. Never stored. */
  readonly raw: string;
  /** Goes into the database. Never leaves the server. */
  readonly hash: string;
}

/**
 * Mint a token.
 *
 * ⚠ Only the HASH is persisted. A download grant is a bearer credential for bytes: with raw
 * tokens in a column, anyone who can read the table (a backup, a support query, a leaked dump)
 * can download every file whose link has not expired yet. Hashing makes the stored row useless
 * on its own -- the same reason session tokens are not stored raw.
 *
 * SHA-256 rather than a password hash: the input is 256 bits of uniform randomness, so there is
 * no dictionary to slow down, and a redemption is on the request path.
 */
export function mintDownloadToken(): IssuedToken {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, hash: hashDownloadToken(raw) };
}

export function hashDownloadToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two token hashes.
 *
 * Not used by the SQL redemption path (PostgreSQL compares the hash itself); exported for the
 * places that compare in TypeScript, so that no caller reaches for `===` on a secret.
 */
export function tokenHashEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** `expiresAt` for a grant issued at `now`. ISO 8601, as the contract's `expiresAt` is. */
export function downloadExpiry(now: Date): Date {
  return new Date(now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000);
}
