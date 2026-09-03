/**
 * `InspectPasswordResetThrottle` -- a platform-admin-only READ of the exact state
 * `requestPasswordReset` (`password-reset.ts`) consults before deciding whether to issue a
 * token and call the mailer: is this email even registered, and if so, is it currently
 * cooling down (60s) or over the rolling-24h daily cap.
 *
 * ## Why this needs to exist at all (issue #2632)
 *
 * `requestPasswordReset` returns `{ sent: true }` unconditionally (I-1, anti-enumeration --
 * see that file's head comment) whether or not an email is registered, cooling down, or over
 * cap. That is exactly right for the PUBLIC endpoint. But it also means nobody -- not the
 * user, not support, not an engineer with production access but no direct DB query tool --
 * can tell "did this actually get skipped, and why" from the outside. A real incident
 * (2026-09-04, `barbarayang300300@gmail.com` and later `usam@boardx.us` both reported "no
 * reset email arrives") took multiple rounds of guessing to even name "rate limit" as the
 * likely cause, and NOTHING could confirm it without someone manually running SQL against
 * production -- which nobody present had access to.
 *
 * This use case answers exactly that question, gated behind `PlatformSuperuserGuard` (same
 * bar as "系统异常 → 测试邮件"), so the answer is a button click away next time instead of a
 * SQL query nobody can run.
 *
 * ⚠ This is diagnostic-only. It does not reset, bypass, or otherwise touch the throttle --
 * only `requestPasswordReset`'s own token issuance advances `latestIssuedAt`/
 * `countIssuedSince`. A superuser who wants to unblock someone still has to wait out the
 * window or reach for a direct DB change; that is a deliberate scope boundary, not an
 * oversight -- adding a "clear this user's throttle" mutation is a second, separate decision
 * (does that reset both the cooldown AND the daily cap? does it need its own audit trail?)
 * that issue #2632 explicitly did not ask for.
 */
import { auth as C } from "@repo/contracts";
import type { z } from "zod";
import { normalizeEmail } from "../../domain/auth/email";
import { COOLDOWN_MS, DAY_MS } from "./password-reset";
import type { Clock, CredentialRepository, ResetTokenRepository } from "./ports";

export interface InspectThrottleDeps {
  readonly credentials: CredentialRepository;
  readonly resetTokens: ResetTokenRepository;
  readonly clock: Clock;
}

export type InspectThrottleInput = z.infer<typeof C.operations.inspectPasswordResetThrottle.in>;
export type InspectThrottleOutput = z.infer<typeof C.operations.inspectPasswordResetThrottle.out>;

export async function inspectPasswordResetThrottle(
  deps: InspectThrottleDeps,
  input: InspectThrottleInput,
): Promise<InspectThrottleOutput> {
  const email = normalizeEmail(input.email);
  const now = deps.clock.now();
  const dailyCap = C.AUTH_POLICY.resendDailyMax;
  const cooldownSeconds = C.AUTH_POLICY.resendCooldownSeconds;

  const cred = await deps.credentials.findByEmail(email);
  if (!cred) {
    // ⚠ Unlike the public endpoint, this branch IS allowed to say "not registered" --
    // the caller is already a verified platform superuser, not an anonymous prober. The
    // enumeration concern this mirrors (`requestPasswordReset`'s I-1) does not apply to an
    // endpoint only a whitelisted admin identity can reach at all.
    return {
      registered: false,
      issuedInLast24h: 0,
      dailyCap,
      overDailyCap: false,
      lastIssuedAt: null,
      cooldownSeconds,
      cooling: false,
      cooldownEndsAt: null,
    };
  }

  const lastIssuedAt = await deps.resetTokens.latestIssuedAt(cred.userId);
  const issuedInLast24h = await deps.resetTokens.countIssuedSince(cred.userId, new Date(now.getTime() - DAY_MS));
  const cooling = lastIssuedAt !== null && now.getTime() - lastIssuedAt.getTime() < COOLDOWN_MS;
  const overDailyCap = issuedInLast24h >= dailyCap;

  return {
    registered: true,
    issuedInLast24h,
    dailyCap,
    overDailyCap,
    lastIssuedAt: lastIssuedAt?.toISOString() ?? null,
    cooldownSeconds,
    cooling,
    cooldownEndsAt: cooling ? new Date(lastIssuedAt!.getTime() + COOLDOWN_MS).toISOString() : null,
  };
}
