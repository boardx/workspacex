/**
 * F15 四个测试文件共用的装配。
 *
 * ⚠ 只放**装配**，不放断言。共用的断言 helper 会让四个文件里最重要的那几行
 * （反向断言）挪到一个谁也不会打开的文件里，而它们正是最该被读到的。
 */
import { PgInviteLinkRepository, PgParticipantRosterRepository } from "../../src/infrastructure/auth/pg-invite-link-repository";
import { PgLiveSessionRepository } from "../../src/infrastructure/auth/pg-live-session-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { newLiveSessionId } from "../../src/domain/auth/live-session";

export function repos(db: PgDatabase) {
  return {
    links: new PgInviteLinkRepository(db),
    roster: new PgParticipantRosterRepository(db),
    liveSessions: new PgLiveSessionRepository(db, newLiveSessionId),
  };
}

export function newDb(): PgDatabase {
  return new PgDatabase(appConfig());
}

/** 判定 id 工厂。固定值即可——断言的是判定的**结论**，不是 id 的随机性。 */
export function fixedIds(prefix: string) {
  let n = 0;
  return { next: () => `${prefix}-${n++}` };
}

export { toOrgId };

/** 一名引导师的调用者上下文。 */
export function facilitator(actorId: string) {
  return { actorId, actorProjectRole: "facilitator" as const };
}

/** 管理面读用例要的六件。 */
export function readerCtx(opts: {
  orgId: string;
  projectId: string;
  actorId: string;
  orgRole?: string | null;
  teamId?: string | null;
  projectRole?: string | null;
  groupId?: string | null;
}) {
  return {
    orgId: toOrgId(opts.orgId),
    projectId: opts.projectId,
    actorId: opts.actorId,
    actorOrgRole: opts.orgRole === undefined ? "consultant" : opts.orgRole,
    actorTeamId: opts.teamId ?? null,
    actorProjectRole: opts.projectRole === undefined ? "facilitator" : opts.projectRole,
    actorGroupId: opts.groupId ?? null,
  };
}
