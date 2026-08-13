/**
 * shared-invite-links delta —— 组织共享邀请链接（人类 2026-08-13 三条拍板）的反证面。
 *
 * ## 反证怎么戳穿"看起来对"的实现
 *
 * 最容易写错的三个版本，各有一条测试直接打在它身上：
 *   ① "多次链接其实是一次性的"：同一链接第二个人加入失败。→ 多次语义 describe 第一条。
 *   ② "admin 级链接照常签发令牌，只在界面画个待复核徽标"：建链后
 *      `org_invite_link_tokens` 里已有行。→ 复核 describe 直接查那张表，断言零行。
 *   ③ "上限判定放在锁外"：三个人并发挤 max_uses=2 时进来三个。→ used_count 恒等断言
 *      （串行版本；并发窗口由 FOR UPDATE 构造消灭，同 create 的配额锁定先例）。
 *
 * 落库无明文（长期凭据 hash 化）的断言是**搜值不搜字段名**：把两张表整行 to_jsonb，
 * 断言签发响应里的明文不出现在任何列——字段改名骗不过它。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOrgInviteLink } from "../../src/application/auth/create-org-invite-link";
import { listOrgInviteLinks } from "../../src/application/auth/list-org-invite-links";
import { revokeOrgInviteLink } from "../../src/application/auth/revoke-org-invite-link";
import { reviewOrgInviteLink } from "../../src/application/auth/review-org-invite-link";
import { activateViaOrgInviteLink } from "../../src/application/auth/activate-via-org-invite-link";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import { PgOrgInviteLinkRepository } from "../../src/infrastructure/auth/pg-org-invite-link-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import {
  addCredential,
  addOrgMember,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { fakeHasher, fakeSessions, fakeTokens } from "../support/org-invite";

const ORG = "org-shared-links";
const ADMIN_A = "u-shl-admin-a";
const ADMIN_B = "u-shl-admin-b";
const HOOK_TIMEOUT_MS = 60_000;

/** credentials 不随 resetOrgs 级联（非租户表）——邮箱带运行期后缀，跨次运行不互撞。 */
const RUN = Date.now().toString(36);
const email = (name: string) => `${name}-${RUN}@shl.test`;

let db: PgDatabase;
let repo: PgOrgInviteLinkRepository;

const adminCtx = (actorId: string) => ({
  orgId: toOrgId(ORG),
  actorId,
  actorOrgRole: "admin",
});

function activateDeps() {
  return { repo, hasher: fakeHasher, sessions: fakeSessions(), tokens: fakeTokens() };
}

async function join(token: string, mail: string, name = "joiner") {
  return activateViaOrgInviteLink(activateDeps(), {
    token,
    email: mail,
    profile: { name, password: "long-enough-passphrase-1" },
  });
}

