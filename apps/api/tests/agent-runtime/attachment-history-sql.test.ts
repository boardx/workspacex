/**
 * V9-b 前置 A（#970）—— `PgAgentRunRepository.readThreadHistory` 的**真实 Postgres** 反证：
 * 历史每轮真的把 `chat_message_attachments` 的 filename/mime 聚合了回来。
 *
 * 为什么这条必须走真库：`attachment-notice-in-context.test.ts` 用的是**内存 fake store**，
 * 它证明的是「execute-run 拿到附件后会折进上下文」，但 fake 直接把附件喂进来了——SQL 到底
 * 有没有查 `chat_message_attachments`、列名/关联对不对，纯内存测一个字都覆盖不到。少了这条，
 * A 可能带着一句永远返回空聚合的坏 SQL 上线，而上面那条内存测照样绿（本仓「静态痕迹≠动态
 * 事实」反复踩的坑）。claim 侧的 `inputAttachments` 用的是**同一个** `attachmentsAggSql`
 * 片段，这条测通即证明那段聚合 SQL 本身正确。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-i970-hist";
const PROJECT = "proj-i970";
const THREAD = "thr-i970";
const ACTOR = "u-i970";

let db: PgDatabase;
let repo: PgAgentRunRepository;

async function addAttachment(opts: {
  id: string; messageId: string; filename: string; mime: string; bytes: number;
}): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO chat_message_attachments
         (id, org_id, thread_id, message_id, storage_ref, filename, mime, bytes, extracted_ref, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NULL, now())`,
      [opts.id, ORG, THREAD, opts.messageId, `chat-attachments/${ORG}/${opts.id}`,
        opts.filename, opts.mime, opts.bytes],
    ),
  );
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunRepository(db);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
});

afterAll(async () => {
  await db.close();
});

describe("readThreadHistory —— 附件元数据聚合（真库反证）", () => {
  it("挂了附件的那条历史消息带回 filename/mime；没挂的不带；助手轮不受影响", async () => {
    // 三条历史消息（id 递增即时间递增）：human 带两个附件 → agent 回复 → human 带一个附件。
    await addChatMessage({ orgId: ORG, id: "m1", threadId: THREAD, body: "看看这两个文件", authorId: ACTOR });
    await addAttachment({ id: "att-1a", messageId: "m1", filename: "简历.pdf", mime: "application/pdf", bytes: 1024 });
    await addAttachment({ id: "att-1b", messageId: "m1", filename: "作品.png", mime: "image/png", bytes: 2048 });
    await addChatMessage({ orgId: ORG, id: "m2", threadId: THREAD, body: "收到，看完了", authorId: "agent-x", authorKind: "agent", agentId: "agent-x" });
    await addChatMessage({ orgId: ORG, id: "m3", threadId: THREAD, body: "再看这个", authorId: ACTOR });
    await addAttachment({ id: "att-3", messageId: "m3", filename: "合同.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: 4096 });
    // 触发消息（anchor）：最新的一条，本身不进历史。
    await addChatMessage({ orgId: ORG, id: "m9-trigger", threadId: THREAD, body: "附件是什么？", authorId: ACTOR });

    const history = await repo.readThreadHistory(toOrgId(ORG), THREAD, "m9-trigger", 10);

    // m1、m2、m3 三轮（trigger 不含），oldest-first。
    expect(history.map((h) => h.content)).toEqual(["看看这两个文件", "收到，看完了", "再看这个"]);
    // m1 带回两个附件，顺序按 created_at,id。
    expect(history[0]!.attachments).toEqual([
      { filename: "简历.pdf", mime: "application/pdf" },
      { filename: "作品.png", mime: "image/png" },
    ]);
    // agent 轮没有附件 → 不挂 attachments 字段（保持「空/缺省=没有附件」）。
    expect(history[1]!.attachments).toBeUndefined();
    // m3 带回一个。
    expect(history[2]!.attachments).toEqual([
      { filename: "合同.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    ]);
  });

  it("整条线程都没有附件 → 每轮都不带 attachments（不是空数组噪声）", async () => {
    await addChatMessage({ orgId: ORG, id: "n1", threadId: THREAD, body: "纯文字", authorId: ACTOR });
    await addChatMessage({ orgId: ORG, id: "n9-trigger", threadId: THREAD, body: "问题", authorId: ACTOR });

    const history = await repo.readThreadHistory(toOrgId(ORG), THREAD, "n9-trigger", 10);
    expect(history).toHaveLength(1);
    expect(history[0]!.attachments).toBeUndefined();
  });
});
