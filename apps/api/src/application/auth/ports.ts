/**
 * Ports for the `auth` use cases. Defined here, implemented by `infrastructure`.
 *
 * usecases.md's port table lists five; this file has seven, and the two extras are not
 * scope creep -- they are gaps in the contract, recorded here rather than absorbed silently:
 *
 *   `LoginAttemptRepository`  domain.md declares `LoginAttempt` as the value object lockout
 *                             is computed from, and usecases.md's port table has NO port
 *                             for it. Without one, the lockout rule has nowhere to read
 *                             from, so an implementer either invents a port (this) or
 *                             reaches into a table from the use case (a layering breach).
 *   `Clock`                   every rule in this bundle is time-dependent (rolling window,
 *                             lock duration, token expiry, session TTL). With `Date.now()`
 *                             called inside the use case, "the lock lifts after 15 minutes"
 *                             can only be asserted by sleeping for 15 minutes -- so it
 *                             would not be asserted, and I-3's second half would quietly
 *                             stop being true.
 */
import type { SessionRecord } from "../../domain/auth/session-lifetime";
import type { LoginAttempt } from "../../domain/auth/lockout";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";
import type { z } from "zod";
import type { identity } from "@repo/contracts";

/* ───────────────────────────── credentials ───────────────────────────── */

export interface CredentialRow {
  readonly userId: string;
  /** Already normalised (`domain/auth/email`). */
  readonly email: string;
  readonly passwordHash: string;
  readonly emailVerifiedAt: Date | null;
  /** #638 delta, iteration 1. `credentials.display_name` -- always set, never null. */
  readonly displayName: string;
}

export interface CredentialRepository {
  /** @param email MUST be normalised by the caller. Returns null when no such account. */
  findByEmail(email: string): Promise<CredentialRow | null>;
  findByUserId(userId: string): Promise<CredentialRow | null>;
  /** Replace the stored hash. Used by password reset; never by login. */
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  /**
   * `updateOwnProfile`（#638 delta，迭代 1）—— 目前只有这一个可写字段。
   * 返回更新后的行；`userId` 不存在时返回 null（理论上不该发生，调用方已认证）。
   */
  updateDisplayName(userId: string, displayName: string): Promise<CredentialRow | null>;
}

export const CREDENTIAL_REPOSITORY = Symbol("CredentialRepository");

/* ───────────────────────────── hashing ───────────────────────────── */

/**
 * ⚠ `verifyDummy` is not a convenience wrapper and MUST NOT be deleted as dead weight.
 *
 * It is the timing half of I-1. "Email not found" takes a short path; "wrong password"
 * runs a slow hash. The two differ by roughly an order of magnitude, and an identical
 * response body does not help at all -- an attacker with a stopwatch enumerates the user
 * table through the difference. So when no user is found, the login path burns an
 * EQUIVALENT amount of work against a fixed dummy hash.
 *
 * coverage.md §5 item 4 names this line as the one most likely to be removed in code review
 * as "pointless waste". It is on the PORT rather than inline in the use case so that
 * removing it is a compile error in every implementation, not a quiet deletion in one.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(plaintext: string, hash: string): Promise<boolean>;
  /**
   * Burn the same cost `verify` would, and always return false.
   * Called when the account does not exist, so that the two failure paths cost the same.
   */
  verifyDummy(plaintext: string): Promise<false>;
}

export const PASSWORD_HASHER = Symbol("PasswordHasher");

/* ─────────────────────────── login attempts ─────────────────────────── */

export interface LoginAttemptRepository {
  /**
   * Attempts for this email newer than `since`.
   * ⚠ By EMAIL, never by IP -- see migration 0010 for the reasoning and for the recorded
   * conflict with uc-1-1 R4 E1.
   */
  recentFor(email: string, since: Date): Promise<readonly LoginAttempt[]>;
  record(email: string, outcome: LoginAttempt["outcome"], at: Date): Promise<void>;
}

export const LOGIN_ATTEMPT_REPOSITORY = Symbol("LoginAttemptRepository");

/* ─────────────────────────── session tokens ─────────────────────────── */

