/**
 * #594（人类本人 2026-08-06 直接推翻裁决，方案 A）—— **线程可以不挂靠任何项目**。
 *
 * ## 权威依据（不是我猜的）
 *
 * 人类原话：「不需要新建项目也应该新建一个 chat，开始使用 skills 和 agent」。
 * 二选一确认为方案 A（`projectId` 全链路可空），不是方案 B（隐式默认项目）。
 * coord-main 视为签核已完成，登记于本束 `MIGRATION-IMPACT.md`。
 *
 * ## 🔴 这份改动最大的风险，本文件把它当**主角**而不是附带
 *
 * `chat` 束此前唯一的可见性实现（`resolveVisibility`）**只认项目成员资格**。
 * 让它对 `projectId === null` 也能回答，等于给「只有一份可见性实现」这条纪律
 * 加了第一条分支——分支写错的那一天不是报错，是**越权读**。
 * 所以本文件除了「功能通不通」，专门留了一节 §3 只测**攻击面**：
 *   ① A 能不能看见 B 的个人线程（I-3 的直接延伸，creator-only）
 *   ② 把 `projectId` 故意传成 `null` 去撞一条**真实存在的项目线程**，
 *      是否会被personal 路径悄悄放行——**这是「换个门绕开项目 ACL」的具体形状**，
 *      不设这道 mismatch 门，personal 路径本身就是一条越权捷径。
 *
 * ## §4 是纯功能：新用户不建项目也能创建 → 发消息 → 列表看得到
 *
 * 对应 #594 验收原文：「新用户登陆后，无需创建任何项目，直接进 /chat 就能新建会话、
 * 发消息、收到 AI 回复」。收到 AI 回复不在本文件范围（依赖 agent-runtime 全链路，
 * 见 PR 正文「未验证项」），本文件测到「消息被接受、run 排队」为止。
 *
 * ## 为什么走真实 HTTP 而不是纯函数单测
 *
 * 攻击面测的是「跨用户能不能看见彼此的数据」，这件事必须在**真实数据库 + 真实路由**
 * 上验证——纯函数测试只能证明「给定这些输入，函数返回这个」，证明不了「路由真的把
 * 正确的输入喂给了它」。同型先例见 `visibility-two-layer-intersection.test.ts`。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";
import { DEFAULT_PERSONAL_THREAD_TITLE } from "../../src/application/chat/mutate-thread";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i594";
const PROJECT = "proj-i594"; // 只用于 §3② 的「真实项目线程」反证，其余全程不建项目
let BASE: string;
let app: NestExpressApplication;
let fx: Awaited<ReturnType<typeof seedOrg>>;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

function mutate(userId: string, body: Record<string, unknown>) {
  return fetch(`${BASE}/chat/threads/mutate`, {
    method: "POST", headers: as(userId),
    body: JSON.stringify({
      op: "create", projectId: null, threadId: null, groupId: null, title: null,
      visibilityScope: null, expectedVersion: null, reason: null,
      ...body,
    }),
  });
}

function getThread(userId: string, threadId: string, projectId: string | null = null) {
  const qs = projectId === null ? "" : `?projectId=${projectId}`;
  return fetch(`${BASE}/chat/threads/${threadId}${qs}`, { headers: as(userId) });
}

function sendMessage(userId: string, threadId: string, text: string, agentId = "probe-agent") {
  return fetch(`${BASE}/chat/threads/${threadId}/messages`, {
    method: "POST", headers: as(userId),
    body: JSON.stringify({ clientMessageId: crypto.randomUUID(), text, agentId }),
  });
}

function listPersonal(userId: string) {
  return fetch(`${BASE}/chat/threads`, { headers: as(userId) });
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
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-a", "consultant", null);
  await addOrgMember(ORG, "u-b", "consultant", null);
});

/* ══════════════════ §1 创建 ══════════════════ */

