/**
 * #946 · F153/W1 —— 抽取 worker 的**真库 + 真 anydoc** 端到端反证。
 *
 * 走完整条异步链：附件字节在对象存储 → enqueue → worker 认领 → planExtraction → 真 anydoc
 * 转 markdown（CSV）/passthrough（txt）/vision（图片，#1560：假视觉端口，真实模型另由
 * `scripts/probe-vision-model.mjs` 出证据）→ 落 markdown 对象 → 写 extracted_ref
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
import type { AttachmentVisionPort, VisionResult } from "../../src/application/chat/attachment-vision.port";
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
function deps(vision?: AttachmentVisionPort): AttachmentExtractionDeps {
  return { store, extraction: repo, converter: new AnydocAttachmentToMarkdown(), vision, log: () => {} };
}

/**
 * #1560：假视觉端口。它**不是** mock fallback——生产接的是 `BailianVisionExtractor`，缺席时图片
 * 如实落 failed，绝无路径悄悄退回到这个假件；这里显式注入它，是为了在不打外部 API 的前提下
 * 证明「产物真的经同一条路径落到了真库 + 真对象存储」。真实模型可用性另由探测脚本出证据。
 */
function fakeVision(result: VisionResult): AttachmentVisionPort {
  return { async describeImage() { return result; } };
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
  await addChatMessage({ orgId: ORG, id: "few-m1", threadId: THREAD, body: "带附件", authorId: ACTOR });
  store = memStore();
});

afterAll(async () => { await db?.close(); });

describe("attachment extraction worker（真库 + 真 anydoc）", () => {
  it("CSV 附件 → 抽出 markdown 表格，extracted_ref/status 写好，job 排空", async () => {
    const csv = new TextEncoder().encode("name,role\nAva,facilitator\n");
    const ref = `chat-attachments/${ORG}/att-csv`;
    await store.putOnce(ref, csv, "text/csv");
    await addAttachment({ id: "att-csv", messageId: "few-m1", mime: "text/csv", storageRef: ref, bytes: csv.byteLength });
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
    await addAttachment({ id: "att-txt", messageId: "few-m1", mime: "text/plain", storageRef: ref, bytes: txt.byteLength });
    await repo.enqueue(toOrgId(ORG), "att-txt");

    const r = await runExtractionTick(deps(), toOrgId(ORG), "worker-1");
    expect(r.claimed && r.outcome).toBe("extracted");
    const state = await readAttachmentState("att-txt");
    expect(state.status).toBe("extracted");
    expect(new TextDecoder().decode(store.map.get(state.ref!)!.bytes)).toBe("这是一段纯文本笔记");
  });

  // #1560 P1：这条原本断言「图片 → unsupported」。行为改了，断言随之改写成新语义的两面——
  // 有视觉能力就抽出内容，没有就如实失败——而不是删掉不测。
  it("图片附件 + 视觉能力 → 抽出转录/描述 markdown，走与 CSV 同一条落库路径", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const ref = `chat-attachments/${ORG}/att-png`;
    await store.putOnce(ref, png, "image/png");
    await addAttachment({ id: "att-png", messageId: "few-m1", mime: "image/png", storageRef: ref, bytes: png.byteLength });
    await repo.enqueue(toOrgId(ORG), "att-png");

    const markdown = "# 图片视觉理解\n\n## 图中文字转录\n\n季度复盘 2026 Q3\n";
    const r = await runExtractionTick(deps(fakeVision({ ok: true, markdown, modelId: "qwen-vl-test" })), toOrgId(ORG), "worker-1");
    expect(r.claimed && r.outcome).toBe("extracted");

    const state = await readAttachmentState("att-png");
    expect(state.status).toBe("extracted");
    expect(state.ref).toBe(extractedObjectKey(toOrgId(ORG), "att-png"));
    expect(new TextDecoder().decode(store.map.get(state.ref!)!.bytes)).toContain("季度复盘 2026 Q3");
    expect(await outboxCount()).toBe(0);
  });

  it("图片附件 + 无视觉能力（key 缺失）→ failed 且原因如实落 extraction_error，无幽灵产物", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const ref = `chat-attachments/${ORG}/att-png-nokey`;
    await store.putOnce(ref, png, "image/png");
    await addAttachment({ id: "att-png-nokey", messageId: "few-m1", mime: "image/png", storageRef: ref, bytes: png.byteLength });
    await repo.enqueue(toOrgId(ORG), "att-png-nokey");

    const r = await runExtractionTick(deps(fakeVision({ ok: false, code: "visionNotConfigured" })), toOrgId(ORG), "worker-1");
    expect(r.claimed && r.outcome).toBe("failed");

    const state = await readAttachmentState("att-png-nokey");
    expect(state.status).toBe("failed");
    expect(state.err).toBe("visionNotConfigured");
    expect(state.ref).toBeNull();
    expect(store.map.has(extractedObjectKey(toOrgId(ORG), "att-png-nokey"))).toBe(false);
    expect(await outboxCount()).toBe(0);
  });

  it("重放安全：同一 job 再跑一次（markdown 已落）不炸，仍收敛为 extracted", async () => {
    const csv = new TextEncoder().encode("a,b\n1,2\n");
    const ref = `chat-attachments/${ORG}/att-replay`;
    await store.putOnce(ref, csv, "text/csv");
    await addAttachment({ id: "att-replay", messageId: "few-m1", mime: "text/csv", storageRef: ref, bytes: csv.byteLength });
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
