/**
 * F16 · I-13「撤销时刻已存在的 LiveSession，在其 survivesUntilStageId 结束之前写操作
 * 仍成功；该环节结束后同一会话的下一次请求即失败」，与 I-14「[重置全部] / 逐人移出
 * 立即生效，不等环节结束」。
 *
 * 两块：
 *   ① **纯函数**（不连库，不需要 Postgres）—— `liveSessionWriteVerdict` 是 I-12~I-14
 *      的唯一判定点（`domain/auth/live-session.ts`），本身可以完全离线验证。
 *   ② **端到端**（连库）—— 证明 `revokeInviteLinks` 真的把①里验过的判定落到了
 *      `live_sessions` 表上，而不是判定对了、接线错了。
 */
import { describe, expect, it } from "vitest";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { liveSessionWriteVerdict, type LiveSessionState } from "../../src/domain/auth/live-session";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import { revokeInviteLinks } from "../../src/application/auth/revoke-invite-links";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import {
  addOrgMember,
  addProjectMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { facilitator, newDb, repos, toOrgId } from "../support/invite-link";
import { recordCheckIn } from "../../src/application/auth/record-check-in";

/* ══════════════════════ ① 纯函数：不连库 ══════════════════════ */

function state(over: Partial<LiveSessionState> = {}): LiveSessionState {
  return { revokedAt: null, survivesUntilStageId: null, endedAt: null, ...over };
}

describe("纯函数 liveSessionWriteVerdict（不连库）", () => {
  it("未撤销 ⇒ 任何环节下都允许", () => {
    expect(liveSessionWriteVerdict(state(), "stage-1").allowed).toBe(true);
    expect(liveSessionWriteVerdict(state(), null).allowed).toBe(true);
  });

  it("I-13：单条撤销（survivesUntilStageId 非空）—— 仍是那个环节时允许", () => {
    const revoked = new Date("2026-07-31T10:00:00Z");
    const s = state({ revokedAt: revoked, survivesUntilStageId: "stage-2" });
    expect(liveSessionWriteVerdict(s, "stage-2")).toEqual({ allowed: true });
  });

  it("I-13：环节推进之后 —— 同一会话的下一次请求即失败", () => {
    const revoked = new Date("2026-07-31T10:00:00Z");
    const s = state({ revokedAt: revoked, survivesUntilStageId: "stage-2" });
    expect(liveSessionWriteVerdict(s, "stage-3")).toEqual({
      allowed: false,
      reason: "stage-advanced-past-survival",
    });
    // ⚠ 反向：换回原环节不会让它复活——真实实现里环节只会前进，这里只断言判定本身
    //   对「不是那一个环节」一视同仁，不因为字符串恰好相等就放过。
    expect(liveSessionWriteVerdict(s, null).allowed).toBe(false);
  });

  it("I-14：[重置全部] / 逐人移出（survivesUntilStageId 为 null 且已撤销）—— 立即拒绝，不看环节", () => {
    const revoked = new Date("2026-07-31T10:00:00Z");
    const s = state({ revokedAt: revoked, survivesUntilStageId: null });
    // ⚠ 这正是与 I-13 的差别所在：即便传入的环节与「撤销时刻」一致，照样被拒。
    expect(liveSessionWriteVerdict(s, "stage-2")).toEqual({ allowed: false, reason: "session-ended" });
    expect(liveSessionWriteVerdict(s, null)).toEqual({ allowed: false, reason: "session-ended" });
  });

  it("会话已显式结束（ended_at 非空）⇒ 恒拒绝，优先于其余判定", () => {
    const s = state({
      revokedAt: new Date("2026-07-31T10:00:00Z"),
      survivesUntilStageId: "stage-2",
      endedAt: new Date("2026-07-31T10:05:00Z"),
    });
    // 即便 survivesUntilStageId 还指着 stage-2、请求也确实带着 stage-2，
    // ended_at 一旦非空就不该再允许——它是比「保留窗口」更强的终态。
    expect(liveSessionWriteVerdict(s, "stage-2")).toEqual({ allowed: false, reason: "session-ended" });
  });
});

/* ══════════════════════ ② 端到端：连库 ══════════════════════ */

const ORG = "org-f16-onsite";
const PROJECT = `${ORG}-p`;
const HOST = "u-f16-onsite-host";
const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: ReturnType<typeof repos>["links"];
let roster: ReturnType<typeof repos>["roster"];
let liveSessions: ReturnType<typeof repos>["liveSessions"];
let fixture: Awaited<ReturnType<typeof seedOrg>>;

const orgId = toOrgId(ORG);

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = newDb();
  const r = repos(db);
  repo = r.links;
  roster = r.roster;
  liveSessions = r.liveSessions;
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  fixture = await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1"] });
  await addOrgMember(ORG, HOST, "consultant", null);
  await addProjectMember(ORG, PROJECT, HOST, "facilitator", null, true);
}, HOOK_TIMEOUT_MS);

