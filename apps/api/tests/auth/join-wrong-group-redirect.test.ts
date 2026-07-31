/**
 * F13 意外①：打开别组链接不报错——按名单跳回本人所属组并提示「你在第 N 组」（AC3）。
 *
 * ⚠ 这条判定本身**由 F12 `JoinByGroupLink` 落地**（I-20：落地组号恒取名单条目的
 *   `groupId`，与链接自带的组号无关），`join-token-phone-roster.test.ts` 的第一个
 *   describe 块已经断言过同一件事。F13 在此另开一个文件的理由是 usecases.md 把
 *   「三种意外」列为**三条独立验收线索**（R11：「三种意外各自独立验收」），
 *   这里是它在测试文件层面的落点，而不是重新发明一套判定逻辑。
 *
 * ⚠ **不报错**是这条验收的核心：断言的是 `resolves`（正常返回一个 grant），
 *   不是某个特定的错误码——打开别组链接在契约里**根本不是一种失败**。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgAdmin as C } from "@repo/contracts";
import { joinByGroupLink } from "../../src/application/auth/join-by-group-link";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { facilitator, fixedIds, newDb, repos, toOrgId } from "../support/join";

const ORG = "org-f13-wrong-group";
const PROJECT = `${ORG}-p`;
const HOST = "u-f13-wrong-group-host";
const HOOK_TIMEOUT_MS = 60_000;

// 名单登记的是第 2 组，但拿到手上的是第 1 组的链接——AC3 的道具。
const PHONE = "+86 139-0000-3057";
const PHONE_NORMALIZED = "8613900003057";

let db: PgDatabase;
let R: ReturnType<typeof repos>;
let fixture: Awaited<ReturnType<typeof seedOrg>>;

const orgId = toOrgId(ORG);
const guestIds = fixedIds("gi-f13-wrong-group");

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
  fixture = await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1", "g2", "g3"] });
  await addOrgMember(ORG, HOST, "consultant", null);
  await addProjectMember(ORG, PROJECT, HOST, "facilitator", null, true);
}, HOOK_TIMEOUT_MS);

describe("F13 意外①：打开别组链接（第 1 组的链接，名单里是第 3 组）", () => {
  it("不报错，落地在名单所属的第 3 组，且 redirectedFromLinkGroup=true", async () => {
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
        participantId: "pp-f13-wrong-group-1",
        contactKind: "phone",
        contact: PHONE_NORMALIZED,
        masked: "139 •••• 3057",
        projectRole: "member",
        groupId: fixture.groups.g3 ?? null,
      },
    ]);

    // 打开的是第 1 组的链接——本次调用**不 reject**。
    const out = await joinByGroupLink(
      { repo: R.join, newGuestIdentityId: guestIds.next },
      { linkToken: link.token, phone: PHONE, existingSessionId: null },
    );

    expect(out.groupId).toBe(fixture.groups.g3);
    expect(out.groupId).not.toBe(fixture.groups.g1);
    expect(out.redirectedFromLinkGroup).toBe(true);

    const parsed = C.operations.joinByGroupLink.out.safeParse(out);
    expect(parsed.success).toBe(true);
  });

  it("同一手机号打开自己所属组的链接：redirectedFromLinkGroup=false（对照组）", async () => {
    const link = await issueInviteLink(
      { repo: R.links },
      {
        orgId,
        projectId: PROJECT,
        kind: "group",
        groupId: fixture.groups.g3 ?? null,
        identity: "member",
        validity: "7d",
        ...facilitator(HOST),
      },
    );
    await R.roster.upsert(orgId, PROJECT, HOST, [
      {
        participantId: "pp-f13-wrong-group-2",
        contactKind: "phone",
        contact: PHONE_NORMALIZED,
        masked: "139 •••• 3057",
        projectRole: "member",
        groupId: fixture.groups.g3 ?? null,
      },
    ]);

    const out = await joinByGroupLink(
      { repo: R.join, newGuestIdentityId: guestIds.next },
      { linkToken: link.token, phone: PHONE, existingSessionId: null },
    );

    expect(out.groupId).toBe(fixture.groups.g3);
    expect(out.redirectedFromLinkGroup).toBe(false);
  });
});
