/**
 * F109 —— 线程卡徽标**同源**（chat 束 domain.md I-13 / I-14 / I-15，uc-8-1 R7）。
 *
 * ## 这个文件里最重要的一条断言不是数值断言
 *
 * I-13 说「两处数值恒相等」。**一个「两处各算一次、结果碰巧相等」的实现能通过任何
 * 数值断言**——它今天相等，明天有人改了其中一处的规则就不相等了，而那天没有测试会红。
 * 所以这里有一条**静态断言**：全仓 `apps/api/src` 里，决定「一条消息算不算待复核」
 * 的地方只有 `domain/chat/thread-badges.ts`，读 `review_pending` 这一列的地方只有
 * 仓储的那一次 SELECT。第二处出现，无论它算得对不对，都当场变红。
 *
 * ## I-14 的用例是刻意反直觉的
 *
 * 「最后消息 1 秒前 + 转录已停 ⇒ 徽标不出现」。一个按最后活动时间推断的实现在
 * 「有新消息 ⇒ 转录中」这个更自然的用例上是绿的，只有这一条能把它抓出来。
 *
 * ## 每条拒绝都是成对的
 *
 * 沿用 `visibility-two-layer-intersection.test.ts` 的规矩：一个把所有人都拒掉的
 * 列表实现同样能满足「别组线程不在响应里」。所以每一条「不在」旁边都有一条「在」。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { chat as C } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread, addTranscriptSession } from "../support/chat-db";
import { messageBadges, reviewPendingCount } from "../../src/domain/chat/thread-badges";
import { threadGroupLabel } from "../../src/domain/chat/thread-grouping";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f109badge";
const PROJECT = "proj-f109badge";
let BASE: string;
let app: NestExpressApplication;
let fx: Awaited<ReturnType<typeof seedOrg>>;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

const listThreads = (userId: string, query = "") =>
  fetch(`${BASE}/chat/projects/${PROJECT}/threads${query}`, { headers: as(userId) });

const readThread = (userId: string, threadId: string) =>
  fetch(`${BASE}/chat/threads/${threadId}?projectId=${PROJECT}`, { headers: as(userId) });

type ListOut = { groups: { label: string; cards: { id: string; badges: string[]; agentSummary: string }[] }[] };
type MutateOut = {
  threadId: string;
  version: number;
  auditEventId: string;
  impactScope: string | null;
};
const mutateJson = async (userId: string, body: Record<string, unknown>): Promise<MutateOut> =>
  (await (await mutate(userId, body)).json()) as MutateOut;
const allCards = (body: ListOut) => body.groups.flatMap((g) => g.cards);
const cardOf = (body: ListOut, id: string) => allCards(body).find((c) => c.id === id);

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

  // 全场线程：3 条待复核 + 2 条不待复核。徽标的 N 就是它。
  await addChatThread({
    orgId: ORG, id: "f109b-t-plenary", projectId: PROJECT, groupId: null,
    visibilityScope: "plenary", createdBy: "u-fac", title: "欧洲储能进入策略 · 假设梳理",
  });
  for (const i of [1, 2, 3]) {
    await addChatMessage({
      orgId: ORG, id: `f109b-m-p-${i}`, threadId: "f109b-t-plenary", authorId: "a-scout",
      authorKind: "agent", agentId: "scout", body: `待复核 ${i}`, reviewPending: true,
    });
  }
  await addChatMessage({
    orgId: ORG, id: "f109b-m-p-4", threadId: "f109b-t-plenary", authorId: "u-fac", body: "已看过",
  });
  await addChatMessage({
    orgId: ORG, id: "f109b-m-p-5", threadId: "f109b-t-plenary", authorId: "a-echo",
    authorKind: "agent", agentId: "echo", body: "另一个 agent 也发过言",
  });

  // 第二组的共享线程。u-mem1（第一组）恒不可见。
  await addChatThread({
    orgId: ORG, id: "f109b-t-g2", projectId: PROJECT, groupId: fx.groups.g2!,
    visibilityScope: "group-shared", createdBy: "u-mem2", title: "第二组的线程",
  });
  await addChatMessage({
    orgId: ORG, id: "f109b-m-g2-1", threadId: "f109b-t-g2", authorId: "u-mem2", body: "别组内容",
    reviewPending: true,
  });
}, 60_000);

describe("I-13 徽标同源：线程卡的 N 与消息头的 N 取自同一处", () => {
  it("列表的 review-pending 徽标与详情里带该徽标的消息数由同一个函数决定", async () => {
    const list = (await (await listThreads("u-fac")).json()) as ListOut;
    const detail = (await (await readThread("u-fac", "f109b-t-plenary")).json()) as {
      messages: { id: string; badges: string[] }[];
    };

    const detailCount = detail.messages.filter((m) => m.badges.includes("review-pending")).length;
    expect(detailCount).toBe(3);

    // 同一批消息交给那个唯一的函数，结果必须与详情逐条一致——
    // 详情不是「另算了一遍」，它就是 `messageBadges` 的逐条输出。
    const viaDomain = reviewPendingCount(
      detail.messages.map((m) => ({ id: m.id, reviewPending: m.badges.includes("review-pending") })),
    );
    expect(viaDomain).toBe(detailCount);

    const card = cardOf(list, "f109b-t-plenary");
    expect(card).toBeDefined();
    // ⚠ 契约的 `ThreadCard` 没有数值字段（见下面那条 it 的说明），
    //   所以这里能断言的是「有没有」，而「有没有」必须与 N>0 严格同向。
    expect(card!.badges.includes("review-pending")).toBe(detailCount > 0);
    expect(C.ThreadCard.safeParse(card).success).toBe(true);
  });

  it("N 归零时两处同时消失（不是列表还留着一个陈旧徽标）", async () => {
    await addChatThread({
      orgId: ORG, id: "f109b-t-clean", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac", title: "没有待复核的线程",
    });
    await addChatMessage({
      orgId: ORG, id: "f109b-m-clean", threadId: "f109b-t-clean", authorId: "u-fac", body: "干净",
    });
    const list = (await (await listThreads("u-fac")).json()) as ListOut;
    const detail = (await (await readThread("u-fac", "f109b-t-clean")).json()) as {
      messages: { badges: string[] }[];
    };
    expect(detail.messages.every((m) => m.badges.length === 0)).toBe(true);
    expect(cardOf(list, "f109b-t-clean")!.badges).toEqual([]);
  });

  /**
   * **这一条是本文件的门控**，其余数值断言都可以被「两处各算一次」骗过去。
   *
   * 判定点必须只有一个。允许出现 `review_pending` / `reviewPending` 字面量的地方：
   *   · `domain/chat/thread-badges.ts` —— 那个唯一的判定；
   *   · `application/chat/ports.ts`     —— 类型声明；
   *   · `infrastructure/chat/pg-chat-repository.ts` —— 唯一一次 SELECT。
   * 任何第四个文件出现它，就是第二处在决定「什么算待复核」。
   */
  it("[静态] 全仓只有一处决定「一条消息算不算待复核」", () => {
    const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
    const ALLOWED = new Set([
      "domain/chat/thread-badges.ts",
      "application/chat/ports.ts",
      "infrastructure/chat/pg-chat-repository.ts",
    ]);
    const offenders: string[] = [];
    for (const rel of walk(SRC)) {
      if (!rel.endsWith(".ts")) continue;
      // ⚠ **去掉注释再扫**。写着「不要在这里判 `m.reviewPending`」的注释不是第二处判定，
      //   而带注释扫会把每一条解释规则的文字都算成违规——于是唯一能让门变绿的办法
      //   就是把解释删掉。一个惩罚解释的门控最终会得到一份没有解释的代码。
      const code = stripComments(readFileSync(join(SRC, rel), "utf8"));
      if (!/review[_P]ending/i.test(code)) continue;
      if (!ALLOWED.has(rel)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);

    // 非空转：允许集合里的三个文件确实都含有它。集合写错（比如路径分隔符不对）
    // 会让上面那条断言在「什么都没扫到」的情况下变绿——本仓已九次栽在这种全绿空转上。
    for (const rel of ALLOWED) {
      expect(stripComments(readFileSync(join(SRC, rel), "utf8"))).toMatch(/review[_P]ending/i);
    }
  });

  it("[静态] `review-pending` 这个取值只由 messageBadges 产出", () => {
    const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
    /**
     * ⚠ **同名不同义，已登记**：`application/retrieval/ports.ts` 的
     *   `Lifecycle = "effective" | "review-pending" | ...` 讲的是**材料索引的生命周期**
     *   （F10 / 检索束），与对话消息的「待复核」徽标毫无关系——两者恰好同码。
     *
     *   它**不是**第二个来源，所以在这里显式豁免而不是把门放宽。
     *   但它是本仓踩过五次的那类坑（同一个字符串在两处有两个含义）的又一实例，
     *   已随 F109 一并上报，等人类决定是否给其中一侧改名。
     */
    const HOMONYMS = new Set(["application/retrieval/ports.ts"]);
    const offenders = walk(SRC).filter(
      (rel) =>
        rel.endsWith(".ts") &&
        rel !== "domain/chat/thread-badges.ts" &&
        !HOMONYMS.has(rel) &&
        stripComments(readFileSync(join(SRC, rel), "utf8")).includes('"review-pending"'),
    );
    expect(offenders).toEqual([]);
    expect(
      stripComments(readFileSync(join(SRC, "domain/chat/thread-badges.ts"), "utf8")),
    ).toContain('"review-pending"');
    // 非空转：豁免项确实还在，且确实含有那个字面量。它哪天被改名了，这条会红，
    // 提醒把豁免删掉——一个没人维护的豁免会慢慢变成一个真的洞。
    for (const rel of HOMONYMS) {
      expect(readFileSync(join(SRC, rel), "utf8")).toContain('"review-pending"');
    }
  });
});

