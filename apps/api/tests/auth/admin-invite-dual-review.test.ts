/** Current invitations are ordinary members. Historical internal review behavior is
 * exercised only with explicitly seeded legacy awaiting-review rows. Public review is retired. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inviteOrgMember } from "../../src/application/auth/invite-org-member";
import { reviewAdminInvite } from "../../src/application/auth/review-admin-invite";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import { PgOrgInviteRepository } from "../../src/infrastructure/auth/pg-org-invite-repository";
import { PgOrgProfileRepository } from "../../src/infrastructure/auth/pg-org-profile-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { OrgAdminManagementController } from "../../src/interface/controllers/org-admin-management.controller";
import { toOrgId } from "../../src/domain/org-id";
import type { Principal } from "../../src/domain/principal";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-f11-review";
const SINGLE_ADMIN_ORG = "org-f11-review-solo";
const ADMIN_A = "u-f11-admin-a";
const ADMIN_B = "u-f11-admin-b";
const ADMIN_C = "u-f11-admin-c";

const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: PgOrgInviteRepository;
let controller: OrgAdminManagementController;
let fixture: Awaited<ReturnType<typeof seedOrg>>;

const principal = (userId: string, orgId = ORG): Principal => ({ userId, orgId: toOrgId(orgId) });

/** 该邀请此刻唯一可用（未作废）的令牌明文——D2 反证要断言「响应即库中那一枚」。 */
async function liveToken(inviteId: string): Promise<string> {
  const r = await asOwner((c) =>
    c.query<{ token: string }>(
      "SELECT token FROM org_invite_tokens WHERE invite_id = $1 AND consumed_at IS NULL",
      [inviteId],
    ),
  );
  expect(r.rows.length, "恰好一枚可用令牌").toBe(1);
  return r.rows[0]!.token;
}

async function setSeatQuota(orgId: string, n: number): Promise<void> {
  await asApp(orgId, (c) => c.query("UPDATE organizations SET seat_quota = $2 WHERE id = $1", [orgId, n]));
}

async function tokenCount(inviteId: string): Promise<number> {
  const row = await asOwner((c) =>
    c.query<{ n: string }>("SELECT count(*)::text AS n FROM org_invite_tokens WHERE invite_id = $1", [inviteId]),
  );
  return Number(row.rows[0]?.n ?? 0);
}

