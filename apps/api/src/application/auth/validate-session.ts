/**
 * `ValidateSession` -- the real implementation behind F18's `PrincipalResolverPort`.
 *
 * F18 shipped `HeaderPrincipalResolver`: read the principal out of a test-injection header,
 * unreachable in production, with the credential format deliberately left to this bundle
 * (UC-0.6 A-3). This is that credential format arriving: an opaque bearer token resolved
 * through the session store.
 *
 * ⚠ Returns null for every "not a valid session" case and lets the Guard turn that into a
 * 401. It does NOT throw a distinct error per reason at this layer, because the Guard's
 * rule is structural (principal non-null) and a resolver that threw three different things
 * would push authentication decisions into the Guard, which is the one place F18 kept them
 * out of.
 *
 * ⚠ A store failure must PROPAGATE, not become null. The Guard catches a thrown error and
 * answers 503 `auth_unavailable`; a null would answer 401. Those look similar and are not:
 * turning "Redis is down" into "you are not logged in" is a degradation, and the failure
 * row in usecases.md is explicit that Redis being unavailable means REFUSE.
 */
import { checkSession, shouldTouchLastActive } from "../../domain/auth/session-lifetime";
import type { Clock, SessionTokenStore } from "./ports";

export interface ValidateSessionDeps {
  readonly sessions: SessionTokenStore;
  readonly clock: Clock;
}

export interface ValidatedSession {
  readonly userId: string;
  readonly currentOrgId: string | null;
}

export async function validateSession(
  deps: ValidateSessionDeps,
  sessionToken: string,
): Promise<ValidatedSession | null> {
  if (!sessionToken) return null;
  const record = await deps.sessions.findByToken(sessionToken);
  if (!record) return null;
  // Revoked BEFORE expired -- see `checkSession`. Both are null here; the distinction
  // matters to the user-facing reason code, which the session-list UI (phase-01 F03, not
  // migrated) will surface. Recorded so the domain distinction is not mistaken for dead code.
  const now = deps.clock.now();
  if (checkSession(record, now.getTime()) !== null) return null;

  /*
   * F03：推进「最后活跃」。
   *
   * ⚠ 位置是刻意的——**在有效性判定之后**。放在前面会给一条已被踢的会话续上活跃时间，
   *   于是设备列表里那台设备看起来还在用。
   *
   * ⚠ 节流（`shouldTouchLastActive`）。不节流就是每个受保护请求在鉴权路径上多一次写，
   *   而这一列根本不需要秒级精度。
   *
   * ⚠ 写失败**照旧向外抛**，不 catch。整个 bundle 的规则是「存储不可用一律拒绝，
   *   不降级」——这里 catch 掉会开一个例外：Redis 半死时鉴权继续放行，
   *   而放行正是 503 想要避免的那件事。
   */
  if (shouldTouchLastActive(record, now.getTime())) {
    await deps.sessions.touch(sessionToken, now);
  }

  return { userId: record.userId, currentOrgId: record.currentOrgId };
}
