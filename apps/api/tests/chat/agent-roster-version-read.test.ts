/**
 * #513 —— **读端口下发 `rosterVersion`**，打真实 Postgres。
 *
 * ## 它修的是什么
 *
 * `updateAgentRoster.in.expectedRosterVersion` 是**必填的乐观锁**
 * （`packages/contracts/src/chat.ts` 的 `updateAgentRoster.in`），而在 #513 之前
 * `rosterVersion` **只出现在写端口的出参** `updateAgentRoster.out`。⇒ 客户端只有在
 * 自己刚写过一次之后才知道当前版本号；**页面一刷新，内存里的版本号就没了**，
 * 下一次改编制无从填起 ⇒ 必然 409 `VERSION_CHANGED`。
 *
 * #513 把服务端**早已持有**的同一个 `chat_threads.roster_version`
 * （`apps/api/src/infrastructure/chat/pg-chat-repository.ts` 的 `findAgentRoster`
 * 已经 SELECT 出来了，只是 `application/chat/get-agent-panel.ts` 把它丢掉了）
 * 在读端口 `getAgentPanel.out` 也下发一次。**同一字段、同一事实源，不是第二个
 * 版本号概念。**
 *
 * ## 🟡 该契约面**待人类补签**
 *
 * `getAgentPanel.out` 加字段属新契约面。coord-main 在人类不在场时代裁「按既有
 * `chat` 束的自然延伸先做」，判据与 #489（`listThreads.out` 加 capabilities）同型，
 * 并同时把它**登记为待补签**——照 #496 `createTemplate` 的先例。
 * **没有任何 `design-signoff.md` 被改动**（那是人类的动作）。
 *
 * ## 为什么断言落在「与库里的值一致」而不是「等于某个常数」
 *
 * 只断 `rosterVersion === 1` 的话，一个把常量 1 硬编在出参里的实现也能过。
 * 这里每次都去 `chat_threads` 读一次真值来比，**再**断言它随每次编制变更而推进。
 *
 * ## 反证（PR 正文里贴了输出）
 *
 * 把 `get-agent-panel.ts` 里的 `rosterVersion: roster.rosterVersion` 摘掉、或改成
 * 常量 `0`，本文件的「与库一致」和「跨页面加载往返」两条必须**当场变红**。
 *
 * ## 范围诚实
 *
 * 本文件验的是**版本号读得回来**，不是「agent 真的执行并产生回复」（#414 + #413）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { z } from "zod";
import { chat as C } from "@repo/contracts";
import {
  addCapability, addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i513-rosterver";
const PROJECT = "proj-i513-rosterver";
const THREAD = "thread-i513-rosterver";
const FACILITATOR = "user-i513-facilitator";
const AGENT_A = "agent-i513-a";
const AGENT_B = "agent-i513-b";

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

function postRoster(
  userId: string,
  body: { add: string[]; remove: string[]; expectedRosterVersion: number },
) {
  return fetch(`${BASE}/chat/threads/${THREAD}/agents?projectId=${PROJECT}`, {
    method: "POST",
    headers: as(userId),
    body: JSON.stringify({ threadId: THREAD, ...body }),
  });
}

/**
 * 读一次面板，过契约 `.strict()` 校验后整包返回。
 * strict 很重要：多一个计划外的键（例如实现顺手塞了个 `version`）在这里就红。
 */
async function readPanel(userId: string): Promise<z.infer<typeof C.operations.getAgentPanel.out>> {
  const res = await fetch(
    `${BASE}/chat/threads/${THREAD}/agents?projectId=${PROJECT}`,
    { headers: as(userId) },
  );
  expect(res.status, "读编制面板").toBe(200);
  const body: unknown = await res.json();
  const parsed = C.operations.getAgentPanel.out.safeParse(body);
  expect(parsed.success, `getAgentPanel.out strict 校验失败：${JSON.stringify(parsed)}`).toBe(true);
  if (!parsed.success) throw new Error("unreachable");
  return parsed.data;
}

