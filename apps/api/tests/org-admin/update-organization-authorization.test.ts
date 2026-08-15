/**
 * `updateOrganization`（#363 delta）—— 真实 Postgres。
 *
 * 反证：
 *   · 非 admin → `PROJECT_ROLE_INSUFFICIENT`，库内 `name`/`description` 未变
 *     （独立 re-read 验证，不只看响应/异常）；
 *   · admin → 真的落库（独立 re-read 验证）；
 *   · `avatarArtifactId` 指向别的组织的 artifact → `AVATAR_ARTIFACT_NOT_OWNED`。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { orgAdmin as C } from "@repo/contracts";
import { updateOrganization } from "../../src/application/auth/update-organization";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import { PgOrgProfileRepository } from "../../src/infrastructure/auth/pg-org-profile-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { OrgAdminManagementController } from "../../src/interface/controllers/org-admin-management.controller";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addCredential, addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORG = "org-i363-update-org";
const OTHER_ORG = "org-i363-update-org-other";
const ADMIN = "u-update-org-admin";

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
  await resetOrgs(ORG, OTHER_ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
});

async function readOrgRow(orgId: string): Promise<{ name: string; description: string | null }> {
  return asOwner(async (c) => {
    const r = await c.query<{ name: string; description: string | null }>(
      "SELECT name, description FROM organizations WHERE id = $1",
      [orgId],
    );
    return r.rows[0] as { name: string; description: string | null };
  });
}

describe("updateOrganization", () => {
  it("非 admin 调用 —— PROJECT_ROLE_INSUFFICIENT，库内 name/description 真的没变", async () => {
    const fixture = await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    const before = await readOrgRow(fixture.orgId);

    await expect(
      updateOrganization(
        { repo },
        { orgId: toOrgId(ORG), actorOrgRole: "consultant", name: "Hijacked Name", description: "nope" },
      ),
    ).rejects.toThrow(OrgAdminError);

    const after = await readOrgRow(fixture.orgId);
    expect(after).toEqual(before);
    expect(after.name).not.toBe("Hijacked Name");
  });

  it("admin 调用 —— 真的落库，独立 re-read 验证（不只看响应体）", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });

    const out = await updateOrganization(
      { repo },
      { orgId: toOrgId(ORG), actorOrgRole: "admin", name: "New Org Name", description: "a real description" },
    );
    expect(out.name).toBe("New Org Name");
    expect(out.description).toBe("a real description");

    // 独立 re-read：不复用 out，直接从库里再查一次。
    const reread = await readOrgRow(ORG);
    expect(reread.name).toBe("New Org Name");
    expect(reread.description).toBe("a real description");
  });

  it("avatarArtifactId 指向别的组织的 artifact —— AVATAR_ARTIFACT_NOT_OWNED", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    await seedOrg({ orgId: OTHER_ORG, teamNames: [], projectId: `${OTHER_ORG}-p` });
    await addCredential(ADMIN, "admin@i363-update-org.test", "Admin");
    await addOrgMember(OTHER_ORG, ADMIN, "admin", null);

    // 在 OTHER_ORG 名下真实落一个头像 artifact。
    const otherRepo = repo; // 同一个 repo 实例，租户上下文由 withTenant 决定
    const stored = await otherRepo.storeAvatar(
      toOrgId(OTHER_ORG),
      ADMIN,
      new Uint8Array([1, 2, 3, 4]),
      "image/png",
      "deadbeef",
    );

    await expect(
      updateOrganization(
        { repo },
        { orgId: toOrgId(ORG), actorOrgRole: "admin", avatarArtifactId: stored.orgAvatarArtifactId },
      ),
    ).rejects.toMatchObject(new OrgAdminError("AVATAR_ARTIFACT_NOT_OWNED"));
  });

  it("controller 路由层：非 admin 调用真实 HTTP 路径 —— 403", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    await addCredential("u-consultant", "consultant@i363-update-org.test", "Consultant");
    await addOrgMember(ORG, "u-consultant", "consultant", null);

    await expect(
      controller.updateProfile(ORG, { orgId: ORG, name: "Hijacked" }, { userId: "u-consultant", orgId: toOrgId(ORG) }),
    ).rejects.toMatchObject(new ForbiddenException({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" }));

    const after = await readOrgRow(ORG);
    expect(after.name).not.toBe("Hijacked");
  });

  /* ═══════ 反证（参照 orphan-invite-resend-revoke.test.ts 反证 C）：
     controller 响应 key 集合逐字等于契约 out——仓储 OrgProfile 的
     avatarArtifactId 绝不透传（契约 out 是 .strict() 的三字段）。 ═══════ */
  it("controller 响应 key 集合逐字等于契约 out（不透传 avatarArtifactId）", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    await addCredential(ADMIN, "admin@i363-update-org.test", "Admin");
    await addOrgMember(ORG, ADMIN, "admin", null);

    const out = await controller.updateProfile(
      ORG,
      { orgId: ORG, name: "Key Set Check", description: "contract-only fields" },
      { userId: ADMIN, orgId: toOrgId(ORG) },
    );

    expect(Object.keys(out).sort()).toEqual(Object.keys(C.operations.updateOrganization.out.shape).sort());
    // 双保险：契约 out 是 .strict()，透传多余字段时 parse 直接炸。
    expect(() => C.operations.updateOrganization.out.parse(out)).not.toThrow();
  });
});
