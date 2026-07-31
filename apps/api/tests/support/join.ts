/**
 * F12 三个测试文件共用的装配。同 `tests/support/invite-link.ts`（F15）的分工：
 * 这里只放**装配**，断言留在各测试文件里。
 */
import {
  PgInviteLinkRepository,
  PgJoinApplicationRepository,
  PgJoinRepository,
  PgParticipantRosterRepository,
  PgParticipantWithdrawalRepository,
} from "../../src/infrastructure/auth/pg-invite-link-repository";
import { PgLiveSessionRepository } from "../../src/infrastructure/auth/pg-live-session-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { newLiveSessionId } from "../../src/domain/auth/live-session";

export function repos(db: PgDatabase) {
  return {
    join: new PgJoinRepository(db),
    links: new PgInviteLinkRepository(db),
    roster: new PgParticipantRosterRepository(db),
    // F13 意外②：名单外访客申请加入 / 引导师批准或拒绝。
    joinApplication: new PgJoinApplicationRepository(db),
    // F13 意外③：掉线/换设备重开——用来在测试里先 `checkIn` 出一条既有在场会话。
    liveSessions: new PgLiveSessionRepository(db, newLiveSessionId),
    withdrawal: new PgParticipantWithdrawalRepository(db),
  };
}

export function newDb(): PgDatabase {
  return new PgDatabase(appConfig());
}

/** 免注册身份 id 工厂。固定值即可——断言的是幂等重放的**结论**，不是随机性。 */
export function fixedIds(prefix: string) {
  let n = 0;
  return { next: () => `${prefix}-${n++}` };
}

export { toOrgId };

/** 一名引导师的调用者上下文（签发链接、落名单要用）。 */
export function facilitator(actorId: string) {
  return { actorId, actorProjectRole: "facilitator" as const };
}
