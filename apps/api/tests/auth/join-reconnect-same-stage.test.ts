/**
 * F13 意外③：掉线 / 换设备重开链接 —— 回到同一组、同一环节，本组产出不丢；
 * 换设备接管后旧设备会话立即失效（UC-1.2 R4，I-23）。
 *
 * ⚠ **不依赖浏览器 Cookie**（I-23 逐字）：`resumeLiveSession` 的输入是
 *   `{linkToken, phone, code, deviceId}`，与 F12 `joinByGroupLink` 判定同一份
 *   「令牌有效 ∧ 手机号在名单」，本文件不重新断言那一半（见 `join-wrong-group-redirect
 *   .test.ts` 与 `join-token-phone-roster.test.ts`），只断言「重开」特有的行为：
 *   ① 同一 guestIdentityId / groupId 被找回 ② 底层 `live_sessions` 行的
 *   `entered_at_stage_id` / `group_id` 原封不动（「产出不丢」在数据层的意思）
 *   ③ 换了 deviceId ⇒ `takeoverOf` 回填旧设备 id ④ 同一 deviceId 重连 ⇒
 *   `takeoverOf` 为 null（不是每次重连都算一次接管）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgAdmin as C } from "@repo/contracts";
import { joinByGroupLink } from "../../src/application/auth/join-by-group-link";
import { resumeLiveSession } from "../../src/application/auth/resume-live-session";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import { recordCheckIn } from "../../src/application/auth/record-check-in";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { facilitator, fixedIds, newDb, repos, toOrgId } from "../support/join";

const ORG = "org-f13-reconnect";
const PROJECT = `${ORG}-p`;
const HOST = "u-f13-reconnect-host";
const HOOK_TIMEOUT_MS = 60_000;

const PHONE = "+86 135-0000-6203";
const PHONE_NORMALIZED = "8613500006203";
const PARTICIPANT_ID = "pp-f13-reconnect-1";
const STAGE_ID = "stage-3";

let db: PgDatabase;
let R: ReturnType<typeof repos>;
let fixture: Awaited<ReturnType<typeof seedOrg>>;

const orgId = toOrgId(ORG);
const guestIds = fixedIds("gi-f13-reconnect");

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = newDb();
  R = repos(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  fixture = await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1", "g2"] });
  await addOrgMember(ORG, HOST, "consultant", null);
  await addProjectMember(ORG, PROJECT, HOST, "facilitator", null, true);
}, HOOK_TIMEOUT_MS);

/** 走一遍「已经进过场，且已经推进到环节 3」的前置状态。 */
async function joinAndAdvanceToStage3() {
  const link = await issueInviteLink(
    { repo: R.links },
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
  await R.roster.upsert(orgId, PROJECT, HOST, [
    {
      participantId: PARTICIPANT_ID,
      contactKind: "phone",
      contact: PHONE_NORMALIZED,
      masked: "135 •••• 6203",
      projectRole: "member",
      groupId: fixture.groups.g1 ?? null,
    },
  ]);
  const joined = await joinByGroupLink(
    { repo: R.join, newGuestIdentityId: guestIds.next },
    { linkToken: link.token, phone: PHONE, existingSessionId: null },
  );
  await recordCheckIn(
    { liveSessions: R.liveSessions },
    {
      orgId,
      projectId: PROJECT,
      participantId: PARTICIPANT_ID,
      linkId: link.linkId,
      guestIdentityId: joined.guestIdentityId,
      groupId: fixture.groups.g1 ?? null,
      currentStageId: STAGE_ID,
    },
  );
  return { link, joined };
}

async function readLiveSessionRow() {
  return asApp(ORG, async (c) => {
    const res = await c.query<{ entered_at_stage_id: string | null; group_id: string | null; device_id: string | null }>(
      `SELECT entered_at_stage_id, group_id, device_id FROM live_sessions
         WHERE project_id = $1 AND participant_id = $2 AND ended_at IS NULL`,
      [PROJECT, PARTICIPANT_ID],
    );
    return res.rows[0];
  });
}

describe("① 掉线重开：回到同一组、同一环节，产出不丢", () => {
  it("resumeLiveSession 返回同一 guestIdentityId / groupId，底层会话的 stage/group 原封不动", async () => {
    const { link, joined } = await joinAndAdvanceToStage3();
    const before = await readLiveSessionRow();
    expect(before?.entered_at_stage_id).toBe(STAGE_ID);
    expect(before?.group_id).toBe(fixture.groups.g1);

    const resumed = await resumeLiveSession(
      { repo: R.join },
      { linkToken: link.token, phone: PHONE, code: "123456", deviceId: "device-old" },
    );

    expect(resumed.guestIdentityId).toBe(joined.guestIdentityId);
    expect(resumed.groupId).toBe(fixture.groups.g1);

    const after = await readLiveSessionRow();
    expect(after?.entered_at_stage_id).toBe(before?.entered_at_stage_id);
    expect(after?.group_id).toBe(before?.group_id);
    expect(after?.device_id).toBe("device-old");

    const parsed = C.operations.resumeLiveSession.out.safeParse(resumed);
    expect(parsed.success).toBe(true);
  });
});

describe("② 换设备：旧设备被接管失效，takeoverOf 回填旧 deviceId", () => {
  it("先用 device-A 重连，再用 device-B 重连 ⇒ takeoverOf = device-A", async () => {
    const { link } = await joinAndAdvanceToStage3();

    const first = await resumeLiveSession(
      { repo: R.join },
      { linkToken: link.token, phone: PHONE, code: "123456", deviceId: "device-A" },
    );
    expect(first.takeoverOf).toBeNull();

    const second = await resumeLiveSession(
      { repo: R.join },
      { linkToken: link.token, phone: PHONE, code: "123456", deviceId: "device-B" },
    );
    expect(second.takeoverOf).toBe("device-A");

    const after = await readLiveSessionRow();
    expect(after?.device_id).toBe("device-B");
  });

  it("同一设备重连：takeoverOf 为 null（不是每次重连都算接管）", async () => {
    const { link } = await joinAndAdvanceToStage3();

    await resumeLiveSession(
      { repo: R.join },
      { linkToken: link.token, phone: PHONE, code: "123456", deviceId: "device-same" },
    );
    const second = await resumeLiveSession(
      { repo: R.join },
      { linkToken: link.token, phone: PHONE, code: "123456", deviceId: "device-same" },
    );
    expect(second.takeoverOf).toBeNull();
  });
});

describe("③ 尚未进过场时调用 ResumeLiveSession（无在场会话）", () => {
  it("返回 PHONE_NOT_ON_ROSTER——这不是重开场景，应走 JoinByGroupLink 初次进场", async () => {
    const link = await issueInviteLink(
      { repo: R.links },
      {
        orgId,
        projectId: PROJECT,
        kind: "group",
        groupId: fixture.groups.g2 ?? null,
        identity: "member",
        validity: "7d",
        ...facilitator(HOST),
      },
    );
    await R.roster.upsert(orgId, PROJECT, HOST, [
      {
        participantId: "pp-f13-reconnect-never-joined",
        contactKind: "phone",
        contact: "8613500009999",
        masked: "135 •••• 9999",
        projectRole: "member",
        groupId: fixture.groups.g2 ?? null,
      },
    ]);

    await expect(
      resumeLiveSession(
        { repo: R.join },
        { linkToken: link.token, phone: "13500009999", code: "123456", deviceId: "device-x" },
      ),
    ).rejects.toBeInstanceOf(OrgAdminError);
    await expect(
      resumeLiveSession(
        { repo: R.join },
        { linkToken: link.token, phone: "13500009999", code: "123456", deviceId: "device-x" },
      ),
    ).rejects.toMatchObject({ reasonCode: "PHONE_NOT_ON_ROSTER" });
  });
});

/**
 * ⚠ 反证：上面 `safeParse(...).success === true` 会不会是空转？
 */
describe("反证：resumeLiveSession.out 确实会拒绝漂移的响应体", () => {
  it("拒绝多字段、拒绝缺字段", () => {
    const good = {
      guestIdentityId: "gi-1",
      groupId: "g-1",
      stage: { id: "s-1", index: 0, total: 1 },
      takeoverOf: null,
    };
    expect(C.operations.resumeLiveSession.out.safeParse(good).success).toBe(true);
    expect(C.operations.resumeLiveSession.out.safeParse({ ...good, surprise: 1 }).success).toBe(false);
    const { groupId: _drop, ...missing } = good;
    expect(C.operations.resumeLiveSession.out.safeParse(missing).success).toBe(false);
  });
});