/**
 * Opaque session tokens. Redis (domain §3 ①).
 *
 * ⚠ Chosen over JWT because I-5 requires "all existing sessions invalid IMMEDIATELY" after
 * a password reset, and a JWT cannot do that without a blacklist -- which is a stateful
 * store, i.e. this, with extra steps and a window in which the old token still works.
 *
 * ⚠ NOT the same thing as `application/identity/ports.ts`'s `SessionStore`. That one holds
 * the per-user project-scoped CONTEXT that `switchOrganization` clears (O-12); this one
 * maps a bearer token to an identity. They were nearly merged during design: the names are
 * similar and both say "session". Merging them would mean revoking a token also wipes the
 * user's project context on every other device, and clearing context on an org switch would
 * log them out.
 *
 * ⚠ Every method must FAIL, never degrade, when Redis is unreachable (usecases.md's last
 * failure row). Returning "no session" on a connection error is indistinguishable, from the
 * caller's side, from a valid logout -- and returning "session ok" is the disguise for
 * "there is no auth layer".
 */
export interface SessionTokenStore {
  /** @returns the opaque bearer token. The token is NOT derivable from the record. */
  issue(record: SessionRecord): Promise<string>;
  findByToken(token: string): Promise<SessionRecord | null>;
  /**
   * Mark every live session of this user revoked, and return HOW MANY were marked.
   *
   * ⚠ The count is contract surface (`completePasswordReset.out.revokedSessionCount`), not
   * diagnostics: it is the only assertable form of uc-1-1 R4's "all existing sessions are
   * invalidated". The common way to get R4 wrong is to revoke only the CURRENT session, and
   * that mistake produces a response identical to the correct one except for this number.
   *
   * ⚠ Marks, does not delete (I-7).
   */
  revokeAllForUser(userId: string, at: Date): Promise<number>;
  /** All sessions of a user, revoked ones included -- so I-7 ("still there, marked") is assertable. */
  listForUser(userId: string): Promise<readonly SessionRecord[]>;

  /**
   * F03：吊销**一条**会话——「踢下线」。
   *
   * ⚠ 与 `revokeAllForUser` 是两个方法而不是一个带可选参数的方法。
   *   两者的**前置条件不同**：全量吊销的调用者是「刚改完密码的本人」，单条吊销的调用者
   *   声称「这条是我的」——而那句声称必须被这里验证。做成可选参数，会让「不传 sessionId
   *   就是全部」这条隐含语义在某个调用点被误用成「传了一个 undefined 的 sessionId」，
   *   于是一次踢下线静默变成把自己所有设备都踢了。
   *
   * ⚠ `userId` 是**归属校验参数，不是查询便利**。实现必须确认这条会话属于该 userId，
   *   否则任何人拿到（或猜到）别人的 sessionId 就能踢掉别人的设备——
   *   而 `usecases.md` 的 `pre` 逐字写着「只能列/踢**自己**的会话」。
   *
   * ⚠ **幂等**：重复踢同一条返回**同一个** `revokedAt`（`usecases.md`「幂等重放」）。
   *   第二次刷新时间戳会让「这台设备是什么时候被踢的」这个审计问题得到一个错误答案。
   *
   * ⚠ 标记而非删行（I-7），与 `revokeAllForUser` 同一条理由。
   *
   * @returns null = 没有这样一条属于该用户的会话（不存在 / 已自然过期出存储 / 不是他的）。
   *          三种情况**故意合并成一个返回值**：分开就等于给调用者一个「这个 sessionId
   *          存在吗」的探测器，而契约的 `err` 里根本没有这一档。
   */
  revokeSession(
    userId: string,
    sessionId: string,
    at: Date,
  ): Promise<{ readonly revokedAt: number; readonly device: string } | null>;

  /**
   * F03：把这条会话的 `lastActiveAt` 推到 `at`。
   *
   * ⚠ 调用方负责节流（`shouldTouchLastActive`），实现这里不再判一次——
   *   判两次就是「同一事实声明在两处」，而漂移方向是有人改了常量、实现纹丝不动。
   *
   * ⚠ 不得复活已过期/已吊销的会话，也不得延长 TTL。它只写一个展示字段。
   */
  touch(token: string, at: Date): Promise<void>;

