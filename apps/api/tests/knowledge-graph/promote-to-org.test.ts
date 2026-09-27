/**
 * B2-S4（issue #4428）—— 「记到组织记忆」（L2 → L3）与组织大脑只读。真实 PostgreSQL，装配同 `promote-to-project.test.ts`。
 *
 * 钉住：
 *   · 组织 lead 能晋升：L3 复制一条（scope 'org' / org_id）、derived_from 连回项目记忆那条、证据与实体跟过去、动作记 promoteToOrg；
 *   · 组织 admin 也能；consultant（哪怕是项目引导师）不能（KG_NOT_OWNER）；
 *   · 会话结论（不在项目记忆里）逐条 KG_CLAIM_NOT_FOUND；
 *   · 同一说法再记一次 ⇒ 合并到组织记忆里已有那条，不复制第二份；
 *   · 读侧：`getProjectKnowledge.canPromoteToOrg` 只对 lead / admin 为 true；`getOrgKnowledge` 任何组织成员可读，外人 KG_NOT_VISIBLE。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import type { PromotionDeps } from "../../src/application/knowledge-graph/promote-to-personal";
import { promoteToOrg } from "../../src/application/knowledge-graph/promote-to-org";
import { promoteToProject } from "../../src/application/knowledge-graph/promote-to-project";
import { getOrgKnowledge } from "../../src/application/knowledge-graph/read-org-knowledge";
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

const ORG = "org-kg-b2-org";
const ORG_ID = toOrgId(ORG);
const PROJECT = `${ORG}-p`;
const T_A = "thr-b2-a"; // 项目线程，u-fac 建，plenary
let db: PgDatabase;
let deps: PromotionDeps;

const claim = (statement: string, kind: string, about: string[]) =>
  ({ statement, kind, confidence: 0.8, about, decidedBy: null, quote: statement });
const REPLY_A = JSON.stringify({
  entities: [{ name: "并网", kind: "concept", aliases: [] }],
  claims: [claim("客户把交付确定性排在价格之前", "fact", ["并网"]), claim("并网周期是首要阻碍", "fact", ["并网"])],
});

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1"] });
  await enableExtraction(ORG);
  await addOrgMember(ORG, "u-lead", "lead", fx.teams.energy!);
  await addOrgMember(ORG, "u-admin", "admin", fx.teams.energy!);
  await addOrgMember(ORG, "u-fac", "consultant", fx.teams.energy!);
  await addOrgMember(ORG, "u-mem", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null);
  await addProjectMember(ORG, PROJECT, "u-lead", "member", fx.groups.g1!);
  await addProjectMember(ORG, PROJECT, "u-admin", "member", fx.groups.g1!);
  await addChatThread({ orgId: ORG, id: T_A, projectId: PROJECT, groupId: null, visibilityScope: "plenary", createdBy: "u-fac" });
  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db, true), promotion: new PgPromotion(db), newId: newKgId,
  };
  const { model } = loopbackModel([["交付确定性", REPLY_A]]);
  await addChatMessage({ orgId: ORG, id: `m-${T_A}`, threadId: T_A, body: "客户把交付确定性排在价格之前；并网周期是首要阻碍。", authorId: "u-fac" });
  await runExtractionTick(extractionDeps(db, model, ORG));
});
afterAll(async () => { await db.close(); });

const sql = <T>(q: string, params: unknown[] = []) => asOwner(async (c) => (await c.query(q, params)).rows as T[]);
const threadClaimId = async (userId: string, statement: string) => {
  const k = await getThreadKnowledge(deps, { userId, orgId: ORG_ID, threadId: T_A });
  const c = k.claims.find((x) => x.statement === statement);
  if (c === undefined) throw new Error(`no claim ${statement} in ${T_A}`);
  return c.id;
};
const projectClaimId = async (statement: string) => {
  const k = await getProjectKnowledge(deps, { userId: "u-fac", orgId: ORG_ID, projectId: PROJECT });
  const c = k.claims.find((x) => x.statement === statement);
  if (c === undefined) throw new Error(`no project claim ${statement}`);
  return c.id;
};
const promote = (userId: string, claimIds: string[]) => promoteToOrg(deps, { userId, orgId: ORG_ID, projectId: PROJECT, claimIds });

describe("B2-S4 记到组织记忆", () => {
  it("先由引导师把两条记到项目大脑（来源就绪）；读侧 canPromoteToOrg：lead / admin true，consultant（引导师）false", async () => {
    const ids = await Promise.all(["并网周期是首要阻碍", "客户把交付确定性排在价格之前"].map((s) => threadClaimId("u-fac", s)));
    const { results } = await promoteToProject(deps, { userId: "u-fac", orgId: ORG_ID, threadId: T_A, claimIds: ids });
    expect(results.map((r) => r.outcome)).toEqual(["promoted", "promoted"]);
    expect((await getProjectKnowledge(deps, { userId: "u-lead", orgId: ORG_ID, projectId: PROJECT })).canPromoteToOrg).toBe(true);
    expect((await getProjectKnowledge(deps, { userId: "u-admin", orgId: ORG_ID, projectId: PROJECT })).canPromoteToOrg).toBe(true);
    expect((await getProjectKnowledge(deps, { userId: "u-fac", orgId: ORG_ID, projectId: PROJECT })).canPromoteToOrg).toBe(false);
  });

  it("组织 lead 晋升：L3 复制一条到 ('org', orgId)，derived_from 连回项目记忆，证据与实体跟过去，动作 promoteToOrg", async () => {
    const src = await projectClaimId("并网周期是首要阻碍");
    const { results } = await promote("u-lead", [src]);
    expect(results[0]).toMatchObject({ claimId: src, outcome: "promoted" });
    const oid = (results[0] as { personalClaimId: string }).personalClaimId;
    const [l3] = await sql<{ statement: string; scope_kind: string; scope_id: string; status: string; created_by: string }>(
      "SELECT statement, scope_kind, scope_id, status, created_by FROM claims WHERE id = $1", [oid]);
    expect(l3).toEqual({ statement: "并网周期是首要阻碍", scope_kind: "org", scope_id: ORG, status: "accepted", created_by: "human" });
    expect(await sql("SELECT scope_kind, scope_id FROM claims WHERE id = $1", [src])).toEqual([{ scope_kind: "project", scope_id: PROJECT }]);
    expect(await sql("SELECT 1 FROM ontology_edges WHERE src_id = $1 AND dst_id = $2 AND relation = 'derived_from'", [oid, src])).toHaveLength(1);
    expect(await sql("SELECT message_id FROM claim_message_evidence WHERE claim_id = $1", [oid])).toEqual([{ message_id: `m-${T_A}` }]);
    expect(await sql("SELECT o.name, o.scope_kind, o.scope_id FROM ontology_edges e JOIN ontology_objects o ON o.id = e.dst_id WHERE e.src_id = $1", [oid]))
      .toEqual([{ name: "并网", scope_kind: "org", scope_id: ORG }]);
    const [act] = await sql<{ action_type: string; scope_kind: string; scope_id: string; project_id: string }>(
      "SELECT action_type, scope_kind, scope_id, payload->>'project_id' AS project_id FROM ontology_actions WHERE payload->'claims'->1->>'id' = $1", [oid]);
    expect(act).toEqual({ action_type: "promoteToOrg", scope_kind: "org", scope_id: ORG, project_id: PROJECT });
  });

  it("consultant（哪怕是项目引导师）KG_NOT_OWNER；会话结论不在项目记忆里 ⇒ 逐条 KG_CLAIM_NOT_FOUND", async () => {
    const src = await projectClaimId("客户把交付确定性排在价格之前");
    await expect(promote("u-fac", [src])).rejects.toMatchObject({ code: "KG_NOT_OWNER" });
    await expect(promote("u-mem", [src])).rejects.toMatchObject({ code: "KG_NOT_OWNER" });
    const chatClaim = await threadClaimId("u-fac", "客户把交付确定性排在价格之前");
    const { results } = await promote("u-admin", [chatClaim]);
    expect(results).toEqual([{ claimId: chatClaim, outcome: "rejected", code: "KG_CLAIM_NOT_FOUND" }]);
    expect(await sql(`SELECT id FROM claims WHERE org_id = '${ORG}' AND scope_kind = 'org'`)).toHaveLength(1);
  });

  it("组织 admin 晋升第二条；同一说法再记一次 ⇒ 合并到组织记忆里已有那条，不复制第二份", async () => {
    const src = await projectClaimId("客户把交付确定性排在价格之前");
    const first = await promote("u-admin", [src]);
    expect(first.results[0]).toMatchObject({ claimId: src, outcome: "promoted" });
    const oid = (first.results[0] as { personalClaimId: string }).personalClaimId;
    const again = await promote("u-lead", [src]);
    expect(again.results[0]).toEqual({ claimId: src, outcome: "merged_into_existing", personalClaimId: oid });
    expect(await sql(`SELECT id FROM claims WHERE org_id = '${ORG}' AND scope_kind = 'org' AND statement = '客户把交付确定性排在价格之前'`)).toHaveLength(1);
  });

  it("组织大脑只读：任何组织成员（consultant）都看得到两条与实体；外人 KG_NOT_VISIBLE", async () => {
    const k = await getOrgKnowledge(deps, { userId: "u-mem", orgId: ORG_ID });
    expect(k.scope).toEqual({ kind: "org", id: ORG });
    expect(k.claims.map((c) => c.statement).sort()).toEqual(["客户把交付确定性排在价格之前", "并网周期是首要阻碍"].sort());
    expect(k.claims.every((c) => c.scope.kind === "org" && c.derivedFromClaimId !== null)).toBe(true);
    expect(k.objects.map((o) => o.name)).toEqual(["并网"]);
    expect(k.revision).toBeGreaterThanOrEqual(3);
    await expect(getOrgKnowledge(deps, { userId: "u-stranger", orgId: ORG_ID })).rejects.toMatchObject({ code: "KG_NOT_VISIBLE" });
  });
});
