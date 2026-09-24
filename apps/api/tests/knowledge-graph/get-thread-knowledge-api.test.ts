/**
 * Phase 18 F09 —— 知识面板读接口（UC-KG-1 / 2 / 11），真实数据库、真实可见性判定。
 *
 * 数据由 F06 的抽取流水线（回环模型）真实产生，不手插本体行：读模型测的是「用户说了一句话之后，
 * 面板上看到的东西」。
 */
import { NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import {
  KgReadError, getClaimSources, getThreadKnowledge, getTurnMemory, type KnowledgeReadDeps,
} from "../../src/application/knowledge-graph/read-thread-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { KnowledgeGraphController } from "../../src/interface/controllers/knowledge-graph.controller";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { ZHANG_DECIDES, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-f09-read";
const ORG_ID = toOrgId(ORG);
const PERSONAL = "thr-kg-f09-personal";
const SHARED = "thr-kg-f09-shared";
let db: PgDatabase;
let deps: KnowledgeReadDeps;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  for (const u of ["u-owner", "u-member"]) {
    await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
    await addProjectMember(ORG, `${ORG}-p`, u, "facilitator", null);
  }
  await addChatThread({ orgId: ORG, id: PERSONAL, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: SHARED, projectId: `${ORG}-p`, visibilityScope: "plenary", createdBy: "u-owner" });
  db = new PgDatabase(appConfig());
  deps = { repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db), knowledge: new PgKnowledgeRead(db) };

  const { model } = loopbackModel([["张三决定", ZHANG_DECIDES]]);
  for (const t of [PERSONAL, SHARED]) {
    await addChatMessage({ orgId: ORG, id: `m-${t}-q`, threadId: t, body: "那就这样，张三决定下周一上线 v2。", authorId: "u-owner" });
    await addChatMessage({ orgId: ORG, id: `m-${t}-a`, threadId: t, body: "好的，已记录。", authorId: "agent-1", authorKind: "agent", agentId: "agent-1" });
  }
  await runExtractionTick(extractionDeps(db, model, ORG));
});
afterAll(async () => { await db.close(); });

const owner = { userId: "u-owner", orgId: ORG_ID };

