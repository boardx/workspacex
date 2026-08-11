/**
 * `uploadOrgAvatar` —— **HTTP 路由层**的端到端反证（devapp「卡在上传中…」缺陷的还原试验）。
 *
 * 既有的 `upload-org-avatar-server-validated.test.ts` 直接调用用例函数，从未经过
 * `readRawBody`（controller 手写的原始流读取）。生产（devapp.boardx.us）人类实测
 * 上传按钮永远停在「上传中…」——fetch 不 resolve，说明服务端在 HTTP 层挂起。
 * 本文件用与浏览器完全相同的请求形状（元数据走查询串 + 原始二进制体 + 真实 TCP）
 * 打真实监听端口，证明这条路在超时时间内必然给出响应。
 *
 * ⚠ 每个 it 都带显式超时——「挂住」正是被测缺陷的形态，测试自身绝不许挂住。
 */
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { addCredential, addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-avatar-http-route";
const ADMIN = "u-avatar-http-admin";

const HOOK_TIMEOUT_MS = 60_000;
const CASE_TIMEOUT_MS = 20_000;
/** 单发请求的硬超时：真实服务器在本地环回上正常应在毫秒级返回；10s 足够慷慨。 */
const REQUEST_TIMEOUT_MS = 10_000;

// 8x8 真实 PNG（同 upload-org-avatar-server-validated.test.ts）。
const REAL_PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000800000008080600000098e5a90c0000000a49444154789c6360000002000155ff9db60000000049454e44ae426082",
  "hex",
);

let app: NestExpressApplication;
let base = "";

function uploadUrl(bytes: Buffer, contentType: string): string {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const q = new URLSearchParams({
    filename: "avatar.png",
    sizeBytes: String(bytes.byteLength),
    sha256,
    contentType,
  });
  return `${base}/organizations/${ORG}/avatar?${q.toString()}`;
}

/** 浏览器 `live-org-admin.ts#uploadOrgAvatar` 的忠实复刻：原始字节体 + 元数据查询串。 */
function uploadAvatar(bytes: Buffer, contentType = "image/png"): Promise<Response> {
  return fetch(uploadUrl(bytes, contentType), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": contentType,
      "x-kernel-test-principal": `${ADMIN}:${ORG}`,
    },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await app?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
  await addCredential(ADMIN, "admin@avatar-http.test", "Admin");
  await addOrgMember(ORG, ADMIN, "admin", null);
}, HOOK_TIMEOUT_MS);

describe("POST /organizations/:orgId/avatar —— 真实 HTTP，必须在超时内响应", () => {
  it(
    "正例：真实 PNG 字节 + admin → 200，返回 orgAvatarArtifactId / avatarUrl",
    async () => {
      const res = await uploadAvatar(REAL_PNG_BYTES);
      expect(res.status).toBe(201);
      const json = (await res.json()) as { orgAvatarArtifactId?: string; avatarUrl?: string };
      expect(json.orgAvatarArtifactId).toMatch(/^org-avatar-/);
      expect(json.avatarUrl).toContain(`/organizations/${ORG}/avatar-file/`);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "负例：声明 image/png 但字节是 JPEG magic → 415 UNSUPPORTED_CONTENT_TYPE（不是挂起）",
    async () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      const res = await uploadAvatar(jpeg, "image/png");
      expect(res.status).toBe(415);
      const json = (await res.json()) as { reasonCode?: string };
      expect(json.reasonCode).toBe("UNSUPPORTED_CONTENT_TYPE");
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "较大文件（1MB，多个 TCP 分片）也必须在超时内完成 —— readRawBody 不许因分片而丢 end 事件",
    async () => {
      // 用真实 PNG 头 + 填充字节构造 1MB 的「PNG」——嗅探只看 magic bytes，
      // 这里测的是流读取，不是图片解码。
      const big = Buffer.concat([REAL_PNG_BYTES, Buffer.alloc(1024 * 1024 - REAL_PNG_BYTES.length)]);
      const res = await uploadAvatar(big);
      expect(res.status).toBe(201);
    },
    CASE_TIMEOUT_MS,
  );
});
