import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createDigitalInterviewDraft } from "../../src/application/interview/create-digital-interview-draft";
import { PgDigitalInterviewRepository } from "../../src/infrastructure/interview/pg-digital-interview-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-digital-interview-f02";
const OTHER_ORG = "org-digital-interview-f02-other";
const USER = "u-digital-interview-f02";
const EXPERT_VERSION = "agent-version-f02";
let app: NestExpressApplication;
let base = "";
let db: PgDatabase;

const auth = { "x-kernel-test-principal": `${USER}:${ORG}` };

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: "proj-f02" });
  await addOrgMember(ORG, USER, "consultant", fixture.teams.energy!);
  await seedOrg({ orgId: OTHER_ORG, projectId: "proj-f02-other" });

  const repo = new PgDigitalInterviewRepository(db);
  await createDigitalInterviewDraft(
    { repo, ids: { next: () => "itv-f02-visible" } },
    {
      orgId: toOrgId(ORG), actorId: USER,
      scope: { kind: "none", projectId: null, researchProjectId: null },
      name: "德国采购决策链", tags: ["采购决策", "德国市场"], topic: "谁拥有采购否决权",
    },
  );
  await createDigitalInterviewDraft(
    { repo, ids: { next: () => "itv-f02-same-org-hidden" } },
    {
      orgId: toOrgId(ORG), actorId: "u-f02-other-member",
      scope: { kind: "none", projectId: null, researchProjectId: null },
      name: "同组织也不可泄露", tags: ["私密"], topic: "只有创建者可见",
    },
  );
  await createDigitalInterviewDraft(
    { repo, ids: { next: () => "itv-f02-hidden" } },
    {
      orgId: toOrgId(OTHER_ORG), actorId: "u-other",
      scope: { kind: "none", projectId: null, researchProjectId: null },
      name: "不应泄露的访谈", tags: ["机密"], topic: "机密主题",
    },
  );

  await db.withTenant(toOrgId(ORG), async (session) => {
    await session.query(
      `INSERT INTO agents
        (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,published_version_id,
         initials,role,visibility,source,publish_state,model_id,concurrency_limit,degrade_policy)
       VALUES ('agent-f02-de',$1,'de-procurement','德国采购总监','enabled',$2,now(),now(),NULL,
               'DE','负责德国制造业能源采购与供应商谈判','全组织可用','self','运行中','model-f02',2,'跟随组织级')`,
      [ORG, USER],
    );
    await session.query(
      `INSERT INTO agent_versions
        (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
         model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,'agent-f02-de','v1',$3,'instructions',ARRAY[]::text[],
               'deep-agent','model-f02','[]'::jsonb,$4,now(),now())`,
      [EXPERT_VERSION, ORG, "a".repeat(64), USER],
    );
    await session.query(
      "UPDATE agents SET published_version_id=$2 WHERE org_id=$1 AND id='agent-f02-de'",
      [ORG, EXPERT_VERSION],
    );
    await session.query(
      `INSERT INTO capability_listings
        (id,org_id,kind,name,scope,owner_team_id,enabled,endpoint,abbr,duty,role_label)
       VALUES ('agent-f02-de',$1,'agent','德国采购总监','org-wide',NULL,true,NULL,'DE','负责德国制造业能源采购与供应商谈判','采购总监')`,
      [ORG],
    );
  });
});

