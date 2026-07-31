/**
 * F109 —— `messages.jsonl` 的**文件粒度**与判权同源（domain.md I-16 / I-12，uc-8-1 AC3）。
 *
 * ## 「会话为文件粒度」这句话怎么才算被测到
 *
 * 断言「有一个 messages.jsonl」对**每条消息一个文件**的实现同样是绿的——那种实现里
 * 也会有一个叫 `messages.jsonl` 的东西。所以这里断的是两件事的**联合**：
 *
 *   ① 该会话前缀下 `messages.jsonl` 的对象数 **恒为 1，且不随消息数增长**；
 *   ② 该前缀下**没有任何以 messageId 命名的对象**。
 *
 * 反证：把物化改成「一条消息写一个对象」，①与②同时变红。
 * 只写①，一个「一个汇总文件 + N 个分片文件」的实现照样通过。
 *
 * ## anchor 是 messageId（I-16 后半）
 *
 * 每一行的 `id` 就是消息 id，且**逐条**能在这个 `.jsonl` 里定位到——
 * 断言的是「定位成功率为 1.0」，不是「大部分能定位」。
 *
 * ## 文件浏览器不是权限旁路（I-12 / X-5）
 *
 * 取文件与读线程走**同一个** `resolveVisibility`。这里的验收方式是：
 * 别组的人取别组线程的文件，响应与「线程不存在」**逐字节相同**。
 * 一个「文件端口自己判一次权」的实现能挡住这个请求，但挡不住下一次规则变更——
 * 所以还有一条成对断言：**同一个人**取**他看得见的**那条线程的文件必须成功。
 */
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { chat as C } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { messagesToJsonl } from "../../src/application/chat/get-thread-messages-file";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

// 对象存储根目录必须在 app 启动**之前**定下来（`objectStoreRoot()` 读它）。
const OBJECT_ROOT = mkdtempSync(join(tmpdir(), "w1-chat-F109-objects-"));
process.env.WORKSPACEX_OBJECT_ROOT = OBJECT_ROOT;

const ORG = "org-f109file";
const PROJECT = "proj-f109file";
let BASE: string;
let app: NestExpressApplication;
let fx: Awaited<ReturnType<typeof seedOrg>>;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

const getFile = (userId: string, threadId: string) =>
  fetch(`${BASE}/chat/threads/${threadId}/messages-file?projectId=${PROJECT}`, {
    headers: as(userId),
  });

const readThread = (userId: string, threadId: string) =>
  fetch(`${BASE}/chat/threads/${threadId}?projectId=${PROJECT}`, { headers: as(userId) });

interface FileOut {
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  downloadUrl: string;
}
const fileJson = async (userId: string, threadId: string): Promise<FileOut> =>
  (await (await getFile(userId, threadId)).json()) as FileOut;

/**
 * 该 artifact 前缀下的 `messages.jsonl` 对象。
 *
 * ⚠ `FsObjectStore.pathFor()` 把一个 key 映射成 `<root>/<key 各段>/_<digest>`，
 *   所以磁盘上 `messages.jsonl` 是**目录**，字节在里面的 `_xxxx` 里，
 *   旁边还有一个 `.mime`。按「文件名等于 messages.jsonl」去数会数到 0 个而不是报错——
 *   一条**永远为 0** 的断言配上 `toHaveLength(1)` 会红，配上 `not.toHaveLength(2)` 就会
 *   永远绿。这个注释是为了下一个人不要把它「修」成后者。
 */
function messagesFileObjects(objectKey: string): string[] {
  const prefix = objectKey.slice(0, objectKey.lastIndexOf("/v"));
  return walk(join(OBJECT_ROOT, prefix)).filter(
    (k) => k.includes("messages.jsonl/") && !k.endsWith(".mime"),
  );
}