  /**
   * F22: point THIS session at another organization.
   *
   * ⚠ Why this has to exist at all, and why it is the whole point of `switchOrgAtLogin`.
   *
   * `identity.switchOrganization` writes identity's own `SessionStore` -- the per-user
   * project-scoped context. It cannot reach the record behind the bearer token, and the
   * Guard's principal comes from exactly that record (`validateSession` reads
   * `currentOrgId` off it). So without this method, a "successful" org switch leaves every
   * subsequent request authorised against the OLD organization, with the new one rendered
   * on screen. Nothing errors; the two sources simply disagree.
   *
   * That defect was invisible before F22 because there was never a second organization to
   * switch to -- `orgs[0]` was always the only one, so the two sources always agreed.
   *
   * ⚠ ONE session, not all of them. Organizations are switched per DEVICE: O-12's post
   * effects are about the current context, and moving every session would mean switching
   * org on a laptop silently re-scopes a phone that is mid-task.
   *
   * @returns false when the token names no live session -- the caller turns that into
   *          SESSION_EXPIRED / SESSION_REVOKED rather than pretending the switch happened.
   */
  setCurrentOrg(token: string, orgId: OrgId): Promise<boolean>;
}

export const SESSION_TOKEN_STORE = Symbol("SessionTokenStore");

/* ────────────────────── password reset tokens ────────────────────── */

export interface ResetTokenRepository {
  /** Stores the HASH of `token`; the plaintext never reaches the database. */
  issue(userId: string, token: string, expiresAt: Date): Promise<void>;
  /**
   * Atomically consume a token: valid and unused => mark used and return the user.
   *
   * ⚠ One conditional UPDATE (`WHERE used_at IS NULL`, assert rowCount === 1), never
   * SELECT-then-UPDATE. The read-then-write has a window in which two concurrent requests
   * both see an unused token, and "single use" silently becomes "twice".
   */
  consume(token: string, now: Date): Promise<{ userId: string } | null>;
  /** Requests issued for this user since `since` -- the resend cooldown / daily cap (O-28 ④). */
  countIssuedSince(userId: string, since: Date): Promise<number>;
  latestIssuedAt(userId: string): Promise<Date | null>;
}

export const RESET_TOKEN_REPOSITORY = Symbol("ResetTokenRepository");

/* ────────────────────────────── mailer ────────────────────────────── */

/**
 * ⚠ Sending mail is EGRESS (X-3, gap A-4). The local-organization path promises zero
 * outbound traffic, so this port must not reach the network on that path -- which means
 * "forgot password" does not work for a local organization at all. usecases.md records that
 * as an open product question (A-4), and this bundle does not answer it.
 *
 * What is implemented here is an OUTBOX: the message is recorded, and delivery is somebody
 * else's transport. That keeps `sent: true` honest at this layer (the request was accepted
 * and recorded) without this feature quietly opening an egress path nobody signed off.
 */
export interface Mailer {
  send(msg: { to: string; kind: MailKind; body: Record<string, string> }): Promise<void>;
}

/**
 * ⚠ `password-changed` is MANDATORY and not user-disableable (O-28 ④): it is the only
 * alarm channel that exists when an account has already been taken over.
 */
export type MailKind = "password-reset-link" | "password-changed" | "account-locked";

export const MAILER = Symbol("Mailer");

/* ────────────────────────────── clock ────────────────────────────── */

export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol("Clock");

/* ─────────────────────────── token factory ─────────────────────────── */

/**
 * Unguessable ids and tokens (I-6: "UUID, must not be a sequence").
 *
 * A port rather than a direct `randomUUID()` call so the domain stays pure and, more
 * usefully, so a test can prove the production factory is NOT a counter: a sequential
 * session id is guessable, and guessable session ids make every other control in this
 * bundle irrelevant.
 */
export interface TokenFactory {
  /** Session id -- UUID. */
  sessionId(): string;
  /** High-entropy opaque bearer token (session token / reset token). */
  opaqueToken(): string;
}

export const TOKEN_FACTORY = Symbol("TokenFactory");


