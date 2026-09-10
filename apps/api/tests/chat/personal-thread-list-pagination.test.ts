/**
 * issue #3356 —— 左侧对话列表分页：**真栈**（HTTP → controller → application →
 * resolveVisibility → PostgreSQL）断言。
 *
 * ## 为什么判据必须在这一层，不在 DOM 上
 *
 * 人类的需求原话是「不要一次全部加载出来」。「界面上只显示了 30 条」这个断言
 * **前端截断 + 后端仍然全量返回**也能轻松通过，而用户真正要解决的问题（一次全拉）
 * 原封不动——issue 里点名这是本仓反复出现的假修法形状。所以这里判的是
 * **HTTP 响应体里到底有几张卡片**、**游标翻页有没有重复/丢失**，一个 DOM 断言都没有。
 *
 * ## 五条
 *
 * ① 首屏不带任何参数 ⇒ 响应里恰好 `THREAD_PAGE_SIZE` 张卡片（不是 75 张），
 *    且 `nextCursor` 非空。
 * ② 顺着 `nextCursor` 翻到底 ⇒ 取回的 id 集合与播种的 75 条**逐一相等**，
 *    且**零重复**。（"不重复、不丢"两件事分别断言：只断言集合相等看不见重复，
 *    只断言无重复看不见丢失。）
 * ③ 最后一页 `nextCursor === null` ——「全部加载完后入口消失」的唯一事实源。
 * ④ 搜索命中的是**还没被翻出来的**那一页的对话 ⇒ 说明 `q` 在服务端过滤，
 *    不是在已加载的 30 条里过滤。这条是 issue 点名的陷阱。
 * ⑤ 翻页途中有对话被顶到最前（真实场景：收到新消息 ⇒ `last_activity_at` 跳到 now）
 *    ⇒ 第二页**不重复**第一页已经给过的任何一条。这一条正是「用 offset 会怎样」
 *    的反面：offset=30 在同样的事件下必然重复一条。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { chat as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-thread-page";
const PROJECT = "proj-thread-page-unused"; // seedOrg 要求非空；本文件只建个人线程
const OWNER = "u-page-owner";

/** 播种条数：刻意**不是** `THREAD_PAGE_SIZE` 的整数倍，最后一页因此是半页。 */
const SEEDED = 75;

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({ "x-kernel-test-principal": `${userId}:${ORG}` });

/** 第 i 条（i=0 最新）。时间刻意跨「今天 / 本周 / 更早」三组，见 ④ 的分组断言。 */
const threadId = (i: number) => `pt-${String(i).padStart(3, "0")}`;
const threadTitle = (i: number) => `对话-${String(i).padStart(3, "0")}`;

interface ListOut {
  groups: { label: string; cards: { id: string; title: string }[] }[];
  capabilities: string[];
  nextCursor: string | null;
}

