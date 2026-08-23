/**
 * #1915 —— `GET /agents`（`listAgents`，契约 `agent-runtime.ts`）从 HTTP 真的可达。
 *
 * 规避的空转形状（与 #617 `create-agent-http-route.test.ts` 同一份纪律）：
 * ① ⛔ 只断言 status —— 正样本断言返回的行内容与刚创建的 agent 逐字对应。
 * ② ⛔ "answers 404" 型 —— 配了正样本 + 装置自检（邻近未知路径确实 404）。
 * ③ ⛔ 只测"能读"，不测"读不到不该读的" —— 断言跨组织/未落库行不泄漏。
 *
 * 反证义务：
 *   A：把 admin 授权门摘掉 ⇒ 断言必须变红 —— 见「授权」一节（非 admin 必须 403）。
 *   B：把 `WHERE initials IS NOT NULL` 等判据摘掉 ⇒ agent-starter-import 行会混进来 ——
 *      见「装置自检：非 createAgent 落库的行不出现」。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentRuntime as AR } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1915-list-agents-http";
const OTHER_ORG = "org-i1915-list-agents-http-other";
const ADMIN = "u-i1915-list-agents-admin";
const MEMBER = "u-i1915-list-agents-member";

let app: NestExpressApplication;
let base = "";

const authFor = (userId: string) => ({ "x-kernel-test-principal": `${userId}:${ORG}` });
const authForOrg = (userId: string, orgId: string) => ({ "x-kernel-test-principal": `${userId}:${orgId}` });

function get(path: string, headers: Record<string, string>): Promise<Response> {
  return fetch(`${base}${path}`, { method: "GET", headers });
}

async function createAgent(
  userId: string,
  overrides: Partial<{
    name: string;
    initials: string;
    role: string;
    roleLabel: string;
    visibility: "全组织可用" | "仅某组";
  }> = {},
): Promise<string> {
  const response = await fetch(`${base}/agents`, {
    method: "POST",
    headers: { ...authFor(userId), "content-type": "application/json" },
    body: JSON.stringify({
      name: overrides.name ?? "值班助理",
      initials: overrides.initials ?? "ZB",
      role: overrides.role ?? "值班一句话",
      roleLabel: overrides.roleLabel ?? "值班助理",
      visibility: overrides.visibility ?? "全组织可用",
      cloneFrom: null,
      source: "self",
    }),
  });
  const parsed = AR.operations.createAgent.out.parse(await response.json());
  return parsed.agentId;
}

/** agent-starter-import 那条写路径落的行——initials/role/visibility/publish_state 全是 NULL。 */
async function seedStarterImportRow(): Promise<string> {
  const agentId = `agent-i1915-starter-${randomUUID()}`;
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$1,$3,'enabled',$4,now(),now())`,
      [agentId, ORG, "starter import row", ADMIN],
    ),
  );
  return agentId;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
  await resetOrgs(OTHER_ORG);
});

describe("路由真的存在（正样本，⚠ 没有它整个文件等于只测了 404）", () => {
  it("admin 建一个 agent 后能在 listAgents 里读到它，字段与创建时逐字对应", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i1915-list-agents" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    await addOrgMember(ORG, MEMBER, "consultant", null);

    const agentId = await createAgent(ADMIN, {
      name: "值班助理",
      initials: "ZB",
      role: "值班一句话",
      roleLabel: "值班头衔",
      visibility: "全组织可用",
    });

    const response = await get("/agents?tag=&publishState=&visibility=", authFor(ADMIN));
    expect(response.status).toBe(200);
    const rows = AR.operations.listAgents.out.parse(await response.json());
    const row = rows.find((r) => r.agentId === agentId);
    expect(row).toBeDefined();
    expect(row?.name).toBe("值班助理");
    expect(row?.initials).toBe("ZB");
    expect(row?.roleLabel).toBe("值班头衔");
    expect(row?.visibility).toBe("全组织可用");
    expect(row?.publishState).toBe("草稿");
    expect(row?.skillCount).toBe(0);
    expect(row?.monthlyCallCount).toBeNull();
  });

  it("装置自检：邻近的未知路径确实 404 ⇒ 上面那条 200 是这条路由给的", async () => {
    const response = await get("/agents-does-not-exist", authFor(ADMIN));
    expect(response.status).toBe(404);
  });

  it("不传任何查询参数（浏览器最常见的调用形态）也能 200", async () => {
    const response = await get("/agents", authFor(ADMIN));
    expect(response.status).toBe(200);
  });
});

describe("授权：非 admin 被拒", () => {
  it("consultant 读取 ⇒ 403 / ROLE_INSUFFICIENT", async () => {
    const response = await get("/agents", authFor(MEMBER));
    expect(response.status).toBe(403);
    expect((await response.json() as { reasonCode?: string }).reasonCode).toBe("ROLE_INSUFFICIENT");
  });
});

describe("装置自检：非 createAgent 落库的行不出现", () => {
  it("agent-starter-import 的行（initials/role/visibility/publish_state 全 NULL）不出现在列表里", async () => {
    const starterAgentId = await seedStarterImportRow();
    const response = await get("/agents", authFor(ADMIN));
    expect(response.status).toBe(200);
    const rows = AR.operations.listAgents.out.parse(await response.json());
    expect(rows.some((r) => r.agentId === starterAgentId)).toBe(false);
  });
});

describe("租户隔离：另一个组织的 admin 读不到这个组织的 agent", () => {
  it("OTHER_ORG 的 admin 读到的列表里没有 ORG 建的那些 agent", async () => {
    await resetOrgs(OTHER_ORG);
    await seedOrg({ orgId: OTHER_ORG, projectId: "proj-i1915-list-agents-other" });
    const otherAdmin = "u-i1915-list-agents-other-admin";
    await addOrgMember(OTHER_ORG, otherAdmin, "admin", null);

    const response = await get("/agents", authForOrg(otherAdmin, OTHER_ORG));
    expect(response.status).toBe(200);
    const rows = AR.operations.listAgents.out.parse(await response.json());
    expect(rows).toEqual([]);
  });
});

describe("过滤：publishState / visibility", () => {
  it("publishState=草稿 只返回草稿态的行", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i1915-list-agents" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    await createAgent(ADMIN, { initials: "F1", name: "过滤用一" });
    await createAgent(ADMIN, { initials: "F2", name: "过滤用二" });

    const response = await get(
      `/agents?${new URLSearchParams({ publishState: "草稿" }).toString()}`,
      authFor(ADMIN),
    );
    expect(response.status).toBe(200);
    const rows = AR.operations.listAgents.out.parse(await response.json());
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.publishState === "草稿")).toBe(true);
  });

  it("publishState=运行中 排除掉刚建的草稿", async () => {
    const response = await get(
      `/agents?${new URLSearchParams({ publishState: "运行中" }).toString()}`,
      authFor(ADMIN),
    );
    expect(response.status).toBe(200);
    const rows = AR.operations.listAgents.out.parse(await response.json());
    expect(rows.every((r) => r.publishState === "运行中")).toBe(true);
  });
});
