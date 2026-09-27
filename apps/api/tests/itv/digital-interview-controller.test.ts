import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createDigitalInterviewDraft } from "../../src/application/interview/create-digital-interview-draft";
import { PgDigitalInterviewRepository } from "../../src/infrastructure/interview/pg-digital-interview-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appendInterviewMarkdownDocument } from "../../src/infrastructure/interview/interview-markdown-store";
import { PgInterviewMarkdownReader } from "../../src/infrastructure/interview/pg-interview-markdown-reader";
import { PgInterviewScopeRepository } from "../../src/infrastructure/interview/pg-interview-scope-repository";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { generateInterviewMarkdown } from "../../src/application/interview/generate-interview-markdown";
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

it("confirmation appends an immutable source version and keeps raw Markdown unchanged", async () => {
  await db.withTenant(toOrgId(ORG), (session) => session.query(`INSERT INTO digital_interview_revisions(org_id,id,interview_id,revision_number,created_by) VALUES($1,'revision-api-confirm-4400','itv-f02-visible',1,$2)`, [ORG, USER]));
  const markdown = "# 需求\r\n\r\n教师上次备课 🧪\r\n";
  const headers = { ...auth, "content-type": "application/json" };
  const saved = await (await fetch(`${base}/interviews/digital/itv-f02-visible/markdown/intake`, { method: "POST", headers, body: JSON.stringify({ markdown, expectedVersion: 1, expectedDocumentVersion: 0 }) })).json();
  const draft = saved.documents[0];
  const confirm = await fetch(`${base}/interviews/digital/itv-f02-visible/markdown/intake/confirm`, { method: "POST", headers, body: JSON.stringify({ expectedVersion: saved.version, expectedDocumentVersion: draft.version }) });
  expect(confirm.status).toBe(201);
  const result = await confirm.json();
  expect(result.documents[0].markdown).toBe(markdown);
  expect(result.documents[0].version).toBe(2);
  expect(result.states[0]).toMatchObject({ status: "confirmed", failure: null });
  expect(result.version).toBe(3);
  const editing = await fetch(`${base}/interviews/digital/itv-f02-visible/markdown/intake`, { method: "POST", headers, body: JSON.stringify({ markdown: "# 静默覆盖", expectedVersion: result.version, expectedDocumentVersion: 2 }) });
  expect(editing.status).toBe(409);
  const original = await db.withTenant(toOrgId(ORG), (session) => session.query<{ markdown: string; status: string }>("SELECT markdown,status FROM digital_interview_artifact_versions WHERE org_id=$1 AND artifact_id=$2", [ORG, draft.documentId]));
  expect(original.rows[0]).toEqual({ markdown, status: "draft" });
});

it("partialFailurePreservesMarkdown and retry appends a new document version", async () => {
  await db.withTenant(toOrgId(ORG), async (session) => {
    await session.query(`INSERT INTO digital_interview_revisions(org_id,id,interview_id,revision_number,created_by) VALUES($1,'revision-api-partial-4400','itv-f02-visible',1,$2)`, [ORG, USER]);
    await appendInterviewMarkdownDocument(session, { orgId: toOrgId(ORG), interviewId: "itv-f02-visible", revisionId: "revision-api-partial-4400", step: "intake", title: "需求", markdown: "# 需求\n教师备课", evidenceMode: "simulated", references: [], expectedVersion: 0 });
  });
  let calls = 0;
  const partial = "# 研究分析\r\n\r\n## 已生成目标\r\n理解备课行为。\r\n";
  const deps = { repo: new PgDigitalInterviewRepository(db), scope: new PgInterviewScopeRepository(db), decisions: new UuidDecisionIdFactory(), reader: new PgInterviewMarkdownReader(db), modelProvider: "test", modelId: "test", model: { complete: async () => {
    calls += 1;
    return calls === 1 ? { text: partial, truncated: true } : { text: `${partial}\r\n## 待验证假设\r\n效率是否提升需验证。` };
  } } };
  const input = { orgId: toOrgId(ORG), viewerUserId: USER, interviewId: "itv-f02-visible", step: "analysis" as const, expectedVersion: 1, expectedDocumentVersion: 0 };
  await expect(generateInterviewMarkdown(deps, input)).rejects.toThrow("AI_GENERATION_UNAVAILABLE");
  const restored = await (await fetch(`${base}/interviews/digital/itv-f02-visible/markdown`, { headers: auth })).json();
  const document = restored.documents.find((doc: { step: string }) => doc.step === "analysis");
  expect(document?.markdown).toBe(partial);
  expect(restored.states.find((state: { documentId: string }) => state.documentId === document.documentId)).toMatchObject({ status: "failed", failure: { code: "AI_GENERATION_UNAVAILABLE", retryable: true } });
  const retried = await generateInterviewMarkdown(deps, { ...input, expectedVersion: restored.version, expectedDocumentVersion: document.version });
  expect(retried.documents.find((doc) => doc.step === "analysis")?.version).toBe(2);
  expect(calls).toBe(2);
  const archived = await db.withTenant(toOrgId(ORG), (session) => session.query<{ markdown: string }>("SELECT markdown FROM digital_interview_artifact_versions WHERE org_id=$1 AND artifact_id=$2", [ORG, document.documentId]));
  expect(archived.rows[0]?.markdown).toBe(partial);
});

