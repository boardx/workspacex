/**
 * issue #4352 —— 每条消息的抽取结果（`getMessageExtraction.status`）与 UC-KG-4「整理本会话」（`requestReindex`）。
 * 真实数据库、真实队列 / 执行器 / 读模型；模型是按消息内容回固定 JSON 的回环实现。
 *
 * 契约字段 `status` 按人类 2026-09-27 的决定先行实现、签核后补（evidence/phase-18/r10/README.md §3.2）。
 */
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { getMessageExtraction, getThreadKnowledge, type KnowledgeReadDeps } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { requestReindex, type RequestReindexDeps } from "../../src/application/knowledge-graph/request-reindex";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgKgReindex } from "../../src/infrastructure/knowledge-graph/pg-kg-reindex";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { KnowledgeGraphController } from "../../src/interface/controllers/knowledge-graph.controller";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { ZHANG_DECIDES, enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4352";
const ORG_ID = toOrgId(ORG);
const MINE = "thr-kg-i4352-mine";
const SHARED = "thr-kg-i4352-shared";
const OFF = "thr-kg-i4352-off";
let db: PgDatabase;
let readDeps: KnowledgeReadDeps;
let reindexDeps: RequestReindexDeps;

const owner = { userId: "u-owner", orgId: ORG_ID };
const model = loopbackModel([["张三决定", ZHANG_DECIDES], ["乱码", "抱歉我不太明白"]]).model;
const tick = () => runExtractionTick(extractionDeps(db, model, ORG));
const status = async (threadId: string, messageId: string) =>
  (await getMessageExtraction(readDeps, { ...owner, threadId, messageId })).status;
const queueRows = (threadId: string) => asApp(ORG, (c) => c.query<{ message_id: string; attempts: number }>(
  "SELECT message_id, attempts FROM kg_extraction_queue WHERE thread_id = $1 ORDER BY message_id", [threadId])).then((r) => r.rows);
const due = (threadId: string) => asOwner((c) => c.query("UPDATE kg_extraction_queue SET next_attempt_at = now() WHERE thread_id = $1", [threadId]));

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await enableExtraction(ORG);
  for (const u of ["u-owner", "u-member"]) {
    await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
    await addProjectMember(ORG, `${ORG}-p`, u, "facilitator", null);
  }
  await addChatThread({ orgId: ORG, id: MINE, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: SHARED, projectId: `${ORG}-p`, visibilityScope: "plenary", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: OFF, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  db = new PgDatabase(appConfig());
  readDeps = { repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db), knowledge: new PgKnowledgeRead(db, true) };
  reindexDeps = { ...readDeps, reindex: new PgKgReindex(db), extractionConfigured: true };
});
afterAll(async () => { await db.close(); });

describe("issue #4352: getMessageExtraction.status", () => {
  it("排队中 ⇒ pending；抽出了东西 ⇒ written；合法的「没有可记的」⇒ empty；从没排进抽取 ⇒ none", async () => {
    await addChatMessage({ orgId: ORG, id: "m-4352-zhang", threadId: MINE, body: "那就这样，张三决定下周一上线 v2。", authorId: "u-owner" });
    await addChatMessage({ orgId: ORG, id: "m-4352-hello", threadId: MINE, body: "你好呀，辛苦了！", authorId: "u-owner" });
    await addChatMessage({ orgId: ORG, id: "m-4352-raw", threadId: MINE, body: "转录片段", authorId: "u-owner", rawTranscript: true });
    expect(await status(MINE, "m-4352-zhang")).toBe("pending");
    await tick();
    const zhang = await getMessageExtraction(readDeps, { ...owner, threadId: MINE, messageId: "m-4352-zhang" });
    expect(zhang.status).toBe("written");
    expect(zhang.claims.length).toBeGreaterThan(0);
    expect(KG.knowledgeGraph.getMessageExtraction.out.safeParse(zhang).success).toBe(true);
    expect(await getMessageExtraction(readDeps, { ...owner, threadId: MINE, messageId: "m-4352-hello" })).toEqual({ claims: [], status: "empty" });
    expect(await status(MINE, "m-4352-raw")).toBe("none");
    expect(await status(MINE, "m-does-not-exist")).toBe("none");
  });

  it("解析不出 ⇒ 重试期间 pending，三次用完 ⇒ failed", async () => {
    await addChatMessage({ orgId: ORG, id: "m-4352-garbage", threadId: MINE, body: "乱码 xyz", authorId: "u-owner" });
    await tick();
    expect(await status(MINE, "m-4352-garbage")).toBe("pending");
    for (let i = 0; i < 2; i += 1) { await due(MINE); await tick(); }
    expect(await status(MINE, "m-4352-garbage")).toBe("failed");
    const outcome = await asApp(ORG, (c) => c.query("SELECT outcome FROM kg_message_extraction_outcomes WHERE message_id = 'm-4352-garbage'"));
    expect(outcome.rows).toEqual([{ outcome: "failed" }]);
  });
});

