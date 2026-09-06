/**
 * #595 A2 —— `/admin/agents/:agentId/skill-pins` 从 HTTP 真的可达，且门都在正确的位置。
 *
 * ## 规避的三种空转形状（与 #595 段 2 同一份纪律）
 *
 * ① ⛔ 只断言 `status >= 400`——每条负样本都断言**具体 status + 具体 reasonCode**。
 * ② ⛔ `answers 404` 型——配了正样本（必须 201）与装置自检（邻近未知路径确实 404）。
 * ③ ⛔ 只断言"抛错了"——每条负样本都**同时**断言 `agents.published_version_id`
 *    没有变化（`counts()`/`readPointer()`），防"先写后抛"的实现蒙混过关。
 */
import { createHash, randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentRuntime as AR } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i595-pins-http";
const ADMIN = "u-i595-pins-admin";
const MEMBER = "u-i595-pins-member";

let app: NestExpressApplication;
let base = "";

const authFor = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

function post(path: string, userId: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, { method: "POST", headers: authFor(userId), body: JSON.stringify(body) });
}

async function seedAgentWithSkill(): Promise<{ agentId: string; versionId: string; skillVersionId: string }> {
  const agentId = `agent-i595-pins-${randomUUID()}`;
  const versionId = `agent-version-i595-pins-${randomUUID()}`;
  const skillId = `skill-i595-pins-${randomUUID()}`;
  const skillVersionId = `skill-version-i595-pins-${randomUUID()}`;
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now())`,
      [skillId, ORG, skillId, "pins http fixture skill", ADMIN],
    );
    await c.query(
      `INSERT INTO skill_versions (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
       VALUES ($1,$2,$3,'v1',$4,'{}'::jsonb,$5,now(),false)`,
      [skillVersionId, ORG, skillId, "0".repeat(64), ADMIN],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)`,
      [ORG, skillVersionId, Buffer.from("# fixture\n"), createHash("sha256").update("# fixture\n").digest("hex")],
    );
    await c.query("SELECT wave2_publish_skill_version($1,$2)", [ORG, skillVersionId]);
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now())`,
      [agentId, ORG, agentId, "pins http fixture agent", ADMIN],
    );
    const instructions = "pins http fixture instructions";
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,'v1',$4,$5,'{}'::text[],'wave2-loopback','sentinel-model','[]'::jsonb,$6,now(),now())`,
      [versionId, ORG, agentId, createHash("sha256").update(instructions).digest("hex"), instructions, ADMIN],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [versionId, agentId, ORG]);
  });
  return { agentId, versionId, skillVersionId };
}

async function publishedVersionOf(agentId: string): Promise<string | null> {
  return asApp(ORG, async (c) => {
    const r = await c.query<{ published_version_id: string | null }>(
      "SELECT published_version_id FROM agents WHERE id=$1 AND org_id=$2",
      [agentId, ORG],
    );
    return r.rows[0]?.published_version_id ?? null;
  });
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
  it("admin pin 一个已发布的 skill 版本 ⇒ 201，agents.published_version_id 真的换了", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i595-pins-http" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    await addOrgMember(ORG, MEMBER, "consultant", null);
    const fx = await seedAgentWithSkill();

    const response = await post(`/admin/agents/${fx.agentId}/skill-pins`, ADMIN, {
      agentId: fx.agentId,
      skillVersionIds: [fx.skillVersionId],
      expectedVersion: fx.versionId,
    });

    expect(response.status).toBe(201);
    const parsed = AR.operations.setAgentSkillPins.out.parse(await response.json());
    expect(parsed.skillVersionIds).toEqual([fx.skillVersionId]);
    expect(parsed.versionId).not.toBe(fx.versionId);

    const nowPublished = await publishedVersionOf(fx.agentId);
    expect(nowPublished).toBe(parsed.versionId);
  });

  it("装置自检：邻近的未知路径确实 404 ⇒ 上面那条 201 是这条路由给的", async () => {
    const response = await post("/admin/agents/does-not-matter/skill-pins-does-not-exist", ADMIN, {});
    expect(response.status).toBe(404);
  });
});

