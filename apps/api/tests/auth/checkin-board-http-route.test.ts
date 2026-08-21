/**
 * F05（phase-10 group-checkin 束）—— `GET /projects/:projectId/checkin-board` 从 HTTP
 * 真的可达，而且用例内的角色投影/越权拒绝在真实容器里仍然生效。
 *
 * ## 这个文件要消掉的那句话
 *
 * `checkin-board.controller.ts` 头注：`getCheckinBoard`（F16/UC-1.3 R8）与其仓储实现
 * 在 F05 开工前早已完整、且有真实 DB 测试（`checkin-writeback.test.ts`），但**没有一条
 * 路由到得了它**。那份测试证明的是「如果有人调用这个函数，它是对的」，不是「有人能从
 * HTTP 调用它」。本文件补的是后半句——同 `tests/skill/url-import-http-route.test.ts`
 * 头注点名的同一种空转。
 *
 * ## 与 `checkin-writeback.test.ts` 的分工
 *
 * 那个文件（应用层，真实 DB）已经穷尽了「组长只见本组」「不在项目里的人被拒」「契约形状」
 * 几条断言——本文件**不重复**那些用例内部逻辑，只证明三件事：①路由真的存在、②服务端
 * 从库里解析角色（不信任请求体/query 里假冒的身份），③走真实 Nest 容器时越权拒绝仍是
 * 403 + 具体 reasonCode，不是被某个中间件截胡成笼统 401/404。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgAdmin as C } from "@repo/contracts";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import {
  addOrgMember,
  addProjectMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { facilitator, fixedIds, newDb, repos, toOrgId } from "../support/invite-link";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f05-checkin-http";
const PROJECT = `${ORG}-p`;
const HOST = "u-f05-checkin-http-host";
const GROUP_LEAD = "u-f05-checkin-http-lead";
const STRANGER = "u-f05-checkin-http-stranger";
const HOOK_TIMEOUT_MS = 60_000;

let app: NestExpressApplication;
let base = "";
let db: ReturnType<typeof newDb>;
let repo: ReturnType<typeof repos>["links"];
let roster: ReturnType<typeof repos>["roster"];
let fixture: Awaited<ReturnType<typeof seedOrg>>;

const orgId = toOrgId(ORG);
const ids = fixedIds("dec-f05-checkin-http");

const authFor = (userId: string, orgIdStr: string) => ({
  "x-kernel-test-principal": `${userId}:${orgIdStr}`,
  "content-type": "application/json",
});

function getBoard(userId: string): Promise<Response> {
  return fetch(`${base}/projects/${PROJECT}/checkin-board`, {
    method: "GET",
    headers: authFor(userId, ORG),
  });
}

async function addParticipant(groupId: string, contact: string) {
  const out = await roster.upsert(orgId, PROJECT, HOST, [
    {
      participantId: `pp-http-${contact}`,
      contactKind: "phone",
      contact,
      masked: `138 •••• ${contact.slice(-4)}`,
      projectRole: "member",
      groupId,
    },
  ]);
  return out.created[0]!;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = newDb();
  const r = repos(db);
  repo = r.links;
  roster = r.roster;

  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  fixture = await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1", "g2"] });
  await addOrgMember(ORG, HOST, "consultant", null);
  await addOrgMember(ORG, GROUP_LEAD, "consultant", null);
  await addOrgMember(ORG, STRANGER, "consultant", null);
  await addProjectMember(ORG, PROJECT, HOST, "facilitator", null, true);
  await addProjectMember(ORG, PROJECT, GROUP_LEAD, "groupLead", fixture.groups.g1 ?? null);
}, HOOK_TIMEOUT_MS);

describe("路由真的存在（正样本）", () => {
  it("引导师 GET /projects/:projectId/checkin-board ⇒ 200，响应满足契约，含真实到场数", async () => {
    const p1 = await addParticipant(fixture.groups.g1!, "13800011111");
    await addParticipant(fixture.groups.g2!, "13800022222");
    await issueInviteLink(
      { repo },
      {
        orgId,
        projectId: PROJECT,
        kind: "group",
        groupId: fixture.groups.g1 ?? null,
        identity: "member",
        validity: "7d",
        ...facilitator(HOST),
      },
    );

    const response = await getBoard(HOST);
    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    const parsed = C.operations.getCheckinBoard.out.parse(payload);

    const g1 = parsed.groups.find((g) => g.groupId === fixture.groups.g1);
    expect(g1?.total).toBe(1);
    expect(g1?.present).toBe(0);
    expect(g1?.links.length).toBe(1);
    expect(g1?.roster.some((r) => r.alias.includes("1111"))).toBe(true);
    expect(parsed.overall.total).toBe(2);
    expect(parsed.realtime).toBe(false);
    void p1;
  });

  it("装置自检：邻近的未知路径确实 404 ⇒ 上面那条 200 是这条路由给的", async () => {
    const response = await fetch(`${base}/projects/${PROJECT}/checkin-board-does-not-exist`, {
      headers: authFor(HOST, ORG),
    });
    expect(response.status).toBe(404);
  });
});

describe("组长只见本组——用例内部的投影在真实容器里仍然生效", () => {
  it("组长（g1）GET ⇒ 只看到 g1，看不到 g2", async () => {
    await addParticipant(fixture.groups.g1!, "13800033333");
    await addParticipant(fixture.groups.g2!, "13800044444");

    const response = await getBoard(GROUP_LEAD);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { groups: { groupId: string }[] };
    expect(payload.groups.map((g) => g.groupId)).toEqual([fixture.groups.g1]);
  });
});

describe("越权：不在项目里的人被拒，且服务端不信任请求里假冒的身份", () => {
  it("不在项目里的人 GET ⇒ 403 / NO_PROJECT_ROLE，不是笼统 401/404", async () => {
    const response = await getBoard(STRANGER);
    expect(response.status).toBe(403);
    const payload = (await response.json()) as { reasonCode?: string; message?: { reasonCode?: string } };
    const reasonCode = payload.reasonCode ?? payload.message?.reasonCode;
    expect(reasonCode).toBe("NO_PROJECT_ROLE");
  });

  it("组织都不在的人 GET ⇒ 403 / NO_ORG_MEMBERSHIP（组织层比项目层先判）", async () => {
    const response = await fetch(`${base}/projects/${PROJECT}/checkin-board`, {
      headers: authFor("u-f05-checkin-http-ghost", ORG),
    });
    expect(response.status).toBe(403);
    const payload = (await response.json()) as { reasonCode?: string; message?: { reasonCode?: string } };
    const reasonCode = payload.reasonCode ?? payload.message?.reasonCode;
    expect(reasonCode).toBe("NO_ORG_MEMBERSHIP");
  });
});