describe("I-13 计数不泄露：只数这个人看得见的消息", () => {
  it("观察者读不到的待复核消息不进它的徽标（否则徽标是侧信道）", async () => {
    await addChatThread({
      orgId: ORG, id: "f109b-t-mixed", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac", title: "混合线程",
    });
    // 原始转写：观察者读不到（I-5），但它是待复核的。
    await addChatMessage({
      orgId: ORG, id: "f109b-m-mixed-raw", threadId: "f109b-t-mixed", authorId: "u-fac",
      body: "原始转写正文", rawTranscript: true, reviewPending: true,
    });
    await addChatMessage({
      orgId: ORG, id: "f109b-m-mixed-ok", threadId: "f109b-t-mixed", authorId: "u-fac", body: "普通消息",
    });

    const facCard = cardOf((await (await listThreads("u-fac")).json()) as ListOut, "f109b-t-mixed")!;
    const obsCard = cardOf((await (await listThreads("u-obs")).json()) as ListOut, "f109b-t-mixed")!;

    // 成对：引导师看得到那条 ⇒ 徽标在；观察者看不到 ⇒ 徽标不在。
    // 只断言后者的话，一个「谁的徽标都不显示」的实现也是绿的。
    expect(facCard.badges).toContain("review-pending");
    expect(obsCard.badges).not.toContain("review-pending");
  });
});

