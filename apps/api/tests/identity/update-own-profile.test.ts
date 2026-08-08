/**
 * `updateOwnProfile`（#638 delta；迭代 1 改名，迭代 2 补头像）—— 真 Postgres。
 *
 * ## 反证 A/B 怎么戳穿（本文件的核心断言）
 *
 * 一个只改了返回值、没有真的执行 `UPDATE credentials` 的实现，会让「用例返回的
 * `displayName` 看起来对」这条断言照样绿——所以本文件在用例返回之后**独立重新查库**
 * （`readCredentialByEmail`，绕开被测代码的返回值），断言库里那一行也真的变了。
 * 只信返回值 = 只信被测代码自己的说法。
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UpdateOwnProfileError, updateOwnProfile } from "../../src/application/identity/update-own-profile";
import { PgCredentialRepository } from "../../src/infrastructure/auth/pg-credential-repository";
import { PgAvatarRepository } from "../../src/infrastructure/auth/pg-avatar-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";
import { seedCredential } from "../support/auth";
import { readCredentialByEmail } from "../support/auth-db";

const USER_ID = "u-f638-profile";
const OTHER_USER_ID = "u-f638-profile-other";
const EMAIL = "profile-owner@f638.test";
const OTHER_EMAIL = "profile-other@f638.test";

let db: PgDatabase;
let repo: PgCredentialRepository;
let avatars: PgAvatarRepository;

const HOOK_TIMEOUT_MS = 60_000;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgCredentialRepository(db);
  avatars = new PgAvatarRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await seedCredential({ userId: USER_ID, email: EMAIL, password: "correct horse battery staple", displayName: "原名" });
  await seedCredential({ userId: OTHER_USER_ID, email: OTHER_EMAIL, password: "correct horse battery staple", displayName: "别人" });
  // ⚠ `seedCredential` 的 ON CONFLICT 分支不覆盖 `display_name`（fixture 本身的既有行为，
  // 见 tests/support/auth.ts）——上一个测试改过名的话，这里显式复位，否则每个 it 之间
  // 不是真正独立的。
  await asOwner((c) => c.query("UPDATE credentials SET display_name = $2, avatar_artifact_id = NULL, avatar_url = NULL WHERE user_id = $1", [USER_ID, "原名"]));
});

describe("updateOwnProfile", () => {
  it("改名真的落库——不是只改了返回值（反证 A/B 的绿态基线）", async () => {
    const out = await updateOwnProfile({ credentials: repo, avatars }, { userId: USER_ID, displayName: "新名字" });

    expect(out.displayName).toBe("新名字");
    expect(out.avatarUrl).toBeNull();

    // 独立重新查库，绕开被测用例的返回值。
    const row = await readCredentialByEmail(EMAIL);
    expect(row?.display_name).toBe("新名字");
  });

  it("displayName 与 avatarArtifactId 都缺失时拒绝 INVALID_INPUT，不做静默 no-op", async () => {
    await expect(updateOwnProfile({ credentials: repo, avatars }, { userId: USER_ID })).rejects.toThrow(UpdateOwnProfileError);

    const row = await readCredentialByEmail(EMAIL);
    expect(row?.display_name).toBe("原名"); // 未改动
  });

  it("avatarArtifactId 指向别人的 artifact 时拒绝 AVATAR_ARTIFACT_NOT_OWNED，不落库", async () => {
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
      updateOwnProfile({ credentials: repo, avatars }, { userId: USER_ID, avatarArtifactId: foreignArtifactId }),
    ).rejects.toThrow(UpdateOwnProfileError);

    const row = await readCredentialByEmail(EMAIL);
    expect(row?.avatar_artifact_id ?? null).toBeNull();
  });

  it("avatarArtifactId 指向自己的 artifact 时真的落库——反证 A/B 同款独立重查", async () => {
    const ownArtifactId = `avatar-${randomBytes(8).toString("hex")}`;
    await avatars.create({
      artifactId: ownArtifactId,
      userId: USER_ID,
      objectKey: `avatars/${USER_ID}/${ownArtifactId}`,
      contentType: "image/png",
      sizeBytes: 100,
      sha256: "1".repeat(64),
    });

    const out = await updateOwnProfile({ credentials: repo, avatars }, { userId: USER_ID, avatarArtifactId: ownArtifactId });
    expect(out.avatarUrl).toBe(`/identity/me/avatar/${ownArtifactId}`);

    const row = await readCredentialByEmail(EMAIL);
    expect(row?.avatar_artifact_id).toBe(ownArtifactId);
    expect(row?.avatar_url).toBe(`/identity/me/avatar/${ownArtifactId}`);
  });

  it("avatarArtifactId 传 null 清空头像回默认", async () => {
    const ownArtifactId = `avatar-${randomBytes(8).toString("hex")}`;
    await avatars.create({
      artifactId: ownArtifactId,
      userId: USER_ID,
      objectKey: `avatars/${USER_ID}/${ownArtifactId}`,
      contentType: "image/png",
      sizeBytes: 100,
      sha256: "2".repeat(64),
    });
    await updateOwnProfile({ credentials: repo, avatars }, { userId: USER_ID, avatarArtifactId: ownArtifactId });

    const out = await updateOwnProfile({ credentials: repo, avatars }, { userId: USER_ID, avatarArtifactId: null });
    expect(out.avatarUrl).toBeNull();

    const row = await readCredentialByEmail(EMAIL);
    expect(row?.avatar_artifact_id ?? null).toBeNull();
    expect(row?.avatar_url ?? null).toBeNull();
  });
});