it("modelConsumesConfirmedMarkdown through the real source repository and saves raw generated analysis", async () => {
  const raw = "# 需求\r\n\r\n研究教师备课的最近一次真实行为 🧪\r\n";
  await db.withTenant(toOrgId(ORG), async (session) => {
    await session.query(`INSERT INTO digital_interview_revisions(org_id,id,interview_id,revision_number,created_by) VALUES($1,'revision-api-model-4400','itv-f02-visible',1,$2)`, [ORG, USER]);
    await appendInterviewMarkdownDocument(session, { orgId: toOrgId(ORG), interviewId: "itv-f02-visible", revisionId: "revision-api-model-4400", step: "intake", title: "原始需求", markdown: raw, evidenceMode: "simulated", references: [], expectedVersion: 0 });
  });
  const output = "# 研究分析\r\n\r\n## 研究目标\r\n理解最近一次备课行为。\r\n\r\n## 待验证假设\r\n- 不预设 AI 有效。\r\n";
  let calls = 0;
  const deps = {
    repo: new PgDigitalInterviewRepository(db), scope: new PgInterviewScopeRepository(db),
    decisions: new UuidDecisionIdFactory(), reader: new PgInterviewMarkdownReader(db),
    modelProvider: "test", modelId: "markdown-analysis-test",
    model: { complete: async (input: { user: string; system: string }) => {
      calls += 1;
      expect(input.user).toContain(raw);
      expect(input.user).not.toContain("\\r\\n");
      expect(input.system).toContain("Markdown");
      return { text: output, usage: { inputTokens: 10, outputTokens: 20 } };
    } },
  };
  const input = { orgId: toOrgId(ORG), viewerUserId: USER, interviewId: "itv-f02-visible", step: "analysis" as const, expectedVersion: 1, expectedDocumentVersion: 0 };
  const generated = await generateInterviewMarkdown(deps, input);
  expect(generated.documents.find((doc) => doc.step === "analysis")?.markdown).toBe(output);
  expect(generated.version).toBe(2);
  await expect(generateInterviewMarkdown(deps, input)).rejects.toThrow("CONCURRENT_MODIFICATION");
  await expect(generateInterviewMarkdown(deps, { ...input, interviewId: "itv-f02-same-org-hidden" })).rejects.toThrow();
  expect(calls).toBe(1);
});

