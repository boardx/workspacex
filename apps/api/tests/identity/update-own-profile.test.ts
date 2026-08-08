/**
 * `updateOwnProfile`（#638 delta，迭代 1）—— 自助改名，真 Postgres。
 *
 * ## 反证 A/B 怎么戳穿（本文件的核心断言）
 *
 * 一个只改了返回值、没有真的执行 `UPDATE credentials` 的实现，会让「用例返回的
 * `displayName` 看起来对」这条断言照样绿——所以本文件在用例返回之后**独立重新查库**
 * （`readCredentialByEmail`，绕开被测代码的返回值），断言库里那一行也真的变了。
 * 只信返回值 = 只信被测代码自己的说法。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UpdateOwnProfileError, updateOwnProfile } from "../../src/application/identity/update-own-profile";
import { PgCredentialRepository } from "../../src/infrastructure/auth/pg-credential-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";
import { seedCredential } from "../support/auth";
import { readCredentialByEmail } from "../support/auth-db";

const USER_ID = "u-f638-profile";
const EMAIL = "profile-owner@f638.test";

let db: PgDatabase;
let repo: PgCredentialRepository;

const HOOK_TIMEOUT_MS = 60_000;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgCredentialRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await seedCredential({ userId: USER_ID, email: EMAIL, password: "correct horse battery staple", displayName: "原名" });
  // ⚠ `seedCredential` 的 ON CONFLICT 分支不覆盖 `display_name`（fixture 本身的既有行为，
  // 见 tests/support/auth.ts）——上一个测试改过名的话，这里显式复位，否则每个 it 之间
  // 不是真正独立的。
  await asOwner((c) => c.query("UPDATE credentials SET display_name = $2 WHERE user_id = $1", [USER_ID, "原名"]));
});

describe("updateOwnProfile", () => {
  it("改名真的落库——不是只改了返回值（反证 A/B 的绿态基线）", async () => {
    const out = await updateOwnProfile({ credentials: repo }, { userId: USER_ID, displayName: "新名字" });

    expect(out.displayName).toBe("新名字");
    expect(out.avatarUrl).toBeNull();

    // 独立重新查库，绕开被测用例的返回值。
    const row = await readCredentialByEmail(EMAIL);
    expect(row?.display_name).toBe("新名字");
  });

  it("displayName 缺失时拒绝 INVALID_INPUT，不做静默 no-op", async () => {
    await expect(updateOwnProfile({ credentials: repo }, { userId: USER_ID })).rejects.toThrow(UpdateOwnProfileError);

    const row = await readCredentialByEmail(EMAIL);
    expect(row?.display_name).toBe("原名"); // 未改动
  });

  it("avatarArtifactId 非 null 时拒绝 INVALID_INPUT——uploadOwnAvatar 本轮未实现", async () => {
    await expect(
      updateOwnProfile({ credentials: repo }, { userId: USER_ID, displayName: "新名字2", avatarArtifactId: "art-1" }),
    ).rejects.toThrow(UpdateOwnProfileError);

    // 拒绝必须在改名之前发生——displayName 不应该被顺带改掉。
    const row = await readCredentialByEmail(EMAIL);
    expect(row?.display_name).toBe("原名");
  });
});
