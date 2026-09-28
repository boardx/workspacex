/**
 * FF-100 —— 项目线程的 mismatch 门（`resolveVisibility` 项目分支）。
 *
 * 缺陷形状（2026-09-28 file-first 复盘实测）：项目 B 的成员请求 `?projectId=B`，线程 id
 * 却是项目 A 的一条全场线程 ⇒ 200。成员资格与 `authorize` 判的都是 B，从头到尾没人核对
 * 线程到底属于哪个项目；`messages.jsonl` 还会被物化进 **B** 的文件浏览器。
 *
 * 个人分支早有同形的门①（`personal-thread-no-project.test.ts` §3②），项目分支没有。
 * 反证：删掉 `resolve-visibility.ts` 里 `thread.projectId !== projectId` 那一行 ⇒ 本文件红。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  addOrgMember, addProjectMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-ff100";
const PROJECT_A = "proj-ff100-a";
const PROJECT_B = "proj-ff100-b";
const THREAD_A = "thr-ff100-a";
let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({ "x-kernel-test-principal": `${userId}:${ORG}` });
const readThread = (userId: string, projectId: string) =>
  fetch(`${BASE}/chat/threads/${THREAD_A}?projectId=${projectId}`, { headers: as(userId) });
const readFile = (userId: string, projectId: string) =>
  fetch(`${BASE}/chat/threads/${THREAD_A}/messages-file?projectId=${projectId}`, { headers: as(userId) });

async function artifactCountIn(projectId: string): Promise<number> {
  return asOwner(async (c) => {
    const r = await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM artifacts WHERE org_id = $1 AND project_id = $2",
      [ORG, projectId],
    );
    return r.rows[0]!.n;
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT_A });
  await asOwner((c) => c.query(
    "INSERT INTO projects (id, org_id, name, kind) VALUES ($1, $2, 'B', 'workshop')",
    [PROJECT_B, ORG],
  ));
  await addOrgMember(ORG, "u-a", "consultant", null);
  await addOrgMember(ORG, "u-b", "consultant", null);
  await addProjectMember(ORG, PROJECT_A, "u-a", "facilitator", null);
  await addProjectMember(ORG, PROJECT_B, "u-b", "facilitator", null);
  await addChatThread({
    orgId: ORG, id: THREAD_A, projectId: PROJECT_A, visibilityScope: "plenary", createdBy: "u-a",
  });
  await addChatMessage({ orgId: ORG, id: "msg-ff100", threadId: THREAD_A, authorId: "u-a", body: "A 项目的正文" });
}, 180_000);

afterAll(async () => {
  await app?.close();
});

describe("FF-100 项目线程 mismatch 门", () => {
  it("B 的成员把 projectId 声称为 B 去读 A 的线程 ⇒ 404，与「线程不存在」同一出口", async () => {
    const res = await readThread("u-b", PROJECT_B);
    const missing = await fetch(`${BASE}/chat/threads/thr-ff100-none?projectId=${PROJECT_B}`, { headers: as("u-b") });
    expect(res.status).toBe(404);
    expect(res.status).toBe(missing.status);
  });

  it("同样取不到 messages.jsonl，且 B 的文件浏览器里不会多出 A 的对话文件", async () => {
    const before = await artifactCountIn(PROJECT_B);
    const res = await readFile("u-b", PROJECT_B);
    expect(res.status).toBe(404);
    expect(await artifactCountIn(PROJECT_B)).toBe(before);
  });

  it("A 的成员自称 B 也不行：门判的是线程归属，不是请求者身份", async () => {
    await addProjectMember(ORG, PROJECT_B, "u-a", "facilitator", null);
    expect((await readThread("u-a", PROJECT_B)).status).toBe(404);
  });

  it("正样本对照：A 的成员用真实 projectId 读 ⇒ 200（证明 404 是 mismatch 门挡的）", async () => {
    expect((await readThread("u-a", PROJECT_A)).status).toBe(200);
  });
});
