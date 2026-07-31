/**
 * F16 · 「分组与签到到场回写」（uc-1-3 R8）：参与者进场后，现场面「分组与签到」板上
 * 该人由未到变已到，本组 n/m 与全场计数（11/12 已到）同步刷新。
 *
 * `user_visible_behavior` 逐字要求的是**回写**这个动词——一条名单条目不会自己
 * 从「未到」变成「已到」，必须有一次写操作（`recordCheckIn`）真正落库，
 * 而 `getCheckinBoard` 读到的分子分母必须来自**同一次查询**（usecases.md：
 * 「管理面与现场面共用同一份数据，不得实现成两套链接」），不是两次 count 各算各的。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgAdmin as C } from "@repo/contracts";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import { recordCheckIn } from "../../src/application/auth/record-check-in";
import { getCheckinBoard } from "../../src/application/auth/get-checkin-board";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import {
  addOrgMember,
  addProjectMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { facilitator, fixedIds, newDb, readerCtx, repos, toOrgId } from "../support/invite-link";

const ORG = "org-f16-checkin";
const PROJECT = `${ORG}-p`;
const HOST = "u-f16-checkin-host";
const GROUP_LEAD = "u-f16-checkin-lead";
const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: ReturnType<typeof repos>["links"];
let roster: ReturnType<typeof repos>["roster"];
let liveSessions: ReturnType<typeof repos>["liveSessions"];
let fixture: Awaited<ReturnType<typeof seedOrg>>;

const orgId = toOrgId(ORG);
const ids = fixedIds("dec-f16-checkin");

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
  fixture = await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1", "g2"] });
  await addOrgMember(ORG, HOST, "consultant", null);
  await addOrgMember(ORG, GROUP_LEAD, "consultant", null);
  await addProjectMember(ORG, PROJECT, HOST, "facilitator", null, true);
  await addProjectMember(ORG, PROJECT, GROUP_LEAD, "groupLead", fixture.groups.g1 ?? null);
}, HOOK_TIMEOUT_MS);

async function addParticipant(groupId: string, contact: string) {
  const out = await roster.upsert(orgId, PROJECT, HOST, [
    {
      participantId: `pp-${contact}`,
      contactKind: "phone",
      contact,
      masked: `138 •••• ${contact.slice(-4)}`,
      projectRole: "member",
      groupId,
    },
  ]);
  return out.created[0]!;
}

function board(actorId: string, projectRole: string | null, groupId: string | null = null) {
  return getCheckinBoard(
    { liveSessions, ids },
    readerCtx({ orgId: ORG, projectId: PROJECT, actorId, projectRole, groupId }),
  );
}

describe("到场回写：未到 → 已到，且本组 / 全场计数同步刷新", () => {
  it("签到前 present=0；recordCheckIn 后该人变 present，本组与全场计数都 +1", async () => {
    const p1 = await addParticipant(fixture.groups.g1!, "13800001111");
    const p2 = await addParticipant(fixture.groups.g1!, "13800002222");
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

    const before = await board(HOST, "facilitator");
    const g1Before = before.groups.find((g) => g.groupId === fixture.groups.g1);
    expect(g1Before?.present).toBe(0);
    expect(g1Before?.total).toBe(2);
    expect(before.overall.present).toBe(0);
    expect(before.overall.total).toBe(2);
    // 未签到者的 roster 条目恒 absent（还没有任何写操作把它翻成 present）。
    expect(g1Before?.roster.every((r) => r.attendance === "absent")).toBe(true);

    await recordCheckIn(
      { liveSessions },
      {
        orgId,
        projectId: PROJECT,
        participantId: p1.participantId,
        linkId: link.linkId,
        guestIdentityId: `guest-${p1.participantId}`,
        groupId: fixture.groups.g1!,
        currentStageId: "stage-1",
      },
    );

    const after = await board(HOST, "facilitator");
    const g1After = after.groups.find((g) => g.groupId === fixture.groups.g1);
    expect(g1After?.present).toBe(1);
    expect(g1After?.total).toBe(2);
    expect(after.overall.present).toBe(1);
    expect(after.overall.total).toBe(2);
    expect(g1After?.roster.some((r) => r.attendance === "present")).toBe(true);

    // p2 未签到，仍是 absent —— 回写只影响真正签到的那一人。
    void p2;
  });

  it("同一名单条目重复签到（掉线重连）不产生第二条在场记录——present 计数不重复累加", async () => {
    const p1 = await addParticipant(fixture.groups.g1!, "13800003333");
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

    const checkInOnce = () =>
      recordCheckIn(
        { liveSessions },
        {
          orgId,
          projectId: PROJECT,
          participantId: p1.participantId,
          linkId: link.linkId,
          guestIdentityId: `guest-${p1.participantId}`,
          groupId: fixture.groups.g1!,
          currentStageId: "stage-1",
        },
      );

    const first = await checkInOnce();
    const second = await checkInOnce();
    // 幂等：命中同一条在场会话，不是两条。
    expect(second.sessionId).toBe(first.sessionId);

    const out = await board(HOST, "facilitator");
    expect(out.groups.find((g) => g.groupId === fixture.groups.g1)?.present).toBe(1);
  });

  it("组长只见本组：g2 不出现在组长读到的 groups 里", async () => {
    await addParticipant(fixture.groups.g1!, "13800004444");
    await addParticipant(fixture.groups.g2!, "13800005555");

    const out = await board(GROUP_LEAD, "groupLead", fixture.groups.g1 ?? null);
    expect(out.groups.map((g) => g.groupId)).toEqual([fixture.groups.g1]);
  });

  it("不在项目里的人读签到板被拒", async () => {
    await expect(board("u-stranger", null)).rejects.toBeInstanceOf(OrgAdminError);
    await expect(board("u-stranger", null)).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });

  it("契约响应形状：groups[].roster / links 与 overall 都过 safeParse", async () => {
    await addParticipant(fixture.groups.g1!, "13800006666");
    await issueInviteLink(
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
    const out = await board(HOST, "facilitator");
    const parsed = C.operations.getCheckinBoard.out.safeParse({
      groups: out.groups.map((g) => ({
        groupId: g.groupId,
        title: g.title,
        present: g.present,
        total: g.total,
        links: g.links.map((l) => ({ url: l.url, qrPayload: l.qrPayload })),
        roster: g.roster.map((r) => ({ alias: r.alias, attendance: r.attendance })),
      })),
      overall: out.overall,
      realtime: out.realtime,
    });
    expect(parsed.success).toBe(true);
  });
});

/**
 * ⚠ 反证：一个恒 `success: true` 的 schema 会让上面那条 safeParse 断言空转。
 */
describe("反证：getCheckinBoard.out 确实会拒绝漂移的响应体", () => {
  it("拒绝负数 present/total，拒绝多字段", () => {
    const good = {
      groups: [
        {
          groupId: "g1",
          title: "第一组",
          present: 0,
          total: 0,
          links: [],
          roster: [],
        },
      ],
      overall: { present: 0, total: 0 },
      realtime: false,
    };
    expect(C.operations.getCheckinBoard.out.safeParse(good).success).toBe(true);
    expect(
      C.operations.getCheckinBoard.out.safeParse({
        ...good,
        overall: { present: -1, total: 0 },
      }).success,
    ).toBe(false);
    expect(
      C.operations.getCheckinBoard.out.safeParse({ ...good, surprise: 1 }).success,
    ).toBe(false);
  });
});
