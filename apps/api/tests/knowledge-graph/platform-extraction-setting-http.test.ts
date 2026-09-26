/**
 * 用户直接交办（2026-09-25，ad-hoc）—— `GET`/`PUT /platform/knowledge-graph/extraction-setting`
 * 的权限形状，真实 HTTP + 真实 Nest 授权 + 真实 Postgres（同
 * `org-extraction-setting-permission.test.ts` 的 `x-kernel-test-principal` 测试身份跑法）：
 *   · 非平台运营准入：GET/PUT 都 403 `NOT_PLATFORM_SUPERUSER`，落库的值不变。
 *   · 平台超管（`PLATFORM_SUPERUSER_EMAILS` 白名单）：GET/PUT 都 200，写完立即反映在下一次读上。
 *   · 可来回切换（不是只能开一次）。
 *
 * ⚠ `kg_extraction_state` 全库单例、跨测试文件共享——本文件末尾 `afterAll` 把它兜回 `true`
 *   （迁移 20260925120000 的默认值），不留一个被本文件改成 `false` 的进程状态给其他并行文件。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCredential, asOwner, ensureDatabase, migrateOnce } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const OPS = `u-kg-deploy-ops-${randomUUID().slice(0, 8)}`;
const OPS_EMAIL = `${OPS}@platform-extraction.test`;
const MEMBER = `u-kg-deploy-member-${randomUUID().slice(0, 8)}`;
const ORG = `org-kg-deploy-toggle-${randomUUID().slice(0, 8)}`;

let app: NestExpressApplication;
let base: string;
const ORIGINAL_WHITELIST = process.env.PLATFORM_SUPERUSER_EMAILS;

const headers = (actor: string) => ({ "x-kernel-test-principal": `${actor}:${ORG}`, "content-type": "application/json" });
const request = (path: string, method = "GET", actor = OPS, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: headers(actor), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  await addCredential(OPS, OPS_EMAIL, "KG Deploy Ops");
  process.env.PLATFORM_SUPERUSER_EMAILS = OPS_EMAIL;
}, 180_000);

afterAll(async () => {
  if (ORIGINAL_WHITELIST === undefined) delete process.env.PLATFORM_SUPERUSER_EMAILS;
  else process.env.PLATFORM_SUPERUSER_EMAILS = ORIGINAL_WHITELIST;
  // 兜底：全库单例回到迁移的默认值，不把某个并行文件跑到一半的「关」状态留给别的文件。
  await asOwner((c) => c.query("SELECT kg_extraction_set_enabled(true)"));
  await app?.close();
});

describe("F-KG-DEPLOY-TOGGLE HTTP: 平台级抽取开关的读写权限", () => {
  it("非平台运营准入：GET/PUT 都 403 NOT_PLATFORM_SUPERUSER，落库的值不变", async () => {
    const before = await asOwner((c) => c.query<{ enabled: boolean }>("SELECT enabled FROM kg_extraction_state WHERE singleton"));

    const getDenied = await request("/platform/knowledge-graph/extraction-setting", "GET", MEMBER);
    expect(getDenied.status).toBe(403);
    expect(await getDenied.json()).toMatchObject({ reasonCode: "NOT_PLATFORM_SUPERUSER" });

    const putDenied = await request("/platform/knowledge-graph/extraction-setting", "PUT", MEMBER, { enabled: !before.rows[0]!.enabled });
    expect(putDenied.status).toBe(403);
    expect(await putDenied.json()).toMatchObject({ reasonCode: "NOT_PLATFORM_SUPERUSER" });

    const after = await asOwner((c) => c.query<{ enabled: boolean }>("SELECT enabled FROM kg_extraction_state WHERE singleton"));
    expect(after.rows[0]?.enabled).toBe(before.rows[0]?.enabled);
  });

  it("平台超管：GET 读到现值；PUT 200，立即反映在下一次读上；可来回切换", async () => {
    try {
      const on = await request("/platform/knowledge-graph/extraction-setting", "PUT", OPS, { enabled: true });
      expect(on.status).toBe(200);
      const onBody = await on.json() as { providerConfigured: boolean; enabled: boolean };
      expect(onBody.enabled).toBe(true);
      expect(typeof onBody.providerConfigured).toBe("boolean");

      const readBack = await request("/platform/knowledge-graph/extraction-setting", "GET", OPS);
      expect(readBack.status).toBe(200);
      expect(await readBack.json()).toMatchObject({ enabled: true });

      const off = await request("/platform/knowledge-graph/extraction-setting", "PUT", OPS, { enabled: false });
      expect(off.status).toBe(200);
      expect(await off.json()).toMatchObject({ enabled: false });

      const readBackOff = await request("/platform/knowledge-graph/extraction-setting", "GET", OPS);
      expect(await readBackOff.json()).toMatchObject({ enabled: false });
    } finally {
      await asOwner((c) => c.query("SELECT kg_extraction_set_enabled(true)"));
    }
  });
});
