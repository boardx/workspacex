/**
 * `summarizePersonaFromThread`（`POST /chat/threads/:threadId/persona-summary`）——
 * 把内置 canvas 模板 `persona` 接到 chat 里：真实起一次服务、真实写线程消息、真实
 * 打接口、真实查库验证落地结果，端到端覆盖人类原话「必须要在 chat 里面可以总结
 * 用户画像的模板」这句需求的最小闭环。
 *
 * 三条断言线：
 *   ① 线程里写过 persona 模板自己的字段/分区语法 ⇒ 落地成功、`sufficient: true`，
 *      「产物」列表里的标题真的带着线程里写过的姓名（不是套壳文案）。
 *   ② 线程里只有自由聊天、没有任何可辨认的画像信息 ⇒ 依然落地成功（不是拒绝），
 *      但 `sufficient: false` 且标题明说「信息不足」——如实报告，不虚构画像。
 *   ③ 观察者恒无写权——与 `landAsArtifact` 本身同一条门（复用同一个错误映射）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-persona-summary";
const PROJECT = "proj-persona-summary";
const THREAD = "persona-summary-t1";

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

interface SummarizeOut {
  artifactId?: string;
  mode?: string;
  hasSource?: boolean;
  sufficient?: boolean;
  reasonCode?: string;
}

const summarize = async (
  userId: string,
  messageId: string,
): Promise<{ status: number; body: SummarizeOut }> => {
  const r = await fetch(`${BASE}/chat/threads/${THREAD}/persona-summary`, {
    method: "POST",
    headers: as(userId),
    body: JSON.stringify({ threadId: THREAD, messageId }),
  });
  return { status: r.status, body: (await r.json()) as SummarizeOut };
};

interface ThreadArtifactsOut {
  items: { artifactId: string; title: string; mode: string; hasSource: boolean }[];
}

const listArtifacts = async (userId: string): Promise<ThreadArtifactsOut> => {
  const r = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts?projectId=${PROJECT}`, {
    headers: as(userId),
  });
  return (await r.json()) as ThreadArtifactsOut;
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
  await addOrgMember(ORG, "u-obs", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null);
  await addProjectMember(ORG, PROJECT, "u-obs", "observer", null);

  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, groupId: null,
    visibilityScope: "plenary", createdBy: "u-fac", title: "用户画像汇总",
  });
});

describe("summarizePersonaFromThread · 真实落地一次", () => {
  it("①线程里写过 persona 字段/分区语法 ⇒ 落地成功，标题带着线程里真实写过的姓名", async () => {
    await addChatMessage({
      orgId: ORG, id: "pm-1", threadId: THREAD, authorId: "u-fac",
      body: "访谈记录：\n姓名: 陈静\n职位: 生产计划员",
    });
    await addChatMessage({
      orgId: ORG, id: "pm-2", threadId: THREAD, authorId: "u-fac",
      body: "## 目标和需求\n- 确保订单准时交付率稳定在95%以上",
    });

    const { status, body } = await summarize("u-fac", "pm-2");
    expect(status).toBe(200);
    expect(body.sufficient).toBe(true);
    expect(body.mode).toBe("draft");
    expect(typeof body.artifactId).toBe("string");

    const list = await listArtifacts("u-fac");
    const item = list.items.find((i) => i.artifactId === body.artifactId);
    expect(item).toBeDefined();
    expect(item!.title).toBe("用户画像 · 陈静");
    expect(item!.mode).toBe("draft");
  });

  it("②只有自由聊天、没有任何可辨认的画像信息 ⇒ 依然落地成功但 sufficient:false，标题明说信息不足", async () => {
    await addChatMessage({
      orgId: ORG, id: "pm-3", threadId: THREAD, authorId: "u-fac",
      body: "早上好，今天的进度怎么样？",
    });
    await addChatMessage({
      orgId: ORG, id: "pm-4", threadId: THREAD, authorId: "u-fac",
      body: "还不错，下午再对一下计划。",
    });

    const { status, body } = await summarize("u-fac", "pm-4");
    expect(status).toBe(200);
    expect(body.sufficient).toBe(false);

    const list = await listArtifacts("u-fac");
    const item = list.items.find((i) => i.artifactId === body.artifactId);
    expect(item).toBeDefined();
    expect(item!.title).toBe("用户画像（信息不足）");
  });

  it("③观察者恒无写权——与 landAsArtifact 本身同一条门", async () => {
    await addChatMessage({
      orgId: ORG, id: "pm-5", threadId: THREAD, authorId: "u-fac", body: "姓名: 王芳",
    });
    const { status, body } = await summarize("u-obs", "pm-5");
    expect(status).toBe(403);
    expect(body.reasonCode).toBe("NO_WRITE_ROLE");
  });
});
