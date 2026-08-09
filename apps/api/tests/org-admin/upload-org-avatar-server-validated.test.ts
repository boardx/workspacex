/**
 * `uploadOrgAvatar`（#363 delta）—— 真实 Postgres + 真实（临时目录）对象存储。
 *
 * 反证（verification.md 逐字）：绕过前端直接发超限/错误 content-type 请求 →
 * 服务端真的拒绝，不落对象存储。三条分别断言：
 *   ① 实际字节数超过 5MB 硬上限（不是声明的 sizeBytes）→ FILE_TOO_LARGE，
 *      且 `org_avatar_artifacts` 里没有新行；
 *   ② 声明 image/png 但字节其实是 jpeg 的 magic number → UNSUPPORTED_CONTENT_TYPE，
 *      不落地；
 *   ③ 非 admin 调用 → PROJECT_ROLE_INSUFFICIENT，同样不落地。
 * 最后一条正例：真实 PNG 字节 + admin → 真的落对象存储，能读回同样的字节。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uploadOrgAvatar } from "../../src/application/auth/upload-org-avatar";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import { PgOrgProfileRepository } from "../../src/infrastructure/auth/pg-org-profile-repository";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addCredential, addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORG = "org-i363-upload-avatar";
const ADMIN = "u-avatar-admin";

let db: PgDatabase;
let repo: PgOrgProfileRepository;

const HOOK_TIMEOUT_MS = 60_000;

// 8x8 真实 PNG（最小合法 PNG 签名 + IHDR，够 magic-byte 嗅探判定为 "png"）。
const REAL_PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000800000008080600000098e5a90c0000000a49444154789c6360000002000155ff9db60000000049454e44ae426082",
  "hex",
);
// JPEG 的 magic number（FF D8 FF），声明为 image/png 时应触发 UNSUPPORTED_CONTENT_TYPE。
const JPEG_MAGIC_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

async function countAvatarRows(orgId: string): Promise<number> {
  return asOwner(async (c) => {
    const r = await c.query<{ n: string }>("SELECT count(*)::text AS n FROM org_avatar_artifacts WHERE org_id = $1", [
      orgId,
    ]);
    return Number(r.rows[0]?.n ?? "0");
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  const store = new FsObjectStore(mkdtempSync(join(tmpdir(), "i363-avatar-")));
  repo = new PgOrgProfileRepository(db, store);
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
  await addCredential(ADMIN, "admin@i363-avatar.test", "Admin");
  await addOrgMember(ORG, ADMIN, "admin", null);
}

describe("uploadOrgAvatar — 服务端真实校验", () => {
  it("① 实际字节数超过 5MB 硬上限 —— FILE_TOO_LARGE，不落对象存储/不落库", async () => {
    await seedAdmin();
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);

    await expect(
      uploadOrgAvatar(
        { repo },
        {
          orgId: toOrgId(ORG),
          actorId: ADMIN,
          actorOrgRole: "admin",
          bytes: oversized,
          declaredSizeBytes: oversized.byteLength,
          declaredContentType: "image/png",
          declaredSha256: "irrelevant",
        },
      ),
    ).rejects.toMatchObject(new OrgAdminError("FILE_TOO_LARGE"));

    expect(await countAvatarRows(ORG)).toBe(0);
  });

  it("② 声明 image/png 但字节其实是 jpeg —— UNSUPPORTED_CONTENT_TYPE，不落地", async () => {
    await seedAdmin();

    await expect(
      uploadOrgAvatar(
        { repo },
        {
          orgId: toOrgId(ORG),
          actorId: ADMIN,
          actorOrgRole: "admin",
          bytes: new Uint8Array(JPEG_MAGIC_BYTES),
          declaredSizeBytes: JPEG_MAGIC_BYTES.byteLength,
          declaredContentType: "image/png",
          declaredSha256: "irrelevant",
        },
      ),
    ).rejects.toMatchObject(new OrgAdminError("UNSUPPORTED_CONTENT_TYPE"));

    expect(await countAvatarRows(ORG)).toBe(0);
  });

  it("③ 非 admin 调用 —— PROJECT_ROLE_INSUFFICIENT，不落地", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    await addCredential("u-consultant", "consultant@i363-avatar.test", "Consultant");
    await addOrgMember(ORG, "u-consultant", "consultant", null);

    await expect(
      uploadOrgAvatar(
        { repo },
        {
          orgId: toOrgId(ORG),
          actorId: "u-consultant",
          actorOrgRole: "consultant",
          bytes: new Uint8Array(REAL_PNG_BYTES),
          declaredSizeBytes: REAL_PNG_BYTES.byteLength,
          declaredContentType: "image/png",
          declaredSha256: "irrelevant",
        },
      ),
    ).rejects.toMatchObject(new OrgAdminError("PROJECT_ROLE_INSUFFICIENT"));

    expect(await countAvatarRows(ORG)).toBe(0);
  });

  it("正例：真实 PNG + admin —— 真的落对象存储，能读回同样的字节", async () => {
    await seedAdmin();

    const out = await uploadOrgAvatar(
      { repo },
      {
        orgId: toOrgId(ORG),
        actorId: ADMIN,
        actorOrgRole: "admin",
        bytes: new Uint8Array(REAL_PNG_BYTES),
        declaredSizeBytes: REAL_PNG_BYTES.byteLength,
        declaredContentType: "image/png",
        declaredSha256: "real-sha",
      },
    );

    expect(out.orgAvatarArtifactId).toBeTruthy();
    expect(out.avatarUrl).toContain(out.orgAvatarArtifactId);
    expect(await countAvatarRows(ORG)).toBe(1);

    const readBack = await repo.readAvatarBytes(toOrgId(ORG), out.orgAvatarArtifactId);
    expect(readBack).not.toBeNull();
    expect(Buffer.from(readBack!.bytes).equals(REAL_PNG_BYTES)).toBe(true);
    expect(readBack!.contentType).toBe("image/png");
  });
});