async function list(params: Record<string, string> = {}): Promise<ListOut> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/chat/threads${qs ? `?${qs}` : ""}`, { headers: as(OWNER) });
  expect(res.status).toBe(200);
  return (await res.json()) as ListOut;
}

const idsOf = (out: ListOut): string[] => out.groups.flatMap((g) => g.cards.map((c) => c.id));

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
  const now = Date.now();
  for (let i = 0; i < SEEDED; i += 1) {
    await addChatThread({
      orgId: ORG,
      id: threadId(i),
      projectId: null,
      groupId: null,
      visibilityScope: "private",
      createdBy: OWNER,
      title: threadTitle(i),
      // 每条比上一条早 6 小时 ⇒ 前 4 条落在「今天」，其余散进「本周」和「更早」。
      // 分组边界因此**必然**横跨分页边界（第 30/31 条不在同一组），这正是要验的形状。
      lastActivityAt: new Date(now - i * 6 * 3600_000),
    });
  }
});

describe("issue #3356 · 个人对话列表分页（真栈）", () => {
  it("① 首屏请求只取一页——响应体里就是 30 张卡片，不是 75 张", async () => {
    const first = await list();
    expect(idsOf(first)).toHaveLength(C.THREAD_PAGE_SIZE);
    // 判的是**服务端返回条数**：前端截断 + 后端全量返回过不了这一条。
    expect(idsOf(first).length).toBeLessThan(SEEDED);
    expect(first.nextCursor).not.toBeNull();
    // 最新的一条必然在首屏（排序是 last_activity_at DESC）。
    expect(idsOf(first)[0]).toBe(threadId(0));
  });

  it("② 顺着游标翻到底：不重复、不丢——集合与播种的 75 条逐一相等", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: ListOut = await list(cursor === null ? {} : { cursor });
      pages += 1;
      expect(pages).toBeLessThanOrEqual(10); // 防死循环：真值是 3
      seen.push(...idsOf(page));
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(pages).toBe(Math.ceil(SEEDED / C.THREAD_PAGE_SIZE)); // 75 / 30 ⇒ 3 页
    // 不重复：数组长度 === 去重后长度。（只断言集合相等看不见重复。）
    expect(seen).toHaveLength(new Set(seen).size);
    // 不丢：集合与播种的完全相等。（只断言无重复看不见丢失。）
    expect([...seen].sort()).toEqual(Array.from({ length: SEEDED }, (_, i) => threadId(i)).sort());
    // 顺序也没乱：整体仍是 last_activity_at DESC。
    expect(seen).toEqual(Array.from({ length: SEEDED }, (_, i) => threadId(i)));
  });

  it("③ 最后一页 nextCursor 为 null——「全部加载完，入口消失」，不是点了没反应", async () => {
    let cursor: string | null = null;
    const counts: number[] = [];
    for (let p = 0; p < 3; p += 1) {
      const page: ListOut = await list(cursor === null ? {} : { cursor });
      counts.push(idsOf(page).length);
      cursor = page.nextCursor;
    }
    expect(counts).toEqual([30, 30, 15]); // 最后一页是半页
    expect(cursor).toBeNull();
  });

  it("④ 搜索在服务端跑：能搜到还没翻出来的那一页的对话（否则用户会以为「搜不到 = 没有」）", async () => {
    const first = await list();
    const buried = threadId(70); // 第三页才会出现的一条
    expect(idsOf(first)).not.toContain(buried);

    const found = await list({ q: threadTitle(70) });
    expect(idsOf(found)).toEqual([buried]);
    expect(found.nextCursor).toBeNull(); // 只有一条 ⇒ 没有下一页

    // 搜索结果本身也分页，不是「搜索就全返回」。
    const many = await list({ q: "对话-0" }); // 对话-000..对话-074 里前缀命中 10 条
    expect(idsOf(many).length).toBeLessThanOrEqual(C.THREAD_PAGE_SIZE);
  });

  /**
   * ⑥ 反证 A（第一版）暴露的缺口，补的这一条。
   *
   * 第一次做「服务端忽略分页参数」的反证时，我把 SQL 的 `LIMIT` 撑成 10 万、
   * 但**保留了 application 层那次 `slice(0, limit)`**——五条断言**全绿**。
   * 也就是说：上面①~⑤ 只看得见「HTTP 响应里有几条」，看不见「数据库到底被要了
   * 几行」。而「不要一次全部加载」这句需求里，被全量拉的那一趟正是 SQL 这一趟。
   *
   * 这一条直接打**仓储边界**：给 5 就最多回 5 行。它是唯一会因为「SQL 拉全量、
   * 上层再截断」而变红的断言。
   */
  it("⑥ 全量拉取被挡在 SQL 那一层，不是「拉回来再截断」——仓储给 5 就最多回 5 行", async () => {
    const { PgChatRepository } = await import("../../src/infrastructure/chat/pg-chat-repository");
    // 一个只把 withTenant 转接到测试用租户连接的最小 DatabasePort——跑的是**真 SQL**，
    // 不是替身查询：这一条要证的正是那句 SQL 自己带没带 LIMIT。
    const db = {
      withTenant: <T,>(orgId: string, fn: (s: { query: (t: string, p?: unknown[]) => Promise<unknown> }) => Promise<T>) =>
        asApp(orgId, (c) => fn({ query: (t, p) => c.query(t, (p ?? []) as never[]) })),
    };
    const repo = new PgChatRepository(db as never);
    const rows = await repo.listPersonalThreads(ORG as never, OWNER, {
      includeArchived: false, limit: 5, after: null, titleQuery: null,
    });
    expect(rows).toHaveLength(5);
  });

  it("⑤ 翻页途中有对话被顶到最前（收到新消息），第二页不重复第一页给过的任何一条", async () => {
    const first = await list();
    const firstIds = idsOf(first);

    // 真实事件：一条很老的对话（第三页那条）收到新消息 ⇒ last_activity_at 跳到 now。
    // 用 offset=30 取第二页时，这次上浮会把原来的第 30 行整体后移一格，于是第一页
    // 的最后一条**必然在第二页里再出现一次**。游标不会。
    await asApp(ORG, (c) =>
      c.query(`UPDATE chat_threads SET last_activity_at = now() WHERE org_id = $1 AND id = $2`, [ORG, threadId(70)]),
    );

    const second = await list({ cursor: first.nextCursor! });
    const overlap = idsOf(second).filter((id) => firstIds.includes(id));
    expect(overlap).toEqual([]);
  });
});