describe("I-14 `● 转录中` 绑定真实转录状态，不由最后消息时间推断", () => {
  it("在录 ⇒ transcribing 为真；停止后为假；最后消息很新也不复活", async () => {
    await addChatThread({
      orgId: ORG, id: "f109b-t-live", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac", title: "正在转录",
    });
    await addChatMessage({
      orgId: ORG, id: "f109b-m-live", threadId: "f109b-t-live", authorId: "u-fac", body: "刚刚说的话",
    });
    await addTranscriptSession({ orgId: ORG, id: "ts-live", threadId: "f109b-t-live" });

    // 「最后消息就在刚刚，但转录已经停了」—— 按时间推断的实现在这里会说「转录中」。
    await addChatThread({
      orgId: ORG, id: "f109b-t-stopped", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac", title: "刚说完话但转录已停",
    });
    await addChatMessage({
      orgId: ORG, id: "f109b-m-stopped", threadId: "f109b-t-stopped", authorId: "u-fac", body: "一秒前的消息",
    });
    await addTranscriptSession({
      orgId: ORG, id: "ts-stopped", threadId: "f109b-t-stopped", stopped: true,
    });

    const rows = await threadRows();
    expect(rows.get("f109b-t-live")).toBe(true);
    expect(rows.get("f109b-t-stopped")).toBe(false);
  });
});

describe("I-15 归档线程默认不返回，显式筛选可读", () => {
  it("默认列表不含归档线程；?includeArchived=true 含它", async () => {
    await addChatThread({
      orgId: ORG, id: "f109b-t-arch", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac", title: "已归档", archived: true,
    });
    await addChatMessage({
      orgId: ORG, id: "f109b-m-arch", threadId: "f109b-t-arch", authorId: "u-fac", body: "归档内容",
    });

    const def = (await (await listThreads("u-fac")).json()) as ListOut;
    expect(cardOf(def, "f109b-t-arch")).toBeUndefined();
    // 成对：默认不在 ≠ 永远取不到。只断言前者的话，一个「归档线程彻底消失」的
    // 实现也是绿的，而 I-15 说的是「显式筛选可读」。
    const explicit = (await (await listThreads("u-fac", "?includeArchived=true")).json()) as ListOut;
    expect(cardOf(explicit, "f109b-t-arch")).toBeDefined();
  });

  it("归档线程的全部写操作被拒（改名）", async () => {
    await addChatThread({
      orgId: ORG, id: "f109b-t-arch2", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac", title: "已归档", archived: true,
    });
    const r = await mutate("u-fac", {
      op: "rename", projectId: PROJECT, threadId: "f109b-t-arch2", groupId: null,
      title: "改个名", visibilityScope: null, expectedVersion: 0, reason: null,
    });
    expect(r.status).toBe(403);
  });
});

