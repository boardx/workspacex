/**
 * `Login` (F20) -- uc-1-1 R3, contract `auth.operations.login`.
 *
 * ## The order of operations here IS the security property
 *
 *   1. lockout check          BEFORE the password is verified (I-3: a correct password is
 *                             refused while locked -- checking it afterwards would let the
 *                             attacker's eventual hit through)
 *   2. credential lookup
 *   3. password verification, OR an equivalent-cost dummy hash when there is no account
 *                            (I-1's timing half)
 *   4. email-verified check   AFTER the password is confirmed (I-8, and see below)
 *   5. issue the session
 *
 * ## Why `EMAIL_NOT_VERIFIED` comes after the password check
 *
 * uc-1-1 A3 wants the user told that their email is unverified. But answering that BEFORE
 * verifying the password turns the endpoint into an oracle: anyone can ask "is
 * victim@corp.com a registered-but-unverified account" without holding the password. So the
 * distinct code is only issued to a caller who has ALREADY proven they hold the password --
 * at which point they are the account owner and telling them costs nothing.
 *
 * ⚠ That is a deliberate narrowing of A3 and is called out in the report: A3's literal
 * reading ("prompt and offer resend") is reachable only after a correct password.
 *
 * ## What this use case must never do (I-9)
 *
 * It returns organization IDS and nothing else -- no roles, no scopes. `auth` answers "who
 * are you"; the moment it answers "what may you do" there is a second authorization source,
 * and X-1's whole job is that there is exactly one.
 */
import { auth as C } from "@repo/contracts";
import type { z } from "zod";
import { normalizeEmail } from "../../domain/auth/email";
import { decideLockout, LOCK_WINDOW_MS } from "../../domain/auth/lockout";
import { SESSION_TTL_MS, type SessionRecord } from "../../domain/auth/session-lifetime";
import type { IdentityRepository } from "../identity/ports";
import { AuthError } from "./errors";
import type {
  Clock,
  CredentialRepository,
  LoginAttemptRepository,
  PasswordHasher,
  SessionTokenStore,
  TokenFactory,
} from "./ports";

export interface LoginDeps {
  readonly credentials: CredentialRepository;
  readonly hasher: PasswordHasher;
  readonly attempts: LoginAttemptRepository;
  readonly sessions: SessionTokenStore;
  readonly tokens: TokenFactory;
  readonly clock: Clock;
  /** Only `listMemberships` is used -- a cross-org read restricted to the caller's own id. */
  readonly identity: IdentityRepository;
}

export type LoginInput = z.infer<typeof C.operations.login.in>;
export type LoginOutput = z.infer<typeof C.operations.login.out>;

/**
 * F03：这次登录来自哪台设备、哪个网络。
 *
 * ⚠ **第二个参数，不是 `LoginInput` 的字段。** `auth.operations.login.in` 是 phase-00
 *   已签核的 `{ email, password }.strict()`，往里加字段等于改一份已签核契约；
 *   而且那会让设备名变成**客户端自报**的值。这两个值只从传输元数据派生
 *   （`domain/auth/device-fingerprint.ts`），由 `interface` 层从请求头/连接上读出。
 *
 * ⚠ 有默认值，但默认值是 `UNKNOWN_DEVICE` 而不是「省略」——一条没有设备名的会话
 *   在列表里是一行无法与另一行区分的空白，用户据此决定踢哪一台。
 */
export interface LoginDeviceContext {
  readonly device: string;
  readonly location: string | null;
}

