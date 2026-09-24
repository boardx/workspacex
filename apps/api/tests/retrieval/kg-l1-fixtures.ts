/**
 * F12 测试的共享夹具：一个 org，所有者 u-owner 有两条个人会话（A 里说过客户 A 的要求并晋升到个人空间，
 * B 是新会话）；一条项目会话 S（所有者 + 成员 u-member 都在）；u-member 与 u-other 各有自己的个人会话。
 * 知识由 F06 抽取流水线真实产生、F11 真实晋升、F04 投影进 AGE。
 */
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { projectPendingGraph } from "../../src/application/knowledge-graph/project-pending-graph";
import { promoteToPersonal, type PromotionDeps } from "../../src/application/knowledge-graph/promote-to-personal";
import { getThreadKnowledge } from "../../src/application/knowledge-graph/read-thread-knowledge";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgGraphProjection } from "../../src/infrastructure/knowledge-graph/pg-graph-projection";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { PgPromotion } from "../../src/infrastructure/knowledge-graph/pg-promotion";
import { enableExtraction, extractionDeps, loopbackModel, silentLogger } from "../knowledge-graph/kg-extraction-fixtures";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

export const DEMAND = "客户 A 要求 v2 下周一上线";

const REPLY = JSON.stringify({
  entities: [{ name: "客户 A", kind: "organization", aliases: [] }, { name: "v2", kind: "product", aliases: [] }],
  claims: [{ statement: DEMAND, kind: "fact", confidence: 0.9, about: ["客户 A", "v2"], decidedBy: null, quote: DEMAND }],
});
const SHARED_REPLY = JSON.stringify({
  entities: [{ name: "客户 A", kind: "organization", aliases: [] }],
  claims: [{ statement: "客户 A 的合同在法务那里", kind: "fact", confidence: 0.8, about: ["客户 A"], decidedBy: null, quote: "客户 A 的合同在法务那里" }],
});

export interface L1Org {
  readonly org: string;
  readonly A: string;
  readonly B: string;
  readonly S: string;
  readonly MEMBER: string;
  readonly OTHER: string;
  readonly readDeps: PromotionDeps;
  /** 晋升后 L1 那条结论的 id。 */
  readonly personalClaimId: string;
}

export async function seedL1Org(db: DatabasePort, org: string): Promise<L1Org> {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(org);
  const fx = await seedOrg({ orgId: org, projectId: `${org}-p` });
  await enableExtraction();
  for (const u of ["u-owner", "u-member", "u-other"]) await addOrgMember(org, u, "consultant", fx.teams.energy!);
  for (const u of ["u-owner", "u-member"]) await addProjectMember(org, `${org}-p`, u, "facilitator", null);
  const ids = { A: `${org}-A`, B: `${org}-B`, S: `${org}-S`, MEMBER: `${org}-member`, OTHER: `${org}-other` };
  await addChatThread({ orgId: org, id: ids.A, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: org, id: ids.B, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: org, id: ids.S, projectId: `${org}-p`, visibilityScope: "plenary", createdBy: "u-owner" });
  await addChatThread({ orgId: org, id: ids.MEMBER, projectId: null, visibilityScope: "private", createdBy: "u-member" });
  await addChatThread({ orgId: org, id: ids.OTHER, projectId: null, visibilityScope: "private", createdBy: "u-other" });
  await addChatMessage({ orgId: org, id: `m-${ids.A}`, threadId: ids.A, body: `${DEMAND}，不然就换供应商。`, authorId: "u-owner" });
  await addChatMessage({ orgId: org, id: `m-${ids.S}`, threadId: ids.S, body: "客户 A 的合同在法务那里。", authorId: "u-owner" });
  await runExtractionTick(extractionDeps(db, loopbackModel([["要求", REPLY], ["合同", SHARED_REPLY]]).model, org));

  const readDeps: PromotionDeps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db), promotion: new PgPromotion(db), newId: newKgId,
  };
  const orgId = toOrgId(org);
  const k = await getThreadKnowledge(readDeps, { userId: "u-owner", orgId, threadId: ids.A });
  const src = k.claims.find((c) => c.statement === DEMAND)!;
  const { results } = await promoteToPersonal(readDeps, { userId: "u-owner", orgId, threadId: ids.A, claimIds: [src.id] });
  const personalClaimId = (results[0] as { personalClaimId: string }).personalClaimId;
  await projectPendingGraph(new PgGraphProjection(db), silentLogger);
  return { org, ...ids, readDeps, personalClaimId };
}
