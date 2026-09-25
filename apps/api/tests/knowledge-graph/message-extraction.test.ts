/**
 * issue #4180 —— 「这条消息刚被抽取出新知识」的信号源：`getMessageExtraction`。真实数据库。
 *
 * 与 F13 `getTurnMemory` 的 `captured`（挂在回答下方，按「回答 + 前面紧邻的用户消息」整轮算）
 * 不是同一件事——这里只认这一条消息自己的证据，不做向前扩展匹配，覆盖：
 *   - 一条消息产生了活结论 ⇒ 出现；
 *   - 那条结论后来被撤销（F10 revokeClaim）⇒ 不再出现；
 *   - 一条没有被抽出任何东西的消息 ⇒ 空数组，不是错误；
 *   - 伪造 / 跨会话 / 跨组织的 messageId 不泄露任何结论；
 *   - 看不见这个会话的人读它 ⇒ KG_THREAD_NOT_FOUND（同其余读接口「不存在与看不见同一出口」的纪律）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyHumanAction, type HumanActionDeps } from "../../src/application/knowledge-graph/apply-human-action";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { getMessageExtraction, getThreadKnowledge, KgReadError, type KnowledgeReadDeps } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgHumanAction } from "../../src/infrastructure/knowledge-graph/pg-human-action";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-f4180-extraction";
const ORG_ID = toOrgId(ORG);
const OTHER_ORG = "org-kg-f4180-other";
const OTHER_ORG_ID = toOrgId(OTHER_ORG);
const MINE = "thr-kg-f4180-mine";
const SILENT = "thr-kg-f4180-silent";
const OTHER_THREAD = "thr-kg-f4180-other-thread";

const STATEMENT = "客户 A 要求下周一上线";
const REPLY = JSON.stringify({
  entities: [{ name: "客户 A", kind: "organization", aliases: [] }],
  claims: [{ statement: STATEMENT, kind: "fact", confidence: 0.9, about: ["客户 A"], decidedBy: null, quote: STATEMENT }],
});

let db: PgDatabase;
let readDeps: KnowledgeReadDeps;
let actionDeps: HumanActionDeps;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG, OTHER_ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  const otherFx = await seedOrg({ orgId: OTHER_ORG, projectId: `${OTHER_ORG}-p` });
  await enableExtraction(ORG, OTHER_ORG);
  await addOrgMember(ORG, "u-owner", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, `${ORG}-p`, "u-owner", "facilitator", null);
  await addOrgMember(OTHER_ORG, "u-owner", "consultant", otherFx.teams.energy!);
  await addChatThread({ orgId: ORG, id: MINE, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: SILENT, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: OTHER_ORG, id: OTHER_THREAD, projectId: null, visibilityScope: "private", createdBy: "u-owner" });

  await addChatMessage({ orgId: ORG, id: `m-${MINE}`, threadId: MINE, body: `${STATEMENT}。`, authorId: "u-owner" });
  // 这条消息没有触发任何抽取产物（回环模型对「无关」不命中任何关键词，回空结果）。
  await addChatMessage({ orgId: ORG, id: `m-${SILENT}`, threadId: SILENT, body: "今天天气不错。", authorId: "u-owner" });
  // 另一个组织里，恰好取了同一个字面量 id，用来证明「message_id 字面相等」不足以跨组织/跨会话拿到结论。
  await addChatMessage({ orgId: OTHER_ORG, id: `m-${MINE}`, threadId: OTHER_THREAD, body: `${STATEMENT}。`, authorId: "u-owner" });

  db = new PgDatabase(appConfig());
  const { model } = loopbackModel([["客户 A", REPLY]]);
  await runExtractionTick(extractionDeps(db, model, ORG));
  await runExtractionTick(extractionDeps(db, model, OTHER_ORG));

  readDeps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db, true),
  };
  actionDeps = { ...readDeps, actions: new PgHumanAction(db), newId: newKgId };
});
afterAll(async () => { await db.close(); });

describe("issue #4180: getMessageExtraction", () => {
  it("一条消息产生了活结论 ⇒ 出现，带 claimId 与 statement", async () => {
    const out = await getMessageExtraction(readDeps, { userId: "u-owner", orgId: ORG_ID, threadId: MINE, messageId: `m-${MINE}` });
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0]).toMatchObject({ statement: STATEMENT });
  });

  it("一条没有被抽出任何东西的消息 ⇒ 空数组，不是错误", async () => {
    const out = await getMessageExtraction(readDeps, { userId: "u-owner", orgId: ORG_ID, threadId: SILENT, messageId: `m-${SILENT}` });
    expect(out.claims).toEqual([]);
  });

  it("伪造 messageId（不存在）⇒ 空数组，不报错、不泄露", async () => {
    const out = await getMessageExtraction(readDeps, { userId: "u-owner", orgId: ORG_ID, threadId: MINE, messageId: "forged-message-id-does-not-exist" });
    expect(out.claims).toEqual([]);
  });

  it("跨会话：拿另一条会话真实存在的 messageId 来问这条会话 ⇒ 空数组（消息不属于这条会话）", async () => {
    const out = await getMessageExtraction(readDeps, { userId: "u-owner", orgId: ORG_ID, threadId: MINE, messageId: `m-${SILENT}` });
    expect(out.claims).toEqual([]);
  });

  it("跨组织：同一个字面量 message_id 在另一个组织里真实存在、也真的抽出了同名结论，读这个组织时不会读到那一条", async () => {
    // 先证明另一个组织确实真的抽出了同名结论——不是「凑巧两边都是空」这种弱结论。
    const otherOut = await getMessageExtraction(readDeps, { userId: "u-owner", orgId: OTHER_ORG_ID, threadId: OTHER_THREAD, messageId: `m-${MINE}` });
    expect(otherOut.claims).toHaveLength(1);
    expect(otherOut.claims[0]).toMatchObject({ statement: STATEMENT });
    // 本组织用同一个字面量 messageId 读，看到的是自己会话里真的产生的那一条，不会因为跨组织撞了同一个
    // message_id 字符串就多读出别的组织的结论（本条 claimId 与另一个组织那条不是同一个 id）。
    const mineOut = await getMessageExtraction(readDeps, { userId: "u-owner", orgId: ORG_ID, threadId: MINE, messageId: `m-${MINE}` });
    expect(mineOut.claims).toHaveLength(1);
    expect(mineOut.claims[0]!.claimId).not.toBe(otherOut.claims[0]!.claimId);
  });

  it("那条结论后来被撤销（F10 revokeClaim）⇒ 不再出现", async () => {
    const before = await getMessageExtraction(readDeps, { userId: "u-owner", orgId: ORG_ID, threadId: MINE, messageId: `m-${MINE}` });
    const claimId = before.claims[0]!.claimId;
    const k = await getThreadKnowledge(readDeps, { userId: "u-owner", orgId: ORG_ID, threadId: MINE });
    await applyHumanAction(actionDeps, {
      userId: "u-owner", orgId: ORG_ID, threadId: MINE, basedOnRevision: k.revision,
      action: { type: "revokeClaim", claimId },
    });
    const after = await getMessageExtraction(readDeps, { userId: "u-owner", orgId: ORG_ID, threadId: MINE, messageId: `m-${MINE}` });
    expect(after.claims).toEqual([]);
  });

  it("会话不可见（不是成员）⇒ KG_THREAD_NOT_FOUND，同其余读接口「不存在与看不见同一出口」的纪律", async () => {
    await expect(getMessageExtraction(readDeps, { userId: "u-stranger", orgId: ORG_ID, threadId: MINE, messageId: `m-${MINE}` }))
      .rejects.toMatchObject({ code: "KG_THREAD_NOT_FOUND" });
    await expect(getMessageExtraction(readDeps, { userId: "u-stranger", orgId: ORG_ID, threadId: MINE, messageId: `m-${MINE}` }))
      .rejects.toBeInstanceOf(KgReadError);
  });
});