async function tokenRowCount(linkId: string): Promise<number> {
  const r = await asOwner((c) =>
    c.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM org_invite_link_tokens WHERE link_id = $1",
      [linkId],
    ),
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function usedCount(linkId: string): Promise<number> {
  const r = await asOwner((c) =>
    c.query<{ used_count: number }>("SELECT used_count FROM org_invite_links WHERE id = $1", [linkId]),
  );
  return Number(r.rows[0]?.used_count ?? -1);
}

async function memberCount(): Promise<number> {
  const r = await asOwner((c) =>
    c.query<{ n: string }>("SELECT count(*)::text AS n FROM org_memberships WHERE org_id = $1", [ORG]),
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function credentialCount(mail: string): Promise<number> {
  const r = await asOwner((c) =>
    c.query<{ n: string }>("SELECT count(*)::text AS n FROM credentials WHERE email = $1", [mail]),
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function setSeatQuota(n: number): Promise<void> {
  await asOwner((c) => c.query("UPDATE organizations SET seat_quota = $2 WHERE id = $1", [ORG, n]));
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgOrgInviteLinkRepository(db);
  await addCredential(ADMIN_A, email("admin-a"), "管理员甲");
  await addCredential(ADMIN_B, email("admin-b"), "管理员乙");
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p`, seatQuota: 100 });
  await addOrgMember(ORG, ADMIN_A, "admin", null);
  await addOrgMember(ORG, ADMIN_B, "admin", null);
});

describe("多次语义（拍板①）", () => {
  it("同一链接两个不同的人先后加入都成功；used_count 逐次 +1", async () => {
    const link = await createOrgInviteLink(
      { repo },
      { ...adminCtx(ADMIN_A), orgRole: "consultant", expiry: "7d", maxUses: null },
    );
    expect(link.status).toBe("active");
    expect(link.linkToken).not.toBeNull();

    const first = await join(link.linkToken!, email("joiner-1"), "第一人");
    const second = await join(link.linkToken!, email("joiner-2"), "第二人");
    expect(first.userId).not.toBe(second.userId);
    expect(first.orgId).toBe(ORG);
    expect(second.orgRole).toBe("consultant");
    expect(await usedCount(link.linkId)).toBe(2);

    // ALLOWLIST 例外的前提（lint-permission-paths）：授予值之外什么都不返回。
    expect(Object.keys(first).sort()).toEqual(["orgId", "orgRole", "sessionId", "userId"]);
  });

  it("max_uses=2 时第三人被拒（统一 INVITE_NOT_FOUND），计数停在 2", async () => {
    const link = await createOrgInviteLink(
      { repo },
      { ...adminCtx(ADMIN_A), orgRole: "consultant", expiry: "7d", maxUses: 2 },
    );
    await join(link.linkToken!, email("cap-1"));
    await join(link.linkToken!, email("cap-2"));
    await expect(join(link.linkToken!, email("cap-3"))).rejects.toMatchObject({
      reasonCode: "INVITE_NOT_FOUND",
    });
    expect(await usedCount(link.linkId)).toBe(2);
    // 被拒的那一次没有留下半个账号（事务回滚）。
    expect(await credentialCount(email("cap-3"))).toBe(0);
  });
});

describe("失效面统一（V10 防枚举）", () => {
  it("过期链接 → INVITE_NOT_FOUND", async () => {
    const past = () => new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const link = await createOrgInviteLink(
      { repo, now: past },
      { ...adminCtx(ADMIN_A), orgRole: "consultant", expiry: "7d", maxUses: null },
    );
    await expect(join(link.linkToken!, email("late"))).rejects.toMatchObject({
      reasonCode: "INVITE_NOT_FOUND",
    });
  });

  it("已作废链接 → INVITE_NOT_FOUND；作废幂等", async () => {
    const link = await createOrgInviteLink(
      { repo },
      { ...adminCtx(ADMIN_A), orgRole: "consultant", expiry: "7d", maxUses: null },
    );
    const revoked = await revokeOrgInviteLink(
      { repo },
      { orgId: toOrgId(ORG), actorOrgRole: "admin", linkId: link.linkId },
    );
    expect(revoked.status).toBe("revoked");
    // 幂等重放同一结果。
    const again = await revokeOrgInviteLink(
      { repo },
      { orgId: toOrgId(ORG), actorOrgRole: "admin", linkId: link.linkId },
    );
    expect(again.status).toBe("revoked");
    await expect(join(link.linkToken!, email("after-revoke"))).rejects.toMatchObject({
      reasonCode: "INVITE_NOT_FOUND",
    });
  });

  it("不存在的令牌 → 同一个 INVITE_NOT_FOUND（与前两种逐码相同）", async () => {
    await expect(join("no-such-token-value", email("ghost"))).rejects.toMatchObject({
      reasonCode: "INVITE_NOT_FOUND",
    });
  });
});

describe("admin 级链接的双人复核（拍板③ / O-28⑥ 适用点扩展）", () => {
  it("建链即待复核：linkToken=null、token 表零行（令牌不存在，不是签了拦着）", async () => {
    const link = await createOrgInviteLink(
      { repo },
      { ...adminCtx(ADMIN_A), orgRole: "admin", expiry: "7d", maxUses: 1 },
    );
    expect(link.status).toBe("pending-review");
    expect(link.linkToken).toBeNull();
    expect(link.expiresAt).toBeNull();
    expect(await tokenRowCount(link.linkId)).toBe(0);
  });

  it("发起人自批 → INVITE_SELF_REVIEW_FORBIDDEN（I-4）", async () => {
    const link = await createOrgInviteLink(
      { repo },
      { ...adminCtx(ADMIN_A), orgRole: "admin", expiry: "7d", maxUses: null },
    );
    await expect(
      reviewOrgInviteLink(
        { repo },
        {
          orgId: toOrgId(ORG),
          reviewerId: ADMIN_A,
          reviewerOrgRole: "admin",
          linkId: link.linkId,
          decision: "approve",
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "INVITE_SELF_REVIEW_FORBIDDEN" });
    expect(await tokenRowCount(link.linkId)).toBe(0);
  });

  it("第二 admin 批准 → 明文只此一次回传，且用它真实建号成功（授予 admin）", async () => {
    const link = await createOrgInviteLink(
      { repo },
      { ...adminCtx(ADMIN_A), orgRole: "admin", expiry: "1d", maxUses: null },
    );
    const reviewed = await reviewOrgInviteLink(
      { repo },
      {
        orgId: toOrgId(ORG),
        reviewerId: ADMIN_B,
        reviewerOrgRole: "admin",
        linkId: link.linkId,
        decision: "approve",
      },
    );
    expect(reviewed.status).toBe("active");
    expect(reviewed.linkToken).not.toBeNull();
    expect(reviewed.expiresAt).not.toBeNull();

    const joined = await join(reviewed.linkToken!, email("new-admin"), "新管理员");
    expect(joined.orgRole).toBe("admin");

    // 幂等重放（同 reviewer 重复 approve）不再吐令牌。
    const replay = await reviewOrgInviteLink(
      { repo },
      {
        orgId: toOrgId(ORG),
        reviewerId: ADMIN_B,
        reviewerOrgRole: "admin",
        linkId: link.linkId,
        decision: "approve",
      },
    );
    expect(replay.linkToken).toBeNull();
  });

  it("拒绝 → revoked；对已裁定链接的第二次不同决定 → VERSION_CHANGED", async () => {
    const link = await createOrgInviteLink(
      { repo },
      { ...adminCtx(ADMIN_A), orgRole: "admin", expiry: "7d", maxUses: null },
    );
    const rejected = await reviewOrgInviteLink(
      { repo },
      {
        orgId: toOrgId(ORG),
        reviewerId: ADMIN_B,
        reviewerOrgRole: "admin",
        linkId: link.linkId,
        decision: "reject",
      },
    );
    expect(rejected.status).toBe("revoked");
    expect(rejected.linkToken).toBeNull();
    await expect(
      reviewOrgInviteLink(
        { repo },
        {
          orgId: toOrgId(ORG),
          reviewerId: ADMIN_B,
          reviewerOrgRole: "admin",
          linkId: link.linkId,
          decision: "approve",
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "VERSION_CHANGED" });
  });
});

describe("席位配额硬闸（拍板① / I-9）", () => {
  it("配额耗尽时加入被拒且什么都没变（成员数 / used_count / credentials）", async () => {
    const link = await createOrgInviteLink(
      { repo },
      { ...adminCtx(ADMIN_A), orgRole: "consultant", expiry: "7d", maxUses: null },
    );
    const before = await memberCount();
    await setSeatQuota(before); // 恰好用满
    await expect(join(link.linkToken!, email("over-quota"))).rejects.toMatchObject({
      reasonCode: "QUOTA_EXHAUSTED",
    });
    expect(await memberCount()).toBe(before);
    expect(await usedCount(link.linkId)).toBe(0);
    expect(await credentialCount(email("over-quota"))).toBe(0);
  });
});

describe("邮箱查重（拍板①：明确拒绝、不重复建号）", () => {
  it("已是成员的邮箱走链接 → INVITE_ALREADY_MEMBER，credentials 行数不变", async () => {
    const link = await createOrgInviteLink(
      { repo },
      { ...adminCtx(ADMIN_A), orgRole: "consultant", expiry: "7d", maxUses: null },
    );
    await expect(join(link.linkToken!, email("admin-a"))).rejects.toMatchObject({
      reasonCode: "INVITE_ALREADY_MEMBER",
    });
    expect(await credentialCount(email("admin-a"))).toBe(1);
    expect(await usedCount(link.linkId)).toBe(0);
  });

  it("大小写变体同样被拒（normalizeEmail 与 credentials 同一口径）", async () => {
    const link = await createOrgInviteLink(
      { repo },
      { ...adminCtx(ADMIN_A), orgRole: "consultant", expiry: "7d", maxUses: null },
    );
    await expect(join(link.linkToken!, email("admin-a").toUpperCase())).rejects.toMatchObject({
      reasonCode: "INVITE_ALREADY_MEMBER",
    });
  });
});

describe("落库无明文（长期凭据 hash 化）", () => {
  it("签发响应里的明文在两张表的任何列里都搜不到；列表输出也搜不到", async () => {
    const link = await createOrgInviteLink(
      { repo },
      { ...adminCtx(ADMIN_A), orgRole: "consultant", expiry: "7d", maxUses: null },
    );
    const plaintext = link.linkToken!;
    expect(plaintext.length).toBeGreaterThan(20);

    // 搜值不搜字段名：整行 JSON 化，明文不出现在任何列。
    const rows = await asOwner(async (c) => {
      const a = await c.query<{ j: string }>("SELECT to_jsonb(t)::text AS j FROM org_invite_link_tokens t");
      const b = await c.query<{ j: string }>("SELECT to_jsonb(l)::text AS j FROM org_invite_links l");
      return [...a.rows, ...b.rows].map((r) => r.j).join("\n");
    });
    expect(rows).not.toContain(plaintext);
    // hash 行确实存在（不是"根本没写"冒充"没存明文"）。
    expect(await tokenRowCount(link.linkId)).toBe(1);

    const listed = await listOrgInviteLinks(
      { repo },
      { orgId: toOrgId(ORG), actorOrgRole: "admin" },
    );
    expect(JSON.stringify(listed)).not.toContain(plaintext);
    const mine = listed.find((l) => l.linkId === link.linkId);
    expect(mine?.status).toBe("active");
    expect(mine?.createdByUserId).toBe(ADMIN_A);
  });
});

describe("越权面", () => {
  it("非 admin 建链/列表/作废/复核一律 PROJECT_ROLE_INSUFFICIENT", async () => {
    const nonAdmin = { orgId: toOrgId(ORG), actorId: "u-shl-lead", actorOrgRole: "lead" };
    await expect(
      createOrgInviteLink({ repo }, { ...nonAdmin, orgRole: "consultant", expiry: "7d", maxUses: null }),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
    await expect(
      listOrgInviteLinks({ repo }, { orgId: toOrgId(ORG), actorOrgRole: "lead" }),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
    await expect(
      revokeOrgInviteLink({ repo }, { orgId: toOrgId(ORG), actorOrgRole: "lead", linkId: "oil-x" }),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
    await expect(
      reviewOrgInviteLink(
        { repo },
        { orgId: toOrgId(ORG), reviewerId: "u-shl-lead", reviewerOrgRole: "lead", linkId: "oil-x", decision: "approve" },
      ),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
  });

  it("弱口令在契约层被拒，不触碰令牌（先判形状再查库）", async () => {
    const link = await createOrgInviteLink(
      { repo },
      { ...adminCtx(ADMIN_A), orgRole: "consultant", expiry: "7d", maxUses: null },
    );
    await expect(
      activateViaOrgInviteLink(activateDeps(), {
        token: link.linkToken!,
        email: email("weak-pwd"),
        profile: { name: "x", password: "short" },
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof Error && e.name === "PasswordPolicyError");
    expect(await usedCount(link.linkId)).toBe(0);
  });
});
