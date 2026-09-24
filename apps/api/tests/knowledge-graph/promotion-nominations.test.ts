/**
 * Phase 18 F11 —— AI 提名（uc-18-4 A1，契约 listPromotionNominations），真实数据库。
 *
 * AI 只提名、不执行：列出还没晋升过、不冲突、有出处的结论，每条带一句给人看的理由；
 * 调用前后知识一个字不变。只有个人线程的所有者能看到提名。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { listPromotionNominations, promoteToPersonal, type PromotionDeps } from "../../src/application/knowledge-graph/promote-to-personal";
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
import { extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-f11-nominate";
const ORG_ID = toOrgId(ORG);
const MINE = "thr-kg-f11n-mine";
const SHARED = "thr-kg-f11n-shared";
let db: PgDatabase;
let deps: PromotionDeps;
const owner = { userId: "u-owner", orgId: ORG_ID };

const REPLY = JSON.stringify({
  entities: [{ name: "v2", kind: "product", aliases: [] }, { name: "张三", kind: "person", aliases: [] }],
  claims: [
    { statement: "v2 下周一上线", kind: "decision", confidence: 0.9, about: ["v2"], decidedBy: "张三", quote: "v2 下周一上线" },
    { statement: "发布说明还没写", kind: "todo", confidence: 0.7, about: ["v2"], decidedBy: null, quote: "发布说明还没写" },
    { statement: "测试环境不稳定", kind: "risk", confidence: 0.7, about: ["v2"], decidedBy: null, quote: "测试环境不稳定" },
    { statement: "v2 用的是新架构", kind: "fact", confidence: 0.7, about: ["v2"], decidedBy: null, quote: "v2 用的是新架构" },
  ],
});

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await addOrgMember(ORG, "u-owner", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, `${ORG}-p`, "u-owner", "facilitator", null);
  await addChatThread({ orgId: ORG, id: MINE, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: SHARED, projectId: `${ORG}-p`, visibilityScope: "plenary", createdBy: "u-owner" });
  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db), promotion: new PgPromotion(db), newId: newKgId,
  };
  const { model } = loopbackModel([["上线", REPLY]]);
  const body = "v2 下周一上线，发布说明还没写，测试环境不稳定，v2 用的是新架构。";
  for (const t of [MINE, SHARED]) await addChatMessage({ orgId: ORG, id: `m-${t}`, threadId: t, body, authorId: "u-owner" });
  await runExtractionTick(extractionDeps(db, model, ORG));
});
afterAll(async () => { await db.close(); });

const read = () => getThreadKnowledge(deps, { ...owner, threadId: MINE });
const nominate = () => listPromotionNominations(deps, { ...owner, threadId: MINE });
const byStatement = async (s: string) => (await read()).claims.find((c) => c.statement === s)!.id;

describe("F11: AI 提名", () => {
  it("列出有出处的候选，决定排最前，每条一句人话理由；调用前后知识不变（只提名不执行）", async () => {
    const before = await read();
    const { nominations } = await nominate();
    expect(nominations).toHaveLength(4);
    expect(nominations[0]).toEqual({ claimId: await byStatement("v2 下周一上线"), rationale: "对话里拍板的决定，以后的对话很可能还会用到" });
    for (const n of nominations) {
      expect(n.rationale.length).toBeGreaterThan(0);
      expect(n.rationale).not.toMatch(/claim|scope|L0|L1|ontology/i);
    }
    const after = await read();
    expect(after.revision).toBe(before.revision);
    expect(after.claims).toEqual(before.claims);
    expect(await asOwner(async (c) => (await c.query("SELECT 1 FROM claims WHERE org_id = $1 AND scope_kind = 'personal'", [ORG])).rowCount)).toBe(0);
  });

  it("已晋升的、冲突态的、没有出处的都不再提名", async () => {
    const decided = await byStatement("v2 下周一上线");
    await promoteToPersonal(deps, { ...owner, threadId: MINE, claimIds: [decided] });
    const risk = await byStatement("测试环境不稳定");
    const todo = await byStatement("发布说明还没写");
    await asOwner(async (c) => {
      await c.query("UPDATE claims SET status = 'contested' WHERE id = $1", [risk]);
      await c.query("DELETE FROM claim_message_evidence WHERE claim_id = $1", [todo]);
    });
    const ids = (await nominate()).nominations.map((n) => n.claimId);
    expect(ids).toEqual([await byStatement("v2 用的是新架构")]);
  });

  it("非个人线程没有提名（KG_SCOPE_NOT_PERSONAL）；看不见的线程与不存在同一个出口", async () => {
    await expect(listPromotionNominations(deps, { ...owner, threadId: SHARED })).rejects.toMatchObject({ code: "KG_SCOPE_NOT_PERSONAL" });
    await expect(listPromotionNominations(deps, { userId: "u-stranger", orgId: ORG_ID, threadId: MINE })).rejects.toMatchObject({ code: "KG_THREAD_NOT_FOUND" });
  });
});