describe("授权：非 admin 被拒，且在仓储写入之前被拒", () => {
  it("consultant 提交 ⇒ 403 / ROLE_INSUFFICIENT，agents.published_version_id 未变", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i595-pins-http" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    await addOrgMember(ORG, MEMBER, "consultant", null);
    const fx = await seedAgentWithSkill();

    const response = await post(`/admin/agents/${fx.agentId}/skill-pins`, MEMBER, {
      agentId: fx.agentId,
      skillVersionIds: [fx.skillVersionId],
      expectedVersion: fx.versionId,
    });

    expect(response.status).toBe(403);
    expect((await response.json() as { reasonCode?: string }).reasonCode).toBe("ROLE_INSUFFICIENT");
    expect(await publishedVersionOf(fx.agentId)).toBe(fx.versionId);
  });
});

describe("skill 版本存在性/发布态校验", () => {
  it("pin 一个不存在的 skillVersionId ⇒ 422 / SKILL_VERSION_NOT_FOUND，未变", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i595-pins-http" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    const fx = await seedAgentWithSkill();

    const response = await post(`/admin/agents/${fx.agentId}/skill-pins`, ADMIN, {
      agentId: fx.agentId,
      skillVersionIds: ["skill-version-does-not-exist"],
      expectedVersion: fx.versionId,
    });

    expect(response.status).toBe(422);
    expect((await response.json() as { reasonCode?: string }).reasonCode).toBe("SKILL_VERSION_NOT_FOUND");
    expect(await publishedVersionOf(fx.agentId)).toBe(fx.versionId);
  });

  it("pin 一个未发布(draft)的 skill 版本 ⇒ 422 / SKILL_VERSION_NOT_FOUND，未变", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i595-pins-http" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    const fx = await seedAgentWithSkill();
    const draftId = `skill-version-i595-pins-draft-${randomUUID()}`;
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO skill_versions (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
         SELECT $1, org_id, skill_id, 'v-draft', $2, '{}'::jsonb, creator_id, now(), false
           FROM skill_versions WHERE id = $3 AND org_id = $4`,
        [draftId, "1".repeat(64), fx.skillVersionId, ORG],
      ),
    );

    const response = await post(`/admin/agents/${fx.agentId}/skill-pins`, ADMIN, {
      agentId: fx.agentId,
      skillVersionIds: [draftId],
      expectedVersion: fx.versionId,
    });

    expect(response.status).toBe(422);
    expect((await response.json() as { reasonCode?: string }).reasonCode).toBe("SKILL_VERSION_NOT_FOUND");
    expect(await publishedVersionOf(fx.agentId)).toBe(fx.versionId);
  });
});

describe("并发：expectedVersion 过期被拒", () => {
  it("expectedVersion 传一个陈旧值 ⇒ 409 / VERSION_CHANGED，未变", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i595-pins-http" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    const fx = await seedAgentWithSkill();

    const response = await post(`/admin/agents/${fx.agentId}/skill-pins`, ADMIN, {
      agentId: fx.agentId,
      skillVersionIds: [fx.skillVersionId],
      expectedVersion: "agent-version-stale-does-not-match",
    });

    expect(response.status).toBe(409);
    expect((await response.json() as { reasonCode?: string }).reasonCode).toBe("VERSION_CHANGED");
    expect(await publishedVersionOf(fx.agentId)).toBe(fx.versionId);
  });
});

describe("路径与 body 的 agentId 必须一致", () => {
  /**
   * ⚠ 422，不是 400——与 `skill-mount.controller.ts` 的 `assertPathMatchesBody`
   * 同一个错误码同一个状态（`UnprocessableEntityException`），保持全仓一致，
   * 不为这条路由另造一套"路径/body 不一致"的状态码惯例。
   */
  it("路径与 body 的 agentId 不同 ⇒ 422 / CONTRACT_VALIDATION_FAILED，未变", async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-i595-pins-http" });
    await addOrgMember(ORG, ADMIN, "admin", null);
    const fx = await seedAgentWithSkill();

    const response = await post(`/admin/agents/${fx.agentId}/skill-pins`, ADMIN, {
      agentId: "someone-elses-agent-id",
      skillVersionIds: [fx.skillVersionId],
      expectedVersion: fx.versionId,
    });

    expect(response.status).toBe(422);
    expect((await response.json() as { reasonCode?: string }).reasonCode).toBe("CONTRACT_VALIDATION_FAILED");
    expect(await publishedVersionOf(fx.agentId)).toBe(fx.versionId);
  });
});
