/**
 * F11 — 配额用尽硬阻断（O-29 ⑤ / I-9）。phase-01 `org-admin` · usecases.md `InviteOrgMember`。
 *
 * ⚠ **本文件按 worker 交接说明未在本地执行**（需要 Postgres）；已跑
 * `pnpm --filter api run typecheck`，请 coordinator 在隔离环境里跑一次真实断言。
 *
 * ## I-9 的字面意思：不产生任何 OrgInvite 行
 *
 * 最容易写错的版本是「先插入邀请行，再判断额度不够，事后再补一条报错」——那样即便
 * API 响应是 `QUOTA_EXHAUSTED`，`org_invites` 表已经多了一行幽灵记录。本文件第一个
 * `it` 之后专门去数 `org_invites` 的行数，断言用尽时**行数完全不变**，不是只断言
 * "调用抛错"这个更容易被弱实现蒙混过去的表面现象。
 *
 * ## 为什么用 COUNT-based 账本而不是一个显式的 seats_used 列
 *
 * `usedSeats = count(org_memberships) + count(未失效 org_invites)`——这条断言顺带
 * 验证了这一点：占用一个座位的既不是"成员"也不是"待接受邀请"单独一种，是两者之和。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inviteOrgMember } from "../../src/application/auth/invite-org-member";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import { PgOrgInviteRepository } from "../../src/infrastructure/auth/pg-org-invite-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-f11-quota";
const ADMIN = "u-f11-quota-admin";

const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: PgOrgInviteRepository;

async function setSeatQuota(orgId: string, n: number): Promise<void> {
  await asApp(orgId, (c) => c.query("UPDATE organizations SET seat_quota = $2 WHERE id = $1", [orgId, n]));
}

async function inviteRowCount(orgId: string): Promise<number> {
  const row = await asOwner((c) =>
    c.query<{ n: string }>("SELECT count(*)::text AS n FROM org_invites WHERE org_id = $1", [orgId]),
  );
  return Number(row.rows[0]?.n ?? 0);
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgOrgInviteRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  // ⚠ 本文件是唯一需要**真实生产默认值**（0）的地方，所以显式传 `seatQuota: 0`，
  // 不依赖 `seedOrg` 给其余测试文件的那个宽松默认值（1000，见 `tests/support/db.ts`
  // 的注释——那个默认值本身就是「F11 落地那天，所有不关心配额的既有 fixture 突然
  // 被 QUOTA_EXHAUSTED 挡住」这个真实回归的修复）。
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p`, seatQuota: 0 });
  await addOrgMember(ORG, ADMIN, "admin", null);
});

describe("组织未分配额度（默认 0）时硬阻断", () => {
  it("seat_quota=0（缺省）时任何邀请一律 QUOTA_EXHAUSTED，且不产生任何 OrgInvite 行", async () => {
    const before = await inviteRowCount(ORG);
    await expect(
      inviteOrgMember(
        { repo },
        {
          orgId: toOrgId(ORG),
          actorId: ADMIN,
          actorOrgRole: "admin",
          email: "blocked@f11quota.test",
          orgRole: "consultant",
          teamId: null,
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "QUOTA_EXHAUSTED" } satisfies Partial<OrgAdminError>);
    expect(await inviteRowCount(ORG)).toBe(before);
  });

  it("恢复额度后同一邀请成功（I-9 逐字：置零后拒绝，恢复后成功）", async () => {
    // 配额=2，不是 1：ADMIN 本人（beforeEach 里 addOrgMember）已占一个座位。
    await setSeatQuota(ORG, 2);
    const out = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(ORG),
        actorId: ADMIN,
        actorOrgRole: "admin",
        email: "recovers@f11quota.test",
        orgRole: "consultant",
        teamId: null,
      },
    );
    expect(out.status).toBe("pending");
    expect(out.quotaReserved).toBe(1);
  });
});

describe("配额用尽的边界——恰好用满", () => {
  // ⚠ 配额=2，不是 1：`beforeEach`（外层）已经把 ADMIN 本人加进了 `org_memberships`，
  // 他自己就占了一个座位。座位数 = count(成员) + count(未失效邀请)，
  // 这条注释本身就是"成员也占座位"这条断言的原因——见本 describe 最后一个 `it`。
  beforeEach(async () => {
    await setSeatQuota(ORG, 2);
  });

  it("第一个邀请用满剩下的座位，第二个不同邮箱的邀请被硬阻断", async () => {
    const first = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(ORG),
        actorId: ADMIN,
        actorOrgRole: "admin",
        email: "first@f11quota.test",
        orgRole: "consultant",
        teamId: null,
      },
    );
    expect(first.quotaReserved).toBe(1);

    const before = await inviteRowCount(ORG);
    await expect(
      inviteOrgMember(
        { repo },
        {
          orgId: toOrgId(ORG),
          actorId: ADMIN,
          actorOrgRole: "admin",
          email: "second@f11quota.test",
          orgRole: "consultant",
          teamId: null,
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "QUOTA_EXHAUSTED" } satisfies Partial<OrgAdminError>);
    expect(await inviteRowCount(ORG)).toBe(before);
  });

  it("幂等重放不占用第二个座位：同一 (org,email,orgRole,teamId) 重复提交返回既有邀请、quotaReserved=0", async () => {
    const first = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(ORG),
        actorId: ADMIN,
        actorOrgRole: "admin",
        email: "replay@f11quota.test",
        orgRole: "consultant",
        teamId: null,
      },
    );
    const replay = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(ORG),
        actorId: ADMIN,
        actorOrgRole: "admin",
        email: "replay@f11quota.test",
        orgRole: "consultant",
        teamId: null,
      },
    );
    expect(replay.inviteId).toBe(first.inviteId);
    expect(replay.quotaReserved).toBe(0);
    // 座位仍然只用了一个——第三个邀请（不同邮箱）应当仍被阻断，证明重放没有偷偷多占一个位置。
    await expect(
      inviteOrgMember(
        { repo },
        {
          orgId: toOrgId(ORG),
          actorId: ADMIN,
          actorOrgRole: "admin",
          email: "third@f11quota.test",
          orgRole: "consultant",
          teamId: null,
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "QUOTA_EXHAUSTED" } satisfies Partial<OrgAdminError>);
  });

  it("已是组织成员的人也占一个座位——quota 收紧到 1 时，仅有的那名管理员已经用满它", async () => {
    // ADMIN 本人已经是成员（外层 beforeEach 里 addOrgMember）。把配额收紧到 1，
    // usedSeats(=1，仅 ADMIN 一人) >= seatQuota(=1)：任何新邀请都该被阻断——
    // 这条断言的重点是"成员也计入座位"，不是"邀请计入座位"（后者已由前两个 it 覆盖）。
    await setSeatQuota(ORG, 1);
    await expect(
      inviteOrgMember(
        { repo },
        {
          orgId: toOrgId(ORG),
          actorId: ADMIN,
          actorOrgRole: "admin",
          email: "no-room@f11quota.test",
          orgRole: "consultant",
          teamId: null,
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "QUOTA_EXHAUSTED" } satisfies Partial<OrgAdminError>);
  });
});