describe("列表继承 F108 的服务端可见性过滤（不是前端不渲染）", () => {
  it("别组线程不在响应载荷里，而本组的在", async () => {
    const mem1 = (await (await listThreads("u-mem1")).json()) as ListOut;
    const raw = JSON.stringify(mem1);
    // 断言的是**响应体的字节**：前端隐藏了什么与这条无关。
    expect(raw).not.toContain("f109b-t-g2");
    expect(raw).not.toContain("第二组的线程");
    // 成对：一个把所有线程都滤掉的实现也满足上面两条。
    expect(cardOf(mem1, "f109b-t-plenary")).toBeDefined();

    const mem2 = (await (await listThreads("u-mem2")).json()) as ListOut;
    expect(cardOf(mem2, "f109b-t-g2")).toBeDefined();
  });

  it("不泄露条目数：无可见线程时返回空组，而不是「还有 N 条」", async () => {
    await addOrgMember(ORG, "u-outsider", "consultant", fx.teams.energy!);
    // 组织成员但**没有项目角色**：两层交集的项目层为假 ⇒ 一条都看不到。
    const body = (await (await listThreads("u-outsider")).json()) as ListOut;
    expect(body.groups).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/[0-9]/);
  });
});

describe("分组：只有今天 / 本周两组（待裁决第 11 条）", () => {
  it("本周之前的线程不出现在任何一组里", async () => {
    const longAgo = new Date(Date.now() - 60 * 86_400_000);
    await addChatThread({
      orgId: ORG, id: "f109b-t-old", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac", title: "两个月前",
      lastActivityAt: longAgo,
    });
    const body = (await (await listThreads("u-fac")).json()) as ListOut;
    expect(body.groups.map((g) => g.label)).toEqual(["今天", "本周"]);
    expect(cardOf(body, "f109b-t-old")).toBeUndefined();
    // 成对：今天的那条在。
    expect(cardOf(body, "f109b-t-plenary")).toBeDefined();
  });

  it("[纯函数] 跨日/跨周边界", () => {
    const now = new Date("2026-07-31T10:00:00Z"); // 周五
    expect(threadGroupLabel(new Date("2026-07-31T23:59:59Z"), now)).toBe("今天");
    expect(threadGroupLabel(new Date("2026-07-27T00:00:00Z"), now)).toBe("本周"); // 本周一
    expect(threadGroupLabel(new Date("2026-07-26T23:59:59Z"), now)).toBeNull(); // 上周日
  });
});