/* ── 以下自 F19（注册侧）并入 ────────────────────────────────────
 * 两个并行 feature 各自建了一份 auth 地基。合并时以 F20 那份为底（它更完整：
 * 会话、锁定、重置都在里面），再把 F19 独有的搬过来——而不是二选一。
 */

export interface RedeemAndCreateOrgInput {
  readonly code: string;
  /** Already normalized by the use case -- the repository does not re-normalize. */
  readonly email: string;
  readonly displayName: string;
  /** Already hashed. A plaintext password never crosses this boundary. */
  readonly passwordHash: string;
  readonly userId: string;
  readonly orgId: OrgId;
  readonly orgName: string;
  readonly verificationChallengeId: string;
  readonly verificationTokenDigest: string;
  readonly verificationOutboxId: string;
  readonly verificationExpiresAt: Date;
}

/**
 * Outcome of a redemption attempt.
 *
 * A discriminated union rather than exceptions-for-everything: `invite-code-invalid` and
 * `email-taken` are **contracted results** (they are in the operation's `err` list), while
 * a connection failure is not. Modelling the contracted failures as values keeps the
 * boundary honest -- a caller cannot forget to handle one, because TypeScript will not let
 * it read `.orgId` off the union without narrowing.
 */
export type RedeemAndCreateOrgResult =
  | { readonly ok: true; readonly userId: string; readonly orgId: OrgId }
  | { readonly ok: false; readonly reason: "invite-code-invalid" | "email-taken" };

export interface BootstrapFirstUserInput {
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly userId: string;
  readonly orgId: OrgId;
  readonly orgName: string;
  readonly emailVerifiedAt: Date;
}

export type BootstrapFirstUserResult =
  | { readonly ok: true; readonly userId: string; readonly orgId: OrgId }
  | { readonly ok: false; readonly reason: "bootstrap-unavailable" | "email-taken" };

export interface RegistrationRepository {
  /**
   * Cheap global preflight for the public endpoint. This is only a CPU guard: the
   * transactional `bootstrapFirstUser` check remains authoritative for concurrent callers.
   */
  isFirstUserBootstrapAvailable(): Promise<boolean>;

  /**
   * Creates the database's only invite-free account and durably consumes the one-shot gate.
   * The repository must serialize the global check, marker and every write in one
   * transaction; a process-local mutex is insufficient when more than one API instance is
   * running.
   */
  bootstrapFirstUser(input: BootstrapFirstUserInput): Promise<BootstrapFirstUserResult>;

  /**
   * ⚠ **One call because it is one transaction** (I-4). Do not "helpfully" split this.
   *
   * Everything the invariant names happens inside: the conditional redemption, the
   * organization, the owner membership, the credential, and the queued verification mail.
   * Any failure rolls all of it back.
   */
  redeemAndCreateOrg(input: RedeemAndCreateOrgInput): Promise<RedeemAndCreateOrgResult>;

  /**
   * F22 / O-12: an EXISTING account spends a NEW code and gets a SECOND organization.
   *
   * ⚠ A separate method rather than an optional `userId` on `redeemAndCreateOrg`.
   *
   * The two paths differ in WHO IS CALLING, not in their arguments: one is an anonymous
   * visitor holding a code, the other is an authenticated session holding a code. Merging
   * them makes "do we mint a new account" depend on a field in the request -- and a
   * forgeable field there reads "spend one code, attach yourself to somebody else's
   * account".
   *
   * ⚠ Still ONE call, for the same reason as `redeemAndCreateOrg`: I-4's indivisibility is
   * about redemption + organization + membership, and none of that gets weaker because the
   * credential already exists.
   *
   * ⚠ NO credential is written here. O-12: "此时**不新建账号**，只新建组织并把该账号设为其
   * 管理员（否则会出现同邮箱多账号，与 UC-1.1『同一人登录进的是同一账号』冲突）".
   * `multi-org-membership.test.ts` asserts the credential COUNT is unchanged -- which is
   * UC-1.5 V10 ① word for word, and the only assertion that catches a second account.
   */
  joinExistingUserToNewOrg(input: JoinNewOrgInput): Promise<JoinNewOrgResult>;
}