/** 经 `ObjectStore` 端口读回字节——与生产读路径同一条，不自己拼磁盘路径。 */
async function readObject(objectKey: string): Promise<string> {
  const { OBJECT_STORE } = await import("../../src/application/artifact/ports");
  const store = app.get(OBJECT_STORE) as { get(k: string): Promise<Uint8Array | null> };
  const bytes = await store.get(objectKey);
  expect(bytes).not.toBeNull();
  return new TextDecoder().decode(bytes!);
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
  await addOrgMember(ORG, "u-mem1", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-mem1", "member", fx.groups.g1!);
  await addOrgMember(ORG, "u-mem2", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-mem2", "member", fx.groups.g2!);
  await addOrgMember(ORG, "u-obs", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-obs", "observer", null);
}, 60_000);

describe("I-16 每个线程恰好一个 messages.jsonl（会话为文件粒度）", () => {
  it("5 条消息 ⇒ 1 个 messages.jsonl、5 行、0 个按消息命名的对象", async () => {
    const ids = ["f109f-m-a", "f109f-m-b", "f109f-m-c", "f109f-m-d", "f109f-m-e"];
    await addChatThread({
      orgId: ORG, id: "f109f-t-five", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac", title: "五条消息",
    });
    for (const id of ids) {
      await addChatMessage({
        orgId: ORG, id, threadId: "f109f-t-five", authorId: "u-fac", body: `正文 ${id}`,
      });
    }

    const r = await getFile("u-fac", "f109f-t-five");
    expect(r.status).toBe(200);
    const body = (await r.json()) as FileOut;
    expect(C.operations.getThreadMessagesFile.out.safeParse(body).success).toBe(true);

    // ① 恰好一个 messages.jsonl。
    expect(messagesFileObjects(body.objectKey)).toHaveLength(1);
    // ② 没有任何以 messageId 命名的对象——「每条消息一个文件」的实现在这里死。
    const prefix = body.objectKey.slice(0, body.objectKey.lastIndexOf("/v"));
    const objects = walk(join(OBJECT_ROOT, prefix));
    expect(objects.length).toBeGreaterThan(0); // 非空转：确实扫到了东西
    for (const id of ids) {
      expect(objects.some((k) => k.includes(id))).toBe(false);
    }

    const text = await readObject(body.objectKey);
    const lines = text.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(ids.length);

    // anchor = messageId，且**逐条**可定位（成功率 1.0，不是「大部分」）。
    const located = ids.filter((id) =>
      lines.some((l) => (JSON.parse(l) as { id: string }).id === id),
    );
    expect(located).toEqual(ids);
  });

  it("对象数不随消息数增长：1 条与 20 条的线程各自都只有 1 个文件", async () => {
    for (const [id, n] of [["f109f-t-one", 1], ["f109f-t-twenty", 20]] as const) {
      await addChatThread({
        orgId: ORG, id, projectId: PROJECT, groupId: null,
        visibilityScope: "plenary", createdBy: "u-fac", title: id,
      });
      for (let i = 0; i < n; i += 1) {
        await addChatMessage({
          orgId: ORG, id: `${id}-m${i}`, threadId: id, authorId: "u-fac", body: `第 ${i} 条`,
        });
      }
      const body = await fileJson("u-fac", id);
      expect(messagesFileObjects(body.objectKey)).toHaveLength(1);
    }
  });

  it("幂等：重复取用返回同一个 objectKey，不产生第二个版本", async () => {
    await addChatThread({
      orgId: ORG, id: "f109f-t-idem", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac", title: "幂等",
    });
    await addChatMessage({
      orgId: ORG, id: "f109f-m-idem", threadId: "f109f-t-idem", authorId: "u-fac", body: "一条",
    });
    const first = await fileJson("u-fac", "f109f-t-idem");
    const second = await fileJson("u-fac", "f109f-t-idem");
    expect(second.objectKey).toBe(first.objectKey);
    expect(second.sha256).toBe(first.sha256);
    expect(messagesFileObjects(first.objectKey)).toHaveLength(1);
  });

  it("空线程物化不出文件 ⇒ 404，而不是一个 0 字节的假文件", async () => {
    await addChatThread({
      orgId: ORG, id: "f109f-t-empty", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac", title: "空线程",
    });
    expect((await getFile("u-fac", "f109f-t-empty")).status).toBe(404);
  });
});

describe("I-12 文件下载与线程读**同源**判权", () => {
  it("别组组员取别组线程的文件 ⇒ 与「线程不存在」逐字节相同", async () => {
    await addChatThread({
      orgId: ORG, id: "f109f-t-g2file", projectId: PROJECT, groupId: fx.groups.g2!,
      visibilityScope: "group-shared", createdBy: "u-mem2", title: "第二组",
    });
    await addChatMessage({
      orgId: ORG, id: "f109f-m-g2file", threadId: "f109f-t-g2file", authorId: "u-mem2", body: "别组的正文",
    });

    const denied = await getFile("u-mem1", "f109f-t-g2file");
    const missing = await getFile("u-mem1", "f109f-t-does-not-exist");
    expect(denied.status).toBe(missing.status);
    // traceId 逐请求不同，其余必须逐字节相同——与 F108 的 I-3 断言同一种写法。
    const strip = (b: Record<string, unknown>) => ({ ...b, traceId: "<any>" });
    expect(strip((await denied.json()) as Record<string, unknown>)).toEqual(
      strip((await missing.json()) as Record<string, unknown>),
    );
    // 与读线程的出口也一致——两条路一个门。
    expect((await readThread("u-mem1", "f109f-t-g2file")).status).toBe(denied.status);

    // 成对：第二组的人取得到，否则「谁都取不到」也能通过上面全部断言。
    const ok = await getFile("u-mem2", "f109f-t-g2file");
    expect(ok.status).toBe(200);
  });

  it("观察者下载到的文件里**不存在**原始转写那几行（不是下载完再隐藏）", async () => {
    await addChatThread({
      orgId: ORG, id: "f109f-t-obs", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac", title: "含转写",
    });
    await addChatMessage({
      orgId: ORG, id: "f109f-m-raw", threadId: "f109f-t-obs", authorId: "u-fac",
      body: "原始转写的敏感正文", rawTranscript: true,
    });
    await addChatMessage({
      orgId: ORG, id: "f109f-m-pub", threadId: "f109f-t-obs", authorId: "u-fac", body: "公开的一句话",
    });

    const obs = await fileJson("u-obs", "f109f-t-obs");
    const text = await readObject(obs.objectKey);
    // 断言的是**文件的字节**：文件一旦落地就脱离了界面的管辖。
    expect(text).not.toContain("原始转写的敏感正文");
    expect(text).not.toContain("f109f-m-raw");
    // 成对：能看的那条在里面。
    expect(text).toContain("公开的一句话");
  });
});

describe("messagesToJsonl 是纯函数", () => {
  it("一行一条，末尾有换行（wc -l 与消息数相等）", () => {
    const bytes = messagesToJsonl([
      {
        id: "m1", authorKind: "human", authorId: "u", agentId: null, body: "一",
        rawTranscript: false, visibilityScope: null, reviewPending: false,
        createdAt: "2026-07-31T00:00:00.000Z",
      },
      {
        id: "m2", authorKind: "agent", authorId: "a", agentId: "scout", body: "二",
        rawTranscript: false, visibilityScope: null, reviewPending: true,
        createdAt: "2026-07-31T00:00:01.000Z",
      },
    ]);
    const text = new TextDecoder().decode(bytes);
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    // 徽标走的是那个唯一的函数（I-13）——导出的证据文件与界面不得分家。
    expect(JSON.parse(lines[1]!).badges).toEqual(["review-pending"]);
    expect(JSON.parse(lines[0]!).badges).toEqual([]);
  });

  it("空会话产出零字节 —— 由调用方转成 FILE_NOT_MATERIALIZED，不落一个假文件", () => {
    expect(messagesToJsonl([]).byteLength).toBe(0);
  });
});

/* ─────────────────────────── helpers ─────────────────────────── */

function walk(root: string, prefix = ""): string[] {
  let entries: string[];
  try {
    entries = readdirSync(join(root, prefix));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(root, rel));
    else out.push(rel);
  }
  return out;
}
