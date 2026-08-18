/**
 * G2（design-delta chat-persona-roundtrip，confirmed 2026-08-18）：
 * `summarizePersonaFromThread` 产出**以 assistant 消息进入线程** + mindmap 围栏。
 * 真栈断言：
 *   ① 线程里种入 persona 文本语法后触发，`out.resultMessageId` 指向的消息真实存在于
 *      线程（`listMessages` 重读，不信响应体），authorKind 为 `agent`（assistant 侧），
 *      正文含 ```mermaid 围栏且首个非空行是 `mindmap`。
 *   ② mindmap 六个一级分支名与 `@repo/fabric-markdown` 的 `PERSONA_SECTIONS` 集合
 *      相等（逐值点名差集；权威源 import 自 fabric-markdown，不手抄第二份）。
 *   ③ 无画像信息的线程触发 ⇒ `sufficient: false`，六分支下是「信息不足」占位节点
 *      （固定字符串逐字比对），不出现任何未在线程正文出现过的实体词。
 *   ④ `out.mode` 恒为 `draft`；`out` 过契约 safeParse（含新增 resultMessageId）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chat as C } from "@repo/contracts";
import { PERSONA_SECTIONS } from "@repo/fabric-markdown/diagrams/persona";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
process.env.WORKSPACEX_OBJECT_ROOT = mkdtempSync(join(tmpdir(), "wsx-g2-"));

const ORG = "org-persona-mindmap";
const PROJECT = "proj-persona-mindmap";
const THREAD = "persona-mindmap-t1";

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

interface SummarizeOut {
  mode?: string;
  sufficient?: boolean;
  resultMessageId?: string;
}

const summarize = async (messageId: string) => {
  const r = await fetch(`${BASE}/chat/threads/${THREAD}/persona-summary`, {
    method: "POST",
    headers: as("u-fac"),
    body: JSON.stringify({ threadId: THREAD, messageId }),
  });
  return { status: r.status, body: (await r.json()) as SummarizeOut & Record<string, unknown> };
};

interface ListedMessage {
  id: string;
  authorKind: string;
  text: string;
}

const listAll = async (): Promise<ListedMessage[]> => {
  const r = await fetch(`${BASE}/chat/threads/${THREAD}/messages?limit=100`, {
    headers: as("u-fac"),
  });
  expect(r.status).toBe(200);
  return ((await r.json()) as { messages: ListedMessage[] }).messages;
};

/** mindmap 围栏里缩进恰为 4 空格的行 = 一级分支。 */
const firstLevelBranches = (fence: string): string[] =>
  fence.split("\n").filter((l) => /^ {4}\S/.test(l)).map((l) => l.trim());

const extractMermaidFence = (text: string): string => {
  const m = /```mermaid\n([\s\S]*?)```/.exec(text);
  expect(m).not.toBeNull();
  return m![1]!;
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
    visibilityScope: "plenary", createdBy: "u-fac", title: "画像 mindmap",
  });
});

describe("summarizePersonaFromThread · assistant 消息 + mindmap 围栏（G2）", () => {
  it("①②④有画像信息：resultMessageId 指向线程里真实存在的 assistant 消息，正文是 mindmap 围栏、六分支 = PERSONA_SECTIONS", async () => {
    await addChatMessage({
      orgId: ORG, id: "pmm-1", threadId: THREAD, authorId: "u-fac",
      body: "访谈记录：\n姓名: 陈静\n职位: 生产计划员",
    });
    await addChatMessage({
      orgId: ORG, id: "pmm-2", threadId: THREAD, authorId: "u-fac",
      body: "## 目标和需求\n- 确保订单准时交付率稳定在95%以上",
    });

    const { status, body } = await summarize("pmm-2");
    expect(status).toBe(200);
    expect(C.operations.summarizePersonaFromThread.out.safeParse(body).success).toBe(true);
    expect(body.mode).toBe("draft");
    expect(body.sufficient).toBe(true);
    expect(typeof body.resultMessageId).toBe("string");

    // listMessages 重读——不信响应体。
    const messages = await listAll();
    const result = messages.find((m) => m.id === body.resultMessageId);
    expect(result).toBeDefined();
    expect(result!.authorKind).toBe("agent");

    const fence = extractMermaidFence(result!.text);
    const firstNonEmpty = fence.split("\n").find((l) => l.trim().length > 0);
    expect(firstNonEmpty?.trim()).toBe("mindmap");

    // ② 六分支与 PERSONA_SECTIONS 集合相等——逐值点名差集，不用 toHaveLength。
    const branches = firstLevelBranches(fence);
    const missing = [...PERSONA_SECTIONS].filter((s) => !branches.includes(s));
    const extra = branches.filter((b) => !(PERSONA_SECTIONS as readonly string[]).includes(b));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);

    // 线程里真实写过的要点进了分支下（不是套壳空图）。
    expect(fence).toContain("确保订单准时交付率稳定在95%以上");
  });

  it("③无画像信息：sufficient:false，六分支下各挂固定「信息不足」占位、不编造实体词", async () => {
    await addChatMessage({
      orgId: ORG, id: "pmm-3", threadId: THREAD, authorId: "u-fac",
      body: "早上好，今天的进度怎么样？",
    });

    const { status, body } = await summarize("pmm-3");
    expect(status).toBe(200);
    expect(body.sufficient).toBe(false);

    const messages = await listAll();
    const result = messages.find((m) => m.id === body.resultMessageId);
    expect(result).toBeDefined();

    const fence = extractMermaidFence(result!.text);
    // 每个一级分支后紧跟一条二级占位——占位是固定字符串，逐字比对。
    const lines = fence.split("\n");
    for (const section of PERSONA_SECTIONS) {
      const idx = lines.findIndex((l) => l.trim() === section);
      expect(idx).toBeGreaterThan(-1);
      expect(lines[idx + 1]?.trim()).toBe("信息不足");
    }
    // 不编造：除结构行（mindmap/root/分区名/占位）外没有别的内容行。
    const contentLines = lines.filter((l) => l.trim().length > 0).map((l) => l.trim());
    const allowed = new Set<string>(["mindmap", "信息不足", ...PERSONA_SECTIONS]);
    const unexpected = contentLines.filter((l) => !allowed.has(l) && !l.startsWith("root(("));
    expect(unexpected).toEqual([]);
  });
});