describe("F09: getThreadKnowledge", () => {
  it("所有者读个人线程：实体、结论（三态 = AI 记下的）、边、可编辑、仅你可见", async () => {
    const out = KG.knowledgeGraph.getThreadKnowledge.out.parse(await getThreadKnowledge(deps, { ...owner, threadId: PERSONAL }));
    expect(out.scope).toEqual({ kind: "chat_session", id: PERSONAL });
    expect(out.objects.map((o) => [o.name, o.kind, o.claimCount]).sort()).toEqual([["v2", "product", 1], ["张三", "person", 1]]);
    expect(out.claims).toHaveLength(1);
    const [claim] = out.claims;
    expect(claim).toMatchObject({ kind: "decision", status: "proposed", triState: "pending", createdBy: "model", supportingCount: 1, contradictingCount: 0 });
    expect(KG.KG_TRI_STATE_LABEL_ZH[claim!.triState]).toBe("AI 记下的");
    expect(claim!.aboutObjectIds).toHaveLength(1);
    expect(out.edges.map((e) => e.relation).sort()).toEqual(["about", "decided_by"]);
    expect(out.revision).toBeGreaterThan(0);
    expect(out).toMatchObject({ canEdit: true, canPromote: true, visibility: "owner_only" });
    expect(out.ingestion).toEqual({ queued: 0, running: 0, failed: 0, failures: [] });
  });

  it("项目里的共享线程：成员只读、会话成员可见；不能晋升", async () => {
    const out = await getThreadKnowledge(deps, { userId: "u-member", orgId: ORG_ID, threadId: SHARED });
    expect(out.claims).toHaveLength(1);
    expect(out).toMatchObject({ canEdit: false, canPromote: false, visibility: "thread_members" });
  });

  it("别人的个人线程：与「不存在」同一个出口（KG_THREAD_NOT_FOUND），HTTP 404", async () => {
    await expect(getThreadKnowledge(deps, { userId: "u-member", orgId: ORG_ID, threadId: PERSONAL }))
      .rejects.toMatchObject({ code: "KG_THREAD_NOT_FOUND" });
    await expect(getThreadKnowledge(deps, { ...owner, threadId: "thr-does-not-exist" }))
      .rejects.toBeInstanceOf(KgReadError);
    const ctl = new KnowledgeGraphController(deps.repo, deps.ids, deps.chat, deps.knowledge);
    const principal = { userId: "u-member", orgId: ORG } as never;
    await expect(ctl.threadKnowledge(principal, PERSONAL)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("入图进度：新消息排队中 ⇒ queued；三次失败 ⇒ failed 并列出来源", async () => {
    await addChatMessage({ orgId: ORG, id: "m-f09-queued", threadId: PERSONAL, body: "还有一件事", authorId: "u-owner" });
    let out = await getThreadKnowledge(deps, { ...owner, threadId: PERSONAL });
    expect(out.ingestion).toMatchObject({ queued: 1, failed: 0 });
    const failing = extractionDeps(db, loopbackModel([["还有一件事", new Error("down")]]).model, ORG);
    for (let i = 0; i < 3; i += 1) await runExtractionTick(failing);
    out = await getThreadKnowledge(deps, { ...owner, threadId: PERSONAL });
    expect(out.ingestion).toEqual({ queued: 0, running: 0, failed: 1, failures: [{ sourceKind: "chat_message", sourceRef: "m-f09-queued", reason: "retries_exhausted" }] });
  });
});

describe("F09: getClaimSources", () => {
  it("来源抽屉：证据指回原消息（带原话摘录），出处记录是系统的抽取动作", async () => {
    const [claim] = (await getThreadKnowledge(deps, { ...owner, threadId: PERSONAL })).claims;
    const out = KG.knowledgeGraph.getClaimSources.out.parse(await getClaimSources(deps, { ...owner, claimId: claim!.id }));
    expect(out.evidence).toEqual([{
      segmentId: `m-${PERSONAL}-q`, stance: "supporting", sourceKind: "chat_message", sourceRef: `m-${PERSONAL}-q`,
      excerpt: "张三决定下周一上线 v2", locator: null, revoked: false,
    }]);
    expect(out.provenance).toEqual([expect.objectContaining({ actor: { kind: "system", id: "kg-extractor" }, action: "extract", pipelineVersion: "kg-extract@1" })]);
  });

  it("看不到会话的人读不到结论来源（与不存在同一个出口）", async () => {
    const [claim] = (await getThreadKnowledge(deps, { ...owner, threadId: PERSONAL })).claims;
    await expect(getClaimSources(deps, { userId: "u-member", orgId: ORG_ID, claimId: claim!.id })).rejects.toMatchObject({ code: "KG_CLAIM_NOT_FOUND" });
    await expect(getClaimSources(deps, { ...owner, claimId: "clm-nope" })).rejects.toMatchObject({ code: "KG_CLAIM_NOT_FOUND" });
  });
});

describe("F09: getTurnMemory（U-1 已记下 N 条）", () => {
  it("回答下方：这一轮（回答 + 它前面的用户消息）记下的条目", async () => {
    const out = KG.knowledgeGraph.getTurnMemory.out.parse(
      await getTurnMemory(deps, { ...owner, threadId: PERSONAL, messageId: `m-${PERSONAL}-a` }));
    expect(out.captured.map((c) => c.statement)).toEqual(["张三决定下周一上线 v2"]);
    expect(out).toMatchObject({ messageId: `m-${PERSONAL}-a`, pending: false, prompt: null });
  });

  it("还在整理中 ⇒ pending；没记下东西 ⇒ captured 为空", async () => {
    await addChatMessage({ orgId: ORG, id: "m-f09-new-q", threadId: SHARED, body: "新的一句话", authorId: "u-owner" });
    await addChatMessage({ orgId: ORG, id: "m-f09-new-a", threadId: SHARED, body: "收到", authorId: "agent-1", authorKind: "agent", agentId: "agent-1" });
    const out = await getTurnMemory(deps, { ...owner, threadId: SHARED, messageId: "m-f09-new-a" });
    expect(out).toMatchObject({ captured: [], pending: true });
  });
});
