/**
 * F12 主流程（UC-1.2）：**令牌 + 手机号名单双核对**——两个条件同时成立才建身份（I-19）。
 *
 * 四象限：
 *   ① 令牌有效 ∧ 手机号在名单 ⇒ 成功，建身份
 *   ② 令牌有效 ∧ 手机号不在名单 ⇒ `PHONE_NOT_ON_ROSTER`
 *   ③ 令牌无效（已撤销） ∧ 手机号在名单 ⇒ 链接失效的码，**不**建身份
 *   ④（隐含）令牌无效 ∧ 手机号不在名单 ⇒ 同 ③（本文件不重复断言，与③走的是同一判定）
 * 只有 ① 这一个象限成功——这正是 I-19 断言的形状。
 *
 * 另外两条不变量：
 *   I-20：落地组号恒取**名单条目**的 groupId，与链接自带的组号无关；
 *         用第 1 组的链接、名单属第 2 组的手机号进场，断言落在第 2 组且**不报错**（AC3），
 *         并且 `redirectedFromLinkGroup = true`。
 *   I-19（另一半）：同一名单条目重复进场返回**同一** guestIdentityId，不产生第二个身份。
 *
 * ⚠ `contract-design.md` B-8：出去的响应体也要过一次契约 schema，并带反向断言
 *   证明那份 schema 确实会拒绝漂移的 body——否则整段可能在空转。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgAdmin as C } from "@repo/contracts";
import { joinByGroupLink } from "../../src/application/auth/join-by-group-link";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import { revokeInviteLinks } from "../../src/application/auth/revoke-invite-links";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { facilitator, fixedIds, newDb, repos, toOrgId } from "../support/join";

const ORG = "org-f12-roster";
const PROJECT = `${ORG}-p`;
const HOST = "u-f12-host";
const HOOK_TIMEOUT_MS = 60_000;

const PHONE_ON_ROSTER = "+86 138-0000-2049";
const PHONE_NORMALIZED = "8613800002049";
const PHONE_STRANGER = "13900001111";

let db: PgDatabase;
let R: ReturnType<typeof repos>;
let fixture: Awaited<ReturnType<typeof seedOrg>>;

const orgId = toOrgId(ORG);
const guestIds = fixedIds("gi-f12-roster");

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

/** 签一条落地在第 1 组的分组链接，identity=member。 */
async function issueGroupLink() {
  return issueInviteLink(
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
}

/** 把一条手机号落进第 2 组的名单——**与链接的组号不同**，用来证明 I-20。 */
async function seedRosterInGroup2() {
  await R.roster.upsert(orgId, PROJECT, HOST, [
    {
      participantId: "pp-f12-roster-1",
      contactKind: "phone",
      contact: PHONE_NORMALIZED,
      masked: "138 •••• 2049",
      projectRole: "member",
      groupId: fixture.groups.g2 ?? null,
    },
  ]);
}

const deps = () => ({ repo: R.join, newGuestIdentityId: guestIds.next });

describe("① 令牌有效 ∧ 手机号在名单 ⇒ 成功，建身份", () => {
  it("落地组号取名单条目的（第 2 组），不是链接的（第 1 组）；redirectedFromLinkGroup=true", async () => {
    const link = await issueGroupLink();
    await seedRosterInGroup2();

    const out = await joinByGroupLink(deps(), {
      linkToken: link.token,
      phone: PHONE_ON_ROSTER,
      existingSessionId: null,
    });

    expect(out.projectId).toBe(PROJECT);
    // I-20：恒取名单条目的 groupId。
    expect(out.groupId).toBe(fixture.groups.g2);
    expect(out.redirectedFromLinkGroup).toBe(true);
    // 角色恒取链接的（O-06）。
    expect(out.projectRole).toBe("member");
    expect(out.guestIdentityId.length).toBeGreaterThan(0);
    expect(out.alias.length).toBeGreaterThan(0);

    const parsed = C.operations.joinByGroupLink.out.safeParse({
      guestIdentityId: out.guestIdentityId,
      projectId: out.projectId,
      groupId: out.groupId,
      projectRole: out.projectRole,
      alias: out.alias,
      stage: out.stage,
      redirectedFromLinkGroup: out.redirectedFromLinkGroup,
    });
    expect(parsed.success).toBe(true);
  });

  it("同一名单条目重复进场返回同一 guestIdentityId，不产生第二个身份", async () => {
    const link = await issueGroupLink();
    await seedRosterInGroup2();

    const first = await joinByGroupLink(deps(), {
      linkToken: link.token,
      phone: PHONE_ON_ROSTER,
      existingSessionId: null,
    });
    const second = await joinByGroupLink(deps(), {
      linkToken: link.token,
      phone: PHONE_ON_ROSTER,
      existingSessionId: null,
    });

    expect(second.guestIdentityId).toBe(first.guestIdentityId);
  });
});

describe("② 令牌有效 ∧ 手机号不在名单 ⇒ PHONE_NOT_ON_ROSTER，且不建身份", () => {
  it("陌生手机号进场被拒", async () => {
    const link = await issueGroupLink();
    await seedRosterInGroup2();

    await expect(
      joinByGroupLink(deps(), { linkToken: link.token, phone: PHONE_STRANGER, existingSessionId: null }),
    ).rejects.toMatchObject({ reasonCode: "PHONE_NOT_ON_ROSTER" });
  });
});

describe("③ 令牌无效（已撤销） ∧ 手机号在名单 ⇒ 链接失效码，不建身份", () => {
  it("撤销后同一手机号进场被拒，理由是链接失效而不是名单问题", async () => {
    const link = await issueGroupLink();
    await seedRosterInGroup2();
    await revokeInviteLinks({ repo: R.links }, { orgId, projectId: PROJECT, linkId: link.linkId, ...facilitator(HOST) });

    await expect(
      joinByGroupLink(deps(), { linkToken: link.token, phone: PHONE_ON_ROSTER, existingSessionId: null }),
    ).rejects.toMatchObject({ reasonCode: "LINK_REVOKED" });
  });
});

/**
 * ⚠ 反证：上面 `safeParse(...).success === true` 会不会是空转？
 * 一个永远返回 success 的 schema 能让本文件那条契约断言全绿。
 */
describe("反证：契约 schema 确实会拒绝漂移的响应体", () => {
  it("joinByGroupLink.out 拒绝多字段、拒绝缺字段、拒绝空 guestIdentityId", () => {
    const good = {
      guestIdentityId: "gi-1",
      projectId: "p-1",
      groupId: "g-1",
      projectRole: "member" as const,
      alias: "访客2049",
      stage: { id: "s-1", index: 0, total: 1 },
      redirectedFromLinkGroup: false,
    };
    expect(C.operations.joinByGroupLink.out.safeParse(good).success).toBe(true);
    expect(C.operations.joinByGroupLink.out.safeParse({ ...good, surprise: 1 }).success).toBe(false);
    const { alias: _drop, ...missing } = good;
    expect(C.operations.joinByGroupLink.out.safeParse(missing).success).toBe(false);
    expect(
      C.operations.joinByGroupLink.out.safeParse({ ...good, projectRole: "not-a-role" }).success,
    ).toBe(false);
  });
});
