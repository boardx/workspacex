/**
 * G1a（design-delta chat-persona-roundtrip，confirmed 2026-08-18）：
 * `listThreadArtifacts.out.items[]` 带 `messageId`——真栈（HTTP → controller →
 * application → repository → PostgreSQL）断言：
 *   ① 先 `landAsArtifact` 落一条 draft，再 `listThreadArtifacts`，对应条目的
 *      `messageId` 与落地时传入的逐字相等（来自 `chat_artifact_landings.message_id`，
 *      不是响应体回显——landing 与 list 是两次独立请求）。
 *   ② `out` 的 `safeParse` 通过；反向：条目缺 `messageId` 的 body 被 `.strict()`
 *      schema 拒绝（B-8：覆盖拒绝路径，证明契约真的收紧了而不是「多个可选字段」）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chat as C } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
process.env.WORKSPACEX_OBJECT_ROOT = mkdtempSync(join(tmpdir(), "wsx-g1a-"));

const ORG = "org-list-artifacts-msgid";
const PROJECT = "proj-list-artifacts-msgid";
const THREAD = "list-artifacts-msgid-t1";

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

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
  await addOrgMember(ORG, "u-fac", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, groupId: null,
    visibilityScope: "plenary", createdBy: "u-fac", title: "messageId 投影",
  });
  await addChatMessage({
    orgId: ORG, id: "lam-1", threadId: THREAD, authorId: "u-fac", body: "flowchart TD\n  a-->b",
  });
});

describe("listThreadArtifacts · items[].messageId（G1a）", () => {
  it("落地后列表条目的 messageId 与落地时传入的逐字相等，且 out 过 safeParse", async () => {
    const land = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts`, {
      method: "POST",
      headers: as("u-fac"),
      body: JSON.stringify({
        threadId: THREAD, messageId: "lam-1", mode: "draft",
        title: "对话图 · 测试", payloadRef: "flowchart TD\n  a-->b",
      }),
    });
    expect(land.status).toBe(200);
    const landed = (await land.json()) as { artifactId: string };

    const list = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts?projectId=${PROJECT}`, {
      headers: as("u-fac"),
    });
    expect(list.status).toBe(200);
    const body = await list.json();

    const parsed = C.operations.listThreadArtifacts.out.safeParse(body);
    expect(parsed.success).toBe(true);

    const item = (body as { items: { artifactId: string; messageId: string }[] }).items
      .find((i) => i.artifactId === landed.artifactId);
    expect(item).toBeDefined();
    expect(item!.messageId).toBe("lam-1");
  });

  it("反向（B-8）：条目缺 messageId 的 body 被 .strict() schema 拒绝", () => {
    const withoutMessageId = {
      items: [{
        artifactId: "a1", title: "t", mode: "draft", version: null,
        pinnedBy: null, pinnedAt: null, hasSource: false,
      }],
    };
    expect(C.operations.listThreadArtifacts.out.safeParse(withoutMessageId).success).toBe(false);
  });
});
