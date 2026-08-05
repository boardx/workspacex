/**
 * #467（roster 半边）—— 编制的**增删往返**打真实 Postgres。
 *
 * 加一个 agent → `getAgentPanel` 读得到它 → 移出 → 读不到了。
 * 全程 browser 之外的那一半：真实 HTTP 控制器 → application → `PgChatRepository`
 * → `chat_thread_agents` / `chat_threads.roster_version`，中途不塞假数据。
 *
 * ## ⚠ 测试先行的诚实说明
 *
 * 本文件**不是**「先红后绿」的那一份：`POST /chat/threads/:threadId/agents` 从 F110
 * 起就已经实现，本文件是**给一条已实现但零测试、零调用方的路由补特征测试**。
 * #467 真正先红后绿的是前端那三份（`tests/chat-roster-api.test.ts`、
 * `tests/ui/chat-roster-mutate.test.tsx`、`tests/session/chat-roster-route-no-mock.test.ts`），
 * 红证据在 PR 正文里。把这份也说成「先红」会是一次假证据。
 *
 * 它的反证在 PR 正文里：把 `pg-chat-repository.ts` 的 `DELETE FROM chat_thread_agents`
 * 改成空操作，「移出后读不到」必须当场变红。
 *
 * ## 范围诚实
 *
 * 这里验的是**编制关系**，不是「agent 真的执行并产生回复」（#414 + #413）。
 * 编制里有一个 agent ≠ 它能跑。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { chat as C } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i467-roster";
const PROJECT = "proj-i467-roster";
const THREAD = "thread-i467-roster";
const FACILITATOR = "user-i467-facilitator";
const OBSERVER = "user-i467-observer";
const OUTSIDER = "user-i467-outsider";
const AGENT_A = "agent-i467-a";
const AGENT_B = "agent-i467-b";

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

function getPanel(userId: string) {
  return fetch(`${BASE}/chat/threads/${THREAD}/agents?projectId=${PROJECT}`, { headers: as(userId) });
}

/** 读一次面板里的 agent id 集合——断言只看「在不在编制里」，不依赖顺序。 */
async function rosterIds(userId: string): Promise<string[]> {
  const res = await getPanel(userId);
  expect(res.status, "读编制面板").toBe(200);
  const body: unknown = await res.json();
  const parsed = C.operations.getAgentPanel.out.safeParse(body);
  expect(parsed.success, `getAgentPanel.out strict 校验失败：${JSON.stringify(parsed)}`).toBe(true);
  return (parsed.success ? parsed.data.agents : []).map((a) => a.id).sort();
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
  await addOrgMember(ORG, OBSERVER, "consultant", null);
  await addProjectMember(ORG, PROJECT, OBSERVER, "observer", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT,
    visibilityScope: "plenary", createdBy: FACILITATOR, phase: "research", title: "编制往返",
  });
  // 组织 agent 目录（`org_agents`，0032 的占位目录）：`add` 的越范围判定读的就是它。
  await asApp(ORG, async (c) => {
    for (const [id, abbr] of [[AGENT_A, "AA"], [AGENT_B, "BB"]]) {
      await c.query(
        "INSERT INTO org_agents (org_id, agent_id, abbr, name, duty) VALUES ($1,$2,$3,$4,$5)",
        [ORG, id, abbr, `名字 ${id}`, "职责非空（I-17）"],
      );
    }
  });
});

