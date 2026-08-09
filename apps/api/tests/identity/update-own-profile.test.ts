/**
 * `updateOwnProfile`（#638 delta；迭代 1 改名，迭代 2 补头像，迭代 4 补写 provenance）—— 真 Postgres。
 *
 * ## 反证 A/B 怎么戳穿（本文件的核心断言）
 *
 * 一个只改了返回值、没有真的执行 `UPDATE credentials` 的实现，会让「用例返回的
 * `displayName` 看起来对」这条断言照样绿——所以本文件在用例返回之后**独立重新查库**
 * （`readCredentialByEmail`，绕开被测代码的返回值），断言库里那一行也真的变了。
 * 只信返回值 = 只信被测代码自己的说法。
 *
 * 迭代 4 追加：同一条纪律用在 provenance 上——独立查 `provenance_events`，不信
 * `updateOwnProfile` 的返回值（它甚至没有把 `provenanceEventId` 放进 `out`，因为契约
 * `updateOwnProfile.out` 是已签核的 `.strict()`，加字段是另一件需要签核的事；这里只信
 * 库里真的多了一行）。
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UpdateOwnProfileError, updateOwnProfile } from "../../src/application/identity/update-own-profile";
import { PgCredentialRepository } from "../../src/infrastructure/auth/pg-credential-repository";
import { PgAvatarRepository } from "../../src/infrastructure/auth/pg-avatar-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { seedCredential } from "../support/auth";
import { readCredentialByEmail } from "../support/auth-db";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f638-iter4-profile";
const PROJECT = "proj-f638-iter4-profile";
const USER_ID = "u-f638-profile";
const OTHER_USER_ID = "u-f638-profile-other";
const EMAIL = "profile-owner@f638.test";
const OTHER_EMAIL = "profile-other@f638.test";

let db: PgDatabase;
let repo: PgCredentialRepository;
let avatars: PgAvatarRepository;
let provenance: PgProvenanceRepository;

const HOOK_TIMEOUT_MS = 60_000;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgCredentialRepository(db);
  avatars = new PgAvatarRepository(db);
  provenance = new PgProvenanceRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await seedCredential({ userId: USER_ID, email: EMAIL, password: "correct horse battery staple", displayName: "原名" });
  await seedCredential({ userId: OTHER_USER_ID, email: OTHER_EMAIL, password: "correct horse battery staple", displayName: "别人" });
  // ⚠ `seedCredential` 的 ON CONFLICT 分支不覆盖 `display_name`（fixture 本身的既有行为，
  // 见 tests/support/auth.ts）——上一个测试改过名的话，这里显式复位，否则每个 it 之间
  // 不是真正独立的。
  await asOwner((c) => c.query("UPDATE credentials SET display_name = $2, avatar_artifact_id = NULL, avatar_url = NULL WHERE user_id = $1", [USER_ID, "原名"]));
});

async function provenanceRowsFor(type: string, targetId: string) {
  return asOwner((c) =>
    c.query<{ type: string; actor_id: string; target_kind: string; target_id: string; detail: Record<string, unknown> }>(
      "SELECT type, actor_id, target_kind, target_id, detail FROM provenance_events WHERE org_id = $1 AND type = $2 AND target_id = $3",
      [ORG, type, targetId],
    ),
  );
}

describe("updateOwnProfile", () => {
  it("改名真的落库——不是只改了返回值（反证 A/B 的绿态基线）", async () => {
    const out = await updateOwnProfile(
      { credentials: repo, avatars, provenance },
      { userId: USER_ID, orgId: toOrgId(ORG), displayName: "新名字" },
    );

    expect(out.displayName).toBe("新名字");
    expect(out.avatarUrl).toBeNull();

    // 独立重新查库，绕开被测用例的返回值。
    const row = await readCredentialByEmail(EMAIL);
    expect(row?.display_name).toBe("新名字");
  });

  it("反证（#638 迭代 4）：改名成功写一条 profile-renamed，actor/target 都是本人账户", async () => {
    await updateOwnProfile(
      { credentials: repo, avatars, provenance },
      { userId: USER_ID, orgId: toOrgId(ORG), displayName: "反证专用新名字" },
    );

    const events = await provenanceRowsFor("profile-renamed", USER_ID);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({
      type: "profile-renamed",
      actor_id: USER_ID,
      target_kind: "account",
      target_id: USER_ID,
    });
    expect(events.rows[0]!.detail).toEqual({ displayName: "反证专用新名字" });
  });

  it("displayName 与 avatarArtifactId 都缺失时拒绝 INVALID_INPUT，不做静默 no-op", async () => {
    await expect(
      updateOwnProfile({ credentials: repo, avatars, provenance }, { userId: USER_ID, orgId: toOrgId(ORG) }),
    ).rejects.toThrow(UpdateOwnProfileError);

    const row = await readCredentialByEmail(EMAIL);
    expect(row?.display_name).toBe("原名"); // 未改动

    // 拒绝路径不写审计——没有发生的更新不该留下"发生过"的痕迹。
    const events = await provenanceRowsFor("profile-renamed", USER_ID);
    expect(events.rows).toHaveLength(0);
  });

  it("avatarArtifactId 指向别人的 artifact 时拒绝 AVATAR_ARTIFACT_NOT_OWNED，不落库、不写审计", async () => {
    // 造一个属于 OTHER_USER_ID 的 avatar 元数据行（对象存储字节在这条测试里无关紧要）。
    const foreignArtifactId = `avatar-${randomBytes(8).toString("hex")}`;
    await avatars.create({
      artifactId: foreignArtifactId,
      userId: OTHER_USER_ID,
      objectKey: `avatars/${OTHER_USER_ID}/${foreignArtifactId}`,
      contentType: "image/png",
      sizeBytes: 100,
      sha256: "0".repeat(64),
    });

    await expect(
      updateOwnProfile(
        { credentials: repo, avatars, provenance },
        { userId: USER_ID, orgId: toOrgId(ORG), avatarArtifactId: foreignArtifactId },
      ),
    ).rejects.toThrow(UpdateOwnProfileError);

    const row = await readCredentialByEmail(EMAIL);
    expect(row?.avatar_artifact_id ?? null).toBeNull();

    const events = await provenanceRowsFor("avatar-changed", USER_ID);
    expect(events.rows).toHaveLength(0);
  });

  it("avatarArtifactId 指向自己的 artifact 时真的落库——反证 A/B 同款独立重查，且写一条 avatar-changed", async () => {
    const ownArtifactId = `avatar-${randomBytes(8).toString("hex")}`;
    await avatars.create({
      artifactId: ownArtifactId,
      userId: USER_ID,
      objectKey: `avatars/${USER_ID}/${ownArtifactId}`,
      contentType: "image/png",
      sizeBytes: 100,
      sha256: "1".repeat(64),
    });

    const out = await updateOwnProfile(
      { credentials: repo, avatars, provenance },
      { userId: USER_ID, orgId: toOrgId(ORG), avatarArtifactId: ownArtifactId },
    );
    expect(out.avatarUrl).toBe(`/identity/me/avatar/${ownArtifactId}`);

    const row = await readCredentialByEmail(EMAIL);
    expect(row?.avatar_artifact_id).toBe(ownArtifactId);
    expect(row?.avatar_url).toBe(`/identity/me/avatar/${ownArtifactId}`);

    const events = await provenanceRowsFor("avatar-changed", USER_ID);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({ type: "avatar-changed", actor_id: USER_ID, target_kind: "account", target_id: USER_ID });
    expect(events.rows[0]!.detail).toEqual({ avatarArtifactId: ownArtifactId, cleared: false });
  });

  it("avatarArtifactId 传 null 清空头像回默认，且写一条 cleared:true 的 avatar-changed", async () => {
    const ownArtifactId = `avatar-${randomBytes(8).toString("hex")}`;
    await avatars.create({
      artifactId: ownArtifactId,
      userId: USER_ID,
      objectKey: `avatars/${USER_ID}/${ownArtifactId}`,
      contentType: "image/png",
      sizeBytes: 100,
      sha256: "2".repeat(64),
    });
    await updateOwnProfile(
      { credentials: repo, avatars, provenance },
      { userId: USER_ID, orgId: toOrgId(ORG), avatarArtifactId: ownArtifactId },
    );

    const out = await updateOwnProfile(
      { credentials: repo, avatars, provenance },
      { userId: USER_ID, orgId: toOrgId(ORG), avatarArtifactId: null },
    );
    expect(out.avatarUrl).toBeNull();

    const row = await readCredentialByEmail(EMAIL);
    expect(row?.avatar_artifact_id ?? null).toBeNull();
    expect(row?.avatar_url ?? null).toBeNull();

    // 两次调用各写各的：先 set（cleared:false）后 clear（cleared:true），恰好两条。
    const events = await provenanceRowsFor("avatar-changed", USER_ID);
    expect(events.rows).toHaveLength(2);
    const clearRow = events.rows.find((r) => (r.detail as { cleared: boolean }).cleared === true);
    expect(clearRow?.detail).toEqual({ avatarArtifactId: null, cleared: true });
  });
});