/** 库里 `chat_threads.roster_version` 的真值——断言的另一端，不是从响应体里抄的。 */
async function dbRosterVersion(): Promise<number> {
  return asApp(ORG, async (c) => {
    const r = await c.query<{ roster_version: number }>(
      "SELECT roster_version FROM chat_threads WHERE id = $1 AND org_id = $2",
      [THREAD, ORG],
    );
    const v = r.rows[0]?.roster_version;
    expect(v, "fixture 线程必须存在").not.toBeUndefined();
    return Number(v);
  });
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
  await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: [] });
  await addOrgMember(ORG, FACILITATOR, "lead", null);
  await addProjectMember(ORG, PROJECT, FACILITATOR, "facilitator", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT,
    visibilityScope: "plenary", createdBy: FACILITATOR, phase: "research", title: "编制版本号",
  });
  /**
   * #619：组织 agent 目录不再是 `org_agents`（0032 的占位目录），
   * `add` 的越范围判定读的是 `capability_listings（kind='agent', enabled=true）`。
   */
  for (const [id, abbr] of [[AGENT_A, "AA"], [AGENT_B, "BB"]] as const) {
    await addCapability({ orgId: ORG, id, kind: "agent", name: `名字 ${id}`, abbr, duty: "职责非空（I-17）" });
  }
});

describe("#513 getAgentPanel 下发 rosterVersion（真实 Postgres）", () => {
  it("读端口返回的 rosterVersion 与库里 chat_threads.roster_version 一致", async () => {
    expect(await dbRosterVersion(), "新线程的 DDL 默认值").toBe(0);
    expect((await readPanel(FACILITATOR)).rosterVersion).toBe(await dbRosterVersion());
  });

  it("改一次编制后再读：版本号跟着变，两端仍然一致", async () => {
    const before = (await readPanel(FACILITATOR)).rosterVersion;

    const added = await postRoster(FACILITATOR, { add: [AGENT_A], remove: [], expectedRosterVersion: before });
    expect(added.status).toBe(200);

    const after = await readPanel(FACILITATOR);
    // ① 真的推进了——常量实现在这条下红。
    expect(after.rosterVersion).toBeGreaterThan(before);
    // ② 推进到的是**库里那个值**，不是前端/服务端各自 +1 猜的。
    expect(after.rosterVersion).toBe(await dbRosterVersion());
    // ③ 与写端口同一事实源：写端口刚回过的版本号，读端口读回来必须是同一个。
    const addedOut = C.operations.updateAgentRoster.out.parse(await added.clone().json());
    expect(after.rosterVersion).toBe(addedOut.rosterVersion);
  });

  it("跨「页面加载」的往返：只凭读端口拿到的版本号就能改编制（#513 的正题）", async () => {
    // 第一次写：模拟首屏，版本号来自读端口。
    const first = (await readPanel(FACILITATOR)).rosterVersion;
    expect((await postRoster(FACILITATOR, {
      add: [AGENT_A], remove: [], expectedRosterVersion: first,
    })).status).toBe(200);

    /* ⚠ 这里是本 issue 的核心：**丢掉上一步的全部内存状态**（模拟浏览器刷新），
     *   只重新读一次面板。在 #513 之前这一步拿不到版本号，客户端只能从 DDL 默认值
     *   0 起步，而库里已经是 1 ⇒ 下一次写必然 409。
     *
     *   ⛔ 明令禁止的兜底：「读不到就传 0 / -1 / 省略」。乐观锁的意义就是拒绝盲写，
     *      兜底等于把锁摘了。所以这里**只用读回来的那个值**。 */
    const afterReload = (await readPanel(FACILITATOR)).rosterVersion;
    expect(afterReload, "刷新后读回来的版本号必须是库里的真值，不是 0").toBe(await dbRosterVersion());
    expect(afterReload).not.toBe(first);

    const second = await postRoster(FACILITATOR, {
      add: [], remove: [AGENT_A], expectedRosterVersion: afterReload,
    });
    expect(second.status, "凭读端口的版本号改编制必须成功，不再 409").toBe(200);
    expect((await readPanel(FACILITATOR)).agents.map((a) => a.id)).toEqual([]);
  });

  it("乐观锁没被摘掉：拿过期版本号照样 409（本 issue 不放宽这条）", async () => {
    const v0 = (await readPanel(FACILITATOR)).rosterVersion;
    expect((await postRoster(FACILITATOR, { add: [AGENT_A], remove: [], expectedRosterVersion: v0 })).status).toBe(200);

    const stale = await postRoster(FACILITATOR, { add: [AGENT_B], remove: [], expectedRosterVersion: v0 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reasonCode: "VERSION_CHANGED" });
    expect((await readPanel(FACILITATOR)).agents.map((a) => a.id)).toEqual([AGENT_A]);
  });
});