describe("#467 线程 agent 编制的增删往返（真实 Postgres）", () => {
  it("加一个 → 面板读得到 → 移出 → 面板读不到", async () => {
    expect(await rosterIds(FACILITATOR)).toEqual([]);

    const added = await postRoster(FACILITATOR, { add: [AGENT_A], remove: [], expectedRosterVersion: 0 });
    expect(added.status).toBe(200);
    const addedBody: unknown = await added.json();
    const addedParsed = C.operations.updateAgentRoster.out.safeParse(addedBody);
    expect(addedParsed.success, `updateAgentRoster.out strict 校验失败：${JSON.stringify(addedParsed)}`).toBe(true);
    const addedOut = addedParsed.success ? addedParsed.data : null;
    expect(addedOut!.rosterVersion).toBe(1);
    // 审计事件真的落了库（不是返回一个编出来的 id）。
    expect(addedOut!.auditEventId).not.toBe("");
    await asApp(ORG, async (c) => {
      const r = await c.query("SELECT 1 FROM provenance_events WHERE id = $1", [addedOut!.auditEventId]);
      expect(r.rows.length, "auditEventId 必须能在 provenance_events 里查到").toBe(1);
    });

    // ⚠ 断言落在**重新读一次面板**上，而不是上面那个响应体——响应体是同一次调用的
    //   回声，它绿不能证明「写进库了」。
    expect(await rosterIds(FACILITATOR)).toEqual([AGENT_A]);

    const removed = await postRoster(FACILITATOR, { add: [], remove: [AGENT_A], expectedRosterVersion: 1 });
    expect(removed.status).toBe(200);
    expect(await rosterIds(FACILITATOR)).toEqual([]);
  });

  it("加两个再单独移掉一个：留下的那个还在（不是整表清空）", async () => {
    expect((await postRoster(FACILITATOR, { add: [AGENT_A, AGENT_B], remove: [], expectedRosterVersion: 0 })).status).toBe(200);
    expect(await rosterIds(FACILITATOR)).toEqual([AGENT_A, AGENT_B].sort());

    expect((await postRoster(FACILITATOR, { add: [], remove: [AGENT_A], expectedRosterVersion: 1 })).status).toBe(200);
    expect(await rosterIds(FACILITATOR)).toEqual([AGENT_B]);
  });

  /* ── 权限在服务端，不是「前端把按钮藏起来」 ─────────────────────────────── */

  it("观察者提交编制变更 → 403，且编制**没被改动**", async () => {
    const res = await postRoster(OBSERVER, { add: [AGENT_A], remove: [], expectedRosterVersion: 0 });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reasonCode: "NO_WRITE_ROLE" });
    // 反空转：拒绝之后库里确实没这条——只断状态码的话，一个「先写后拒」的实现也能过。
    expect(await rosterIds(FACILITATOR)).toEqual([]);
  });

  it("非项目成员提交 → 404（不可见与不存在同一个出口，不泄露存在性）", async () => {
    await addOrgMember(ORG, OUTSIDER, "consultant", null);
    const res = await postRoster(OUTSIDER, { add: [AGENT_A], remove: [], expectedRosterVersion: 0 });
    expect(res.status).toBe(404);
    expect(await rosterIds(FACILITATOR)).toEqual([]);
  });

  /* ── 业务前置 ────────────────────────────────────────────────────────────── */

  it("加一个不在组织目录里的 agent → 422 AGENT_OUT_OF_SCOPE，且整批都不生效", async () => {
    const res = await postRoster(FACILITATOR, {
      add: [AGENT_A, "agent-not-in-catalog"], remove: [], expectedRosterVersion: 0,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reasonCode: "AGENT_OUT_OF_SCOPE" });
    // 「部分成功即整体拒绝」：合法的那个 AGENT_A 也不许被加进去。
    expect(await rosterIds(FACILITATOR)).toEqual([]);
  });

  it("移一个本就不在编制里的 agent → 422 AGENT_NOT_FOUND", async () => {
    const res = await postRoster(FACILITATOR, { add: [], remove: [AGENT_B], expectedRosterVersion: 0 });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reasonCode: "AGENT_NOT_FOUND" });
  });

  it("版本号过期 → 409 VERSION_CHANGED，且不静默覆盖", async () => {
    expect((await postRoster(FACILITATOR, { add: [AGENT_A], remove: [], expectedRosterVersion: 0 })).status).toBe(200);

    // 拿已经用过的 0 再提交一次。
    const stale = await postRoster(FACILITATOR, { add: [AGENT_B], remove: [], expectedRosterVersion: 0 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reasonCode: "VERSION_CHANGED" });
    expect(await rosterIds(FACILITATOR)).toEqual([AGENT_A]);
  });

  it("body 多一个键（contract `.strict()`）→ 400，服务端不接受计划外字段", async () => {
    const res = await fetch(`${BASE}/chat/threads/${THREAD}/agents?projectId=${PROJECT}`, {
      method: "POST",
      headers: as(FACILITATOR),
      body: JSON.stringify({
        threadId: THREAD, add: [AGENT_A], remove: [], expectedRosterVersion: 0,
        projectId: PROJECT, // ← 越界字段：projectId 走 query，不在 body 契约里
      }),
    });
    expect(res.status).toBe(400);
  });
});
