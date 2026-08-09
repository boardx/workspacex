/**
 * #619 A —— `org_agents` 收敛进 `capability_listings`，端到端走真实 HTTP。
 *
 * ## 这个文件证明的是"前半段"，不是"后半段"（coord-main 的裁定原话）
 *
 * ⚠ **本文件只证明**：通过 admin UI 真实可用的 `POST /capabilities/mutate` 建出来的
 *   一个 `kind='agent'` 目录条目，能被 `POST /chat/threads/:threadId/agents` 挑进
 *   某个线程的编制，并且 `GET /chat/threads/:threadId/agents`（面板读端口）能读到它。
 * ⛔ **本文件不证明**"选中后 chat 里真的能调用"——那半段依赖 #617
 *   （`createAgent` 全仓零 controller，一个从 admin UI 建出来的 agent 目录条目
 *   今天没有任何路径拥有 `agents`/`agent_versions` 那半执行链路）。
 *   #617 落地后要回来把这两半接上，实测一遍完整链路（issue #619 第三条要求）。
 *
 * ## 收敛前后的对照（写进测试名，免得读者要跳回 issue 才看得懂"为什么测这个"）
 *
 * 迁移 `0032-f110-ai-team-panel.sql` 文件头写明 `org_agents` 是"占位目录"，
 * 等的是"phase-00 F15"——F15 就是 `capability_listings`。#619 做的是把这句等了
 * 很久的承诺兑现：编制判定（`AGENT_OUT_OF_SCOPE`）与编制展示都从 `org_agents`
 * 切到 `capability_listings（kind='agent'）`。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chat as C, identity as I } from "@repo/contracts";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i619-roster-conv";
const OTHER_ORG = "org-i619-roster-conv-other";
const PROJECT = "proj-i619-roster-conv";
const THREAD = "thread-i619-roster-conv";
const ADMIN = "u-i619-admin";
const OTHER_ADMIN = "u-i619-other-admin";

let app: NestExpressApplication;
let BASE = "";

const authFor = (userId: string, orgId: string) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

async function mutateCapability(orgId: string, userId: string, body: unknown) {
  return fetch(`${BASE}/capabilities/mutate`, {
    method: "POST", headers: authFor(userId, orgId), body: JSON.stringify(body),
  });
}

async function updateRoster(orgId: string, userId: string, body: unknown) {
  return fetch(`${BASE}/chat/threads/${THREAD}/agents?projectId=${PROJECT}`, {
    method: "POST", headers: authFor(userId, orgId), body: JSON.stringify(body),
  });
}

async function getPanel(orgId: string, userId: string) {
  return fetch(`${BASE}/chat/threads/${THREAD}/agents?projectId=${PROJECT}`, {
    headers: authFor(userId, orgId),
  });
}

async function currentRosterVersion(orgId: string, userId: string): Promise<number> {
  const r = await getPanel(orgId, userId);
  const body = (await r.json()) as { rosterVersion: number };
  return body.rosterVersion;
}

/** 建一条 `kind='agent'` 的目录条目，走真实 HTTP（不是直接建库）——与 admin UI 同一条路径。 */
async function createAgentCapability(
  orgId: string, userId: string, input: { name: string; abbr: string; duty: string; enabled?: boolean },
): Promise<string> {
  const addRes = await mutateCapability(orgId, userId, {
    orgId, kind: "agent", op: "add",
    payload: { name: input.name, scope: "org-wide", abbr: input.abbr, duty: input.duty },
  });
  expect(addRes.status, await addRes.clone().text()).toBe(200);
  const added = (await addRes.json()) as { listing: { id: string } };
  if (input.enabled === false) {
    const offRes = await mutateCapability(orgId, userId, {
      orgId, kind: "agent", op: "disable", payload: { id: added.listing.id }, disableMode: "interrupt",
    });
    expect(offRes.status).toBe(200);
  }
  return added.listing.id;
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
  await resetOrgs(ORG, OTHER_ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addProjectMember(ORG, PROJECT, ADMIN, "facilitator", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ADMIN,
  });
  await seedOrg({ orgId: OTHER_ORG, projectId: `${PROJECT}-other` });
  await addOrgMember(OTHER_ORG, OTHER_ADMIN, "admin", null);
});

describe("正样本：admin UI 建的 agent 目录条目，能被真实挑进线程编制", () => {
  it("建 → 挑进编制 → 面板读得到，abbr/name/duty 与建的时候一致", async () => {
    const agentId = await createAgentCapability(ORG, ADMIN, {
      name: "记账 Agent", abbr: "BK", duty: "记账与对账",
    });

    const version = await currentRosterVersion(ORG, ADMIN);
    const addRes = await updateRoster(ORG, ADMIN, {
      threadId: THREAD, add: [agentId], remove: [], expectedRosterVersion: version,
    });
    expect(addRes.status, await addRes.clone().text()).toBe(200);
    const added = C.operations.updateAgentRoster.out.parse(await addRes.json());
    expect(added.agents.map((a) => a.id)).toEqual([agentId]);
    expect(added.agents[0]).toMatchObject({ abbr: "BK", name: "记账 Agent", duty: "记账与对账" });

    const panelRes = await getPanel(ORG, ADMIN);
    const panel = C.operations.getAgentPanel.out.parse(await panelRes.json());
    expect(panel.agents.map((a) => a.id)).toEqual([agentId]);
  });
});

