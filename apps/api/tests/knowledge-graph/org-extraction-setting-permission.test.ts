/**
 * issue #4178 —— `getKnowledgeExtractionSetting` / `setKnowledgeExtractionSetting` 的权限
 * 形状，真实 HTTP + 真实 Nest 授权 + 真实 Postgres（同 `workbench-control-http-acceptance.test.ts`
 * 的 `x-kernel-test-principal` 测试身份，S2 同一套跑法）：
 *   · 读：任何组织成员（含非 admin）都能读到现值——这是「这个组织现在抽不抽」这件事本身。
 *   · 写：仅组织 admin；非 admin 调用得到 403 `KG_NOT_ORG_ADMIN`，落库的值不变。
 *   · 写成功后立即反映在下一次读上；`deploymentCapable` 完全由部署环境决定，写操作动不了它。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = `org-kg-f4178-perm-${randomUUID().slice(0, 8)}`;
const ADMIN = "admin-kg-f4178";
const MEMBER = "member-kg-f4178";

let app: NestExpressApplication;
let base: string;

const headers = (actor: string) => ({ "x-kernel-test-principal": `${actor}:${ORG}`, "content-type": "application/json" });
const request = (path: string, method = "GET", actor = ADMIN, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: headers(actor), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 180_000);
afterAll(async () => { await app?.close(); });

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
});

describe("F4178 HTTP: 记忆抽取设置的读写权限", () => {
  it("组织从未设置过（没有行）⇒ 读到 orgEnabled: true（默认开）", async () => {
    // `seedOrg` 给测试组织写了一条显式关掉的行（见 tests/support/db.ts）；删掉它回到新组织的真实初始状态。
    await asOwner((c) => c.query("DELETE FROM kg_org_extraction_settings WHERE org_id = $1", [ORG]));
    const r = await request("/knowledge-graph/extraction-setting", "GET", MEMBER);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ orgEnabled: true });
  });

  it("任何组织成员都能读到现值（非 admin 不 403）", async () => {
    const asAdmin = await request("/knowledge-graph/extraction-setting", "GET", ADMIN);
    expect(asAdmin.status).toBe(200);
    const adminBody = await asAdmin.json() as { deploymentCapable: boolean; orgEnabled: boolean };
    // `seedOrg` 的显式关掉行 ⇒ false（显式关优先于默认开）。
    expect(adminBody).toMatchObject({ orgEnabled: false });
    expect(typeof adminBody.deploymentCapable).toBe("boolean");

    const asMember = await request("/knowledge-graph/extraction-setting", "GET", MEMBER);
    expect(asMember.status).toBe(200);
    expect(await asMember.json()).toEqual(adminBody);
  });

  it("非 admin 写 ⇒ 403 KG_NOT_ORG_ADMIN，落库的值不变", async () => {
    const denied = await request("/knowledge-graph/extraction-setting", "PUT", MEMBER, { enabled: true });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ reasonCode: "KG_NOT_ORG_ADMIN" });

    const row = await asOwner((c) => c.query(
      "SELECT enabled FROM kg_org_extraction_settings WHERE org_id = $1", [ORG],
    ));
    // 非 admin 的写从未落地——`seedOrg` 写的那条显式关掉的行原样还在。
    expect(row.rows[0]?.enabled).toBe(false);
  });

  it("admin 写 ⇒ 200，且立即反映在下一次读上；组织开关可来回切换", async () => {
    const on = await request("/knowledge-graph/extraction-setting", "PUT", ADMIN, { enabled: true });
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({ orgEnabled: true });

    const readBack = await request("/knowledge-graph/extraction-setting", "GET", MEMBER);
    expect(await readBack.json()).toMatchObject({ orgEnabled: true });

    // 可逆：admin 再关回去。
    const off = await request("/knowledge-graph/extraction-setting", "PUT", ADMIN, { enabled: false });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ orgEnabled: false });
  });

  it("跨组织：另一个组织的 admin 改不了这个组织的开关（principal 的 org 就是被改的 org，没有跨组织入参）", async () => {
    const OTHER = `${ORG}-other`;
    await resetOrgs(OTHER);
    await seedOrg({ orgId: OTHER, projectId: `${OTHER}-p` });
    const otherAdmin = "other-admin-kg-f4178";
    await addOrgMember(OTHER, otherAdmin, "admin", null);

    const r = await fetch(`${base}/knowledge-graph/extraction-setting`, {
      method: "PUT",
      headers: { "x-kernel-test-principal": `${otherAdmin}:${OTHER}`, "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(r.status).toBe(200);

    // 目标组织（ORG）完全不受影响——写只能作用于调用者自己当前所在的组织。
    const untouched = await asOwner((c) => c.query(
      "SELECT enabled FROM kg_org_extraction_settings WHERE org_id = $1", [ORG],
    ));
    // `seedOrg` 写的那条显式关掉的行原样还在（行不存在也算被改——没有行 = 默认开）。
    expect(untouched.rows[0]?.enabled).toBe(false);
  });
});
