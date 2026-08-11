/**
 * #946 · F153/W1 —— 抽取 worker 的**真库 + 真 anydoc** 端到端反证。
 *
 * 走完整条异步链：附件字节在对象存储 → enqueue → worker 认领 → planExtraction → 真 anydoc
 * 转 markdown（CSV）/passthrough（txt）/unsupported（图片）→ 落 markdown 对象 → 写 extracted_ref
 * + extraction_status → job 排空。mock 掉任何一环都会把「真的抽出来了」这个唯一要证的东西证没。
 * ObjectStore 用内存实现（worker 不关心哪种 store，只要 putOnce/get 语义对）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAttachmentExtractionRepository } from "../../src/infrastructure/chat/pg-attachment-extraction-repository";
import { AnydocAttachmentToMarkdown } from "../../src/infrastructure/chat/anydoc-attachment-to-markdown";
import { runExtractionTick, extractedObjectKey, type AttachmentExtractionDeps } from "../../src/application/chat/attachment-extraction-worker";
import { ObjectExistsError, type ObjectStore } from "../../src/application/artifact/ports";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f153-worker";
const PROJECT = "proj-f153";
const THREAD = "thr-f153";
const ACTOR = "u-f153";

let db: PgDatabase;
let repo: PgAttachmentExtractionRepository;

/** 内存 ObjectStore：putOnce 撞 key 抛 ObjectExistsError（同生产语义），无外部依赖。 */
function memStore(): ObjectStore & { readonly map: Map<string, { bytes: Uint8Array; mime: string }> } {
  const map = new Map<string, { bytes: Uint8Array; mime: string }>();
  return {
    map,
    async putOnce(key, bytes, mime) {
      if (map.has(key)) throw new ObjectExistsError(key);
      map.set(key, { bytes, mime });
    },
    async get(key) { return map.get(key)?.bytes ?? null; },
    async head(key) { const v = map.get(key); return v ? { sizeBytes: v.bytes.byteLength, mime: v.mime } : null; },
  };
}

async function addAttachment(opts: { id: string; messageId: string; mime: string; storageRef: string; bytes: number }): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO chat_message_attachments
         (id, org_id, thread_id, message_id, storage_ref, filename, mime, bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [opts.id, ORG, THREAD, opts.messageId, opts.storageRef, "f.dat", opts.mime, opts.bytes],
    ),
  );
}

async function readAttachmentState(id: string): Promise<{ status: string; ref: string | null; err: string | null }> {
  return db.withTenant(toOrgId(ORG), async (s) => {
    const r = await s.query<{ extraction_status: string; extracted_ref: string | null; extraction_error: string | null }>(
      `SELECT extraction_status, extracted_ref, extraction_error FROM chat_message_attachments WHERE org_id=$1 AND id=$2`,
      [ORG, id],
    );
    const row = r.rows[0]!;
    return { status: row.extraction_status, ref: row.extracted_ref, err: row.extraction_error };
  });
}

async function outboxCount(): Promise<number> {
  return db.withTenant(toOrgId(ORG), async (s) => {
    const r = await s.query<{ n: string }>(`SELECT count(*)::text AS n FROM chat_attachment_extraction_outbox WHERE org_id=$1`, [ORG]);
    return Number(r.rows[0]!.n);
  });
}

let store: ReturnType<typeof memStore>;
function deps(): AttachmentExtractionDeps {
  return { store, extraction: repo, converter: new AnydocAttachmentToMarkdown(), log: () => {} };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAttachmentExtractionRepository(db);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR });
  await addChatMessage({ orgId: ORG, id: "m1", threadId: THREAD, body: "带附件", authorId: ACTOR });
  store = memStore();
});

afterAll(async () => { await db?.close(); });

