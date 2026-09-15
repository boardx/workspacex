/**
 * 产业图谱**同一份产物的版本线**：真栈断言（HTTP → controller → application →
 * materializeArtifact → PostgreSQL + 对象存储），不是对着代码读出来的结论。
 *
 * 在 `landAsArtifact` 长出可选的 `artifactId` 之前，每次保存都是一份**新** artifact：
 * 用户改一版存一次，右栏就多一张彼此无关的图，「这张图上一版长什么样」这个问题
 * 在数据里根本没有答案。这里钉住的是那条线现在真的存在：
 *
 *   ① 不带 `artifactId` 保存 ⇒ 与今天逐字相同（新 artifact，版本 1）。
 *   ② 带上刚拿到的 `artifactId` 再保存 ⇒ **同一个 artifactId**，版本 2，
 *      `GET /artifacts/:id/file-versions` 真的返回两行、`versionNumber` 是 1 和 2。
 *   ③ 读回（`getThreadArtifactSource`）拿到的是**第二版**的字节。
 *   ④ 右栏产物列表把这两次保存收成**一行**（同一份产物的两个版本，不是两份产物）。
 *   ⑤ 拿一个本线程没落地过的 artifactId 去追加版本 ⇒ 404（与不可见/不存在同一出口）。
 *   ⑥ 两版的 mermaid 源经 `diffMermaidGraphs` 得到结构差异（新增节点 + 新增边）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { diffMermaidGraphs } from "../../src/domain/chat/mermaid-graph-diff";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
process.env.WORKSPACEX_OBJECT_ROOT = mkdtempSync(join(tmpdir(), "wsx-graph-version-"));

const ORG = "org-graph-version";
const PROJECT = "proj-graph-version-unused";
const THREAD = "graph-version-t1";
const OWNER = "u-graph-owner";

const V1 = `graph TD
  raw[原材料] --> mid[中间品]
  mid -->|加工| fin[成品]
`;
const V2 = `graph TD
  raw[原材料] --> mid[中间品]
  mid -->|深加工| fin[成品]
  fin --> sale[销售渠道]
`;

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

const save = async (payloadRef: string, artifactId?: string) => {
  const res = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts`, {
    method: "POST",
    headers: as(OWNER),
    body: JSON.stringify({
      threadId: THREAD, messageId: "gv-1", mode: "draft",
      title: "产业图谱 · 版本线", payloadRef,
      ...(artifactId === undefined ? {} : { artifactId }),
    }),
  });
  return { status: res.status, body: (await res.json()) as { artifactId: string } };
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, OWNER, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: null, groupId: null,
    visibilityScope: "plenary", createdBy: OWNER, title: "产业图谱对话",
  });
  await addChatMessage({ orgId: ORG, id: "gv-1", threadId: THREAD, authorId: OWNER, body: V1 });
});

describe("同一份图谱产物的版本线", () => {
  it("①②③④⑥ 两次保存 = 一份 artifact 的两个版本，读回是第二版，列表收成一行", async () => {
    const first = await save(V1);
    expect(first.status).toBe(200);

    const second = await save(V2, first.body.artifactId);
    expect(second.status).toBe(200);
    // ② 同一份产物，不是又新建了一份。
    expect(second.body.artifactId).toBe(first.body.artifactId);

    const versionsRes = await fetch(
      `${BASE}/artifacts/${encodeURIComponent(first.body.artifactId)}/file-versions`,
      { headers: as(OWNER) },
    );
    expect(versionsRes.status).toBe(200);
    const versions = (await versionsRes.json()) as {
      versions: Array<{ versionNumber: number; sha256: string; changeSource: string; downloadable: boolean }>;
    };
    expect(versions.versions.map((v) => v.versionNumber).sort()).toEqual([1, 2]);
    // 两版内容不同 ⇒ 两个不同的内容哈希（不是同一个版本被读了两遍）。
    expect(new Set(versions.versions.map((v) => v.sha256)).size).toBe(2);
    expect(versions.versions.every((v) => v.downloadable === true)).toBe(true);

    // ③ 读回 = 第二版的字节。
    const sourceRes = await fetch(
      `${BASE}/chat/threads/${THREAD}/artifacts/${encodeURIComponent(first.body.artifactId)}/source`,
      { headers: as(OWNER) },
    );
    expect(sourceRes.status).toBe(200);
    const source = (await sourceRes.json()) as { markdown: string };
    expect(source.markdown).toBe(V2);

    // ④ 右栏产物列表：同一份产物一行。
    const listRes = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts`, { headers: as(OWNER) });
    const listed = (await listRes.json()) as { items: Array<{ artifactId: string }> };
    expect(listed.items.filter((i) => i.artifactId === first.body.artifactId)).toHaveLength(1);

    // ⑥ 结构差异：一个新节点、一条新边、一条边标签改了。
    const diff = diffMermaidGraphs(V1, source.markdown);
    console.log("[e2e] versions =", JSON.stringify(versions.versions, null, 2));
    console.log("[e2e] diff v1→v2 =", JSON.stringify(diff, null, 2));
    expect(diff).toEqual([
      { kind: "node", change: "added", id: "sale", label: "销售渠道", status: null },
      { kind: "edge", change: "added", from: "fin", to: "sale", label: "" },
      { kind: "edge", change: "changed", from: "mid", to: "fin", before: "加工", after: "深加工" },
    ]);
  });

  it("⑤ 往本线程没落地过的 artifactId 上追加版本 ⇒ 404", async () => {
    const res = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts`, {
      method: "POST",
      headers: as(OWNER),
      body: JSON.stringify({
        threadId: THREAD, messageId: "gv-1", mode: "draft",
        title: "不属于本线程的产物", payloadRef: V2, artifactId: "art-not-landed-here",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("不带 artifactId 的两次保存仍然是两份互不相干的产物（既有行为未变）", async () => {
    const a = await save(V1);
    const b = await save(V2);
    expect(a.body.artifactId).not.toBe(b.body.artifactId);

    const listRes = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts`, { headers: as(OWNER) });
    const listed = (await listRes.json()) as { items: Array<{ artifactId: string }> };
    expect(listed.items).toHaveLength(2);
  });
});
