/**
 * DA-16 -- real-DB proof for `file_created`'s new producer: `listThreadAttachments`
 * (the SAME use case `chat-materials-panel.tsx`'s `GET /chat/threads/:id/attachments`
 * already runs, see `agui-file-events.ts`'s own header) feeding `buildFileCreatedEvents`,
 * against a REAL `chat_message_attachments` row -- not a fake repository.
 *
 * ## What this proves, and what it does not
 *
 * This drives the exact application-layer call the controller makes (`listThreadAttachments`
 * with the real, DI-resolved `IdentityRepository`/`DecisionIdFactory`/`ChatRepository`/
 * `AttachmentCommandRepository`), against a fixture row inserted directly by SQL -- the SAME
 * fixture pattern `attachment-history-sql.test.ts` already uses for `chat_message_attachments`,
 * because a real materialization of #1624's writeback path (a genuine sandboxed skill run
 * producing a file over live HTTP) is already covered by `deep-agent-produces-files.test.ts`
 * and `chat-skill-mount-produces-pptx-real-stack.test.ts` -- this file does not re-prove that
 * a run CAN produce a file, only that a produced file, once it exists as a real
 * `chat_message_attachments` row, becomes a correct, schema-valid `file_created` payload.
 *
 * The thin controller wiring that calls this read on the `succeeded` branch and writes the
 * result as a `CUSTOM` event is covered by: (a) `tsc --noEmit` (the call sites compile
 * against the real port/use-case signatures), (b) `agui-bridge-state-events.test.ts`'s
 * existing DA-17 suite continuing to pass unmodified (proving zero regression for the "no
 * files produced" case, which every one of ITS fixtures is).
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY, type IdentityRepository, type DecisionIdFactory } from "../../src/application/identity/ports";
import { CHAT_REPOSITORY, type ChatRepository } from "../../src/application/chat/ports";
import { CHAT_ATTACHMENT_COMMAND_REPOSITORY, type AttachmentCommandRepository } from "../../src/application/chat/upload-attachment";
import { listThreadAttachments } from "../../src/application/chat/list-thread-attachments";
import { buildFileCreatedEvents } from "../../src/application/agent-run/agui-file-events";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-da16-file-events";
const PROJECT = "proj-da16-file-events-unused"; // seedOrg requires one; this test only exercises the personal-thread branch.
const THREAD = "thread-da16-file-events";
const ACTOR = "u-da16-file-events";
const AGENT = "agent-da16-file-events";

let app: NestExpressApplication;

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
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  // Personal thread -- `/copilotkit/agui` never creates a project-scoped one (this file's
  // own header, and `agui-bridge.ts`'s file head "op:create, projectId:null").
  await addChatThread({ orgId: ORG, id: THREAD, projectId: null, visibilityScope: "private", createdBy: ACTOR });
}, 60_000);

afterAll(async () => { await app?.close(); });

describe("DA-16 -- listThreadAttachments + buildFileCreatedEvents（真 Postgres）", () => {
  it("一条真实 chat_message_attachments 行 → 一个校验通过的 file_created payload，字段与 DB 行一一对应", async () => {
    const resultMessageId = `msg-${randomUUID()}`;
    const attachmentId = `att-${randomUUID()}`;
    await addChatMessage({
      orgId: ORG, id: resultMessageId, threadId: THREAD, body: "已经帮你把季度回顾做好了。",
      authorId: AGENT, authorKind: "agent", agentId: AGENT,
    });
    await addAttachment({
      id: attachmentId, messageId: resultMessageId, filename: "季度回顾.pptx",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: 30720,
    });

    const result = await listThreadAttachments(
      {
        repo: app.get<IdentityRepository>(IDENTITY_REPOSITORY),
        ids: app.get<DecisionIdFactory>(DECISION_ID_FACTORY),
        chat: app.get<ChatRepository>(CHAT_REPOSITORY),
        attachments: app.get<AttachmentCommandRepository>(CHAT_ATTACHMENT_COMMAND_REPOSITORY),
      },
      { userId: ACTOR, orgId: toOrgId(ORG), projectId: null, threadId: THREAD },
    );
    const events = buildFileCreatedEvents(result.items, resultMessageId);

    expect(events).toEqual([{
      uri: `vfs://attachment/${attachmentId}`,
      domain: "attachment",
      name: "季度回顾.pptx",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: 30720,
      source: "agent_run_output",
    }]);
  });

  it("同一线程里别的（更早）消息的附件不会混进这次 run 的 file_created——按 resultMessageId 精确过滤", async () => {
    const earlierMessageId = `msg-${randomUUID()}`;
    const thisRunMessageId = `msg-${randomUUID()}`;
    await addChatMessage({ orgId: ORG, id: earlierMessageId, threadId: THREAD, body: "上一轮", authorId: AGENT, authorKind: "agent", agentId: AGENT });
    await addAttachment({ id: `att-${randomUUID()}`, messageId: earlierMessageId, filename: "上一轮产物.csv", mime: "text/csv", bytes: 100 });
    await addChatMessage({ orgId: ORG, id: thisRunMessageId, threadId: THREAD, body: "这一轮", authorId: AGENT, authorKind: "agent", agentId: AGENT });
    // 这一轮没有产出文件。

    const result = await listThreadAttachments(
      {
        repo: app.get<IdentityRepository>(IDENTITY_REPOSITORY),
        ids: app.get<DecisionIdFactory>(DECISION_ID_FACTORY),
        chat: app.get<ChatRepository>(CHAT_REPOSITORY),
        attachments: app.get<AttachmentCommandRepository>(CHAT_ATTACHMENT_COMMAND_REPOSITORY),
      },
      { userId: ACTOR, orgId: toOrgId(ORG), projectId: null, threadId: THREAD },
    );
    expect(buildFileCreatedEvents(result.items, thisRunMessageId)).toEqual([]);
  });
});
