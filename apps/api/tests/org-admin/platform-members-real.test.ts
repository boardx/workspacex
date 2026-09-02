/**
 * `platform-members` 束（member-role-management delta，平台级）—— 真实 Postgres + 真实 controller。
 *
 * 这个文件是 `lint-permission-paths` 允许 `pg-platform-member-repository.ts` 不走
 * `guard()`/`disclose()` 的**条件本身**：
 *   · 名册里**不出现**本地组织（`personal-local`）的成员身份——F16「对平台运营也不可见」
 *     在仓储层成立，不是靠界面过滤；
 *   · 平台组织（`org-platform`）同样不出现；
 *   · 正式组织的成员身份读到的是真实的 join（组织名 / 角色 / 加入时间）；
 *   · 没有任何正式组织的账号仍在名册里（空 `memberships`）；
 *   · `platformSuperuser` 标记来自白名单，而不是任何组织角色；
 *   · 对本地组织改角色 → `MEMBER_NOT_FOUND`（与「不存在」同形），库里没变；
 *   · 对正式组织改角色 → 真的落库、写进**目标组织**的审计（`via: "platform"`）；
 *   · 降掉某组织最后一名 admin → `LAST_ADMIN`，库里没变——平台级不绕过这条判定。
 *
 * 授权面（`PlatformSuperuserGuard`）的反证在 `tests/logging/platform-superuser-guard.test.ts`
 * 与 `tests/org-admin/platform-members-guard-wiring.test.ts`——guard 是 `@UseGuards` 挂在
 * controller 类上的，直接调 controller 方法绕过 Nest 的守卫链，所以那条断言不在这里。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { PgOrgMemberRepository } from "../../src/infrastructure/auth/pg-org-member-repository";
import { PgPlatformMemberRepository } from "../../src/infrastructure/system/pg-platform-member-repository";
import { PlatformMemberController } from "../../src/interface/controllers/platform-member.controller";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import type { ProvenanceWriter } from "../../src/application/provenance/ports";
import {
  addCredential, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";

const ORG = "org-mrm-platform";
const LOCAL_ORG = "org-mrm-platform-local";
const OPS = "u-mrm-plat-ops";
const ADMIN = "u-mrm-plat-admin";
const MEMBER = "u-mrm-plat-member";
const LONER = "u-mrm-plat-loner";
const OPS_EMAIL = "ops@mrm-platform.test";

let db: PgDatabase;
let controller: PlatformMemberController;
const provenance = { append: vi.fn().mockResolvedValue("ev-1"), appendWithin: vi.fn() } as unknown as ProvenanceWriter;

const HOOK_TIMEOUT_MS = 60_000;
const principal = { userId: OPS, orgId: ORG } as never;
const ORIGINAL_ENV = process.env.PLATFORM_SUPERUSER_EMAILS;

const roleOf = (orgId: string, userId: string) =>
  asApp(orgId, (c) =>
    c.query<{ org_role: string }>("SELECT org_role FROM org_memberships WHERE org_id=$1 AND user_id=$2", [orgId, userId])
      .then((r) => r.rows[0]?.org_role ?? null));

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  controller = new PlatformMemberController(
    new PgPlatformMemberRepository(db),
    new PgOrgMemberRepository(db),
    provenance,
  );
  process.env.PLATFORM_SUPERUSER_EMAILS = OPS_EMAIL;
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  if (ORIGINAL_ENV === undefined) delete process.env.PLATFORM_SUPERUSER_EMAILS;
  else process.env.PLATFORM_SUPERUSER_EMAILS = ORIGINAL_ENV;
  await resetOrgs(ORG, LOCAL_ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  vi.mocked(provenance.append).mockClear();
  await resetOrgs(ORG, LOCAL_ORG);
  await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
  await addCredential(OPS, OPS_EMAIL, "Ops");
  await addCredential(ADMIN, "admin@mrm-platform.test", "Org Admin");
  await addCredential(MEMBER, "member@mrm-platform.test", "Org Member");
  await addCredential(LONER, "loner@mrm-platform.test", "No Org Yet");
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  // 本地组织：只有 owner 一人，角色 admin（F16 的单人触发器只放行 owner）。
  await seedOrg({ orgId: LOCAL_ORG, kind: "personal-local", ownerUserId: MEMBER, teamNames: [], projectId: `${LOCAL_ORG}-p` });
  await addOrgMember(LOCAL_ORG, MEMBER, "admin", null);
});

describe("listPlatformMembers", () => {
  it("正式组织的成员身份来自真实 join；本地组织不出现；无组织账号仍在名册；超管标记来自白名单", async () => {
    const out = await controller.list(principal);
    const byId = new Map(out.members.map((m) => [m.userId, m]));

    const member = byId.get(MEMBER);
    expect(member).toBeDefined();
    expect(member?.memberships).toEqual([
      expect.objectContaining({ orgId: ORG, orgRole: "consultant", teamId: null }),
    ]);
    // ⚠ MEMBER 同时是 LOCAL_ORG 的 owner——那条成员身份**不得**出现。
    expect(member?.memberships.some((ms) => ms.orgId === LOCAL_ORG)).toBe(false);
    expect(out.members.some((m) => m.memberships.some((ms) => ms.orgId === LOCAL_ORG))).toBe(false);
    expect(typeof member?.memberships[0]?.orgName).toBe("string");
    expect(typeof member?.memberships[0]?.joinedAt).toBe("string");

    expect(byId.get(LONER)).toMatchObject({ displayName: "No Org Yet", memberships: [] });

    expect(byId.get(OPS)?.platformSuperuser).toBe(true);
    // 组织 admin 不是平台超管——两个身份正交。
    expect(byId.get(ADMIN)?.platformSuperuser).toBe(false);
    expect(byId.get(ADMIN)?.memberships[0]?.orgRole).toBe("admin");
  });

  it("平台组织（org-platform）若存在也不进名册", async () => {
    const out = await controller.list(principal);
    expect(out.members.some((m) => m.memberships.some((ms) => ms.orgId === "org-platform"))).toBe(false);
  });
});

describe("setPlatformMemberOrgRole", () => {
  const body = (orgId: string, userId: string, orgRole: string) => ({ orgId, userId, orgRole }) as never;

  it("正式组织：真的落库，响应带前值，审计写进目标组织并标 via: platform", async () => {
    const out = await controller.setOrgRole(MEMBER, ORG, body(ORG, MEMBER, "lead"), principal);
    expect(out).toEqual({ userId: MEMBER, orgId: ORG, orgRole: "lead", previousOrgRole: "consultant" });
    expect(await roleOf(ORG, MEMBER)).toBe("lead");
    expect(vi.mocked(provenance.append).mock.calls[0]?.[0]).toMatchObject({
      orgId: ORG,
      type: "role-changed",
      actorId: OPS,
      target: { kind: "membership", id: `${ORG}:${MEMBER}` },
      detail: { layer: "organization", via: "platform", from: "consultant", to: "lead" },
    });
  });

  it("本地组织 → 404 MEMBER_NOT_FOUND（与不存在同形），库里没变", async () => {
    await expect(
      controller.setOrgRole(MEMBER, LOCAL_ORG, body(LOCAL_ORG, MEMBER, "consultant"), principal),
    ).rejects.toMatchObject(new NotFoundException({ reasonCode: "MEMBER_NOT_FOUND" }));
    expect(await roleOf(LOCAL_ORG, MEMBER)).toBe("admin");
    await expect(
      controller.setOrgRole(MEMBER, "org-does-not-exist", body("org-does-not-exist", MEMBER, "consultant"), principal),
    ).rejects.toMatchObject(new NotFoundException({ reasonCode: "MEMBER_NOT_FOUND" }));
  });

  it("不是该组织成员的人 → 404 MEMBER_NOT_FOUND", async () => {
    await expect(
      controller.setOrgRole(LONER, ORG, body(ORG, LONER, "consultant"), principal),
    ).rejects.toMatchObject(new NotFoundException({ reasonCode: "MEMBER_NOT_FOUND" }));
  });

  it("降掉该组织最后一名 admin → 409 LAST_ADMIN，库里没变——平台级不绕过这条判定", async () => {
    await expect(
      controller.setOrgRole(ADMIN, ORG, body(ORG, ADMIN, "consultant"), principal),
    ).rejects.toMatchObject(new ConflictException({ reasonCode: "LAST_ADMIN" }));
    expect(await roleOf(ORG, ADMIN)).toBe("admin");
    expect(provenance.append).not.toHaveBeenCalled();
  });
});