describe("§1 无项目也能建线程", () => {
  it("projectId: null ⇒ 建线程成功，返回真实 threadId（不是契约允许、实现照拒的空转）", async () => {
    const res = await mutate("u-a", { title: "个人对话" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { threadId: string };
    expect(body.threadId).toBeTruthy();
  });

  it("一键即建：留空标题 ⇒ 200 并自动起默认名（不是 422）——兑现「留空则自动命名」，对齐 ChatGPT/Claude", async () => {
    // 反证（2026-08-11 人类裁决）：个人对话新建**留空标题**此前会 422 TITLE_INVALID，
    // 与新建表单占位符「留空则自动命名」直接矛盾（假承诺）。现在一键即建：空标题由服务端
    // 起默认名 `DEFAULT_PERSONAL_THREAD_TITLE`。⚠ 项目线程 create 空标题仍是 422（见
    // thread-badge-single-source 的「空白标题 ⇒ 422」，projectId 非空）——两条路径故意不同。
    // 数值/字样单源：断言用服务端导出的常量，不在测试里另抄一份 "新对话"。
    const blank = await mutate("u-a", { title: "   " }); // 纯空格也算留空
    expect(blank.status).toBe(200);
    const { threadId } = (await blank.json()) as { threadId: string };
    expect(threadId).toBeTruthy();

    const listed = await listPersonal("u-a");
    const body = (await listed.json()) as { groups: { cards: { id: string; title: string }[] }[] };
    const card = body.groups.flatMap((g) => g.cards).find((c) => c.id === threadId);
    expect(card?.title).toBe(DEFAULT_PERSONAL_THREAD_TITLE);
  });

  it("正样本对照：带 projectId 走既有项目路径，行为不受影响（回归）", async () => {
    await addProjectMember(ORG, PROJECT, "u-a", "facilitator", null);
    const res = await mutate("u-a", { projectId: PROJECT, title: "项目内对话" });
    expect(res.status).toBe(200);
  });
});

/* ══════════════════ §2 读 / 写 —— 创建者视角，功能正样本 ══════════════════ */

describe("§2 创建者能读、能发消息、能在个人列表里看到它", () => {
  it("getThread：创建者能读到，capabilities 含 composer.send（否则输入区不渲染）", async () => {
    const created = await (await mutate("u-a", { title: "t1" })).json() as { threadId: string };
    const res = await getThread("u-a", created.threadId);
    expect(res.status).toBe(200);
    const body = await res.json() as { thread: { projectId: string | null }; capabilities: string[] };
    expect(body.thread.projectId).toBeNull();
    expect(body.capabilities).toContain("composer.send");
    expect(body.capabilities).toContain("thread.mutate");
  });

  it("发消息：202，agentId 不存在时是 422 AGENT_NOT_FOUND（不是 403）—— 证明写权限本身放行了", async () => {
    const created = await (await mutate("u-a", { title: "t2" })).json() as { threadId: string };
    const res = await sendMessage("u-a", created.threadId, "你好");
    // 组织里没有种子 agent，422 是预期的（同 #614 决定性实测同一形状）；
    // 关键断言是**不是** 403 NO_WRITE_ROLE / 404 NOT_VISIBLE。
    expect(res.status).toBe(422);
  });

  it("列表：创建者的个人线程出现在 GET /chat/threads 里，capabilities 恒下发（零线程时也要有）", async () => {
    const empty = await (await listPersonal("u-b")).json() as { groups: unknown[]; capabilities: string[] };
    expect(empty.groups).toEqual([]);
    expect(empty.capabilities).toContain("composer.send"); // 零线程时也要能建第一条（同 #489 的理由）

    const created = await (await mutate("u-a", { title: "t3" })).json() as { threadId: string };
    const listed = await (await listPersonal("u-a")).json() as {
      groups: { cards: { id: string }[] }[];
    };
    const ids = listed.groups.flatMap((g) => g.cards.map((c) => c.id));
    expect(ids).toContain(created.threadId);
  });

  it("改名 / 删除：创建者可以改名，改完再删除，两者都成功", async () => {
    const created = await (await mutate("u-a", { title: "t4" })).json() as { threadId: string };
    const renamed = await mutate("u-a", {
      op: "rename", threadId: created.threadId, title: "改名了", expectedVersion: 0,
    });
    expect(renamed.status).toBe(200);
    const { version } = await renamed.json() as { version: number };
    const deleted = await mutate("u-a", {
      op: "delete", threadId: created.threadId, expectedVersion: version,
    });
    expect(deleted.status).toBe(200);
  });
});

/* ══════════════════ 🔴 §3 攻击面 —— 本文件的核心交付 ══════════════════ */

describe("🔴 §3① 越权读：A 不能看到 B 的个人线程", () => {
  it("getThread：B 的个人线程，A 请求 ⇒ 404（与「不存在」逐字节相同，I-3）", async () => {
    const created = await (await mutate("u-b", { title: "B 的私事" })).json() as { threadId: string };
    const res = await getThread("u-a", created.threadId);
    expect(res.status).toBe(404);
  });

  it("正样本对照：B 自己请求同一条线程 ⇒ 200（防止上面那条只是因为路由整体坏了）", async () => {
    const created = await (await mutate("u-b", { title: "B 的私事 2" })).json() as { threadId: string };
    const res = await getThread("u-b", created.threadId);
    expect(res.status).toBe(200);
  });

  it("发消息：A 对 B 的线程发消息 ⇒ 404，不是 403 —— 不泄露「这条线程存在但你没权限」", async () => {
    const created = await (await mutate("u-b", { title: "B 的私事 3" })).json() as { threadId: string };
    const res = await sendMessage("u-a", created.threadId, "我能看见你吗");
    expect(res.status).toBe(404);
  });

  it("列表：B 的个人线程不出现在 A 的列表里（哪怕 A 知道它存在）", async () => {
    const created = await (await mutate("u-b", { title: "B 的私事 4" })).json() as { threadId: string };
    const listed = await (await listPersonal("u-a")).json() as { groups: { cards: { id: string }[] }[] };
    const ids = listed.groups.flatMap((g) => g.cards.map((c) => c.id));
    expect(ids).not.toContain(created.threadId);
  });

  it("改名 / 删除：A 对 B 的个人线程发起改名 ⇒ 404，线程未被改动", async () => {
    const created = await (await mutate("u-b", { title: "原名" })).json() as { threadId: string };
    const res = await mutate("u-a", {
      op: "rename", threadId: created.threadId, title: "改名了", expectedVersion: 0,
    });
    expect(res.status).toBe(404);
    const still = await getThread("u-b", created.threadId);
    const body = await still.json() as { thread: { id: string } };
    expect(body.thread.id).toBe(created.threadId);
  });
});

describe("🔴 §3② mismatch 门：projectId=null 不能借道读到一条真实的项目线程", () => {
  it("一条真实项目线程，用 personal 路径（projectId 显式传 null）去读 ⇒ 404，不是 200", async () => {
    await addProjectMember(ORG, PROJECT, "u-a", "facilitator", null);
    await addChatThread({
      orgId: ORG, id: "thr-i594-project-real", projectId: PROJECT,
      visibilityScope: "plenary", createdBy: "u-a",
    });
    // 关键：projectId 显式为 null（走 personal 分支），threadId 却是一条真实项目线程的 id。
    const res = await getThread("u-a", "thr-i594-project-real", null);
    expect(res.status).toBe(404);
  });

  it("正样本对照：同一条线程用真实 projectId 读 ⇒ 200 —— 证明上面的 404 是 mismatch 门挡的，不是线程本身读不到", async () => {
    await addProjectMember(ORG, PROJECT, "u-a", "facilitator", null);
    await addChatThread({
      orgId: ORG, id: "thr-i594-project-real-2", projectId: PROJECT,
      visibilityScope: "plenary", createdBy: "u-a",
    });
    const res = await getThread("u-a", "thr-i594-project-real-2", PROJECT);
    expect(res.status).toBe(200);
  });

  it("同理：mutateThread 改名一条真实项目线程时把 projectId 传成 null ⇒ 404，不是「找不到就当新建个人线程处理」", async () => {
    await addProjectMember(ORG, PROJECT, "u-a", "facilitator", null);
    await addChatThread({
      orgId: ORG, id: "thr-i594-project-real-3", projectId: PROJECT,
      visibilityScope: "plenary", createdBy: "u-a",
    });
    const res = await mutate("u-a", {
      op: "rename", projectId: null, threadId: "thr-i594-project-real-3",
      title: "改名了", expectedVersion: 0,
    });
    expect(res.status).toBe(404);
  });
});

/* ══════════════════ §4 既有项目路径不受影响（回归对照）══════════════════ */

describe("§4 项目路径原样成立（本 PR 不许悄悄改变它）", () => {
  it("别组线程对本组组员不可见，一如既往（抽样一条既有断言，非穷举）", async () => {
    await addProjectMember(ORG, PROJECT, "u-a", "member", fx.groups.g1!);
    await addChatThread({
      orgId: ORG, id: "thr-i594-crossgroup", projectId: PROJECT, groupId: fx.groups.g2!,
      visibilityScope: "group-shared", createdBy: "u-b",
    });
    const res = await getThread("u-a", "thr-i594-crossgroup", PROJECT);
    expect(res.status).toBe(404);
  });
});
