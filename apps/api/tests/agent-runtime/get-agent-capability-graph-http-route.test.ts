/**
 * #1911 —— `GET /agents/:agentId`（`getAgentCapabilityGraph`，契约
 * `agent-runtime.ts` `getAgentCapabilityGraph`）从 HTTP 真的可达，且读的是真实
 * 落库的 `skill_mounts`/`tool_whitelist` 两列——不是拼出来的固定值。
 *
 * 规避的空转形状（同 `create-agent-http-route.test.ts` 头注那三条纪律）：
 * ① 不只断言 status，正样本断言具体字段值真的等于种子数据里插的值。
 * ② 装置自检：邻近未知 agentId 确实 404，证明前一条 200 是这条路由给的。
 * ③ 跨组织读不到（fail-closed，与 `findForClone` 同一形状）单独一条负样本，
 *   不与"不存在"共用同一条断言掩盖差异。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentRuntime as AR } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1911-cap-graph";
const OTHER_ORG = "org-i1911-cap-graph-other";
const ADMIN = "u-i1911-cap-graph-admin";

let app: NestExpressApplication;
let base = "";

const authFor = (userId: string, orgId: string) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

function get(path: string, userId: string, orgId: string): Promise<Response> {
  return fetch(`${base}${path}`, { method: "GET", headers: authFor(userId, orgId) });
}

/** 插入一个挂了 skill 与 mcp 工具的 agent，直接写 `skill_mounts`/`tool_whitelist` 两列。 */
async function seedAgentWithCapabilities(orgId: string): Promise<string> {
  const agentId = `agent-i1911-${randomUUID()}`;
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO agents
         (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,
          initials,role,role_label,role_label_needs_confirmation,visibility,clone_from,source,
          publish_state,model_id,skill_mounts,tool_whitelist,concurrency_limit,degrade_policy)
       VALUES ($1,$2,$1,$3,'enabled',$4,now(),now(),
               'CG','能力图测试','能力图测试',false,'全组织可用',NULL,'self','运行中',NULL,
               $5::jsonb,$6::jsonb,1,'跟随组织级')`,
      [
        agentId,
        orgId,
        // ⚠ 名字带 agentId 后缀：`agents_name_casefold_uniq` 是全库层面的大小写不敏感
        // 唯一约束，不是按 org 分区——两条测试各自建一个 agent 时若同名会撞它。
        `capability graph agent ${agentId}`,
        ADMIN,
        JSON.stringify([{ skillId: "skill-i1911-ppt", skillVersion: 3 }]),
        JSON.stringify([
          { toolFullName: "mcp:crm-server.submit_inquiry", state: "在授权范围内", elevationDecision: null },
        ]),
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
  await resetOrgs(ORG, OTHER_ORG);
});

describe("路由真的存在（正样本）", () => {
  it("读到真实落库的 skillMounts/toolWhitelist，不是固定值", async () => {
    await resetOrgs(ORG, OTHER_ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i1911-cap-graph" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    const agentId = await seedAgentWithCapabilities(ORG);

    const response = await get(`/agents/${agentId}`, ADMIN, ORG);
    expect(response.status).toBe(200);
    const parsed = AR.operations.getAgentCapabilityGraph.out.parse(await response.json());
    expect(parsed.agentId).toBe(agentId);
    expect(parsed.name).toBe(`capability graph agent ${agentId}`);
    expect(parsed.skillMounts).toEqual([{ skillId: "skill-i1911-ppt", skillVersion: 3 }]);
    expect(parsed.toolWhitelist).toEqual([
      { toolFullName: "mcp:crm-server.submit_inquiry", state: "在授权范围内", elevationDecision: null },
    ]);
  });

  it("装置自检：邻近未知 agentId 确实 404 ⇒ 上面那条 200 是这条路由给的", async () => {
    const response = await get(`/agents/agent-i1911-does-not-exist`, ADMIN, ORG);
    expect(response.status).toBe(404);
    expect((await response.json() as { reasonCode?: string }).reasonCode).toBe("AGENT_NOT_FOUND");
  });
});

describe("跨组织读不到（fail-closed，同 findForClone 的既有语义）", () => {
  it("另一个组织的成员读这个 agentId ⇒ 404 / AGENT_NOT_FOUND，不区分\"不存在\"与\"不是你的\"", async () => {
    await seedOrg({ orgId: OTHER_ORG, projectId: "proj-i1911-cap-graph-other" });
    const otherAdmin = "u-i1911-cap-graph-other-admin";
    await addOrgMember(OTHER_ORG, otherAdmin, "admin", null);
    const agentId = await seedAgentWithCapabilities(ORG);

    const response = await get(`/agents/${agentId}`, otherAdmin, OTHER_ORG);
    expect(response.status).toBe(404);
    expect((await response.json() as { reasonCode?: string }).reasonCode).toBe("AGENT_NOT_FOUND");
  });
});

/**
 * #1918 hotfix（#1923）回归：`initials`/`role`/`visibility`/`source`/`publish_state`/
 * `concurrency_limit`/`degrade_policy` 七列全为 NULL 的行——真实由
 * `pg-system-agent-repository.ts`（`ensureDefaultAgent`，即每个组织的「通用助手」）
 * 落库时就长这样，也是 devapp 实测复现的确切形状。此前复用 `findForClone` 时，
 * 这七列任一为 NULL 就判「不存在」⇒ 404；修复后应正常 200。
 */
async function seedBackfillStyleAgent(orgId: string): Promise<string> {
  const agentId = `agent-i1923-backfill-${randomUUID()}`;
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO agents
         (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,
          published_version_id,role_label,role_label_needs_confirmation)
       VALUES ($1,$2,$1,$3,'enabled',$4,now(),now(),NULL,$5,false)`,
      [agentId, orgId, `backfill-style agent ${agentId}`, ADMIN, "通用助手"],
    ),
  );
  return agentId;
}

