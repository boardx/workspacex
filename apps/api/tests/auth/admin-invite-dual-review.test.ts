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
import { orgAdmin as C } from "@repo/contracts";
import { inviteOrgMember } from "../../src/application/auth/invite-org-member";
import { reviewAdminInvite } from "../../src/application/auth/review-admin-invite";
import { activateOrgMember } from "../../src/application/auth/activate-org-member";
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
import { fakeHasher, fakeSessions, fakeTokens, NO_CLAIMS } from "../support/org-invite";

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
    null as never,
    new PgOrgProfileRepository(db, null as never),
    null as never,
    new PgIdentityRepository(db),
    null as never,
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
    expect(reviewed.status).toBe("pending");
    expect(reviewed.tokenIssued).toBe(true);
    expect(await tokenCount(out.inviteId)).toBe(1);
    // D2 裁决 A：批准那一次响应回传令牌，且正是库里那一枚（不是第二枚、不是编的）。
    expect(reviewed.activationToken).toBe(await liveToken(out.inviteId));
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
    expect(reviewed).toEqual({ status: "revoked", tokenIssued: false, activationToken: null });
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

/* ═══════ D2 反证（coord-main 2026-08-11 裁决 A）：批准响应带 token，且只此一次 ═══════ */

describe("D2：批准那一次响应回传 activationToken，此外任何地方拿不到", () => {
  async function awaitingInvite(email: string): Promise<string> {
    const out = await inviteOrgMember(
      { repo },
      { orgId: toOrgId(ORG), actorId: ADMIN_A, actorOrgRole: "admin", email, orgRole: "admin", teamId: null },
    );
    expect(out.status, "前提：管理员邀请停在待复核").toBe("awaiting-review");
    return out.inviteId;
  }

  it("走真实路由批准：响应 key 集合逐字等于契约 out，token 可真实激活建号，重放同一 token 被拒", async () => {
    const inviteId = await awaitingInvite("d2-activate@f11review.test");

    const out = await controller.review(
      ORG, inviteId, { orgId: ORG, inviteId, decision: "approve", reason: null }, principal(ADMIN_B),
    );
    expect(Object.keys(out).sort()).toEqual(Object.keys(C.operations.reviewAdminInvite.out.shape).sort());
    expect(out.activationToken).toBe(await liveToken(inviteId));

    // 🔴 目标：用批准响应里的 token 真实走激活建号——链接不是摆设。
    const activated = await activateOrgMember(
      { repo, hasher: fakeHasher, sessions: fakeSessions(), tokens: fakeTokens() },
      {
        token: out.activationToken!,
        mode: "new-account",
        profile: { name: "批准链接进来的", password: "correct-horse-battery" },
        existingUserId: null,
        untrustedClaims: NO_CLAIMS,
      },
    );
    expect(activated.orgId).toBe(ORG);

    // 同一 token 重放 → 拒（一次性令牌语义原样，不因回传而放松）。
    await expect(
      activateOrgMember(
        { repo, hasher: fakeHasher, sessions: fakeSessions(), tokens: fakeTokens() },
        {
          token: out.activationToken!,
          mode: "new-account",
          profile: { name: "重放", password: "correct-horse-battery" },
          existingUserId: null,
          untrustedClaims: NO_CLAIMS,
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "INVITE_NOT_FOUND" });
  });

  it("「只此一次」的另一半：批准后再查列表搜不到令牌值；并发第二个复核者什么也拿不到", async () => {
    const inviteId = await awaitingInvite("d2-once@f11review.test");
    const out = await controller.review(
      ORG, inviteId, { orgId: ORG, inviteId, decision: "approve", reason: null }, principal(ADMIN_B),
    );
    expect(out.activationToken, "前提：这次批准确实带出了令牌").not.toBeNull();
    expect(out.activationToken!.length).toBeGreaterThan(20);

    // 🔴 搜的是**值**，不是字段名——与 orphan-invite-resend-revoke 反证 C 同一形状。
    const listed = await controller.listInvites(ORG, principal(ADMIN_C));
    expect(JSON.stringify(listed)).not.toContain(out.activationToken!);

    // 并发第二个复核者：批准本来就一次性生效，第二路收到 VERSION_CHANGED，拿不到 token。
    await expect(
      reviewAdminInvite(
        { repo },
        { orgId: toOrgId(ORG), reviewerId: ADMIN_C, reviewerOrgRole: "admin", inviteId, decision: "approve" },
      ),
    ).rejects.toMatchObject({ reasonCode: "VERSION_CHANGED" } satisfies Partial<OrgAdminError>);
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
