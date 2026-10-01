/**
 * 回归：真实栈 `/agent` 页显示「角色目录加载失败：AGENT_NOT_FOUND」。
 *
 * 根因：`KernelModule.controllers` 里 `AgentController`（`GET /agents/:agentId`）注册在
 * `AgentDirectoryController`（`GET /agents/directory`）之前，Express 按注册顺序匹配，
 * 于是 `/agents/directory` 被当成 agentId="directory" 走进 `getCapabilityGraph` → 404。
 * 控制器单测（直接 new 控制器）看不到路由顺序，所以这里起**真实 Nest app**、走真实 HTTP。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentRole as R } from "@repo/contracts";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = `org-agent-dir-route-${randomUUID().slice(0, 8)}`;
const MEMBER = `u-agent-dir-route-${randomUUID().slice(0, 8)}`;

let app: NestExpressApplication;
let base: string;

const get = (path: string) => fetch(`${base}${path}`, { headers: { "x-kernel-test-principal": `${MEMBER}:${ORG}` } });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await seedOrg({ orgId: ORG, projectId: `p-${ORG}` });
  await addOrgMember(ORG, MEMBER, "consultant", null);
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

describe("GET /agents/directory 路由不被 GET /agents/:agentId 吞掉", () => {
  it("列表 → 200 契约形状（不是 404 AGENT_NOT_FOUND）", async () => {
    const res = await get("/agents/directory");
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(text).not.toContain("AGENT_NOT_FOUND");
    expect(Array.isArray(R.operations.listAgentDirectory.out.parse(JSON.parse(text)).items)).toBe(true);
  });

  it("带过滤参数同样命中目录控制器", async () => {
    const res = await get("/agents/directory?roleCategory=research&q=x");
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("详情补充 /agents/directory/:id/profile 命中目录控制器：不可见 → 404 AGENT_NOT_FOUND（真实 SQL 可执行）", async () => {
    const res = await get("/agents/directory/agent-missing/profile");
    const text = await res.text();
    expect(res.status, text).toBe(404);
    expect(text).toContain("AGENT_NOT_FOUND");
  });
});
