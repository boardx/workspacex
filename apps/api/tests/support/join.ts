/**
 * F12 三个测试文件共用的装配。同 `tests/support/invite-link.ts`（F15）的分工：
 * 这里只放**装配**，断言留在各测试文件里。
 */
import {
  PgInviteLinkRepository,
  PgJoinRepository,
  PgParticipantRosterRepository,
} from "../../src/infrastructure/auth/pg-invite-link-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";

export function repos(db: PgDatabase) {
  return {
    join: new PgJoinRepository(db),
    links: new PgInviteLinkRepository(db),
    roster: new PgParticipantRosterRepository(db),
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