describe("issue #4352: requestReindex（UC-KG-4）", () => {
  it("「失败 · 重试」：次数用完的失败行重置成新任务，已完成的消息也重新排进来；面板进入「整理中」", async () => {
    const before = await getThreadKnowledge(readDeps, { ...owner, threadId: MINE });
    expect(before.ingestion).toMatchObject({ queued: 0, running: 0, failed: 1 });
    const out = await requestReindex(reindexDeps, { ...owner, threadId: MINE });
    // 能抽的三条（张三 / 寒暄 / 乱码）；原始转录不排
    expect(out).toEqual({ queued: 3 });
    expect(await queueRows(MINE)).toEqual([
      { message_id: "m-4352-garbage", attempts: 0 }, { message_id: "m-4352-hello", attempts: 0 }, { message_id: "m-4352-zhang", attempts: 0 },
    ]);
    const after = await getThreadKnowledge(readDeps, { ...owner, threadId: MINE });
    expect(after.ingestion).toMatchObject({ queued: 3, running: 0, failed: 0 });
    expect(await status(MINE, "m-4352-zhang")).toBe("pending");
  });

  it("还在整理 ⇒ KG_REINDEX_ALREADY_RUNNING（HTTP 409），不叠加", async () => {
    await expect(requestReindex(reindexDeps, { ...owner, threadId: MINE })).rejects.toMatchObject({ code: "KG_REINDEX_ALREADY_RUNNING" });
    const ctl = new KnowledgeGraphController(
      readDeps.repo, readDeps.ids, readDeps.chat, readDeps.knowledge, {} as never, {} as never, {} as never,
      { enabled: true, provider: "loopback", modelId: "m" }, {} as never, undefined, undefined, reindexDeps.reindex,
    );
    await expect(ctl.reindexThread({ userId: "u-owner", orgId: ORG } as never, MINE, {})).rejects.toBeInstanceOf(ConflictException);
  });

  it("重跑是幂等的（I-7）：同一条消息再抽一遍不产生重复结论；抽完后结果照旧", async () => {
    const claimsBefore = (await getThreadKnowledge(readDeps, { ...owner, threadId: MINE })).claims.length;
    await tick();
    expect((await getThreadKnowledge(readDeps, { ...owner, threadId: MINE })).claims).toHaveLength(claimsBefore);
    expect(await status(MINE, "m-4352-zhang")).toBe("written");
    expect(await status(MINE, "m-4352-hello")).toBe("empty");
    // 乱码那条又开始新的三次机会
    expect((await queueRows(MINE)).map((r) => [r.message_id, r.attempts])).toEqual([["m-4352-garbage", 1]]);
    await asOwner((c) => c.query("DELETE FROM kg_extraction_queue WHERE thread_id = $1", [MINE]));
  });

  it("sourceRefs：只重排给出的、属于本会话的消息", async () => {
    await addChatMessage({ orgId: ORG, id: "m-4352-shared", threadId: SHARED, body: "项目会话里的一句", authorId: "u-owner" });
    await tick();
    const out = await requestReindex(reindexDeps, { ...owner, threadId: MINE, sourceRefs: ["m-4352-hello", "m-4352-shared"] });
    expect(out).toEqual({ queued: 1 });
    expect((await queueRows(MINE)).map((r) => r.message_id)).toEqual(["m-4352-hello"]);
    expect(await queueRows(SHARED)).toEqual([]);
    await tick();
  });

  it("不是会话所有者 ⇒ KG_NOT_OWNER（HTTP 403）；看不见会话 ⇒ KG_THREAD_NOT_FOUND（HTTP 404）", async () => {
    await expect(requestReindex(reindexDeps, { userId: "u-member", orgId: ORG_ID, threadId: SHARED })).rejects.toMatchObject({ code: "KG_NOT_OWNER" });
    await expect(requestReindex(reindexDeps, { userId: "u-member", orgId: ORG_ID, threadId: MINE })).rejects.toMatchObject({ code: "KG_THREAD_NOT_FOUND" });
    const ctl = new KnowledgeGraphController(
      readDeps.repo, readDeps.ids, readDeps.chat, readDeps.knowledge, {} as never, {} as never, {} as never,
      { enabled: true, provider: "loopback", modelId: "m" }, {} as never, undefined, undefined, reindexDeps.reindex,
    );
    await expect(ctl.reindexThread({ userId: "u-member", orgId: ORG } as never, SHARED, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.reindexThread({ userId: "u-member", orgId: ORG } as never, MINE, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it("组织抽取开关关着 ⇒ 关闭期间的消息不排队（不改行为），整理也什么都不排；打开之后「整理本会话」把它们补上", async () => {
    await asOwner((c) => c.query("UPDATE kg_org_extraction_settings SET enabled = false WHERE org_id = $1", [ORG]));
    try {
      await addChatMessage({ orgId: ORG, id: "m-4352-off", threadId: OFF, body: "关着的时候说的话", authorId: "u-owner" });
      expect(await queueRows(OFF)).toEqual([]);
      expect(await status(OFF, "m-4352-off")).toBe("none");
      expect(await requestReindex(reindexDeps, { ...owner, threadId: OFF })).toEqual({ queued: 0 });
      expect(await queueRows(OFF)).toEqual([]);
    } finally {
      await enableExtraction(ORG);
    }
    expect(await requestReindex(reindexDeps, { ...owner, threadId: OFF })).toEqual({ queued: 1 });
    expect(await status(OFF, "m-4352-off")).toBe("pending");
    await tick();
    expect(await status(OFF, "m-4352-off")).toBe("empty");
  });

  it("部署没有配置抽取模型 ⇒ 什么都不排（没有东西会消费它们）", async () => {
    expect(await requestReindex({ ...reindexDeps, extractionConfigured: false }, { ...owner, threadId: OFF })).toEqual({ queued: 0 });
    expect(await queueRows(OFF)).toEqual([]);
  });
});
