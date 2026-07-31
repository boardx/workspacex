/**
 * F111 —— 引用角标 100% 可定位（chat 束 domain.md D 组 I-24，uc-8-2 UC-15）。
 *
 * ## I-24 的断言方式：成功率必须是 1.0，不是"大部分"
 *
 * 遍历一批**结构完好**的引用，逐条调用 `locateCitation`，断言全部成功——不是抽样、
 * 不是"至少一条能用"。同时反证三种"不合格"必须各自被拒（`ANCHOR_UNRESOLVABLE`：
 * message 锚点指向一条已不存在的消息；`SOURCE_ARTIFACT_DELETED`：来源材料已删除），
 * 且 `ANCHOR_UNRESOLVABLE` 是**这条引用不合格**这一判断，不是"读取失败请重试"。
 *
 * ## 三种锚点各自可辨认
 *
 * `page` / `transcript` / `message` 三种 kind 各测一条成功路径，逐条断言返回的
 * anchor 字段与写入时一致——防止一个"只要有任何一个字段非空就算定位成功"的实现
 * 把三种锚点混成同一件事。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  addArtifact, addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatCitation, addChatMessage, addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f111-citations";
const PROJECT = "proj-f111-citations";
const THREAD = "f111-t-cite";

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

interface LocateOut {
  index: number;
  sourceFullName: string;
  anchor: { kind: string; page: number | null; range: string | null; messageId: string | null };
  locatable: true;
}

const locate = async (userId: string, citationId: string): Promise<{ status: number; body: unknown }> => {
  const r = await fetch(`${BASE}/chat/citations/${citationId}`, { headers: as(userId) });
  return { status: r.status, body: await r.json() };
};

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
    visibilityScope: "plenary", createdBy: "u-fac", title: "引用角标",
  });
  await addChatMessage({
    orgId: ORG, id: "f111-cm-1", threadId: THREAD, authorKind: "agent", agentId: "scout",
    authorId: "a-scout", body: "结论带三条引用",
  });
  await addChatMessage({
    orgId: ORG, id: "f111-cm-transcript-source", threadId: THREAD, authorId: "u-fac",
    body: "被 message 锚点指向的那条消息",
  });
  await addArtifact({ orgId: ORG, id: "f111-art-doc", projectId: PROJECT, source: "upload" });
}, 60_000);

describe("I-24：结构完好的一批引用，定位成功率恒为 1.0", () => {
  it("page / transcript / message 三种锚点各自可定位，字段与写入时一致", async () => {
    await addChatCitation({
      orgId: ORG, citationId: "f111-c-page", messageId: "f111-cm-1", index: 1,
      sourceFullName: "《欧洲储能市场准入研究》.pdf", anchorKind: "page", anchorPage: 42,
      sourceArtifactId: "f111-art-doc",
    });
    await addChatCitation({
      orgId: ORG, citationId: "f111-c-transcript", messageId: "f111-cm-1", index: 2,
      sourceFullName: "现场转录 · 2026-07-30", anchorKind: "transcript", anchorRange: "00:12:03-00:12:47",
    });
    await addChatCitation({
      orgId: ORG, citationId: "f111-c-message", messageId: "f111-cm-1", index: 3,
      sourceFullName: "消息引用 · f111-cm-transcript-source", anchorKind: "message",
      anchorMessageId: "f111-cm-transcript-source",
    });

    const ids = ["f111-c-page", "f111-c-transcript", "f111-c-message"];
    const results = await Promise.all(ids.map((id) => locate("u-fac", id)));
    // 成功率 1.0——逐条断言状态码，不是"至少一条 200"。
    for (const r of results) expect(r.status).toBe(200);

    const page = results[0]!.body as LocateOut;
    expect(page.index).toBe(1);
    expect(page.anchor.kind).toBe("page");
    expect(page.anchor.page).toBe(42);
    expect(page.anchor.range).toBeNull();
    expect(page.anchor.messageId).toBeNull();

    const transcript = results[1]!.body as LocateOut;
    expect(transcript.anchor.kind).toBe("transcript");
    expect(transcript.anchor.range).toBe("00:12:03-00:12:47");
    expect(transcript.anchor.page).toBeNull();

    const message = results[2]!.body as LocateOut;
    expect(message.anchor.kind).toBe("message");
    expect(message.anchor.messageId).toBe("f111-cm-transcript-source");
    expect(message.anchor.page).toBeNull();
    expect(message.anchor.range).toBeNull();

    // 三种 kind 互相可辨认——集合大小必须是 3，不是"都算定位成功"的二分。
    expect(new Set(results.map((r) => (r.body as LocateOut).anchor.kind)).size).toBe(3);
  });
});

describe("反证：不合格的引用必须被拒，且不是「暂时找不到」", () => {
  it("ANCHOR_UNRESOLVABLE：message 锚点指向一条已不存在的消息", async () => {
    await addChatCitation({
      orgId: ORG, citationId: "f111-c-dangling", messageId: "f111-cm-1", index: 9,
      sourceFullName: "指向幽灵消息", anchorKind: "message", anchorMessageId: "no-such-message-id",
    });
    const { status, body } = await locate("u-fac", "f111-c-dangling");
    expect(status).toBe(422);
    expect((body as { reasonCode?: string }).reasonCode).toBe("ANCHOR_UNRESOLVABLE");
  });

  it("SOURCE_ARTIFACT_DELETED：来源材料已不存在", async () => {
    await addChatCitation({
      orgId: ORG, citationId: "f111-c-orphan-source", messageId: "f111-cm-1", index: 10,
      sourceFullName: "来源已下架", anchorKind: "page", anchorPage: 3,
      sourceArtifactId: "f111-art-does-not-exist",
    });
    const { status, body } = await locate("u-fac", "f111-c-orphan-source");
    expect(status).toBe(410);
    expect((body as { reasonCode?: string }).reasonCode).toBe("SOURCE_ARTIFACT_DELETED");
  });

  it("不存在的 citationId：与「不可见」同一个出口，404 不带 reasonCode", async () => {
    const { status, body } = await locate("u-fac", "no-such-citation");
    expect(status).toBe(404);
    expect((body as { reasonCode?: string }).reasonCode).toBeUndefined();
  });
});
