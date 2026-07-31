/**
 * F12 反向断言面：**I-18 —— 走完整条进场流程，不产生任何 `credentials` 行**。
 *
 * 「不建账号」唯一能被机械证明的形态就是去数一遍这张表（AC1 / V1，
 * contract-design.md「不变量要能写成断言」）。一个只看「界面上没有跳注册页」的实现
 * 同样能通过用户观感，而背地里插了一行 `credentials`——只有数据库层面的断言拦得住。
 *
 * ⚠ 断言按**免注册身份 id 精确定位**，不做全局行数前后比对：`credentials` 表没有
 *   `org_id`（0010 文件头：账号先于组织存在），全局计数会与同一数据库上并发跑的
 *   其他测试文件互相打架（本仓 vitest 按文件并行）。而 I-18 真正要证明的是
 *   **这一次进场没有产生一行以这个免注册身份 id 为键的 credentials**——
 *   `credentials.user_id` 若真的因为一次「不建账号」的进场而多出一行，
 *   它唯一可能的键就是这次调用生成的 `guestIdentityId`，按这个键查询是
 *   全局计数的一个更精确、且对并发免疫的等价证明。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { joinByGroupLink } from "../../src/application/auth/join-by-group-link";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { addOrgMember, addProjectMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { facilitator, fixedIds, newDb, repos, toOrgId } from "../support/join";

const ORG = "org-f12-no-account";
const PROJECT = `${ORG}-p`;
const HOST = "u-f12-no-account-host";
const HOOK_TIMEOUT_MS = 60_000;

const PHONE = "13800009999";

let db: PgDatabase;
let R: ReturnType<typeof repos>;
let fixture: Awaited<ReturnType<typeof seedOrg>>;

const orgId = toOrgId(ORG);
const guestIds = fixedIds("gi-f12-no-account");

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
  fixture = await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1"] });
  await addOrgMember(ORG, HOST, "consultant", null);
  await addProjectMember(ORG, PROJECT, HOST, "facilitator", null, true);
}, HOOK_TIMEOUT_MS);

/** 这个 id（或候选 id）名下，`credentials` 里有没有一行。 */
async function hasCredentialFor(userId: string): Promise<boolean> {
  return asOwner(async (c) => {
    const res = await c.query("SELECT 1 FROM credentials WHERE user_id = $1", [userId]);
    return res.rows.length > 0;
  });
}

describe("I-18：进场不产生任何 credentials 行", () => {
  it("成功进场：新建的免注册身份 id 名下没有 credentials 行", async () => {
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
        participantId: "pp-f12-no-account-1",
        contactKind: "phone",
        contact: PHONE,
        masked: "138 •••• 9999",
        projectRole: "member",
        groupId: fixture.groups.g1 ?? null,
      },
    ]);

    const out = await joinByGroupLink(
      { repo: R.join, newGuestIdentityId: guestIds.next },
      { linkToken: link.token, phone: PHONE, existingSessionId: null },
    );
    expect(out.guestIdentityId.length).toBeGreaterThan(0);

    // I-18 的直接证据：走完整条进场流程后，这个免注册身份的 id
    // ——而不是别的什么派生 id——在 credentials 里查不到任何一行。
    expect(await hasCredentialFor(out.guestIdentityId)).toBe(false);
  });

  it("被拒的进场（手机号不在名单）：连候选 id 名下都没有 credentials 行", async () => {
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

    const candidateId = guestIds.next();

    await expect(
      joinByGroupLink(
        { repo: R.join, newGuestIdentityId: () => candidateId },
        { linkToken: link.token, phone: "19999998888", existingSessionId: null },
      ),
    ).rejects.toMatchObject({ reasonCode: "PHONE_NOT_ON_ROSTER" });

    expect(await hasCredentialFor(candidateId)).toBe(false);
  });
});