describe("补种/starter-import 残缺行（七列为 NULL，如「通用助手」）——#1918 hotfix 回归（#1923）", () => {
  it("能力图不再 404，name/roleLabel 读得出来，skillMounts/toolWhitelist 兜底成 []", async () => {
    await resetOrgs(ORG, OTHER_ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i1923-backfill" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    const agentId = await seedBackfillStyleAgent(ORG);

    const response = await get(`/agents/${agentId}`, ADMIN, ORG);
    expect(response.status).toBe(200);
    const parsed = AR.operations.getAgentCapabilityGraph.out.parse(await response.json());
    expect(parsed.agentId).toBe(agentId);
    expect(parsed.name).toBe(`backfill-style agent ${agentId}`);
    expect(parsed.roleLabel).toBe("通用助手");
    expect(parsed.skillMounts).toEqual([]);
    expect(parsed.toolWhitelist).toEqual([]);
  });
});

describe("空态：没有挂载任何能力的 agent ⇒ 两个数组都是真实空数组", () => {
  it("skillMounts/toolWhitelist 均为 []，不是 null、不是省略字段", async () => {
    await resetOrgs(ORG, OTHER_ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i1911-cap-graph-empty" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    const agentId = `agent-i1911-empty-${randomUUID()}`;
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO agents
           (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,
            initials,role,role_label,role_label_needs_confirmation,visibility,clone_from,source,
            publish_state,model_id,skill_mounts,tool_whitelist,concurrency_limit,degrade_policy)
         VALUES ($1,$2,$1,$3,'enabled',$4,now(),now(),
                 'EM','空态测试','空态测试',false,'全组织可用',NULL,'self','草稿',NULL,
                 '[]'::jsonb,'[]'::jsonb,1,'跟随组织级')`,
        [agentId, ORG, "empty capability agent", ADMIN],
      ),
    );

    const response = await get(`/agents/${agentId}`, ADMIN, ORG);
    expect(response.status).toBe(200);
    const parsed = AR.operations.getAgentCapabilityGraph.out.parse(await response.json());
    expect(parsed.skillMounts).toEqual([]);
    expect(parsed.toolWhitelist).toEqual([]);
  });
});