let onsiteParticipantSeq = 0;

async function onsiteParticipant(groupId: string, linkId: string, stageId: string | null) {
  const seq = onsiteParticipantSeq++;
  const created = await roster.upsert(orgId, PROJECT, HOST, [
    {
      participantId: `pp-onsite-${seq}`,
      contactKind: "phone",
      contact: `1380001${String(seq).padStart(4, "0")}`,
      masked: "138 •••• 0000",
      projectRole: "member",
      groupId,
    },
  ]);
  const participant = created.created[0]!;
  const session = await recordCheckIn(
    { liveSessions },
    {
      orgId,
      projectId: PROJECT,
      participantId: participant.participantId,
      linkId,
      guestIdentityId: `guest-${participant.participantId}`,
      groupId,
      currentStageId: stageId,
    },
  );
  return { participant, session };
}

describe("端到端：单条撤销 —— 在场会话保留至环节结束，其余不受影响", () => {
  it("撤销后 onsiteSessions/survivesUntilStageId 反映真实在场人数与环节", async () => {
    const link = await issueInviteLink(
      { repo },
      {
        orgId,
        projectId: PROJECT,
        kind: "group",
        groupId: fixture.groups.g1 ?? null,
        identity: "member",
        validity: "7d",
        ...facilitator(HOST),
      },
    );
    const { session: onsite } = await onsiteParticipant(fixture.groups.g1!, link.linkId, "stage-2");

    const out = await revokeInviteLinks(
      { repo, liveSessions },
      { orgId, projectId: PROJECT, linkId: link.linkId, currentStageId: "stage-2", ...facilitator(HOST) },
    );

    expect(out.onsiteSessions).toBe(1);
    expect(out.survivesUntilStageId).toBe("stage-2");

    const row = await liveSessions.get(orgId, onsite.sessionId);
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.survivesUntilStageId).toBe("stage-2");
    // I-13：仍在保留环节内 ⇒ 会话本身未被结束（签到板上仍是 present）。
    expect(row?.endedAt).toBeNull();
  });

  it("没有任何在场会话时 ⇒ onsiteSessions 为 0，survivesUntilStageId 为 null（不是猜的环节）", async () => {
    const link = await issueInviteLink(
      { repo },
      { orgId, projectId: PROJECT, kind: "main", groupId: null, identity: "member", validity: "7d", ...facilitator(HOST) },
    );
    const out = await revokeInviteLinks(
      { repo, liveSessions },
      { orgId, projectId: PROJECT, linkId: link.linkId, currentStageId: "stage-9", ...facilitator(HOST) },
    );
    expect(out.onsiteSessions).toBe(0);
    expect(out.survivesUntilStageId).toBeNull();
  });
});

describe("端到端：[重置全部] —— 立即生效，不等环节结束（I-14）", () => {
  it("在场会话立即被结束，survivesUntilStageId 恒 null", async () => {
    const link = await issueInviteLink(
      { repo },
      {
        orgId,
        projectId: PROJECT,
        kind: "group",
        groupId: fixture.groups.g1 ?? null,
        identity: "member",
        validity: "7d",
        ...facilitator(HOST),
      },
    );
    const { session: onsite } = await onsiteParticipant(fixture.groups.g1!, link.linkId, "stage-1");

    const out = await revokeInviteLinks(
      { repo, liveSessions },
      { orgId, projectId: PROJECT, linkId: null, currentStageId: "stage-1", ...facilitator(HOST) },
    );

    expect(out.onsiteSessions).toBe(1);
    // ⚠ 与单条撤销的差别正是这一行：即便传了 currentStageId，[重置全部] 也恒返回 null。
    expect(out.survivesUntilStageId).toBeNull();

    const row = await liveSessions.get(orgId, onsite.sessionId);
    expect(row?.endedAt).not.toBeNull();
  });
});
