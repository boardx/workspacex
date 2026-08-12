/**
 * #946 · V9-a F150 —— 附件上传端点真实栈 e2e（起 Nest 应用 + 真 PG + 真对象存储 + multipart）。
 *
 * 覆盖契约 `uploadAttachment.err` 的**全部**失败码，逐条一个真实 HTTP 往返：
 *   201 成功落 pending 行 · 404 不可见 · 403 观察者 · 413 超大 · 415 非白名单 ·
 *   422 MIME 与字节不符 · 409 该线程 pending 达 10。
 * 断言查真库（`chat_message_attachments`，`message_id IS NULL`），不看进程内状态。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chatFileUpload as CFU } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-v9a-attach";
const PROJECT = "proj-v9a-attach";
const THREAD = "thread-v9a-attach";
const ACTOR = "u-v9a-attach-writer";
const OBSERVER = "u-v9a-attach-observer";

let BASE: string;
let app: NestExpressApplication;

/** magic-number 合法的小样本，各类型一份。 */
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]); // MZ + NUL：未知二进制

function uploadAs(actor: string, threadId: string, part: { filename: string; mime: string; bytes: Uint8Array }) {
  const fd = new FormData();
  fd.append("file", new Blob([part.bytes], { type: part.mime }), part.filename);
  // 不手动设 content-type——fetch 会带 multipart boundary。
  return fetch(`${BASE}/chat/threads/${threadId}/attachments`, {
    method: "POST",
    headers: { "x-kernel-test-principal": `${actor}:${ORG}` },
    body: fd,
  });
}

const upload = (part: { filename: string; mime: string; bytes: Uint8Array }) => uploadAs(ACTOR, THREAD, part);

