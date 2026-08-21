/**
 * 个人线程 `artifact.land`（人类裁决，2026-08-21，issue #728 round 16 P10 留的
 * 开放问题「个人对话要不要真的支持落地产物」在此落地）：真栈（HTTP → controller
 * → application → resolveVisibility → PostgreSQL）断言。
 *
 * 四条路径：
 *   ① 创建者对自己的个人线程可以真实落地——`chat_artifact_landings` 落一行，
 *      不再是「本地演示，未接后端」；`listThreadArtifacts`（缺省 `projectId`
 *      query 参数 ⇒ 后端归一成 `null`）也读得回来，不是只有 POST 单向能写。
 *   ② 非创建者对同一条个人线程发起落地请求 ⇒ 404（不可见，语义与「线程不存在」
 *      同一个出口，不是 403——`resolvePersonalVisibility` 的门②早在判权之前就
 *      把非创建者短路成 not-found，与项目线程「有权限判断可见但角色不够」的
 *      403 路径是两回事，不能混）。
 *   ③ 个人线程请求 `mode: "live"`/`"pinned"` ⇒ 422 `PERSONAL_THREAD_REQUIRES_DRAFT`
 *      ——硬锁 draft，不依赖「前端恰好没传别的 mode」这个隐性约定。
 *   ④ `getThreadArtifactSource`（G1 读回，供全屏编辑器重开时用最新保存版初始化）
 *      在个人线程上同样可用——不只是 list 能读，取回的 markdown 字节也要对得上
 *      落地时写的 `payloadRef`。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
process.env.WORKSPACEX_OBJECT_ROOT = mkdtempSync(join(tmpdir(), "wsx-personal-land-"));

const ORG = "org-personal-land";
const PROJECT = "proj-personal-land-unused"; // seedOrg 要求非空，本文件不建任何项目线程
const THREAD = "personal-land-t1";
const OWNER = "u-owner";
const OTHER = "u-other";

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
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, OWNER, "consultant", null);
  await addOrgMember(ORG, OTHER, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: null, groupId: null,
    visibilityScope: "plenary", createdBy: OWNER, title: "个人对话",
  });
  await addChatMessage({
    orgId: ORG, id: "pl-1", threadId: THREAD, authorId: OWNER, body: "flowchart TD\n  a-->b",
  });
});

describe("个人线程落地 artifact（2026-08-21 裁决）", () => {
  it("① 创建者可以真实落地——不再是「本地演示」，chat_artifact_landings 真的多一行", async () => {
    const res = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts`, {
      method: "POST",
      headers: as(OWNER),
      body: JSON.stringify({
        threadId: THREAD, messageId: "pl-1", mode: "draft",
        title: "个人对话画布 · 测试", payloadRef: "flowchart TD\n  a-->b",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { artifactId: string; mode: string };
    expect(body.mode).toBe("draft");
    expect(typeof body.artifactId).toBe("string");

    // 真的落库：list 接口能读回同一条（跟既有 G1a 测试同一条验证纪律——
    // 不满足于「接口 200」，要看数据真的进了 chat_artifact_landings）。
    const list = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts`, { headers: as(OWNER) });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { items: Array<{ artifactId: string; messageId: string }> };
    expect(listed.items.some((it) => it.artifactId === body.artifactId && it.messageId === "pl-1")).toBe(true);
  });

  it("② 非创建者对同一条个人线程落地 ⇒ 404（不可见，不是 403——I-3 与其余读路径同一个出口）", async () => {
    const res = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts`, {
      method: "POST",
      headers: as(OTHER),
      body: JSON.stringify({
        threadId: THREAD, messageId: "pl-1", mode: "draft",
        title: "别人的个人对话不该看得见", payloadRef: "flowchart TD\n  a-->b",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("③ 个人线程请求 mode: live/pinned ⇒ 422 PERSONAL_THREAD_REQUIRES_DRAFT，硬锁 draft", async () => {
    for (const mode of ["live", "pinned"] as const) {
      const res = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts`, {
        method: "POST",
        headers: as(OWNER),
        body: JSON.stringify({
          threadId: THREAD, messageId: "pl-1", mode,
          title: `个人对话不该开放 ${mode}`, payloadRef: "flowchart TD\n  a-->b",
        }),
      });
      expect(res.status, mode).toBe(422);
      const body = (await res.json()) as { reasonCode?: string };
      expect(body.reasonCode, mode).toBe("PERSONAL_THREAD_REQUIRES_DRAFT");
    }
  });

  it("④ getThreadArtifactSource（G1 读回）在个人线程上可用，取回的 markdown 与落地时写入的一致", async () => {
    const payload = "flowchart TD\n  a-->b\n  b-->G1读回验证";
    const land = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts`, {
      method: "POST",
      headers: as(OWNER),
      body: JSON.stringify({
        threadId: THREAD, messageId: "pl-1", mode: "draft",
        title: "G1 读回验证", payloadRef: payload,
      }),
    });
    expect(land.status).toBe(200);
    const { artifactId } = (await land.json()) as { artifactId: string };

    const source = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts/${artifactId}/source`, {
      headers: as(OWNER),
    });
    expect(source.status).toBe(200);
    const body = (await source.json()) as { markdown: string; savedBy: string };
    expect(body.markdown).toBe(payload);
    expect(body.savedBy).toBe(OWNER);

    // 非创建者读同一份 draft ⇒ 404（I-36：草稿仅创建者可见，与 list 同一条规则）。
    const sourceAsOther = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts/${artifactId}/source`, {
      headers: as(OTHER),
    });
    expect(sourceAsOther.status).toBe(404);
  });
});
