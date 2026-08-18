/**
 * G1b（design-delta chat-persona-roundtrip，confirmed 2026-08-18）：
 * `getThreadArtifactSource`（`GET /chat/threads/:threadId/artifacts/:artifactId/source`）
 * 真栈断言：
 *   ① 落地一条含真实 markdown 的 draft 后读回，`markdown` 与保存时的字节逐字相等
 *      （从对象存储读回，不是请求缓存回显）；`savedBy` 与 landing 行一致，`savedAt`
 *      是合法 ISO 时间。
 *   ② 同一消息保存两次 ⇒ 按前端读回路径（list 过滤 messageId 取最新）读到**第二次**
 *      的内容（created_at 排序）。
 *   ③ 草稿创建者之外的组员读 ⇒ 404，且响应体与「不存在的 artifactId」逐字同形
 *      （I-36 + I-3：不区分不存在与不可见，不给探测留缝）。
 *   ④ 存储故障（landing 行在、字节被抹掉）⇒ 503 `STORAGE_UNAVAILABLE`——不佯装
 *      「没有保存版」。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chat as C } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const OBJECT_ROOT = mkdtempSync(join(tmpdir(), "wsx-g1b-"));
process.env.WORKSPACEX_OBJECT_ROOT = OBJECT_ROOT;

const ORG = "org-artifact-source";
const PROJECT = "proj-artifact-source";
const THREAD = "artifact-source-t1";

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

const land = async (userId: string, messageId: string, payloadRef: string) => {
  const r = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts`, {
    method: "POST",
    headers: as(userId),
    body: JSON.stringify({ threadId: THREAD, messageId, mode: "draft", title: "对话图", payloadRef }),
  });
  expect(r.status).toBe(200);
  return (await r.json()) as { artifactId: string };
};

const readSource = (userId: string, artifactId: string) =>
  fetch(`${BASE}/chat/threads/${THREAD}/artifacts/${artifactId}/source?projectId=${PROJECT}`, {
    headers: as(userId),
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
  await addOrgMember(ORG, "u-other", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null);
  await addProjectMember(ORG, PROJECT, "u-other", "facilitator", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, groupId: null,
    visibilityScope: "plenary", createdBy: "u-fac", title: "读回",
  });
  await addChatMessage({
    orgId: ORG, id: "src-1", threadId: THREAD, authorId: "u-fac", body: "flowchart TD\n  a-->b",
  });
});

describe("getThreadArtifactSource（G1b）", () => {
  it("①创建者读回：markdown 与保存的字节逐字相等，savedBy/savedAt 来自 landing 行", async () => {
    const saved = "flowchart TD\n  a-->b\n  b-->新节点X";
    const { artifactId } = await land("u-fac", "src-1", saved);

    const r = await readSource("u-fac", artifactId);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(C.operations.getThreadArtifactSource.out.safeParse(body).success).toBe(true);
    const out = body as { markdown: string; version: number | null; savedAt: string; savedBy: string };
    expect(out.markdown).toBe(saved);
    expect(out.version).toBeNull();
    expect(out.savedBy).toBe("u-fac");
    expect(Number.isNaN(Date.parse(out.savedAt))).toBe(false);
  });

  it("②同一消息保存两次：按 messageId 过滤取列表最后一条 ⇒ 读到第二次的内容", async () => {
    await land("u-fac", "src-1", "flowchart TD\n  a-->第一次保存");
    const second = "flowchart TD\n  a-->第二次保存";
    await land("u-fac", "src-1", second);

    const list = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts?projectId=${PROJECT}`, {
      headers: as("u-fac"),
    });
    const items = ((await list.json()) as { items: { artifactId: string; messageId: string }[] }).items
      .filter((i) => i.messageId === "src-1");
    expect(items.length).toBe(2);
    const latest = items[items.length - 1]!;

    const r = await readSource("u-fac", latest.artifactId);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { markdown: string }).markdown).toBe(second);
  });

  it("③他人草稿 404，与不存在的 artifactId 逐字同形（I-36 / I-3）", async () => {
    const { artifactId } = await land("u-fac", "src-1", "flowchart TD\n  a-->b");

    const otherDraft = await readSource("u-other", artifactId);
    const missing = await readSource("u-other", "artifact-does-not-exist");
    expect(otherDraft.status).toBe(404);
    expect(missing.status).toBe(404);
    // 响应体逐字段同形——traceId 是每次请求唯一的诊断字段，剔除后其余必须逐字相等
    // （两种 404 若形状有任何差异，就是可探测的缝）。
    const strip = (b: Record<string, unknown>) => {
      const { traceId, ...rest } = b;
      expect(typeof traceId).toBe("string");
      return rest;
    };
    expect(strip((await otherDraft.json()) as Record<string, unknown>))
      .toEqual(strip((await missing.json()) as Record<string, unknown>));
  });

  it("④landing 行在、字节被抹掉 ⇒ 503 STORAGE_UNAVAILABLE", async () => {
    const { artifactId } = await land("u-fac", "src-1", "flowchart TD\n  a-->b");
    rmSync(join(OBJECT_ROOT, ORG, "artifacts", artifactId), { recursive: true, force: true });

    const r = await readSource("u-fac", artifactId);
    expect(r.status).toBe(503);
    expect(((await r.json()) as { reasonCode?: string }).reasonCode).toBe("STORAGE_UNAVAILABLE");
  });
});
