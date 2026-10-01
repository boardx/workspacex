/**
 * 项目中枢 R7 —— 「记到项目大脑」（L0 → L2）与项目内召回。真实 PostgreSQL，装配同 `promote-to-personal.test.ts`。
 *
 * 钉住：
 *   · 创建者能晋升：L2 复制一条（scope 'project' / project_id）、derived_from 连回、证据与实体跟过去、动作记 promoteToProject；
 *   · 本项目引导师（非创建者）也能；同项目普通组员不能（KG_NOT_OWNER）；个人线程不能（KG_SCOPE_NOT_PROJECT）；
 *   · 一模一样的结论从另一条项目线程晋升 ⇒ 合并到已有那条；
 *   · 召回：同项目**另一条**线程的候选集里出现项目记忆（scope=project），个人线程里不出现。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import type { PromotionDeps } from "../../src/application/knowledge-graph/promote-to-personal";
import { promoteToProject } from "../../src/application/knowledge-graph/promote-to-project";
import { getThreadKnowledge } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { KgHumanActionError } from "../../src/application/knowledge-graph/ports";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { PgPromotion } from "../../src/infrastructure/knowledge-graph/pg-promotion";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-r7-project";
const ORG_ID = toOrgId(ORG);
const PROJECT = `${ORG}-p`;
const T_A = "thr-r7-a";      // 项目线程，u-creator 建，group-shared
const T_B = "thr-r7-b";      // 同项目另一条线程，u-fac 建（召回的观察点）
const T_P = "thr-r7-personal"; // u-creator 的个人线程
let db: PgDatabase;
let deps: PromotionDeps;
let recall: PgKnowledgeRecall;

const claim = (statement: string, kind: string, about: string[]) =>
  ({ statement, kind, confidence: 0.8, about, decidedBy: null, quote: statement });
const REPLY_A = JSON.stringify({
  entities: [{ name: "并网", kind: "concept", aliases: [] }],
  claims: [claim("客户把交付确定性排在价格之前", "fact", ["并网"]), claim("并网周期是首要阻碍", "fact", ["并网"])],
});
const REPLY_B = JSON.stringify({ entities: [], claims: [claim("客户把交付确定性排在价格之前", "fact", [])] });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1"] });
  await enableExtraction(ORG);
  for (const u of ["u-creator", "u-fac", "u-mem"]) await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null);
  await addProjectMember(ORG, PROJECT, "u-creator", "member", fx.groups.g1!);
  await addProjectMember(ORG, PROJECT, "u-mem", "member", fx.groups.g1!);
  await addChatThread({ orgId: ORG, id: T_A, projectId: PROJECT, groupId: fx.groups.g1!, visibilityScope: "group-shared", createdBy: "u-creator" });
  await addChatThread({ orgId: ORG, id: T_B, projectId: PROJECT, groupId: null, visibilityScope: "plenary", createdBy: "u-fac" });
  await addChatThread({ orgId: ORG, id: T_P, projectId: null, visibilityScope: "private", createdBy: "u-creator" });
  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db, true), promotion: new PgPromotion(db), newId: newKgId,
  };
  recall = new PgKnowledgeRecall(db);
  const { model } = loopbackModel([["交付确定性", REPLY_A], ["同一句", REPLY_B]]);
  await addChatMessage({ orgId: ORG, id: `m-${T_A}`, threadId: T_A, body: "客户把交付确定性排在价格之前；并网周期是首要阻碍。", authorId: "u-creator" });
  await addChatMessage({ orgId: ORG, id: `m-${T_B}`, threadId: T_B, body: "同一句：客户把交付确定性排在价格之前。", authorId: "u-fac" });
  await addChatMessage({ orgId: ORG, id: `m-${T_P}`, threadId: T_P, body: "客户把交付确定性排在价格之前；并网周期是首要阻碍。", authorId: "u-creator" });
  await runExtractionTick(extractionDeps(db, model, ORG));
});
afterAll(async () => { await db.close(); });

const sql = <T>(q: string, params: unknown[] = []) => asOwner(async (c) => (await c.query(q, params)).rows as T[]);
const claimId = async (userId: string, threadId: string, statement: string) => {
  const k = await getThreadKnowledge(deps, { userId, orgId: ORG_ID, threadId });
  const c = k.claims.find((x) => x.statement === statement);
  if (c === undefined) throw new Error(`no claim ${statement} in ${threadId}`);
  return c.id;
};
const promote = (userId: string, threadId: string, claimIds: string[]) =>
  promoteToProject(deps, { userId, orgId: ORG_ID, threadId, claimIds });

describe("R7 记到项目大脑", () => {
  it("读侧：项目线程的创建者与引导师 canPromoteToProject=true，普通组员 false，个人线程 false", async () => {
    expect((await getThreadKnowledge(deps, { userId: "u-creator", orgId: ORG_ID, threadId: T_A })).canPromoteToProject).toBe(true);
    expect((await getThreadKnowledge(deps, { userId: "u-fac", orgId: ORG_ID, threadId: T_A })).canPromoteToProject).toBe(true);
    expect((await getThreadKnowledge(deps, { userId: "u-mem", orgId: ORG_ID, threadId: T_A })).canPromoteToProject).toBe(false);
    expect((await getThreadKnowledge(deps, { userId: "u-creator", orgId: ORG_ID, threadId: T_P })).canPromoteToProject).toBe(false);
  });

  it("创建者晋升：L2 复制一条到 ('project', projectId)，derived_from 连回，证据与实体跟过去，动作 promoteToProject", async () => {
    const src = await claimId("u-creator", T_A, "并网周期是首要阻碍");
    const { results } = await promote("u-creator", T_A, [src]);
    expect(results[0]).toMatchObject({ claimId: src, outcome: "promoted" });
    const pid = (results[0] as { personalClaimId: string }).personalClaimId;
    const [l2] = await sql<{ statement: string; scope_kind: string; scope_id: string; status: string; created_by: string }>(
      "SELECT statement, scope_kind, scope_id, status, created_by FROM claims WHERE id = $1", [pid]);
    expect(l2).toEqual({ statement: "并网周期是首要阻碍", scope_kind: "project", scope_id: PROJECT, status: "accepted", created_by: "human" });
    expect(await sql("SELECT scope_kind, scope_id FROM claims WHERE id = $1", [src])).toEqual([{ scope_kind: "chat_session", scope_id: T_A }]);
    expect(await sql("SELECT 1 FROM ontology_edges WHERE src_id = $1 AND dst_id = $2 AND relation = 'derived_from'", [pid, src])).toHaveLength(1);
    expect(await sql("SELECT message_id FROM claim_message_evidence WHERE claim_id = $1", [pid])).toEqual([{ message_id: `m-${T_A}` }]);
    expect(await sql("SELECT o.name, o.scope_kind FROM ontology_edges e JOIN ontology_objects o ON o.id = e.dst_id WHERE e.src_id = $1", [pid]))
      .toEqual([{ name: "并网", scope_kind: "project" }]);
    const [act] = await sql<{ action_type: string; scope_kind: string; scope_id: string }>(
      "SELECT action_type, scope_kind, scope_id FROM ontology_actions WHERE payload->'claims'->1->>'id' = $1", [pid]);
    expect(act).toEqual({ action_type: "promoteToProject", scope_kind: "project", scope_id: PROJECT });
  });

  it("引导师（非创建者）能晋升；同项目普通组员 KG_NOT_OWNER；个人线程 KG_SCOPE_NOT_PROJECT", async () => {
    const src = await claimId("u-fac", T_A, "客户把交付确定性排在价格之前");
    const { results } = await promote("u-fac", T_A, [src]);
    expect(results[0]).toMatchObject({ claimId: src, outcome: "promoted" });
    await expect(promote("u-mem", T_A, [src])).rejects.toMatchObject({ code: "KG_NOT_OWNER" });
    const personal = await claimId("u-creator", T_P, "并网周期是首要阻碍");
    await expect(promote("u-creator", T_P, [personal])).rejects.toBeInstanceOf(KgHumanActionError);
    await expect(promote("u-creator", T_P, [personal])).rejects.toMatchObject({ code: "KG_SCOPE_NOT_PROJECT" });
  });

  it("另一条项目线程里一模一样的结论 ⇒ 合并到项目记忆里已有那条，不复制第二份", async () => {
    const existing = await sql<{ id: string }>(
      `SELECT id FROM claims WHERE org_id = '${ORG}' AND scope_kind = 'project' AND statement = '客户把交付确定性排在价格之前'`);
    expect(existing).toHaveLength(1);
    const src = await claimId("u-fac", T_B, "客户把交付确定性排在价格之前");
    const { results } = await promote("u-fac", T_B, [src]);
    expect(results[0]).toEqual({ claimId: src, outcome: "merged_into_existing", personalClaimId: existing[0]!.id });
    expect(await sql(`SELECT id FROM claims WHERE org_id = '${ORG}' AND scope_kind = 'project' AND statement = '客户把交付确定性排在价格之前'`)).toHaveLength(1);
  });

  it("召回：同项目另一条线程的候选集里出现项目记忆（scope=project）；从本线程晋升出去的那条不重复；个人线程里不出现", async () => {
    const inB = await recall.candidates(ORG_ID, "u-fac", T_B);
    // 「客户把交付确定性排在价格之前」在 B 里已作为本会话结论（chat_session）进候选；它合并进的那条项目记忆
    // 由 B 的这条 derived_from 连回，按 L1 同款规则不再重复一份。只有从别的线程记进项目大脑的才以 project 出现。
    expect(inB.claims.filter((c) => c.scope === "project").map((c) => c.statement)).toEqual(["并网周期是首要阻碍"]);
    expect(inB.claims.filter((c) => c.scope === "chat_session").map((c) => c.statement)).toContain("客户把交付确定性排在价格之前");
    const inPersonal = await recall.candidates(ORG_ID, "u-creator", T_P);
    expect(inPersonal.claims.filter((c) => c.scope === "project")).toHaveLength(0);
  });
});