export interface JoinNewOrgInput {
  readonly code: string;
  /** Already authenticated by the use case. The repository never derives it from a body. */
  readonly userId: string;
  readonly orgId: OrgId;
  readonly orgName: string;
}

export type JoinNewOrgResult =
  | { readonly ok: true; readonly orgId: OrgId }
  | { readonly ok: false; readonly reason: "invite-code-invalid" };

export const REGISTRATION_REPOSITORY = Symbol("RegistrationRepository");

/* ─────────────────────── organization lifecycle (F22) ─────────────────────── */

/**
 * O-29 ③: disable is NOT delete. Reads survive, writes are frozen, data waits out the
 * retention window.
 *
 * ⚠ There is deliberately no `purge()` on this port. Nothing in phase-00 destroys anything
 * after `retentionUntil` -- no scheduler, no job, nothing. A method here would be the
 * shape of a promise that has no implementation behind it, and the person wiring the admin
 * screen would find it and believe it. Recorded as `KNOWN_CONTRACT_GAPS.C13`.
 *
 * ⚠ `disable` is on the port but is NOT reachable over HTTP. Disabling an organization is
 * a PLATFORM-OPERATIONS action, exactly like issuing invite codes (O-29 ①: 签发方 = 平台
 * 运营方，线下签发). Handing a tenant-facing endpoint the ability to freeze the tenant is
 * a self-service kill switch nobody asked for, and O-29 ③ never says the customer performs
 * it. What the acceptance is about is the EFFECT of the disabled state, not its trigger.
 */
export interface OrgLifecycleRepository {
  /**
   * The export manifest, WRAPPED.
   *
   * ⚠ `Guarded<T>` rather than a plain row, and one call rather than `read()` +
   * `tableCounts()`. Both follow from the same rule: `permission-filter` is the ONE doorway
   * between tenant data and a human (UC-0.3 R7 / X-1), and a repository that hands back raw
   * rows leaves nothing forcing a decision. Two methods would mean two payloads, and the
   * second one -- per-table row counts, i.e. how much data this customer holds -- is the one
   * that would quietly be returned unguarded because "it is only numbers".
   *
   * The decision itself is `domain/auth/org-lifecycle.ts`'s `decideOrgExport`, unwrapped
   * through `discloseDecided`: `authorize` cannot express "admin only" (it would find no
   * `acl_bindings` row, fall back to the permissive default scope, and allow every member).
   *
   * @returns null when the organization does not exist -- distinct from "wrapped but denied".
   */
  readExportManifest(orgId: OrgId): Promise<Guarded<OrgExportPayload> | null>;
  /**
   * Freeze an organization. `disabledAt` and `retentionUntil` are both supplied by the
   * caller: the retention window is computed from the contract constant in
   * `domain/auth/org-lifecycle.ts`, and the database stores what it is told. Any
   * `DEFAULT now() + interval` in SQL would be a second copy of the policy.
   */
  disable(orgId: OrgId, disabledAt: Date, retentionUntil: Date): Promise<void>;
  /** Lift the freeze. Present so "disabled" cannot silently mean "deleted" (see migration 0012). */
  reactivate(orgId: OrgId): Promise<void>;
}

export interface OrgExportPayload {
  readonly org: OrgLifecycleRow;
  /**
   * Per-table row counts.
   *
   * ⚠ Tables are derived from the catalog, not listed -- same reasoning as
   * `kernel_tenant_table_audit()`. A hand-written list is missing exactly the table somebody
   * added last week, and an export that silently omits a table is worse than one that
   * fails: the customer believes they took their data with them.
   */
  readonly tables: readonly { table: string; rowCount: number }[];
}

export interface OrgLifecycleRow {
  readonly orgId: string;
  readonly name: string;
  /** ⚠ 从契约的 `OrgKind` 取，不在这里复述字面量——F16 的单一事实源门控会红。 */
  readonly kind: z.infer<typeof identity.OrgKind>;
  readonly modelPolicy: string;
  readonly status: "active" | "disabled";
  readonly disabledAt: Date | null;
  readonly retentionUntil: Date | null;
}

export const ORG_LIFECYCLE_REPOSITORY = Symbol("OrgLifecycleRepository");