describe("F02 数字访谈首屏 HTTP", () => {
  it("历史列表只返回当前用户可见的数字访谈，并携带八态派生操作", async () => {
    const response = await fetch(`${base}/interviews/digital?status=draft`, { headers: auth });
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).toContain("itv-f02-visible");
    expect(raw).not.toContain("itv-f02-hidden");
    expect(raw).not.toContain("不应泄露的访谈");
    expect(raw).not.toContain("itv-f02-same-org-hidden");
    expect(raw).not.toContain("同组织也不可泄露");
    expect(JSON.parse(raw)).toMatchObject({
      items: [{ interviewId: "itv-f02-visible", status: "draft", primaryAction: "confirm_topic" }],
    });
  });

  it("已发布 Agent 会获得明确的未分类 profile，不会在升级后从专家目录消失", async () => {
    const response = await fetch(`${base}/interviews/digital/experts`, { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [{
        expertId: "agent-f02-de", agentDefinitionId: "agent-f02-de", agentVersion: EXPERT_VERSION,
        initials: "DE", displayName: "德国采购总监",
        role: "负责德国制造业能源采购与供应商谈判",
        domains: ["未分类"],
        category: "未分类", bio: "负责德国制造业能源采购与供应商谈判", location: "未指定", typicalAdvice: "暂无典型建议",
        age: 0, occupation: "负责德国制造业能源采购与供应商谈判", goals: [], interests: [],
        painPoints: [], motivations: [], influences: [],
        personalityTraits: { introvertExtrovert: 5, analyticalCreative: 5, busyTimeRich: 5 },
        serviceValue: "暂无服务价值说明",
        materialContextPackId: null, materialVersion: null,
        materialBoundary: "未绑定 Context Pack 材料版本", exploratory: true,
      }],
    });
  });

  it("已发布 Agent 版本不冒充材料版本，领域筛选也不读取角色文案", async () => {
    await db.withTenant(toOrgId(ORG), async (session) => {
      await session.query(
        `UPDATE digital_expert_profiles
            SET domains=ARRAY['采购与供应链','德国市场']
          WHERE org_id=$1 AND agent_id='agent-f02-de'`,
        [ORG],
      );
    });

    const byDomain = await fetch(`${base}/interviews/digital/experts?domain=采购与供应链`, { headers: auth });
    expect(byDomain.status).toBe(200);
    expect(await byDomain.json()).toMatchObject({
      items: [{
        expertId: "agent-f02-de",
        role: "负责德国制造业能源采购与供应商谈判",
        domains: ["采购与供应链", "德国市场"],
        category: "采购与供应链",
        materialBoundary: "未绑定 Context Pack 材料版本",
        exploratory: true,
      }],
    });

    const byRole = await fetch(
      `${base}/interviews/digital/experts?domain=${encodeURIComponent("负责德国制造业能源采购与供应商谈判")}`,
      { headers: auth },
    );
    expect(await byRole.json()).toEqual({ items: [] });
  });

  it("未认证请求明确返回 401，而不是成功空列表", async () => {
    const response = await fetch(`${base}/interviews/digital`);
    expect(response.status).toBe(401);
  });
});