describe("新建 / 改名 / 删除", () => {
  it("新建后出现在列表里；改名后标题变；删除返回影响范围", async () => {
    const created = await mutateJson("u-fac", {
      op: "create", projectId: PROJECT, threadId: null, groupId: null,
      title: "新线程", visibilityScope: "plenary", expectedVersion: null, reason: null,
    });
    expect(created.threadId).toBeTruthy();

    const afterCreate = (await (await listThreads("u-fac")).json()) as ListOut;
    expect(cardOf(afterCreate, created.threadId)).toBeDefined();

    const renamed = await mutateJson("u-fac", {
      op: "rename", projectId: PROJECT, threadId: created.threadId, groupId: null,
      title: "改过的名字", visibilityScope: null, expectedVersion: 0, reason: null,
    });
    expect(renamed.version).toBe(1);

    const deleted = await mutateJson("u-fac", {
      op: "delete", projectId: PROJECT, threadId: created.threadId, groupId: null,
      title: null, visibilityScope: null, expectedVersion: 1, reason: "测试删除",
    });
    // 删除是可追溯动作：影响范围与审计事件都必须真的有。
    expect(deleted.impactScope).toMatch(/条消息/);
    expect(deleted.auditEventId).toBeTruthy();

    const afterDelete = (await (await listThreads("u-fac")).json()) as ListOut;
    expect(cardOf(afterDelete, created.threadId)).toBeUndefined();
  });

  it("并发：expectedVersion 不匹配 ⇒ 409，不静默覆盖", async () => {
    const created = await mutateJson("u-fac", {
      op: "create", projectId: PROJECT, threadId: null, groupId: null,
      title: "并发线程", visibilityScope: "plenary", expectedVersion: null, reason: null,
    });
    const first = await mutate("u-fac", {
      op: "rename", projectId: PROJECT, threadId: created.threadId, groupId: null,
      title: "甲改的", visibilityScope: null, expectedVersion: 0, reason: null,
    });
    expect(first.status).toBe(200);
    // 乙拿着旧版本号来 —— 必须被拒，而不是把甲的改动盖掉。
    const second = await mutate("u-fac", {
      op: "rename", projectId: PROJECT, threadId: created.threadId, groupId: null,
      title: "乙改的", visibilityScope: null, expectedVersion: 0, reason: null,
    });
    expect(second.status).toBe(409);
    const detail = (await (await readThread("u-fac", created.threadId)).json()) as {
      thread: { version: number };
    };
    expect(detail.thread.version).toBe(1);
  });

  it("观察者的写请求被接口拒绝（不只是按钮不渲染）", async () => {
    const r = await mutate("u-obs", {
      op: "create", projectId: PROJECT, threadId: null, groupId: null,
      title: "观察者不该建得出来", visibilityScope: "plenary",
      expectedVersion: null, reason: null,
    });
    expect(r.status).toBe(403);
    // 成对：同一个请求换引导师来必须成功——否则「谁都建不了」也能通过上一条。
    const ok = await mutate("u-fac", {
      op: "create", projectId: PROJECT, threadId: null, groupId: null,
      title: "引导师建得出来", visibilityScope: "plenary",
      expectedVersion: null, reason: null,
    });
    expect(ok.status).toBe(200);
  });

  it("空白标题 ⇒ 422（TITLE_INVALID），不是建出一条没有名字的线程", async () => {
    const r = await mutate("u-fac", {
      op: "create", projectId: PROJECT, threadId: null, groupId: null,
      title: "   ", visibilityScope: "plenary", expectedVersion: null, reason: null,
    });
    expect(r.status).toBe(422);
  });
});

describe("`messageBadges` 是纯函数，取值在契约的封闭枚举内", () => {
  it("产出的每个取值都能过契约的 safeParse；未声明的取值不能", () => {
    for (const b of messageBadges({ id: "x", reviewPending: true, degraded: true })) {
      expect(C.MessageBadge.safeParse(b).success).toBe(true);
    }
    expect(C.MessageBadge.safeParse("transcribing").success).toBe(false);
  });
});

/* ─────────────────────────── helpers ─────────────────────────── */

function mutate(userId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE}/chat/threads/mutate`, {
    method: "POST", headers: as(userId), body: JSON.stringify(body),
  });
}

/**
 * 直接读仓储层的 `transcribing` 事实。
 *
 * ⚠ **不是绕过接口偷懒**：契约的 `ThreadCard.badges` 取值域是 `MessageBadge`
 *   （`degraded` | `review-pending`），`● 转录中` 与 `已归档` **在契约的线程卡上
 *   没有落点**——而 F109 的 `user_visible_behavior` 逐字要求这两个徽标。
 *   契约由人改（ADR-020），所以这里断言的是**服务端确实按真实转录状态算出了它**，
 *   而不是把它硬塞进某个自由字符串冒充结构化字段。缺口原样上报。
 */
async function threadRows(): Promise<Map<string, boolean>> {
  const { PgChatRepository } = await import("../../src/infrastructure/chat/pg-chat-repository");
  const { DATABASE_PORT } = await import("../../src/application/ports/database.port");
  const { toOrgId } = await import("../../src/domain/org-id");
  const db = app.get(DATABASE_PORT);
  const repo = new PgChatRepository(db);
  const rows = await repo.listProjectThreads(toOrgId(ORG), PROJECT, { includeArchived: true });
  return new Map(rows.map((r) => [r.threadId, r.transcribing]));
}

/**
 * 去掉 `//` 与 `/* *\/` 注释。**故意粗糙**：它只服务于上面两条静态门控，
 * 而那两条门控的判据是「代码里还提不提这个名字」，不需要一个真的 parser。
 * 唯一要避免的误伤是「注释里解释规则」，这个函数正好只做这件事。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, prefix))) {
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(root, rel));
    else out.push(rel);
  }
  return out;
}
