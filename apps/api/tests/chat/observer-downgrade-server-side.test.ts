/**
 * F108 —— 观察者降级是**服务端不下发**，不是前端不渲染（chat 束 domain.md I-5）。
 *
 * ## 这个文件与「前端隐藏」的区别，就是它存在的全部理由
 *
 * 每一条断言都打在 **HTTP 响应体**上：那条数据在不在过网的 JSON 里。
 * 「界面上看不到」是一个关于 React 的事实，与授权无关——数据一旦过网，
 * devtools、日志采样、任何第三方客户端都能拿到它。
 *
 * ## 反证（写完门控立刻造反证，本仓已九次「全绿但空转」）
 *
 * 删掉 `application/chat/get-thread.ts` 里标着 ⭐ 的那一行过滤，
 * 下面「转写正文不出现在响应里」与「私聊消息不出现在响应里」必须**当场变红**。
 * 若它们仍然绿，说明被测的是前端，这两条断言从第一天起就是空转的。
 * 反证记录见 issue #51 评论。
 *
 * ## 每条「观察者拿不到」都配一条「别人拿得到」
 *
 * 否则一个「谁都拿不到」的实现——比如接口整体挂了、或过滤条件写成恒 false——
 * 会让本文件全绿。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { chat as C } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { CHAT_WRITE_CAPABILITIES } from "../../src/domain/chat/thread-visibility";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f108-obs";
const PROJECT = "proj-f108-obs";
/** 这两句正文是本文件的探针：它们不许出现在观察者的响应里，必须出现在引导师的响应里。 */
const TRANSCRIPT_TEXT = "原始转写：受访者说了一段尚未脱敏的话";
const PRIVATE_TEXT = "私聊：这句只有三方能看";
const PUBLIC_TEXT = "AI 给全场的结论";

let BASE: string;
let app: NestExpressApplication;
let fx: Awaited<ReturnType<typeof seedOrg>>;

const as = (userId: string) => ({ "x-kernel-test-principal": `${userId}:${ORG}` });

const readThread = (userId: string, threadId = "t-obs") =>
  fetch(`${BASE}/chat/threads/${threadId}?projectId=${PROJECT}`, { headers: as(userId) });

async function payload(userId: string, threadId = "t-obs"): Promise<string> {
  const res = await readThread(userId, threadId);
  expect(res.status, `${userId} 读 ${threadId}`).toBe(200);
  return JSON.stringify(await res.json());
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
  await addOrgMember(ORG, "u-fac", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null);
  await addOrgMember(ORG, "u-obs", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-obs", "observer", null);
  await addOrgMember(ORG, "u-mem", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-mem", "member", fx.groups.g1!);

  // 一条全场线程，里面三样东西：可公开的 AI 发言、原始转写、以及一条更严的私聊消息。
  // 三样放同一条线程，是为了让「按线程判定」这种粗粒度实现无法蒙混过关。
  await addChatThread({
    orgId: ORG, id: "t-obs", projectId: PROJECT, groupId: null,
    visibilityScope: "plenary", createdBy: "u-fac",
  });
  await addChatMessage({
    orgId: ORG, id: "m-pub", threadId: "t-obs", authorId: "agent-1",
    authorKind: "agent", agentId: "agent-1", body: PUBLIC_TEXT,
  });
  await addChatMessage({
    orgId: ORG, id: "m-transcript", threadId: "t-obs", authorId: "u-mem",
    body: TRANSCRIPT_TEXT, rawTranscript: true,
  });
  await addChatMessage({
    orgId: ORG, id: "m-private", threadId: "t-obs", authorId: "u-mem",
    body: PRIVATE_TEXT, visibilityScope: "member-private",
  });
  // 显式 60s，理由同姊妹文件：默认 10s 的 hook 超时在全量并行下会把「机器忙」报成「红」。
}, 60_000);

describe("I-5: 观察者的响应体里根本没有那几条数据", () => {
  it("原始转写不在观察者的响应 JSON 里", async () => {
    expect(await payload("u-obs")).not.toContain(TRANSCRIPT_TEXT);
  });

  it("私聊消息不在观察者的响应 JSON 里", async () => {
    expect(await payload("u-obs")).not.toContain(PRIVATE_TEXT);
  });

  it("消息 id 层面也不存在——不是「返回了但抹掉了正文」", async () => {
    const body = (await (await readThread("u-obs")).json()) as { messages: { id: string }[] };
    expect(body.messages.map((m) => m.id)).toEqual(["m-pub"]);
  });

  it("引导师的响应里两条都在（否则「谁都拿不到」的实现也能全绿）", async () => {
    const facilitator = await payload("u-fac");
    expect(facilitator).toContain(TRANSCRIPT_TEXT);
    expect(facilitator).toContain(PRIVATE_TEXT);
  });

  it("观察者仍然拿得到公开内容——降级不是拒绝", async () => {
    expect(await payload("u-obs")).toContain(PUBLIC_TEXT);
  });
});

describe("I-5: 写能力标记一个都不下发", () => {
  it("观察者的 capabilities 不含任何写能力", async () => {
    const body = (await (await readThread("u-obs")).json()) as { capabilities: string[] };
    for (const cap of CHAT_WRITE_CAPABILITIES) {
      // 「在集合里但标了 disabled」不算——那等于把授权判定交给客户端执行。
      expect(body.capabilities, cap).not.toContain(cap);
    }
    expect(body.capabilities).toContain("thread.read");
  });

  it("引导师的 capabilities 含输入区与批准卡（配对断言）", async () => {
    const body = (await (await readThread("u-fac")).json()) as { capabilities: string[] };
    expect(body.capabilities).toContain("composer.send");
    expect(body.capabilities).toContain("approval.decide");
  });
});

describe("右栏计数说的是真话（I-20）", () => {
  it("观察者的转写标签计数是真实的 0，且标签不隐藏", async () => {
    const body = (await (await readThread("u-obs")).json()) as {
      rightTabs: { tab: string; count: number }[];
    };
    // 恒五个标签，一个都不许因为计数为 0 而消失。
    expect(body.rightTabs.map((t) => t.tab)).toEqual([...C.RightTab.options]);
    expect(body.rightTabs.find((t) => t.tab === "transcript")!.count).toBe(0);
  });

  it("引导师那边同一个计数是 1——0 是真实的，不是被擦掉的", async () => {
    const body = (await (await readThread("u-fac")).json()) as {
      rightTabs: { tab: string; count: number }[];
    };
    expect(body.rightTabs.find((t) => t.tab === "transcript")!.count).toBe(1);
  });
});

describe("观察者读私聊线程：连线程本身都不可见", () => {
  it("member-private 线程对观察者是 404（不是「返回一个空线程」）", async () => {
    await addChatThread({
      orgId: ORG, id: "t-priv", projectId: PROJECT, groupId: fx.groups.g1!,
      visibilityScope: "member-private", createdBy: "u-mem",
    });
    await addChatMessage({
      orgId: ORG, id: "m-priv-only", threadId: "t-priv", authorId: "u-mem", body: PRIVATE_TEXT,
    });
    expect((await readThread("u-obs", "t-priv")).status).toBe(404);
    // 配对：同一条线程，作者本人读得到。
    expect((await readThread("u-mem", "t-priv")).status).toBe(200);
  });
});

describe("响应仍然符合契约", () => {
  it("观察者的响应体过 getThread.out 的 schema", async () => {
    const body = await (await readThread("u-obs")).json();
    const parsed = C.operations.getThread.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
  });
});