it("staleVersionCannotOverwrite Markdown and draft text cannot promote evidence", async () => {
  await db.withTenant(toOrgId(ORG), (session) => session.query(
    `INSERT INTO digital_interview_revisions(org_id,id,interview_id,revision_number,created_by) VALUES($1,'revision-api-write-4400','itv-f02-visible',1,$2)`, [ORG, USER],
  ));
  const url = `${base}/interviews/digital/itv-f02-visible/markdown/intake`;
  const save = (body: unknown) => fetch(url, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) });
  const markdown = "# 原始需求\r\n\r\n中文 🧪\r\n> 不可覆盖\r\n";
  const first = await save({ markdown, expectedVersion: 1, expectedDocumentVersion: 0 });
  expect(first.status).toBe(201);
  const saved = await first.json();
  expect(saved.documents[0].markdown).toBe(markdown);
  expect(saved.documents[0].evidenceMode).toBe("simulated");
  expect(saved.version).toBe(2);
  expect((await save({ markdown: "# 覆盖旧版本", expectedVersion: 1, expectedDocumentVersion: 0 })).status).toBe(409);
  expect((await save({ markdown: "# 宣称真人批准", expectedVersion: 2, expectedDocumentVersion: 1, evidenceMode: "participant", status: "completed" })).status).toBe(400);
  const current = await (await fetch(`${base}/interviews/digital/itv-f02-visible/markdown`, { headers: auth })).json();
  expect(current.documents[0].markdown).toBe(markdown);
  expect(current.documents[0].version).toBe(1);
  for (const id of ["itv-f02-same-org-hidden", "itv-f02-hidden", "missing-4400"]) {
    const denied = await fetch(`${base}/interviews/digital/${id}/markdown/intake`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ markdown, expectedVersion: 1, expectedDocumentVersion: 0 }) });
    expect(denied.status).toBe(404);
  }
});

it("apiPreservesMarkdownBytes in an authorized source document envelope", async () => {
  const markdown = "# 原文\r\n\r\n中文 🧪\r\n\r\n| 字段 | 值 |\r\n| --- | --- |\r\n| 特殊字符 | `a_b` |\r\n";
  await db.withTenant(toOrgId(ORG), async (session) => {
    await session.query(`INSERT INTO digital_interview_revisions(org_id,id,interview_id,revision_number,created_by) VALUES($1,'revision-api-md-4400','itv-f02-visible',1,$2)`, [ORG, USER]);
    await appendInterviewMarkdownDocument(session, { orgId: toOrgId(ORG), interviewId: "itv-f02-visible", revisionId: "revision-api-md-4400", step: "intake", title: "原文", markdown, evidenceMode: "simulated", references: [], expectedVersion: 0 });
  });
  const response = await fetch(`${base}/interviews/digital/itv-f02-visible/markdown`, { headers: auth });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.documents[0].markdown).toBe(markdown);
  expect(result.documents[0].evidenceMode).toBe("simulated");
  expect(result.version).toBe(1);
  for (const id of ["itv-f02-same-org-hidden", "itv-f02-hidden", "missing-4400"]) {
    const denied = await fetch(`${base}/interviews/digital/${id}/markdown`, { headers: auth });
    expect(denied.status).toBe(404);
    expect(await denied.text()).not.toContain(markdown);
  }
});

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
  it("counts only completed selected experts in the current revision", async () => {
    await db.withTenant(toOrgId(ORG), async (session) => {
      await session.query(`UPDATE interview_sessions SET selected_expert_ids=ARRAY['a','b','c'], digital_status='report_pending'
        WHERE org_id=$1 AND id='itv-f02-visible'`, [ORG]);
      await session.query(`INSERT INTO digital_interview_revisions
        (org_id,id,interview_id,revision_number,is_current,created_by,superseded_at)
        VALUES ($1,'old','itv-f02-visible',1,false,$2,now()),($1,'current','itv-f02-visible',2,true,$2,NULL)`, [ORG,USER]);
      await session.query(`INSERT INTO digital_interview_expert_runs
        (org_id,interview_id,revision_id,expert_id,display_name,ordinal,status,total_questions,answers)
        VALUES ($1,'itv-f02-visible','old','b','Old',1,'completed',1,'[]'),
               ($1,'itv-f02-visible','current','a','A',1,'completed',1,'[]'),
               ($1,'itv-f02-visible','current','b','B',2,'failed',1,'[]'),
               ($1,'itv-f02-visible','current','c','C',3,'running',1,'[]'),
               ($1,'itv-f02-visible','current','removed','Removed',4,'completed',1,'[]')`, [ORG]);
    });
    const result = await fetch(`${base}/interviews/digital`, { headers: auth });
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.items.find((item: { interviewId: string }) => item.interviewId === "itv-f02-visible"))
      .toMatchObject({ expertCount: 3, completedExpertCount: 1 });
  });

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