/** Seed historical state without relying on today's creation policy. */
async function legacyAwaitingInvite(...args: Parameters<typeof inviteOrgMember>) {
  const out = await inviteOrgMember(...args);
  await asOwner(async (c) => {
    await c.query("DELETE FROM org_invite_tokens WHERE invite_id=$1", [out.inviteId]);
    await c.query("UPDATE org_invites SET status='awaiting-review', org_role='admin', sent_at=NULL WHERE id=$1", [out.inviteId]);
  });
  return { ...out, status: "awaiting-review" as const, tokenIssued: false, token: null };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgOrgInviteRepository(db);
  // D2 反证的「随时可再读仍封死」半边要打真实的 review / listInvites 路由——
  // 与 orphan-invite-resend-revoke.test.ts 同一构造：不参与的端口给 null 而不是假件。
  controller = new OrgAdminManagementController(
    repo,
    null as never,
    new PgOrgProfileRepository(db, null as never),
    null as never,
    new PgIdentityRepository(db),
    null as never,
    null as never,  // F160 token 额度仓储：本文件不调那三条路由,
    null as never,  // F162 限额规则仓储：本文件不调那五条路由
    null as never,  // issue #852 delta：skill 审核人职能仓储：本文件不调那三条路由
  );
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

describe("ordinary invitation creation and historical internal review", () => {
  it("requesting admin creates a pending ordinary-member invitation with a token", async () => {
    const out = await inviteOrgMember({ repo }, {
      orgId: toOrgId(ORG), actorId: ADMIN_A, actorOrgRole: "admin",
      email: "candidate@f11review.test", orgRole: "admin", teamId: null,
    });
    expect(out.status).toBe("pending");
    expect(out.tokenIssued).toBe(true);
    expect(await tokenCount(out.inviteId)).toBe(1);
    const row = await asOwner((c) => c.query("SELECT org_role FROM org_invites WHERE id=$1", [out.inviteId]));
    expect(row.rows[0].org_role).toBe("consultant");
  });

  it("发起人不可自批（I-4）", async () => {
    const out = await legacyAwaitingInvite(
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
    const out = await legacyAwaitingInvite(
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
    expect(reviewed.status).toBe("pending");
    expect(reviewed.tokenIssued).toBe(true);
    expect(await tokenCount(out.inviteId)).toBe(1);
    // D2 裁决 A：批准那一次响应回传令牌，且正是库里那一枚（不是第二枚、不是编的）。
    expect(reviewed.activationToken).toBe(await liveToken(out.inviteId));
  });

  it("reject 后转 revoked，且不签发 token", async () => {
    const out = await legacyAwaitingInvite(
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
    expect(reviewed).toEqual({ status: "revoked", tokenIssued: false, activationToken: null });
    expect(await tokenCount(out.inviteId)).toBe(0);
  });

  it("幂等重放：同一 reviewer 重复 approve 返回同一结果，不重复签发 token", async () => {
    const out = await legacyAwaitingInvite(
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
    expect(first.status).toBe("pending");
    expect(first.tokenIssued).toBe(true);

    const second = await reviewAdminInvite(
      { repo },
      { orgId: toOrgId(ORG), reviewerId: ADMIN_B, reviewerOrgRole: "admin", inviteId: out.inviteId, decision: "approve" },
    );
    // ⚠ 「返回同一结果」指的是 `status`（幂等重放不改变最终状态），不是 `tokenIssued`
    // 逐字相同——`tokenIssued` 字面意思是「这次调用有没有签发新 token」，同 F10
    // `inviteOrgMember` 对重放的处置一致（`pg-org-invite-repository.ts` 的 `replayed`
    // 分支恒 `tokenIssued: false`，无论首次调用是不是 true）：重放没有再签一次，
    // 所以这次的 `tokenIssued` 如实为 false，而不是复述第一次调用发生过什么。
    // D2 反证：重放同样拿不到 activationToken——「重复批准把令牌再吐一次」正是
    // 「任何管理员事后可再读」的形状，封死。
    expect(second).toEqual({ status: "pending", tokenIssued: false, activationToken: null });
    expect(await tokenCount(out.inviteId)).toBe(1);
  });

  it("并发：两名管理员同时批，只生效一次——第二个到达的收到 VERSION_CHANGED", async () => {
    const out = await legacyAwaitingInvite(
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
    const out = await legacyAwaitingInvite(
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

describe("public review is retired for existing legacy invitations", () => {
  it.each(["approve", "reject"] as const)("%s cannot grant access or return a token", async (decision) => {
    const out = await legacyAwaitingInvite({ repo }, {
      orgId: toOrgId(ORG), actorId: ADMIN_A, actorOrgRole: "admin",
      email: `retired-${decision}@f11review.test`, orgRole: "admin", teamId: null,
    });
    await expect(controller.review(ORG, out.inviteId,
      { orgId: ORG, inviteId: out.inviteId, decision, reason: null }, principal(ADMIN_B)))
      .rejects.toMatchObject({ response: { reasonCode: "VERSION_CHANGED" } });
    expect(await tokenCount(out.inviteId)).toBe(0);
    const listed = await controller.listInvites(ORG, principal(ADMIN_C));
    expect(listed.invites.find((invite) => invite.inviteId === out.inviteId)?.status).toBe("awaiting-review");
  });
});

describe("组织内只有一名管理员：不得退化为单人可批", () => {
  beforeEach(async () => {
    await seedOrg({ orgId: SINGLE_ADMIN_ORG, projectId: `${SINGLE_ADMIN_ORG}-p` });
    await setSeatQuota(SINGLE_ADMIN_ORG, 10);
    await addOrgMember(SINGLE_ADMIN_ORG, ADMIN_A, "admin", null);
  });

  it("邀请停在待批队列，唯一的那名管理员对自己发出的邀请复核仍被拒", async () => {
    const out = await legacyAwaitingInvite(
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
