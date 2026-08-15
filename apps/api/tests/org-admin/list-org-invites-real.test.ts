/**
 * `listOrgInvites`（#363 delta）—— 真实 Postgres。**权限比 `listOrgMembers` 更紧**，
 * 单独测（verification.md 逐字：「这条和 members 权限不同，务必单独测，别复用同一个
 * 断言」）。
 *
 * 反证：
 *   · 造一条真实邀请 → admin 能读到；
 *   · 已撤销的邀请 → `status` 如实反映 `revoked`；
 *   · 本组织的非 admin 成员调用 → `FORBIDDEN` 族（`PROJECT_ROLE_INSUFFICIENT`）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { inviteOrgMember } from "../../src/application/auth/invite-org-member";
import { revokeOrgInvite } from "../../src/application/auth/revoke-org-invite";
import { PgOrgInviteRepository } from "../../src/infrastructure/auth/pg-org-invite-repository";
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

const ORG = "org-i363-list-invites";
const ADMIN = "u-invites-admin";

let db: PgDatabase;
let inviteRepo: PgOrgInviteRepository;
let profileRepo: PgOrgProfileRepository;
let identity: PgIdentityRepository;
let controller: OrgAdminManagementController;

const HOOK_TIMEOUT_MS = 60_000;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  inviteRepo = new PgOrgInviteRepository(db);
  const store = new FsObjectStore(mkdtempSync(join(tmpdir(), "i363-avatar-")));
  profileRepo = new PgOrgProfileRepository(db, store);
  identity = new PgIdentityRepository(db);
  controller = new OrgAdminManagementController(
    inviteRepo,
    null as never,
    null as never,
    profileRepo,
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

async function seedAdmin(): Promise<void> {
  await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
  await addCredential(ADMIN, "admin@i363-invites.test", "Admin");
  await addOrgMember(ORG, ADMIN, "admin", null);
}

describe("listOrgInvites", () => {
  it("admin 能读到真实邀请；已撤销的邀请 status 如实为 revoked", async () => {
    await seedAdmin();
    const live = await inviteOrgMember(
      { repo: inviteRepo },
      { orgId: toOrgId(ORG), actorId: ADMIN, actorOrgRole: "admin", email: "live@i363.test", orgRole: "consultant", teamId: null },
    );
    const toRevoke = await inviteOrgMember(
      { repo: inviteRepo },
      { orgId: toOrgId(ORG), actorId: ADMIN, actorOrgRole: "admin", email: "gone@i363.test", orgRole: "consultant", teamId: null },
    );
    await revokeOrgInvite({ repo: inviteRepo }, { orgId: toOrgId(ORG), actorId: ADMIN, actorOrgRole: "admin", inviteId: toRevoke.inviteId });

    const out = await controller.listInvites(ORG, { userId: ADMIN, orgId: toOrgId(ORG) });

    const liveRow = out.invites.find((i) => i.inviteId === live.inviteId);
    const revokedRow = out.invites.find((i) => i.inviteId === toRevoke.inviteId);
    // 2026-08-09 复核（D 类）：`invitedBy` 现在是邀请人的真实姓名（join `credentials.
    // display_name`），不是裸 user id——`app-shell.tsx` 已经在注释里批评过「拿裸 ID
    // 冒充名称」那类写法，`listOrgInvites` 之前正是这个反例（`06-invites-admin.png`
    // 每一行都写着「由 u-a3f86b... 邀请」）。这里用 `seedAdmin()` 里 `addCredential`
    // 写入的真实姓名 "Admin" 断言，不是 ADMIN 这个 user id 常量。
    expect(liveRow).toMatchObject({ email: "live@i363.test", status: "pending", invitedBy: "Admin" });
    expect(revokedRow?.status).toBe("revoked");
    expect(typeof liveRow?.expiresAt).toBe("string");
  });

  it("本组织的非 admin 成员调用 —— 403 PROJECT_ROLE_INSUFFICIENT（与 members 权限不同，单独断言）", async () => {
    await seedAdmin();
    await addCredential("u-consultant", "consultant@i363-invites.test", "Consultant");
    await addOrgMember(ORG, "u-consultant", "consultant", null);

    await expect(
      controller.listInvites(ORG, { userId: "u-consultant", orgId: toOrgId(ORG) }),
    ).rejects.toMatchObject(new ForbiddenException({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" }));
  });

  it("非成员调用 —— 403 NO_ORG_MEMBERSHIP（比 PROJECT_ROLE_INSUFFICIENT 更早的一档）", async () => {
    await seedAdmin();
    await expect(
      controller.listInvites(ORG, { userId: "u-stranger", orgId: toOrgId(ORG) }),
    ).rejects.toMatchObject(new ForbiddenException({ reasonCode: "NO_ORG_MEMBERSHIP" }));
  });
});
