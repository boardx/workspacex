/**
 * `setOrgMemberRole`（member-role-management delta，组织级）—— 真实 Postgres + 真实 controller。
 *
 * 这个文件是 `lint-permission-paths` 允许 `pg-org-member-repository.ts` 的 `changeRole`
 * 不走 `guard()`/`disclose()` 的**条件本身**：豁免的理由是「admin 门在用例第一行、
 * 最后一名 admin 的判定与写入同一事务」，一句写在允许清单里的话没人验证。所以逐条反证：
 *   · 非本组织成员 → `NO_ORG_MEMBERSHIP`，且库里没变；
 *   · 本组织的非管理员 → `PROJECT_ROLE_INSUFFICIENT`，且库里没变；
 *   · 管理员改别人 → 真的写进去（独立 re-read），响应带 `previousOrgRole`；
 *   · 目标不在本组织 → `MEMBER_NOT_FOUND`（404）；
 *   · 降掉最后一名 admin → `LAST_ADMIN`（409），且库里没变；先提一个新 admin 再降 → 通过；
 *   · 改成同一个角色 → 幂等重放，`previousOrgRole === orgRole`，不写审计。
 *
 * ⚠ 每一条被拒的断言都同时验证**库里没变**：只断言抛异常，一个「先写后判」的实现照样能过。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { PgOrgMemberRepository } from "../../src/infrastructure/auth/pg-org-member-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { OrgAdminManagementController } from "../../src/interface/controllers/org-admin-management.controller";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import type { ProvenanceWriter } from "../../src/application/provenance/ports";
import {
  addCredential, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";

const ORG = "org-mrm-set-role";
const OTHER_ORG = "org-mrm-set-role-other";
const ADMIN = "u-mrm-admin";
const ADMIN2 = "u-mrm-admin-2";
const MEMBER = "u-mrm-member";
const OUTSIDER = "u-mrm-outsider";

let db: PgDatabase;
let controller: OrgAdminManagementController;
const provenance = { append: vi.fn().mockResolvedValue("ev-1"), appendWithin: vi.fn() } as unknown as ProvenanceWriter;

const HOOK_TIMEOUT_MS = 60_000;
const principal = (userId: string) => ({ userId, orgId: ORG }) as never;

const roleOf = (userId: string, orgId = ORG) =>
  asApp(orgId, (c) =>
    c.query<{ org_role: string }>("SELECT org_role FROM org_memberships WHERE org_id=$1 AND user_id=$2", [orgId, userId])
      .then((r) => r.rows[0]?.org_role ?? null));

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  controller = new OrgAdminManagementController(
    null as never,
    new PgOrgMemberRepository(db),
    null as never,
    null as never,
    new PgIdentityRepository(db),
    provenance,
    null as never,
    null as never,
    null as never,
  );
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  vi.mocked(provenance.append).mockClear();
  await resetOrgs(ORG, OTHER_ORG);
  await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
  await seedOrg({ orgId: OTHER_ORG, teamNames: [], projectId: `${OTHER_ORG}-p` });
  await addCredential(ADMIN, "admin@mrm.test", "Admin");
  await addCredential(ADMIN2, "admin2@mrm.test", "Admin Two");
  await addCredential(MEMBER, "member@mrm.test", "Member");
  await addCredential(OUTSIDER, "outsider@mrm.test", "Outsider");
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await addOrgMember(OTHER_ORG, OUTSIDER, "admin", null);
});

const body = (orgRole: string) => ({ orgId: ORG, userId: MEMBER, orgRole }) as never;

describe("setOrgMemberRole —— 授权面", () => {
  it("非本组织成员 → 403 NO_ORG_MEMBERSHIP，库里没变", async () => {
    await expect(controller.setMemberRole(ORG, MEMBER, body("lead"), principal(OUTSIDER))).rejects.toMatchObject(
      new ForbiddenException({ reasonCode: "NO_ORG_MEMBERSHIP" }),
    );
    expect(await roleOf(MEMBER)).toBe("consultant");
  });

  it("本组织的非管理员 → 403 PROJECT_ROLE_INSUFFICIENT，库里没变（连自己都不能改）", async () => {
    await expect(controller.setMemberRole(ORG, MEMBER, body("admin"), principal(MEMBER))).rejects.toMatchObject(
      new ForbiddenException({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" }),
    );
    expect(await roleOf(MEMBER)).toBe("consultant");
    expect(provenance.append).not.toHaveBeenCalled();
  });
});

describe("setOrgMemberRole —— 写路径", () => {
  it("管理员把顾问改成项目负责人 → 真的落库，响应带前值，写一条 role-changed 审计", async () => {
    const out = await controller.setMemberRole(ORG, MEMBER, body("lead"), principal(ADMIN));
    expect(out).toEqual({ userId: MEMBER, orgRole: "lead", previousOrgRole: "consultant" });
    expect(await roleOf(MEMBER)).toBe("lead");
    expect(provenance.append).toHaveBeenCalledTimes(1);
    expect(vi.mocked(provenance.append).mock.calls[0]?.[0]).toMatchObject({
      orgId: ORG,
      type: "role-changed",
      actorId: ADMIN,
      target: { kind: "membership", id: `${ORG}:${MEMBER}` },
      detail: { layer: "organization", from: "consultant", to: "lead", self: false },
    });
  });

  it("改成同一个角色 → 幂等重放：previousOrgRole === orgRole，不写审计", async () => {
    const out = await controller.setMemberRole(ORG, MEMBER, body("consultant"), principal(ADMIN));
    expect(out).toEqual({ userId: MEMBER, orgRole: "consultant", previousOrgRole: "consultant" });
    expect(provenance.append).not.toHaveBeenCalled();
  });

  it("目标不在本组织（别的组织的 admin）→ 404 MEMBER_NOT_FOUND，别的组织的行没变", async () => {
    await expect(
      controller.setMemberRole(ORG, OUTSIDER, { orgId: ORG, userId: OUTSIDER, orgRole: "consultant" } as never, principal(ADMIN)),
    ).rejects.toMatchObject(new NotFoundException({ reasonCode: "MEMBER_NOT_FOUND" }));
    expect(await roleOf(OUTSIDER, OTHER_ORG)).toBe("admin");
  });

  it("降掉最后一名 admin（自降）→ 409 LAST_ADMIN，库里没变", async () => {
    await expect(
      controller.setMemberRole(ORG, ADMIN, { orgId: ORG, userId: ADMIN, orgRole: "consultant" } as never, principal(ADMIN)),
    ).rejects.toMatchObject(new ConflictException({ reasonCode: "LAST_ADMIN" }));
    expect(await roleOf(ADMIN)).toBe("admin");
    expect(provenance.append).not.toHaveBeenCalled();
  });

  it("先把另一个人提成 admin，再自降 → 通过，审计标 self: true", async () => {
    await controller.setMemberRole(ORG, MEMBER, body("admin"), principal(ADMIN));
    expect(await roleOf(MEMBER)).toBe("admin");

    const out = await controller.setMemberRole(
      ORG, ADMIN, { orgId: ORG, userId: ADMIN, orgRole: "lead" } as never, principal(ADMIN),
    );
    expect(out).toEqual({ userId: ADMIN, orgRole: "lead", previousOrgRole: "admin" });
    expect(await roleOf(ADMIN)).toBe("lead");
    expect(vi.mocked(provenance.append).mock.calls[1]?.[0]).toMatchObject({
      detail: { from: "admin", to: "lead", self: true },
    });
  });

  it("两名 admin 并发互相降级 → 恰好一个成功，组织不会剩零 admin", async () => {
    await addOrgMember(ORG, ADMIN2, "admin", null);
    const repo = new PgOrgMemberRepository(db);
    const orgId = ORG as never;
    const results = await Promise.all([
      repo.changeRole(orgId, ADMIN, "consultant"),
      repo.changeRole(orgId, ADMIN2, "consultant"),
    ]);
    const succeeded = results.filter((r) => r.ok).length;
    const refused = results.filter((r) => !r.ok && r.reason === "last-admin").length;
    expect(succeeded).toBe(1);
    expect(refused).toBe(1);
    const admins = await asApp(ORG, (c) =>
      c.query("SELECT user_id FROM org_memberships WHERE org_id=$1 AND org_role='admin'", [ORG]).then((r) => r.rows.length));
    expect(admins).toBe(1);
  });
});
