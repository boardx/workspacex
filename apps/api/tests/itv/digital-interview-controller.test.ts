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
  await app.listen(0);
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