describe("attachment extraction worker（真库 + 真 anydoc）", () => {
  it("CSV 附件 → 抽出 markdown 表格，extracted_ref/status 写好，job 排空", async () => {
    const csv = new TextEncoder().encode("name,role\nAva,facilitator\n");
    const ref = `chat-attachments/${ORG}/att-csv`;
    await store.putOnce(ref, csv, "text/csv");
    await addAttachment({ id: "att-csv", messageId: "m1", mime: "text/csv", storageRef: ref, bytes: csv.byteLength });
    await repo.enqueue(toOrgId(ORG), "att-csv");

    const r = await runExtractionTick(deps(), toOrgId(ORG), "worker-1");
    expect(r).toEqual({ claimed: true, attachmentId: "att-csv", outcome: "extracted" });

    const state = await readAttachmentState("att-csv");
    expect(state.status).toBe("extracted");
    expect(state.ref).toBe(extractedObjectKey(toOrgId(ORG), "att-csv"));
    const md = new TextDecoder().decode(store.map.get(state.ref!)!.bytes);
    expect(md).toContain("facilitator");
    expect(md).toContain("|"); // markdown 表格
    expect(await outboxCount()).toBe(0); // 排空
  });

  it("txt 附件 → passthrough：字节即 markdown，不进 anydoc", async () => {
    const txt = new TextEncoder().encode("这是一段纯文本笔记");
    const ref = `chat-attachments/${ORG}/att-txt`;
    await store.putOnce(ref, txt, "text/plain");
    await addAttachment({ id: "att-txt", messageId: "m1", mime: "text/plain", storageRef: ref, bytes: txt.byteLength });
    await repo.enqueue(toOrgId(ORG), "att-txt");

    const r = await runExtractionTick(deps(), toOrgId(ORG), "worker-1");
    expect(r.claimed && r.outcome).toBe("extracted");
    const state = await readAttachmentState("att-txt");
    expect(state.status).toBe("extracted");
    expect(new TextDecoder().decode(store.map.get(state.ref!)!.bytes)).toBe("这是一段纯文本笔记");
  });

  it("图片附件 → unsupported（非失败），extracted_ref 保持 NULL，job 排空", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const ref = `chat-attachments/${ORG}/att-png`;
    await store.putOnce(ref, png, "image/png");
    await addAttachment({ id: "att-png", messageId: "m1", mime: "image/png", storageRef: ref, bytes: png.byteLength });
    await repo.enqueue(toOrgId(ORG), "att-png");

    const r = await runExtractionTick(deps(), toOrgId(ORG), "worker-1");
    expect(r.claimed && r.outcome).toBe("unsupported");
    const state = await readAttachmentState("att-png");
    expect(state.status).toBe("unsupported");
    expect(state.ref).toBeNull();
    expect(await outboxCount()).toBe(0);
  });

  it("重放安全：同一 job 再跑一次（markdown 已落）不炸，仍收敛为 extracted", async () => {
    const csv = new TextEncoder().encode("a,b\n1,2\n");
    const ref = `chat-attachments/${ORG}/att-replay`;
    await store.putOnce(ref, csv, "text/csv");
    await addAttachment({ id: "att-replay", messageId: "m1", mime: "text/csv", storageRef: ref, bytes: csv.byteLength });
    // 预先把 extracted markdown 落好（模拟上一次已 putOnce 但没走完记状态就崩了）。
    await store.putOnce(extractedObjectKey(toOrgId(ORG), "att-replay"), new TextEncoder().encode("| a | b |"), "text/markdown");
    await repo.enqueue(toOrgId(ORG), "att-replay");

    const r = await runExtractionTick(deps(), toOrgId(ORG), "worker-1");
    // putOnce 撞 ObjectExistsError 被当「已落」，不抛、仍记 extracted。
    expect(r.claimed && r.outcome).toBe("extracted");
    expect((await readAttachmentState("att-replay")).status).toBe("extracted");
    expect(await outboxCount()).toBe(0);
  });

  it("无活可认领 → claimed:false", async () => {
    const r = await runExtractionTick(deps(), toOrgId(ORG), "worker-1");
    expect(r).toEqual({ claimed: false });
  });
});
