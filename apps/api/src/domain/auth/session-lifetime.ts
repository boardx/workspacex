/**
 * Session lifetime and validity -- domain invariants I-6 and I-7 (uc-1-1 R3 step 2 / AC2).
 *
 * ⚠ The 30 days is a `Backlog Use Case.html` number, not something measured from the
 * prototype -- uc-1-1 says so in as many words. It lives in `AUTH_POLICY.sessionDays`
 * (the single source) so that when a human revises it, one edit moves every consumer.
 */
import { auth as C } from "@repo/contracts";

export const SESSION_TTL_MS = C.AUTH_POLICY.sessionDays * 24 * 60 * 60 * 1000;

/** The stored form of a session. Epoch ms rather than ISO strings -- comparable, no parsing. */
export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly currentOrgId: string | null;
  readonly issuedAt: number;
  readonly expiresAt: number;
  /**
   * null = live.
   *
   * ⚠ I-7: revocation WRITES A MARK, it does not delete the row. Deleting makes "who was
   * kicked, and when" unanswerable -- and that is one of the four events uc-1-1 R6 requires
   * to be auditable. It also collapses two different answers into one: a deleted record and
   * a never-existed record are indistinguishable, so `SESSION_REVOKED` ("this device was
   * removed") degrades into `SESSION_EXPIRED` ("you have been away too long"), and
   * usecases.md keeps those separate precisely because the user needs to tell them apart.
   */
  readonly revokedAt: number | null;
  /**
   * F03 / org-admin `DeviceSession`。**同一条记录**，不是第二处会话真相。
   *
   * ⚠ `usecases.md` 第六节的端口表逐字写着 `DeviceSessionRepository`「与 phase-00 的
   * `SessionStore` **同一个存储**，不新建第二处会话真相」。所以这三个字段长在
   * `SessionRecord` 上，而不是另建一张 `device_sessions` 表用 `sessionId` 外键去挂：
   * 两处存储意味着「踢下线」要同时写两边，而任何一次只写成功一边，
   * 列表里显示「已踢」的设备仍然能发请求——那正是本 feature 要守的不变量的反面。
   *
   * ⚠ 这也是 I-33（一次登录恰好一条 `DeviceSession`）为什么在这个模型里**不可能违反**：
   * 会话与设备会话是同一行，计数天然相等。它仍然被断言，但断言的是「一次登录只 issue 一次」。
   */
  readonly device: string;
  /** 网络来源，不是地理定位。语义与取值见 `domain/auth/device-fingerprint.ts` 文件头。 */
  readonly location: string | null;
  /**
   * 最后活跃时刻（epoch ms）。
   *
   * ⚠ 它**必须真的被更新**，否则这一列显示的是登录时刻而标题写着「最后活跃」——
   * 一个界面上看不出错、而用户据它判断「这台设备我还在用吗」的谎。更新在
   * `validateSession` 里做，并按 `LAST_ACTIVE_TOUCH_INTERVAL_MS` 节流。
   */
  readonly lastActiveAt: number;
}

/**
 * 「最后活跃」的写入节流窗口。
 *
 * ⚠ 不节流的话，每一个受保护请求都要往会话存储写一次——鉴权路径上多一次写，
 * 而这个字段的用途（让用户认出哪台设备还在用）根本不需要秒级精度。
 * ⚠ 也不能不写（见 `lastActiveAt`）。所以是节流，不是二选一。
 *
 * 60 秒**没有需求出处**，和 30 天一样属于本 feature 的 `[Backlog]` 侧：
 * 它只影响这一列的精度，不影响任何安全判定，所以放在这里而不是 `AUTH_POLICY`——
 * 进 `AUTH_POLICY` 会让它看起来像一条被签核过的策略。
 */
export const LAST_ACTIVE_TOUCH_INTERVAL_MS = 60_000;

/** 现在该不该写一次 `lastActiveAt`。纯函数，因此节流规则本身可被逐条断言。 */
export function shouldTouchLastActive(s: SessionRecord, now: number): boolean {
  return now - s.lastActiveAt >= LAST_ACTIVE_TOUCH_INTERVAL_MS;
}

/** Why a session is not usable. null = usable. */
export type SessionInvalidity = "SESSION_EXPIRED" | "SESSION_REVOKED";

/**
 * Revocation is checked BEFORE expiry.
 *
 * An expired-and-revoked session should report `SESSION_REVOKED`: the user was kicked, and
 * later it also happened to expire. Reporting expiry would tell them "you have been away a
 * while" when what actually happened is that somebody removed their device -- which is the
 * one case where they need to go change their password.
 */
export function checkSession(s: SessionRecord, now: number): SessionInvalidity | null {
  if (s.revokedAt !== null) return "SESSION_REVOKED";
  if (now >= s.expiresAt) return "SESSION_EXPIRED";
  return null;
}
