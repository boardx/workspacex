/**
 * `listOrgMembers`（#363 delta）—— 真实 Postgres。
 *
 * 反证（verification.md 逐字）：
 *   · 造一个真实成员（真实 `org_memberships` 行）→ 断言能读到；
 *   · 非成员调用 → `NO_ORG_MEMBERSHIP`（本束里 `FORBIDDEN` 的既有码，见
 *     `KNOWN_CONTRACT_GAPS.OA11` ①）；
 *   · 把该成员换成一个不存在的 orgId → 断言读不到/为空，证明不是硬编码。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { listOrgMembers } from "../../src/application/auth/list-org-members";
import { PgOrgProfileRepository } from "../../src/infrastructure/auth/pg-org-profile-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { OrgAdminManagementController } from "../../src/interface/controllers/org-admin-management.controller";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addCredential, addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORG = "org-i363-list-members";

let db: PgDatabase;
let repo: PgOrgProfileRepository;
let identity: PgIdentityRepository;
let controller: OrgAdminManagementController;

const HOOK_TIMEOUT_MS = 60_000;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  const store = new FsObjectStore(mkdtempSync(join(tmpdir(), "i363-avatar-")));
  repo = new PgOrgProfileRepository(db, store);
  identity = new PgIdentityRepository(db);
  // 本文件只调 listMembers 这一条路由，其余端口不参与——给 null 而不是假件
  // （同 `orphan-invite-resend-revoke.test.ts` 的既有处置）。
  controller = new OrgAdminManagementController(
    null as never,
    null as never,
    null as never,
    repo,
    null as never,
    identity,
    null as never,
    null as never,  // F160 token 额度仓储：本文件不调那三条路由,
    null as never,  // F162 限额规则仓储：本文件不调那五条路由
    null as never,  // issue #852 delta：skill 审核人职能仓储：本文件不调那三条路由
  );
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
});

describe("listOrgMembers", () => {
  it("真实成员能读到自己所在组织的成员行，字段来自真实 join", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    await addCredential("u-member-1", "member1@i363.test", "Member One");
    await addOrgMember(ORG, "u-member-1", "consultant", null);

    const out = await listOrgMembers({ repo }, { orgId: toOrgId(ORG) });

    expect(out.members).toHaveLength(1);
    expect(out.members[0]).toMatchObject({
      userId: "u-member-1",
      displayName: "Member One",
      email: "member1@i363.test",
      orgRole: "consultant",
      teamId: null,
      status: "active",
    });
    expect(typeof out.members[0]?.joinedAt).toBe("string");
  });

  it("换一个没有该成员的组织 —— 读到空数组，不是硬编码", async () => {
    const OTHER = `${ORG}-empty`;
    await resetOrgs(OTHER);
    await seedOrg({ orgId: OTHER, teamNames: [], projectId: `${OTHER}-p` });

    const out = await listOrgMembers({ repo }, { orgId: toOrgId(OTHER) });
    expect(out.members).toEqual([]);
    await resetOrgs(OTHER);
  });

  it("非成员调用真实 controller 路由 —— 403 NO_ORG_MEMBERSHIP，走 HTTP 会实测到的那条路径", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    await addCredential("u-member-1", "member1@i363.test", "Member One");
    await addOrgMember(ORG, "u-member-1", "consultant", null);

    await expect(
      controller.listMembers(ORG, { userId: "u-stranger", orgId: toOrgId(ORG) }),
    ).rejects.toMatchObject(
      new ForbiddenException({ reasonCode: "NO_ORG_MEMBERSHIP" }),
    );
  });
});
