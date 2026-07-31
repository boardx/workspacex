/**
 * F13 意外②：名单外访客申请加入 → 引导师「分组与签到」出现待批 → 批准前访客读不到
 * 任何内容（I-21）→ 批准后刷新即进场；拒绝则明确告知（UC-1.2 R4）。
 *
 * 断言顺序即验收顺序：
 *   ① 陌生手机号申请 ⇒ 待批单据，**不**建身份、**不**建名单条目
 *   ② 批准前：同一手机号走 `JoinByGroupLink` 仍是 `PHONE_NOT_ON_ROSTER`——
 *      I-21 的断言形式是「返回 0 行」（这里投影为「查不到名单条目」），不是「界面没渲染」
 *   ③ 引导师批准并指定组号 ⇒ 单据转 approved；此后同一手机号能正常进场，且落在
 *      引导师指定的那一组
 *   ④ 拒绝分支：单据转 rejected，且该手机号此后仍然进不了场
 *   ⑤ 幂等：重复申请返回同一 applicationId，不产生第二条待批单据
 *   ⑥ 越权：非引导师批准被拒
 *
 * ⚠ `contract-design.md` B-8：出去的响应体也要过一次契约 schema，并配反向断言
 *   证明 schema 确实会拒绝漂移的 body。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgAdmin as C } from "@repo/contracts";
import { applyForJoin } from "../../src/application/auth/apply-for-join";
import { reviewJoinApplication } from "../../src/application/auth/review-join-application";
import { joinByGroupLink } from "../../src/application/auth/join-by-group-link";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { facilitator, fixedIds, newDb, repos, toOrgId } from "../support/join";

const ORG = "org-f13-apply";
const PROJECT = `${ORG}-p`;
const HOST = "u-f13-apply-host";
const STRANGER_MEMBER = "u-f13-apply-stranger-member";
const HOOK_TIMEOUT_MS = 60_000;

const PHONE = "+86 137-0000-4091";
const PHONE_NORMALIZED = "8613700004091";
const OTHER_PHONE = "13700005082";

let db: PgDatabase;
let R: ReturnType<typeof repos>;
let fixture: Awaited<ReturnType<typeof seedOrg>>;

const orgId = toOrgId(ORG);
const appIds = fixedIds("app-f13");
const guestIds = fixedIds("gi-f13-apply");
const participantIds = fixedIds("pp-f13-apply-review");

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
  await addProjectMember(ORG, PROJECT, STRANGER_MEMBER, "member", fixture.groups.g1 ?? null);
}, HOOK_TIMEOUT_MS);

async function issueGroupLink(groupId: string | null) {
  return issueInviteLink(
    { repo: R.links },
    {
      orgId,
      projectId: PROJECT,
      kind: "group",
      groupId,
      identity: "member",
      validity: "7d",
      ...facilitator(HOST),
    },
  );
}

describe("① 陌生手机号申请加入 ⇒ 待批单据，不建身份、不建名单条目", () => {
  it("applyForJoin 返回 pending", async () => {
    const link = await issueGroupLink(fixture.groups.g1 ?? null);

    const out = await applyForJoin(
      { repo: R.joinApplication, newApplicationId: appIds.next },
      { linkToken: link.token, phone: PHONE },
    );

    expect(out.status).toBe("pending");
    expect(out.applicationId.length).toBeGreaterThan(0);

    const parsed = C.operations.applyForJoin.out.safeParse(out);
    expect(parsed.success).toBe(true);
  });
});

describe("② 批准前：该手机号走 JoinByGroupLink 仍是 PHONE_NOT_ON_ROSTER（I-21）", () => {
  it("申请待批期间进场仍被拒——'返回 0 行'落在同一份判定上", async () => {
    const link = await issueGroupLink(fixture.groups.g1 ?? null);
    await applyForJoin(
      { repo: R.joinApplication, newApplicationId: appIds.next },
      { linkToken: link.token, phone: PHONE },
    );

    await expect(
      joinByGroupLink(
        { repo: R.join, newGuestIdentityId: guestIds.next },
        { linkToken: link.token, phone: PHONE, existingSessionId: null },
      ),
    ).rejects.toMatchObject({ reasonCode: "PHONE_NOT_ON_ROSTER" });
  });
});

describe("③ 引导师批准并指定组号 ⇒ 单据 approved，此后该手机号能正常进场", () => {
  it("批准后刷新即进场，落在引导师指定的那一组", async () => {
    const link = await issueGroupLink(fixture.groups.g1 ?? null);
    const applied = await applyForJoin(
      { repo: R.joinApplication, newApplicationId: appIds.next },
      { linkToken: link.token, phone: PHONE },
    );

    const reviewed = await reviewJoinApplication(
      { repo: R.joinApplication, newParticipantId: participantIds.next },
      {
        orgId,
        applicationId: applied.applicationId,
        decision: "approve",
        groupId: fixture.groups.g2 ?? null,
        ...facilitator(HOST),
      },
    );
    expect(reviewed.status).toBe("approved");

    const parsedReview = C.operations.reviewJoinApplication.out.safeParse(reviewed);
    expect(parsedReview.success).toBe(true);

    const joined = await joinByGroupLink(
      { repo: R.join, newGuestIdentityId: guestIds.next },
      { linkToken: link.token, phone: PHONE, existingSessionId: null },
    );
    // 落地组号取的是批准时指定的组（第 2 组），不是链接自带的（第 1 组）——
    // 与 I-20 同一条纪律：进场时刻的落地组恒取名单条目的 groupId。
    expect(joined.groupId).toBe(fixture.groups.g2);
  });
});

describe("④ 拒绝分支：单据 rejected，该手机号此后仍进不了场", () => {
  it("reviewJoinApplication decision=reject", async () => {
    const link = await issueGroupLink(fixture.groups.g1 ?? null);
    const applied = await applyForJoin(
      { repo: R.joinApplication, newApplicationId: appIds.next },
      { linkToken: link.token, phone: OTHER_PHONE },
    );

    const reviewed = await reviewJoinApplication(
      { repo: R.joinApplication, newParticipantId: participantIds.next },
      { orgId, applicationId: applied.applicationId, decision: "reject", groupId: null, ...facilitator(HOST) },
    );
    expect(reviewed.status).toBe("rejected");

    await expect(
      joinByGroupLink(
        { repo: R.join, newGuestIdentityId: guestIds.next },
        { linkToken: link.token, phone: OTHER_PHONE, existingSessionId: null },
      ),
    ).rejects.toMatchObject({ reasonCode: "PHONE_NOT_ON_ROSTER" });
  });
});

describe("⑤ 幂等：重复申请返回同一 applicationId，不产生第二条待批单据", () => {
  it("同一手机号连续两次 applyForJoin", async () => {
    const link = await issueGroupLink(fixture.groups.g1 ?? null);
    const first = await applyForJoin(
      { repo: R.joinApplication, newApplicationId: appIds.next },
      { linkToken: link.token, phone: PHONE },
    );
    const second = await applyForJoin(
      { repo: R.joinApplication, newApplicationId: appIds.next },
      { linkToken: link.token, phone: PHONE },
    );
    expect(second.applicationId).toBe(first.applicationId);
  });
});

describe("⑥ 越权：非引导师批准被拒", () => {
  it("组员调用 reviewJoinApplication 被拒", async () => {
    const link = await issueGroupLink(fixture.groups.g1 ?? null);
    const applied = await applyForJoin(
      { repo: R.joinApplication, newApplicationId: appIds.next },
      { linkToken: link.token, phone: PHONE },
    );

    await expect(
      reviewJoinApplication(
        { repo: R.joinApplication, newParticipantId: participantIds.next },
        {
          orgId,
          applicationId: applied.applicationId,
          decision: "approve",
          groupId: fixture.groups.g1 ?? null,
          actorId: STRANGER_MEMBER,
          actorProjectRole: "member",
        },
      ),
    ).rejects.toBeInstanceOf(OrgAdminError);
    await expect(
      reviewJoinApplication(
        { repo: R.joinApplication, newParticipantId: participantIds.next },
        {
          orgId,
          applicationId: applied.applicationId,
          decision: "approve",
          groupId: fixture.groups.g1 ?? null,
          actorId: STRANGER_MEMBER,
          actorProjectRole: "member",
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
  });
});

/**
 * ⚠ 反证：上面 `safeParse(...).success === true` 会不会是空转？
 */
describe("反证：applyForJoin.out / reviewJoinApplication.out 确实会拒绝漂移的响应体", () => {
  it("applyForJoin.out 拒绝多字段、拒绝非法 status", () => {
    const good = { applicationId: "app-1", status: "pending" as const };
    expect(C.operations.applyForJoin.out.safeParse(good).success).toBe(true);
    expect(C.operations.applyForJoin.out.safeParse({ ...good, surprise: 1 }).success).toBe(false);
    expect(C.operations.applyForJoin.out.safeParse({ ...good, status: "approved-ish" }).success).toBe(false);
  });

  it("reviewJoinApplication.out 拒绝多字段、拒绝非法 status", () => {
    const good = { applicationId: "app-1", status: "approved" as const };
    expect(C.operations.reviewJoinApplication.out.safeParse(good).success).toBe(true);
    expect(C.operations.reviewJoinApplication.out.safeParse({ ...good, surprise: 1 }).success).toBe(false);
    expect(C.operations.reviewJoinApplication.out.safeParse({ ...good, status: "??" }).success).toBe(false);
  });
});
