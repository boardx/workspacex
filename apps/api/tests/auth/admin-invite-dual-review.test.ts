/**
 * F11 — 邀请管理员的双人复核（O-28 ⑥ / UC-1.6 R10）。
 * phase-01 `org-admin` · usecases.md `ReviewAdminInvite`。
 *
 * ⚠ **本文件按 worker 交接说明未在本地执行**（需要 Postgres）；已跑
 * `pnpm --filter api run typecheck`，请 coordinator 在隔离环境里跑一次真实断言。
 *
 * ## 反证怎么戳穿一个"看起来对"的实现
 *
 * 最容易写错的版本是：`orgRole = "admin"` 的邀请照常签发 token，只是界面上多画一个
 * "待复核" 徽标。那个实现下，`inviteOrgMember` 的输出仍然是 `awaiting-review`，
 * 但 `org_invite_tokens` 里已经有一行——本文件第一个 `it` 直接查那张表，
 * 断言在复核之前它是空的（I-3 的字面意思：批准前 token 为 null，不是签了但拦着）。
 *
 * 第二易错版本是"唯一管理员可自批"的退化：本文件 SINGLE-ADMIN 那个 describe
 * 专门构造只有一名管理员的组织，断言那个人对自己发出的邀请调用复核仍然拿到
 * `INVITE_SELF_REVIEW_FORBIDDEN`——而不是因为"没有别人"就悄悄放行。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inviteOrgMember } from "../../src/application/auth/invite-org-member";
import { reviewAdminInvite } from "../../src/application/auth/review-admin-invite";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import { PgOrgInviteRepository } from "../../src/infrastructure/auth/pg-org-invite-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-f11-review";
const SINGLE_ADMIN_ORG = "org-f11-review-solo";
const ADMIN_A = "u-f11-admin-a";
const ADMIN_B = "u-f11-admin-b";
const ADMIN_C = "u-f11-admin-c";

const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: PgOrgInviteRepository;
let fixture: Awaited<ReturnType<typeof seedOrg>>;

async function setSeatQuota(orgId: string, n: number): Promise<void> {
  await asApp(orgId, (c) => c.query("UPDATE organizations SET seat_quota = $2 WHERE id = $1", [orgId, n]));
}

async function tokenCount(inviteId: string): Promise<number> {
  const row = await asOwner((c) =>
    c.query<{ n: string }>("SELECT count(*)::text AS n FROM org_invite_tokens WHERE invite_id = $1", [inviteId]),
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
  await resetOrgs(ORG, SINGLE_ADMIN_ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG, SINGLE_ADMIN_ORG);
  fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await setSeatQuota(ORG, 10);
  await addOrgMember(ORG, ADMIN_A, "admin", null);
  await addOrgMember(ORG, ADMIN_B, "admin", null);
  await addOrgMember(ORG, ADMIN_C, "admin", null);
});

describe("邀请管理员进入待批队列，批准前不签发 token", () => {
  it("orgRole=admin 时返回 awaiting-review 且 org_invite_tokens 里没有任何行（I-3）", async () => {
    const out = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(ORG),
        actorId: ADMIN_A,
        actorOrgRole: "admin",
        email: "candidate@f11review.test",
        orgRole: "admin",
        teamId: null,
      },
    );
    expect(out.status).toBe("awaiting-review");
    expect(out.tokenIssued).toBe(false);
    expect(await tokenCount(out.inviteId)).toBe(0);
  });

  it("发起人不可自批（I-4）", async () => {
    const out = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(ORG),
        actorId: ADMIN_A,
        actorOrgRole: "admin",
        email: "self-review@f11review.test",
        orgRole: "admin",
        teamId: null,
      },
    );
    await expect(
      reviewAdminInvite(
        { repo },
        { orgId: toOrgId(ORG), reviewerId: ADMIN_A, reviewerOrgRole: "admin", inviteId: out.inviteId, decision: "approve" },
      ),
    ).rejects.toMatchObject({ reasonCode: "INVITE_SELF_REVIEW_FORBIDDEN" } satisfies Partial<OrgAdminError>);
  });

  it("approve 后转 pending、签发新 token，且 tokenIssued=true", async () => {
    const out = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(ORG),
        actorId: ADMIN_A,
        actorOrgRole: "admin",
        email: "approved@f11review.test",
        orgRole: "admin",
        teamId: null,
      },
    );
    const reviewed = await reviewAdminInvite(
      { repo },
      { orgId: toOrgId(ORG), reviewerId: ADMIN_B, reviewerOrgRole: "admin", inviteId: out.inviteId, decision: "approve" },
    );
    expect(reviewed).toEqual({ status: "pending", tokenIssued: true });
    expect(await tokenCount(out.inviteId)).toBe(1);
  });

  it("reject 后转 revoked，且不签发 token", async () => {
    const out = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(ORG),
        actorId: ADMIN_A,
        actorOrgRole: "admin",
        email: "rejected@f11review.test",
        orgRole: "admin",
        teamId: null,
      },
    );
    const reviewed = await reviewAdminInvite(
      { repo },
      { orgId: toOrgId(ORG), reviewerId: ADMIN_B, reviewerOrgRole: "admin", inviteId: out.inviteId, decision: "reject" },
    );
    expect(reviewed).toEqual({ status: "revoked", tokenIssued: false });
    expect(await tokenCount(out.inviteId)).toBe(0);
  });

  it("幂等重放：同一 reviewer 重复 approve 返回同一结果，不重复签发 token", async () => {
    const out = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(ORG),
        actorId: ADMIN_A,
        actorOrgRole: "admin",
        email: "replay@f11review.test",
        orgRole: "admin",
        teamId: null,
      },
    );
    const first = await reviewAdminInvite(
      { repo },
      { orgId: toOrgId(ORG), reviewerId: ADMIN_B, reviewerOrgRole: "admin", inviteId: out.inviteId, decision: "approve" },
    );
    const second = await reviewAdminInvite(
      { repo },
      { orgId: toOrgId(ORG), reviewerId: ADMIN_B, reviewerOrgRole: "admin", inviteId: out.inviteId, decision: "approve" },
    );
    expect(second).toEqual(first);
    expect(await tokenCount(out.inviteId)).toBe(1);
  });

  it("并发：两名管理员同时批，只生效一次——第二个到达的收到 VERSION_CHANGED", async () => {
    const out = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(ORG),
        actorId: ADMIN_A,
        actorOrgRole: "admin",
        email: "race@f11review.test",
        orgRole: "admin",
        teamId: null,
      },
    );
    await reviewAdminInvite(
      { repo },
      { orgId: toOrgId(ORG), reviewerId: ADMIN_B, reviewerOrgRole: "admin", inviteId: out.inviteId, decision: "approve" },
    );
    await expect(
      reviewAdminInvite(
        { repo },
        { orgId: toOrgId(ORG), reviewerId: ADMIN_C, reviewerOrgRole: "admin", inviteId: out.inviteId, decision: "reject" },
      ),
    ).rejects.toMatchObject({ reasonCode: "VERSION_CHANGED" } satisfies Partial<OrgAdminError>);
  });

  it("非管理员调用被拒（PROJECT_ROLE_INSUFFICIENT）", async () => {
    const out = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(ORG),
        actorId: ADMIN_A,
        actorOrgRole: "admin",
        email: "not-admin-reviewer@f11review.test",
        orgRole: "admin",
        teamId: null,
      },
    );
    await expect(
      reviewAdminInvite(
        { repo },
        {
          orgId: toOrgId(ORG),
          reviewerId: ADMIN_B,
          reviewerOrgRole: "consultant",
          inviteId: out.inviteId,
          decision: "approve",
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" } satisfies Partial<OrgAdminError>);
  });
});

describe("组织内只有一名管理员：不得退化为单人可批", () => {
  beforeEach(async () => {
    await seedOrg({ orgId: SINGLE_ADMIN_ORG, projectId: `${SINGLE_ADMIN_ORG}-p` });
    await setSeatQuota(SINGLE_ADMIN_ORG, 10);
    await addOrgMember(SINGLE_ADMIN_ORG, ADMIN_A, "admin", null);
  });

  it("邀请停在待批队列，唯一的那名管理员对自己发出的邀请复核仍被拒", async () => {
    const out = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(SINGLE_ADMIN_ORG),
        actorId: ADMIN_A,
        actorOrgRole: "admin",
        email: "solo@f11review.test",
        orgRole: "admin",
        teamId: null,
      },
    );
    expect(out.status).toBe("awaiting-review");
    await expect(
      reviewAdminInvite(
        { repo },
        {
          orgId: toOrgId(SINGLE_ADMIN_ORG),
          reviewerId: ADMIN_A,
          reviewerOrgRole: "admin",
          inviteId: out.inviteId,
          decision: "approve",
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "INVITE_SELF_REVIEW_FORBIDDEN" } satisfies Partial<OrgAdminError>);
  });
});
