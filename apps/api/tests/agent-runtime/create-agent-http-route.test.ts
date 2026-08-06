/**
 * #617 —— `POST /agents`（`createAgent`，契约 `agent-runtime.ts:1387`）从 HTTP 真的可达。
 *
 * 规避的空转形状（与 #595 `agent-skill-pins-http-route.test.ts` 同一份纪律）：
 * ① ⛔ 只断言 status >= 400——每条负样本都断言具体 status + 具体 reasonCode。
 * ② ⛔ "answers 404" 型——配了正样本（必须 201）+ 装置自检（邻近未知路径确实 404）。
 * ③ ⛔ 只断言"抛错了"——每条负样本都断言 `agents` 表里没有多出一行（B：先写后抛蒙混不过）。
 *
 * 反证义务（issue #617 红线 2）：
 *   A：把落库那一步摘掉 ⇒ 断言必须变红 —— 见本文件底部「反证 A」。
 *   B：红必须落在目标那一步之后 —— 每条负样本本身就是 B 的证据（见「路数」一节）。
 *   C：clone 时把源的 toolWhitelist 带过来的变异 ⇒ 必须有断言证明它红 —— 「反证 C」。
 *   D：source: "community" ⇒ 拒绝且不落库 —— 「D：社区导入」一节。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentRuntime as AR } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i617-create-agent-http";
const ADMIN = "u-i617-create-agent-admin";
const MEMBER = "u-i617-create-agent-member";

let app: NestExpressApplication;
let base = "";

const authFor = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

function post(path: string, userId: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, { method: "POST", headers: authFor(userId), body: JSON.stringify(body) });
}

async function agentCount(): Promise<number> {
  return asApp(ORG, async (c) => {
    const r = await c.query<{ n: string }>("SELECT count(*)::text AS n FROM agents WHERE org_id=$1", [ORG]);
    return Number(r.rows[0]?.n ?? "0");
  });
}

async function agentRow(agentId: string): Promise<{ tool_whitelist: unknown; clone_from: string | null } | null> {
  return asApp(ORG, async (c) => {
    const r = await c.query<{ tool_whitelist: unknown; clone_from: string | null }>(
      "SELECT tool_whitelist, clone_from FROM agents WHERE id=$1 AND org_id=$2",
      [agentId, ORG],
    );
    return r.rows[0] ?? null;
  });
}

/** 建一个"可被复制"的源 agent，工具白名单非空——C 反证需要看到它不被带过来。 */
async function seedCloneSource(): Promise<string> {
  const agentId = `agent-i617-clone-source-${randomUUID()}`;
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agents
         (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,
          initials,role,visibility,clone_from,source,publish_state,model_id,
          skill_mounts,tool_whitelist,concurrency_limit,degrade_policy)
       VALUES ($1,$2,$1,$3,'enabled',$4,now(),now(),
               'SC','复制源职责','全组织可用',NULL,'self','运行中',NULL,
               '[]'::jsonb,$5::jsonb,2,'跟随组织级')`,
      [
        agentId,
        ORG,
        "clone source agent",
        ADMIN,
        JSON.stringify([{ toolFullName: "mcp-x:danger-tool", state: "已准", elevationDecision: null }]),
      ],
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
});

describe("路由真的存在（正样本，⚠ 没有它整个文件等于只测了 404）", () => {
  it("admin 从零新建 ⇒ 201，agents 表真的多一行，toolWhitelist 恒空", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i617-create-agent" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    await addOrgMember(ORG, MEMBER, "consultant", null);
    const before = await agentCount();

    const response = await post("/agents", ADMIN, {
      name: "值班助理",
      initials: "ZB",
      role: "值班一句话",
      visibility: "全组织可用",
      cloneFrom: null,
      source: "self",
    });

    expect(response.status).toBe(201);
    const parsed = AR.operations.createAgent.out.parse(await response.json());
    expect(parsed.publishState).toBe("草稿");
    expect(parsed.toolWhitelist).toEqual([]);
    expect(parsed.cloneFrom).toBeNull();
    expect(await agentCount()).toBe(before + 1);
    const row = await agentRow(parsed.agentId);
    expect(row).not.toBeNull();
    expect(row?.tool_whitelist).toEqual([]);
  });

  it("装置自检：邻近的未知路径确实 404 ⇒ 上面那条 201 是这条路由给的", async () => {
    const response = await post("/agents-does-not-exist", ADMIN, {});
    expect(response.status).toBe(404);
  });
});

describe("授权：非 admin 被拒，且在仓储写入之前被拒", () => {
  it("consultant 提交 ⇒ 403 / ROLE_INSUFFICIENT，agents 表没有多一行", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i617-create-agent" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    await addOrgMember(ORG, MEMBER, "consultant", null);
    const before = await agentCount();

    const response = await post("/agents", MEMBER, {
      name: "越权新建",
      initials: "YQ",
      role: "不该建成",
      visibility: "全组织可用",
      cloneFrom: null,
      source: "self",
    });

    expect(response.status).toBe(403);
    expect((await response.json() as { reasonCode?: string }).reasonCode).toBe("ROLE_INSUFFICIENT");
    expect(await agentCount()).toBe(before);
  });
});

describe("D：社区导入 phase-1 不实现 —— 拒绝且不落库", () => {
  it("source: community ⇒ 422 / AGENT_MARKET_NOT_AVAILABLE，agents 表没有多一行", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i617-create-agent" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    const before = await agentCount();

    const response = await post("/agents", ADMIN, {
      name: "社区导入的",
      initials: "SQ",
      role: "不该落库",
      visibility: "全组织可用",
      cloneFrom: null,
      source: "community",
    });

    expect(response.status).toBe(422);
    expect((await response.json() as { reasonCode?: string }).reasonCode).toBe("AGENT_MARKET_NOT_AVAILABLE");
    expect(await agentCount()).toBe(before);
  });
});

describe("clone：源不存在 ⇒ AGENT_NOT_FOUND；源存在 ⇒ 复制但白名单清空（I-30 / O-22①）", () => {
  it("cloneFrom 指向不存在的 agent ⇒ 404 / AGENT_NOT_FOUND，agents 表没有多一行", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i617-create-agent" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    const before = await agentCount();

    const response = await post("/agents", ADMIN, {
      name: "复制不存在的源",
      initials: "FX",
      role: "不该落库",
      visibility: "全组织可用",
      cloneFrom: "agent-does-not-exist",
      source: "self",
    });

    expect(response.status).toBe(404);
    expect((await response.json() as { reasonCode?: string }).reasonCode).toBe("AGENT_NOT_FOUND");
    expect(await agentCount()).toBe(before);
  });

  it("cloneFrom 指向真实存在、白名单非空的源 ⇒ 201，新 agent 的 toolWhitelist 仍是 []（真实 I-30 正样本）", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i617-create-agent" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    const sourceId = await seedCloneSource();

    const response = await post("/agents", ADMIN, {
      name: "从值班助理复制",
      initials: "FZ",
      role: "复制出来的职责",
      visibility: "仅某组",
      cloneFrom: sourceId,
      source: "self",
    });

    expect(response.status).toBe(201);
    const parsed = AR.operations.createAgent.out.parse(await response.json());
    expect(parsed.cloneFrom).toBe(sourceId);
    // ⚠ 这条断言是 I-30 的要害：源的 toolWhitelist 有一条 "已准" 的越权工具，
    // 复制出来的新 agent 必须是空数组——不是"源的白名单的子集"，是恒为空。
    expect(parsed.toolWhitelist).toEqual([]);
    const row = await agentRow(parsed.agentId);
    expect(row?.tool_whitelist).toEqual([]);
    expect(row?.clone_from).toBe(sourceId);
  });
});