export async function login(
  deps: LoginDeps,
  input: LoginInput,
  device: LoginDeviceContext,
): Promise<LoginOutput> {
  const email = normalizeEmail(input.email);
  const now = deps.clock.now();

  /* 1. Lockout, before anything is verified (I-3). */
  const recent = await deps.attempts.recentFor(email, new Date(now.getTime() - LOCK_WINDOW_MS));
  const verdict = decideLockout(recent, now.getTime());
  if (verdict.locked) {
    // Not recorded as another failed attempt: the password was never examined, so counting
    // it would let an attacker who keeps hammering extend the lock on the real owner --
    // and it would make `lockedUntil` drift forward on every rejected probe.
    throw new AuthError("ACCOUNT_LOCKED", verdict.lockedUntil);
  }

  /* 2-3. Lookup, then verify -- or burn the same cost when there is nothing to verify. */
  const cred = await deps.credentials.findByEmail(email);

  // ⚠⚠ DO NOT "OPTIMISE" THIS BRANCH AWAY. ⚠⚠
  //
  // `verifyDummy` runs a full-cost hash against a fixed dummy digest and returns false. It
  // looks like pure waste -- it computes a value that is thrown away -- and that is exactly
  // why coverage.md §5 item 4 predicts it gets deleted in review.
  //
  // Without it: "no such account" returns in ~0.1ms and "wrong password" in ~100ms. The
  // response bodies are byte-identical and it does not matter in the slightest; a stopwatch
  // separates them on the first request, and the login endpoint becomes a user-table
  // enumeration oracle for an unauthenticated attacker.
  //
  // `login-enumeration-guard.test.ts` asserts the elapsed-time difference stays inside a
  // threshold, and carries a counter-proof that the assertion is not vacuous.
  const ok = cred
    ? await deps.hasher.verify(input.password, cred.passwordHash)
    : await deps.hasher.verifyDummy(input.password);

  if (!cred || !ok) {
    await deps.attempts.record(email, "bad-credential", now);
    // ONE code for both cases. Splitting them is the enumeration channel I-1 closes, and
    // the split is usually introduced later, by someone improving the error messages.
    throw new AuthError("INVALID_CREDENTIAL");
  }

  /* 4. Verified email (I-8). Only reachable by someone who holds the password. */
  if (cred.emailVerifiedAt === null) {
    // Recorded as a SUCCESSFUL credential check: the password was right. Recording it as a
    // failure would let an unverified user lock their own account out by retrying.
    await deps.attempts.record(email, "ok", now);
    throw new AuthError("EMAIL_NOT_VERIFIED");
  }

  /* 5. Session. */
  await deps.attempts.record(email, "ok", now);

  const orgs = await deps.identity.listMemberships(cred.userId);
  const record: SessionRecord = {
    id: deps.tokens.sessionId(),
    userId: cred.userId,
    // uc-1-1 R3 step 3: the login step does NOT let the user pick an organization. It is
    // resolved afterwards, by `identity.switchOrganization`, which owns the post-effects.
    currentOrgId: orgs[0]?.orgId ?? null,
    issuedAt: now.getTime(),
    expiresAt: now.getTime() + SESSION_TTL_MS,
    revokedAt: null,
    // F03：设备会话与会话是**同一条记录**（org-admin usecases.md 第六节：
    // `DeviceSessionRepository` 与 phase-00 的 `SessionStore` 同一个存储）。
    // 因此 I-33「一次登录恰好一条 DeviceSession」在这里是结构性成立的：
    // 这个函数只 issue 一次，没有第二处需要保持同步。
    device: device.device,
    location: device.location,
    // 登录本身就是一次活跃。用 issuedAt 而不是 0/null：一台刚登录的设备
    // 在列表里显示「最后活跃：从未」是假的。
    lastActiveAt: now.getTime(),
  };
  // 真实事故（2026-09-01，traceId 28b6862c-71e1-4ce8-8e3f-3fceb9f8b607）：ioredis 在这次
  // 调用途中报 `Error: Connection is closed.`（连接被对端关闭，命中一次瞬时 Redis 抖动），
  // 这里此前不捕获，异常原样冒到 `AuthController`，`toHttp()` 认不出它（既不是 `AuthError`
  // 也不是 `PasswordPolicyError`），`AllExceptionsFilter` 把它归成裸的 `internal_error`
  // 500——用户看到「服务暂时不可用」（措辞碰巧对了），但没有走契约定义好的
  // `AUTH_SERVICE_UNAVAILABLE` 通路，日志里也留不下一个可归类的 reasonCode。
  //
  // `redis-session-token-store.ts` 文件头注早就写明这里的设计意图——"Redis unavailable
  // => refuse, never degrade"，"a thrown error becomes 503 auth_unavailable"——但那句意图
  // 只在 `PrincipalGuard`（校验已有 session）那条路径上真正落地了，登录时**签发新
  // session** 这条路径上从来没人接住过。补上同一条纪律：抓住这次调用可能抛出的任何
  // 异常，翻译成契约里本来就有的 `AUTH_SERVICE_UNAVAILABLE`（`toHttp()` 会把它映射成
  // 503，不再混进 500 internal_error 的桶）。
  let sessionToken: string;
  try {
    sessionToken = await deps.sessions.issue(record);
  } catch {
    throw new AuthError("AUTH_SERVICE_UNAVAILABLE");
  }

  return {
    sessionToken,
    userId: cred.userId,
    // IDs only -- no roles (I-9).
    orgs: orgs.map((o) => o.orgId),
    expiresAt: new Date(record.expiresAt).toISOString(),
  };
}