async function pendingCount(threadId: string): Promise<number> {
  return asApp(ORG, async (c) => {
    const r = await c.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM chat_message_attachments WHERE thread_id=$1 AND message_id IS NULL",
      [threadId],
    );
    return Number(r.rows[0]!.n);
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addOrgMember(ORG, OBSERVER, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, OBSERVER, "observer", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
});

describe("POST /chat/threads/:threadId/attachments", () => {
  it("201: 合法 PDF 落一行 pending 附件（message_id NULL），返回契约 Attachment 形状", async () => {
    const res = await upload({ filename: "brief.pdf", mime: "application/pdf", bytes: PDF });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; filename: string; mime: string; bytes: number; createdAt: string };
    // 契约 Attachment：id/filename/mime/bytes/createdAt，且 bytes = 实际接收字节数。
    expect(body).toMatchObject({ filename: "brief.pdf", mime: "application/pdf", bytes: PDF.byteLength });
    expect(body.id).toMatch(/^att/);
    expect(typeof body.createdAt).toBe("string");
    // 契约 out 无 storageRef（内部字段不外泄）
    expect(body).not.toHaveProperty("storageRef");

    const row = await asApp(ORG, (c) => c.query(
      `SELECT filename, mime, bytes, message_id, extracted_ref, storage_ref
         FROM chat_message_attachments WHERE id=$1`, [body.id],
    ));
    expect(row.rows[0]).toMatchObject({
      filename: "brief.pdf", mime: "application/pdf", bytes: String(PDF.byteLength),
      message_id: null, extracted_ref: null, // V9-a：未挂消息、未抽取
    });
    expect(row.rows[0]!.storage_ref).toMatch(/^chat-attachments\//);
  });

  it("修 bug：中文文件名不再 mojibake —— multipart latin1 filename 复原成 UTF-8（人类 devapp 实测）", async () => {
    // busboy 默认按 latin1 解 Content-Disposition 的 filename，浏览器发的 UTF-8 中文名被解成
    // 「æ ªå±…」这类 mojibake。控制器 decodeMultipartFilename 复原。这里走真实 multipart 上传，
    // 断言 201 返回体与落库的 filename 都是正确中文，不是乱码。
    const cjk = "截屏 2026-08-09 风险核算模板.png";
    const res = await upload({ filename: cjk, mime: "image/png", bytes: PNG });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; filename: string };
    expect(body.filename).toBe(cjk);
    expect(body.filename).not.toContain("æ"); // 不是 latin1 mojibake
    const row = await asApp(ORG, (c) => c.query<{ filename: string }>(
      `SELECT filename FROM chat_message_attachments WHERE id=$1`, [body.id]));
    expect(row.rows[0]!.filename).toBe(cjk);
  });

  it("F153 端到端：上传真 CSV → ≤3MB 内联抽取，201 返回时 extraction_status 已 extracted + 摘录就绪", async () => {
    // 走完整真实链路：HTTP multipart → 控制器 → uploadAttachment 用例 → 触发内联抽取
    // （≤3MB 同步）→ 真 anydoc 转 markdown → 写 extracted_ref/excerpt/status。小文件内联，
    // 所以 201 返回时抽取已完成——无需轮询。
    const csv = new TextEncoder().encode("name,role\nAva,facilitator\nScout,researcher\n");
    const res = await upload({ filename: "team.csv", mime: "text/csv", bytes: csv });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };

    const row = await asApp(ORG, (c) => c.query<{
      extraction_status: string; extracted_ref: string | null; extracted_excerpt: string | null;
    }>(
      `SELECT extraction_status, extracted_ref, extracted_excerpt
         FROM chat_message_attachments WHERE id=$1`, [id],
    ));
    const r = row.rows[0]!;
    expect(r.extraction_status).toBe("extracted");
    expect(r.extracted_ref).toMatch(/^chat-attachments-extracted\//);
    // 抽取内容进了 DB 摘录——CSV 变成 markdown 表格。
    expect(r.extracted_excerpt).toContain("facilitator");
    expect(r.extracted_excerpt).toContain("|");
  });

  it("F153 端到端：上传图片 → 内联抽取判 unsupported（非失败），extracted_ref 保持 NULL", async () => {
    const res = await upload({ filename: "pic.png", mime: "image/png", bytes: PNG });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    const row = await asApp(ORG, (c) => c.query<{ extraction_status: string; extracted_ref: string | null }>(
      `SELECT extraction_status, extracted_ref FROM chat_message_attachments WHERE id=$1`, [id],
    ));
    expect(row.rows[0]!.extraction_status).toBe("unsupported");
    expect(row.rows[0]!.extracted_ref).toBeNull();
  });

  it("404: 不存在/不可见的线程 —— 裸 404，不写行", async () => {
    const res404 = await uploadAs(
      ACTOR, "thread-does-not-exist", { filename: "x.pdf", mime: "application/pdf", bytes: PDF },
    );
    expect(res404.status).toBe(404);
    // I-3：裸 404 不带 reasonCode（否则成了存在性预言机）
    expect(await res404.json()).not.toHaveProperty("reasonCode");
    expect(await pendingCount("thread-does-not-exist")).toBe(0);
  });

  it("403: 观察者无写权（NO_WRITE_ROLE），不写行", async () => {
    const res = await uploadAs(OBSERVER, THREAD, { filename: "obs.pdf", mime: "application/pdf", bytes: PDF });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reasonCode: "NO_WRITE_ROLE" });
    expect(await pendingCount(THREAD)).toBe(0);
  });

  it("413: 超单文件字节上限（FILE_TOO_LARGE，multer 硬顶），不写行", async () => {
    const tooBig = new Uint8Array(CFU.ATTACHMENT_LIMITS.maxBytesPerFile + 1);
    tooBig.set(PDF, 0); // 前缀仍是 %PDF，证明拒绝来自大小不是类型
    const res = await upload({ filename: "huge.pdf", mime: "application/pdf", bytes: tooBig });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ reasonCode: "FILE_TOO_LARGE" });
    expect(await pendingCount(THREAD)).toBe(0);
  });

  it("415: 非白名单类型（FILE_TYPE_REJECTED），不写行", async () => {
    const res = await upload({ filename: "app.exe", mime: "application/x-msdownload", bytes: EXE });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ reasonCode: "FILE_TYPE_REJECTED" });
    expect(await pendingCount(THREAD)).toBe(0);
  });

  it("422: 声明 PDF 实为 EXE 字节（MIME_MISMATCH，改扩展名骗白名单），不写行", async () => {
    const res = await upload({ filename: "trojan.pdf", mime: "application/pdf", bytes: EXE });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reasonCode: "MIME_MISMATCH" });
    expect(await pendingCount(THREAD)).toBe(0);
  });

  it("409: 该线程 pending 达上限（ATTACHMENT_LIMIT_EXCEEDED）后拒收第 11 个", async () => {
    const limit = CFU.ATTACHMENT_LIMITS.maxAttachmentsPerMessage;
    for (let i = 0; i < limit; i++) {
      const r = await upload({ filename: `f${i}.png`, mime: "image/png", bytes: PNG });
      expect(r.status).toBe(201);
    }
    expect(await pendingCount(THREAD)).toBe(limit);
    const over = await upload({ filename: "over.png", mime: "image/png", bytes: PNG });
    expect(over.status).toBe(409);
    expect(await over.json()).toMatchObject({ reasonCode: "ATTACHMENT_LIMIT_EXCEEDED" });
    expect(await pendingCount(THREAD)).toBe(limit); // 仍是 limit，没多落
  });
});