describe("负样本：不是「合法 agent」的 id 都进不了编制，且什么都没写进库", () => {
  const rosterRowCount = () =>
    asApp(ORG, (c) =>
      c.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM chat_thread_agents WHERE org_id = $1 AND thread_id = $2",
        [ORG, THREAD],
      ).then((r) => Number(r.rows[0]?.n ?? "0")),
    );

  it("停用状态的 agent 目录条目 ⇒ AGENT_OUT_OF_SCOPE，未写进库", async () => {
    const agentId = await createAgentCapability(ORG, ADMIN, {
      name: "停用中的 Agent", abbr: "OF", duty: "已停用", enabled: false,
    });
    const version = await currentRosterVersion(ORG, ADMIN);
    const before = await rosterRowCount();

    const res = await updateRoster(ORG, ADMIN, {
      threadId: THREAD, add: [agentId], remove: [], expectedRosterVersion: version,
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { reasonCode?: string }).toMatchObject({
      reasonCode: "AGENT_OUT_OF_SCOPE",
    });
    expect(await rosterRowCount()).toBe(before);
  });

  /**
   * ⚠ 这条钉的是 `kind='agent'` 那个过滤条件本身——同组织里真实存在一条
   *   `kind='skill'` 的目录条目，id 却被当成 agent id 提交。如果编制判定
   *   漏了 `kind` 这个条件，这条会被放行，而它显然不该。
   */
  it("同组织里存在，但 kind 不是 agent 的目录条目 ⇒ 同样 AGENT_OUT_OF_SCOPE", async () => {
    const skillCapRes = await mutateCapability(ORG, ADMIN, {
      orgId: ORG, kind: "skill", op: "add", payload: { name: "某 skill 目录条目", scope: "org-wide" },
    });
    expect(skillCapRes.status).toBe(200);
    const skillCap = (await skillCapRes.json()) as { listing: { id: string } };

    const version = await currentRosterVersion(ORG, ADMIN);
    const before = await rosterRowCount();
    const res = await updateRoster(ORG, ADMIN, {
      threadId: THREAD, add: [skillCap.listing.id], remove: [], expectedRosterVersion: version,
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { reasonCode?: string }).toMatchObject({
      reasonCode: "AGENT_OUT_OF_SCOPE",
    });
    expect(await rosterRowCount()).toBe(before);
  });

  /**
   * 跨组织隔离：这是"新查询路径"覆盖要求那一条——`ORG` 的 admin 不能把
   * `OTHER_ORG` 的 agent 目录条目挑进 `ORG` 自己线程的编制。
   */
  it("另一个组织的 agent 目录条目 ⇒ AGENT_OUT_OF_SCOPE，跨组织不可见", async () => {
    const otherOrgAgentId = await createAgentCapability(OTHER_ORG, OTHER_ADMIN, {
      name: "别的组织的 Agent", abbr: "XX", duty: "不该被看到",
    });

    const version = await currentRosterVersion(ORG, ADMIN);
    const before = await rosterRowCount();
    const res = await updateRoster(ORG, ADMIN, {
      threadId: THREAD, add: [otherOrgAgentId], remove: [], expectedRosterVersion: version,
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { reasonCode?: string }).toMatchObject({
      reasonCode: "AGENT_OUT_OF_SCOPE",
    });
    expect(await rosterRowCount()).toBe(before);
  });
});

describe("数据库触发器兜底（应用层被绕过时的最后一道门）", () => {
  it("绕开应用层直接 INSERT chat_thread_agents 指向一个不存在的 capability_listings id ⇒ 触发器拒绝", async () => {
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO chat_thread_agents (thread_id, org_id, agent_id, presence)
           VALUES ($1, $2, $3, 'off')`,
          [THREAD, ORG, `agent-does-not-exist-${randomUUID()}`],
        ),
      ),
    ).rejects.toThrow(/Roster agent is not an enabled agent capability listing/);
  });

  it("同上，但目标条目存在、kind 却是 skill ⇒ 触发器同样拒绝", async () => {
    const skillCapRes = await mutateCapability(ORG, ADMIN, {
      orgId: ORG, kind: "skill", op: "add", payload: { name: "trigger 反证用", scope: "org-wide" },
    });
    const skillCap = (await skillCapRes.json()) as { listing: { id: string } };
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO chat_thread_agents (thread_id, org_id, agent_id, presence)
           VALUES ($1, $2, $3, 'off')`,
          [THREAD, ORG, skillCap.listing.id],
        ),
      ),
    ).rejects.toThrow(/Roster agent is not an enabled agent capability listing/);
  });
});

describe("契约层面：abbr/duty 现在是 CapabilityListing 的一部分", () => {
  it("装置自检：契约 schema 真的要求 abbr/duty 字段存在（哪怕值是 null）", () => {
    const sample = {
      id: "cap-x", orgId: "org-x", kind: "agent" as const, name: "n",
      scope: "org-wide" as const, enabled: true, endpoint: null,
      abbr: null, duty: null, disabledReason: null,
    };
    expect(I.CapabilityListing.safeParse(sample).success).toBe(true);
    // 装置自检的另一半：少了 abbr 字段（不是 null，是**没有这个键**）应当仍然通过
    // ——`.nullable()` 不等于 `.optional()`，缺键会被 `.strict()` 挡在别处，不在这条断言里；
    // 这里只确认"值为 null 是允许的"，即"没有 abbr 不是 agent 独有属性"这句话成立。
    const { abbr: _abbr, ...withoutAbbr } = sample;
    void _abbr;
    expect(I.CapabilityListing.safeParse({ ...withoutAbbr, abbr: undefined }).success).toBe(false);
  });
});
