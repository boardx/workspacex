/**
 * B3-T4（issue #4498）—— 「采纳为项目决策」（项目记忆里的 fact / hypothesis → decision）。真实 PostgreSQL，装配同
 * `promote-to-org.test.ts`。
 *
 * ⚠ 本文件在提交时**未在本地执行**（本轮无 PG；见回报）。断言按迁移 20260928110000 与用例逐条写。
 *
 * 钉住：
 *   · 项目成员（member）能采纳：项目作用域里新增一条 decision（陈述照抄、created_by human、reviewed_by 采纳人）、
 *     derived_from 连回来源、证据与实体边跟过去、ontology_actions 记 adoptProjectDecision（payload 带 rationale）；
 *   · 读侧：`getProjectKnowledge.adoptedDecisions` 列出这笔（decisionClaimId / sourceClaimId / rationale / adoptedBy）；
 *   · 观察者 KG_NOT_OWNER；非成员 KG_NOT_VISIBLE；
 *   · decision 类不能再被采纳（KG_CLAIM_NOT_FOUND）；会话结论（不在项目记忆里）KG_CLAIM_NOT_FOUND；
 *   · 来源 contested ⇒ KG_CONTESTED_NEEDS_RESOLUTION；
 *   · 数据库函数自己也拒观察者（绕过应用层直接调）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adoptProjectDecision } from "../../src/application/knowledge-graph/adopt-project-decision";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import type { PromotionDeps } from "../../src/application/knowledge-graph/promote-to-personal";
import { promoteToProject } from "../../src/application/knowledge-graph/promote-to-project";
import { getProjectKnowledge } from "../../src/application/knowledge-graph/read-project-knowledge";
import { getThreadKnowledge } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { PgPromotion } from "../../src/infrastructure/knowledge-graph/pg-promotion";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-b3-adopt";
const ORG_ID = toOrgId(ORG);
const PROJECT = `${ORG}-p`;
const T_A = "thr-b3-adopt-a"; // 项目线程，u-fac 建，plenary
let db: PgDatabase;
let deps: PromotionDeps;

const claim = (statement: string, kind: string, about: string[]) =>
  ({ statement, kind, confidence: 0.8, about, decidedBy: null, quote: statement });
const REPLY_A = JSON.stringify({
  entities: [{ name: "并网", kind: "concept", aliases: [] }],
  claims: [
    claim("并网周期是首要阻碍", "fact", ["并网"]),
    claim("业主愿为工期承诺付溢价", "hypothesis", ["并网"]),
    claim("下季度先做德国工商业", "decision", ["并网"]),
  ],
});

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1"] });
  await enableExtraction(ORG);
  await addOrgMember(ORG, "u-fac", "consultant", fx.teams.energy!);
  await addOrgMember(ORG, "u-mem", "consultant", fx.teams.energy!);
  await addOrgMember(ORG, "u-obs", "consultant", fx.teams.energy!);
  await addOrgMember(ORG, "u-out", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null);
  await addProjectMember(ORG, PROJECT, "u-mem", "member", fx.groups.g1!);
  await addProjectMember(ORG, PROJECT, "u-obs", "observer", null);
  await addChatThread({ orgId: ORG, id: T_A, projectId: PROJECT, groupId: null, visibilityScope: "plenary", createdBy: "u-fac" });
  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db, true), promotion: new PgPromotion(db), newId: newKgId,
  };
  const { model } = loopbackModel([["并网周期", REPLY_A]]);
  await addChatMessage({ orgId: ORG, id: `m-${T_A}`, threadId: T_A, body: "并网周期是首要阻碍；业主愿为工期承诺付溢价；下季度先做德国工商业。", authorId: "u-fac" });
  await runExtractionTick(extractionDeps(db, model, ORG));
});
afterAll(async () => { await db.close(); });

const sql = <T>(q: string, params: unknown[] = []) => asOwner(async (c) => (await c.query(q, params)).rows as T[]);
const threadClaimId = async (statement: string) => {
  const k = await getThreadKnowledge(deps, { userId: "u-fac", orgId: ORG_ID, threadId: T_A });
  const c = k.claims.find((x) => x.statement === statement);
  if (c === undefined) throw new Error(`no claim ${statement} in ${T_A}`);
  return c.id;
};
const projectClaim = async (statement: string, kind?: string) => {
  const k = await getProjectKnowledge(deps, { userId: "u-fac", orgId: ORG_ID, projectId: PROJECT });
  const c = k.claims.find((x) => x.statement === statement && (kind === undefined || x.kind === kind));
  if (c === undefined) throw new Error(`no project claim ${statement}`);
  return c;
};
const adopt = (userId: string, claimId: string, rationale = "客户访谈与转写都指向它，先按这个排产。") =>
  adoptProjectDecision(deps, { userId, orgId: ORG_ID, projectId: PROJECT, claimId, rationale });

describe("B3-T4 采纳为项目决策", () => {
  it("先由引导师把三条记到项目大脑（来源就绪）", async () => {
    const ids = await Promise.all(["并网周期是首要阻碍", "业主愿为工期承诺付溢价", "下季度先做德国工商业"].map(threadClaimId));
    const { results } = await promoteToProject(deps, { userId: "u-fac", orgId: ORG_ID, threadId: T_A, claimIds: ids });
    expect(results.map((r) => r.outcome)).toEqual(["promoted", "promoted", "promoted"]);
  });

  it("项目成员采纳一条 fact：新 decision（陈述照抄 / human / reviewed_by 采纳人）、derived_from 连回、证据与实体边跟过去、动作带理由", async () => {
    const src = await projectClaim("并网周期是首要阻碍", "fact");
    const out = await adopt("u-mem", src.id);
    expect(out.decisionClaimId).toBe(`${out.actionId}-g`);
    const [d] = await sql<Record<string, string>>(
      "SELECT statement, claim_kind, scope_kind, scope_id, status, created_by, reviewed_by FROM claims WHERE id = $1", [out.decisionClaimId]);
    expect(d).toEqual({
      statement: "并网周期是首要阻碍", claim_kind: "decision", scope_kind: "project", scope_id: PROJECT,
      status: "accepted", created_by: "human", reviewed_by: "u-mem",
    });
    // 来源一字不动
    expect(await sql("SELECT claim_kind, status FROM claims WHERE id = $1", [src.id])).toEqual([{ claim_kind: "fact", status: "accepted" }]);
    expect(await sql("SELECT 1 FROM ontology_edges WHERE src_id = $1 AND dst_id = $2 AND relation = 'derived_from' AND status = 'active'", [out.decisionClaimId, src.id]))
      .toHaveLength(1);
    expect(await sql("SELECT message_id, stance FROM claim_message_evidence WHERE claim_id = $1", [out.decisionClaimId]))
      .toEqual([{ message_id: `m-${T_A}`, stance: "supporting" }]);
    expect(await sql("SELECT o.name FROM ontology_edges e JOIN ontology_objects o ON o.id = e.dst_id WHERE e.src_id = $1 AND e.dst_kind = 'object'", [out.decisionClaimId]))
      .toEqual([{ name: "并网" }]);
    const [act] = await sql<Record<string, string>>(
      `SELECT action_type, scope_kind, scope_id, actor_id, payload->>'rationale' AS rationale,
              payload->>'source_claim_id' AS source, payload->>'decision_claim_id' AS decision
         FROM ontology_actions WHERE id = $1`, [out.actionId]);
    expect(act).toEqual({
      action_type: "adoptProjectDecision", scope_kind: "project", scope_id: PROJECT, actor_id: "u-mem",
      rationale: "客户访谈与转写都指向它，先按这个排产。", source: src.id, decision: out.decisionClaimId,
    });
  });

  it("读侧：getProjectKnowledge 列出这笔采纳记录，决定条目在 claims 里且 derivedFromClaimId 指回来源；观察者也读得到", async () => {
    const src = await projectClaim("并网周期是首要阻碍", "fact");
    const k = await getProjectKnowledge(deps, { userId: "u-obs", orgId: ORG_ID, projectId: PROJECT });
    expect(k.adoptedDecisions).toHaveLength(1);
    const rec = k.adoptedDecisions![0]!;
    expect(rec).toMatchObject({ sourceClaimId: src.id, rationale: "客户访谈与转写都指向它，先按这个排产。" });
    expect(rec.adoptedBy.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(rec.adoptedAt))).toBe(false);
    const decision = k.claims.find((c) => c.id === rec.decisionClaimId);
    expect(decision).toMatchObject({ kind: "decision", statement: "并网周期是首要阻碍", derivedFromClaimId: src.id, createdBy: "human" });
  });

  it("hypothesis 也能采纳；同一条来源再采纳一次各自成条（不判重）", async () => {
    const src = await projectClaim("业主愿为工期承诺付溢价", "hypothesis");
    const a = await adopt("u-fac", src.id, "两轮访谈都听到了溢价意愿。");
    const b = await adopt("u-mem", src.id, "问卷也验证了。");
    expect(a.decisionClaimId).not.toBe(b.decisionClaimId);
    expect(await sql(`SELECT id FROM claims WHERE org_id = '${ORG}' AND scope_kind = 'project' AND claim_kind = 'decision' AND statement = '业主愿为工期承诺付溢价'`)).toHaveLength(2);
    const k = await getProjectKnowledge(deps, { userId: "u-fac", orgId: ORG_ID, projectId: PROJECT });
    expect(k.adoptedDecisions!.filter((d) => d.sourceClaimId === src.id).map((d) => d.rationale).sort()).toEqual(["两轮访谈都听到了溢价意愿。", "问卷也验证了。"]);
  });

  it("观察者 KG_NOT_OWNER；非成员 KG_NOT_VISIBLE；什么都没写", async () => {
    const src = await projectClaim("并网周期是首要阻碍", "fact");
    const before = await sql(`SELECT id FROM claims WHERE org_id = '${ORG}' AND claim_kind = 'decision'`);
    await expect(adopt("u-obs", src.id)).rejects.toMatchObject({ code: "KG_NOT_OWNER" });
    await expect(adopt("u-out", src.id)).rejects.toMatchObject({ code: "KG_NOT_VISIBLE" });
    await expect(adopt("u-stranger", src.id)).rejects.toMatchObject({ code: "KG_NOT_VISIBLE" });
    expect(await sql(`SELECT id FROM claims WHERE org_id = '${ORG}' AND claim_kind = 'decision'`)).toHaveLength(before.length);
  });

  it("decision 类不能再被采纳；会话结论（不在项目记忆里）也不能：都是 KG_CLAIM_NOT_FOUND", async () => {
    const d = await projectClaim("下季度先做德国工商业", "decision");
    await expect(adopt("u-mem", d.id)).rejects.toMatchObject({ code: "KG_CLAIM_NOT_FOUND" });
    const chatClaim = await threadClaimId("并网周期是首要阻碍");
    await expect(adopt("u-mem", chatClaim)).rejects.toMatchObject({ code: "KG_CLAIM_NOT_FOUND" });
  });

  it("来源有未解矛盾 ⇒ KG_CONTESTED_NEEDS_RESOLUTION", async () => {
    const src = await projectClaim("并网周期是首要阻碍", "fact");
    await sql("UPDATE claims SET status = 'contested' WHERE id = $1", [src.id]);
    try {
      await expect(adopt("u-mem", src.id)).rejects.toMatchObject({ code: "KG_CONTESTED_NEEDS_RESOLUTION" });
    } finally {
      await sql("UPDATE claims SET status = 'accepted' WHERE id = $1", [src.id]);
    }
  });

  it("数据库函数自己复核：绕过应用层、以观察者身份直接调 ⇒ KG_NOT_OWNER；空理由 ⇒ KG_INVALID_REQUEST", async () => {
    const src = await projectClaim("并网周期是首要阻碍", "fact");
    const direct = (userId: string, rationale: string) => db.withTenant(ORG_ID, async (s) => {
      await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      await s.query("SELECT kg_adopt_project_decision($1::jsonb)", [JSON.stringify({ action_id: newKgId("act"), project_id: PROJECT, claim_id: src.id, rationale })]);
    });
    await expect(direct("u-obs", "理由")).rejects.toThrow(/^KG_NOT_OWNER/);
    await expect(direct("u-mem", "   ")).rejects.toThrow(/^KG_INVALID_REQUEST/);
  });
});