describe("Studio history management (#3345)", () => {
  const itemPath = "/interviews/digital/itv-f02-visible";
  const jsonHeaders = { ...auth, "content-type": "application/json" };

  it("persists trimmed metadata and empty tags without invalidating workflow versions", async () => {
    const result = await fetch(`${base}${itemPath}/metadata`, {
      method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ name: "  新名称  ", tags: [] }),
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ interviewId: "itv-f02-visible", name: "新名称", tags: [] });
    const rows = await new PgDigitalInterviewRepository(db).listVisible({ orgId: toOrgId(ORG), viewerUserId: USER });
    expect(rows).toHaveLength(1);
    await db.withTenant(toOrgId(ORG), async (session) => {
      const saved = await session.query(`SELECT title,tags,version::integer AS version,digital_status FROM interview_sessions WHERE id=$1`, ["itv-f02-visible"]);
      expect(saved.rows[0]).toMatchObject({ title: "新名称", tags: [], version: 1, digital_status: "draft" });
    });
    const history = await fetch(`${base}/interviews/digital`, { headers: auth });
    expect(await history.json()).toMatchObject({ items: [{ name: "新名称", tags: [], canManage: true }] });
  });

  it("rejects invalid metadata and same-organization or cross-organization mutations", async () => {
    const invalid = await fetch(`${base}${itemPath}/metadata`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ name: " ", tags: [] }) });
    expect(invalid.status).toBe(400);
    for (const id of ["itv-f02-same-org-hidden", "itv-f02-hidden", "itv-f02-missing"]) {
      const update = await fetch(`${base}/interviews/digital/${id}/metadata`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ name: "unauthorized", tags: [] }) });
      expect(update.status).toBe(404);
      const remove = await fetch(`${base}/interviews/digital/${id}`, { method: "DELETE", headers: auth });
      expect(remove.status).toBe(404);
    }
    expect((await fetch(`${base}${itemPath}`, { method: "DELETE" })).status).toBe(401);
  });

  it("does not grant management rights to a visible collaborator", async () => {
    await db.withTenant(toOrgId(ORG), (session) => session.query(
      `INSERT INTO interview_collaborators(interview_id,user_id,org_id,added_by) VALUES($1,$2,$3,$4)`,
      ["itv-f02-same-org-hidden", USER, ORG, "u-f02-other-member"],
    ));
    const history = await (await fetch(`${base}/interviews/digital`, { headers: auth })).json();
    expect(history.items.find((item: { interviewId: string }) => item.interviewId === "itv-f02-same-org-hidden")).toMatchObject({ canManage: false });
    const path = `${base}/interviews/digital/itv-f02-same-org-hidden`;
    expect((await fetch(`${path}/metadata`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ name: "denied", tags: [] }) })).status).toBe(404);
    expect((await fetch(path, { method: "DELETE", headers: auth })).status).toBe(404);
  });

  it("archives running batch history idempotently while retaining workflow data", async () => {
    await db.withTenant(toOrgId(ORG), (session) => session.query(`UPDATE interview_sessions SET digital_status='running' WHERE id=$1`, ["itv-f02-visible"]));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await fetch(`${base}${itemPath}`, { method: "DELETE", headers: auth });
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ interviewId: "itv-f02-visible", archived: true });
    }
    expect(await (await fetch(`${base}/interviews/digital`, { headers: auth })).json()).toEqual({ items: [] });
    const retained = await new PgDigitalInterviewRepository(db).findVisibleById(toOrgId(ORG), USER, "itv-f02-visible");
    expect(retained).not.toBeNull();
    await db.withTenant(toOrgId(ORG), async (session) => {
      const saved = await session.query(`SELECT archived,version::integer AS version,digital_status FROM interview_sessions WHERE id=$1`, ["itv-f02-visible"]);
      expect(saved.rows[0]).toMatchObject({ archived: true, version: 1, digital_status: "running" });
    });
  });

  it("manages quick interviews without dropping their messages or version", async () => {
    const repo = new PgDigitalInterviewRepository(db);
    const experts = await repo.listVisibleExperts({ orgId: toOrgId(ORG), viewerUserId: USER });
    const quick = await repo.createQuick({ orgId: toOrgId(ORG), actorId: USER, interviewId: "itv-f02-managed-quick", requestId: "request-f02-managed-quick", expert: experts[0]! });
    await repo.appendQuickExchange({ orgId: toOrgId(ORG), interviewId: quick.interviewId, expectedVersion: quick.version, userMessageId: "message-f02-managed-user", assistantMessageId: "message-f02-managed-assistant", question: "问题", answer: "回答", sourcePointers: [] });
    const path = `${base}/interviews/digital/${quick.interviewId}`;
    expect((await fetch(`${path}/metadata`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ name: "快捷访谈新名称", tags: ["测试", "测试"] }) })).status).toBe(200);
    expect((await fetch(path, { method: "DELETE", headers: auth })).status).toBe(200);
    const restored = await new PgDigitalInterviewRepository(db).loadQuick(toOrgId(ORG), quick.interviewId);
    expect(restored?.messages).toHaveLength(2);
    expect(restored?.version).toBe(2);
    const history = await (await fetch(`${base}/interviews/digital`, { headers: auth })).json();
    expect(history.items.map((item: { interviewId: string }) => item.interviewId)).not.toContain(quick.interviewId);
  });
});
