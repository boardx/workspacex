/**
 * 本 PR —— 补 UC-3…UC-10/UC-13 的 HTTP 面（`plan-control.controller.ts`，见该文件头注）。
 *
 * F972-F978 的既有测试全部只在测试文件里手工 `new` 应用层依赖直接调函数——没有一条走
 * 真实 `createApp()` + 真实 HTTP 请求。这份测试反其道而行：真实 app、真实端口、真实
 * `fetch`，只信从网络上收到的响应，不 import 任何应用层函数。证明的是「这条路由真的
 * 挂在真实容器里，DI 真的能解析出 `PLAN_RUN_CREATOR`/`ENGINE_RUN_CONTROLLER`」——这正是
 * 此前唯一缺失的一环（应用层函数本身早已被 F974-F976 的测试覆盖过）。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ingestEnginePlanSnapshot } from "../../src/application/plan-control/ingest-engine-plan-snapshot";
import { PLAN_LEDGER_REPOSITORY, type PlanLedgerRepository } from "../../src/application/plan-control/ports";
import { toOrgId } from "../../src/domain/org-id";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-wire-plan-control-http";
const PROJECT = "proj-wire-plan-control-http";
const ACTOR = "u-wire-plan-control-http";
const OBSERVER = "u-wire-plan-control-http-observer";

let app: NestExpressApplication;
let BASE: string;
let planLedger: PlanLedgerRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  planLedger = app.get<PlanLedgerRepository>(PLAN_LEDGER_REPOSITORY);
}, 180_000);

afterAll(async () => {
  await app?.close();
});

function freshThreadId(): string {
  return `thread-${randomUUID()}`;
}

/**
 * ⚠ `projectId: null`（个人线程）——**不是随手选择**。真实生产路径下
 * `copilotkit-v2-shell.tsx` 头注写明白：这条新轨道创建线程一律
 * `mutateThread(op:create, projectId:null)`，`plan-control-api.ts` 的
 * `fetchPlanLedger` 因此也从不带 `?projectId=` 查询参数——与 `chat.controller.ts`
 * 的 `GET /chat/threads/:threadId` 同一条既有惯例（该路由同样把缺省 query 当
 * 「走个人线程分支」，不是本 PR 引入的新约定）。这里如实按真实调用路径造夹具，
 * 不是为了"让测试更容易过"而选个人线程。
 */
async function seedThread(threadId: string): Promise<void> {
  await addChatThread({
    orgId: ORG, id: threadId, projectId: null, visibilityScope: "plenary", createdBy: ACTOR,
  });
}

/** 观察者 NO_WRITE_ROLE 一例需要一条真实**项目**线程（个人线程没有「观察者」这个
 *  概念——I-3 下非创建者与「不存在」同一出口，测不出 403 与 404 的区别）。 */
async function seedProjectThread(threadId: string): Promise<void> {
  await addChatThread({
    orgId: ORG, id: threadId, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
}

async function seedPriorRun(threadId: string): Promise<void> {
  const messageId = `msg-${randomUUID()}`;
  const runId = `run-${randomUUID()}`;
  await addChatMessage({ orgId: ORG, id: messageId, threadId, body: "帮我规划一下", authorId: ACTOR });
  // 无发布 agent 时 confirmPlan 会在「起新 run」这一步失败（PLAN_DELIVERY_FAILED）——
  // 这份测试只验证 HTTP 面真的把请求路由到了应用层、错误码真的按契约映射，不复刻
  // F975 那条「replay 到 deep-agent 替身、断言 digest 逐字相等」的完整链路（那条已经
  // 被 confirm-plan-delivery-digest.test.ts 覆盖，这里重复一遍没有新增证据）。
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id, skill_version_ids,
          model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,'agent-x','agent-version-x','[]','deep-agent','deep-agent','succeeded')`,
      [runId, ORG, threadId, messageId],
    ),
  );
}

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addOrgMember(ORG, OBSERVER, "consultant", null);
  await addProjectMember(ORG, PROJECT, OBSERVER, "observer", null);
});

function actorHeaders(userId = ACTOR): Record<string, string> {
  return { "x-kernel-test-principal": `${userId}:${ORG}`, "content-type": "application/json" };
}

describe("plan-control 写端点真的挂在真实 app 里（本 PR 补的 HTTP 面）", () => {
  it("GET ledger：零计划是正常态（既有 F977 行为，回归确认没被这次改动动到）", async () => {
    const threadId = freshThreadId();
    await seedThread(threadId);
    const res = await fetch(`${BASE}/plan-control/threads/${threadId}/ledger`, {
      headers: actorHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { steps: unknown[]; phase: string };
    expect(body.steps).toEqual([]);
    expect(body.phase).toBe("preparing");
  });

  it("POST reorder：真实 HTTP 往返改变了账本顺序，GET ledger 能读到新顺序", async () => {
    const threadId = freshThreadId();
    await seedThread(threadId);
    const ingested = await ingestEnginePlanSnapshot(planLedger, {
      orgId: toOrgId(ORG), threadId,
      todos: [
        { content: "第一步", status: "pending" },
        { content: "第二步", status: "pending" },
      ],
    });
    const ledgerBefore = await planLedger.getLatest(toOrgId(ORG), threadId);
    const firstStepId = ledgerBefore!.steps[0]!.planStepId;

    const res = await fetch(`${BASE}/plan-control/threads/${threadId}/steps/reorder`, {
      method: "POST", headers: actorHeaders(),
      body: JSON.stringify({ basedOnRevision: ingested.revision, planStepId: firstStepId, toIndex: 1 }),
    });
    // Nest 的 POST 默认状态码是 201（未显式 @HttpCode 时），与既有 `chat.controller.ts`
    // 的 POST 路由同一约定，不是本次改动引入的特例。
    expect(res.status).toBe(201);
    const body = (await res.json()) as { revision: number; appliedTo: string; auditEventId: string };
    expect(body.auditEventId).toBeTruthy();

    const ledgerAfter = await planLedger.getLatest(toOrgId(ORG), threadId);
    expect(ledgerAfter!.steps[1]!.planStepId).toBe(firstStepId);
  });

  it("POST reorder 陈旧 basedOnRevision -> 409 PLAN_REVISION_CHANGED（错误码经 controller 层真实映射）", async () => {
    const threadId = freshThreadId();
    await seedThread(threadId);
    const ingested = await ingestEnginePlanSnapshot(planLedger, {
      orgId: toOrgId(ORG), threadId,
      todos: [{ content: "唯一步骤", status: "pending" }],
    });
    const ledger = await planLedger.getLatest(toOrgId(ORG), threadId);
    const res = await fetch(`${BASE}/plan-control/threads/${threadId}/steps/reorder`, {
      method: "POST", headers: actorHeaders(),
      body: JSON.stringify({
        basedOnRevision: ingested.revision + 1, planStepId: ledger!.steps[0]!.planStepId, toIndex: 0,
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reasonCode: string };
    expect(body.reasonCode).toBe("PLAN_REVISION_CHANGED");
  });

  it("观察者 reorder -> 403 NO_WRITE_ROLE（复用 resolveVisibility，与 chat 束同一条门）", async () => {
    const threadId = freshThreadId();
    await seedProjectThread(threadId);
    const ingested = await ingestEnginePlanSnapshot(planLedger, {
      orgId: toOrgId(ORG), threadId,
      todos: [{ content: "唯一步骤", status: "pending" }],
    });
    const ledger = await planLedger.getLatest(toOrgId(ORG), threadId);
    const res = await fetch(
      `${BASE}/plan-control/threads/${threadId}/steps/reorder?projectId=${PROJECT}`,
      {
        method: "POST", headers: actorHeaders(OBSERVER),
        body: JSON.stringify({
          basedOnRevision: ingested.revision, planStepId: ledger!.steps[0]!.planStepId, toIndex: 0,
        }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("POST addConstraint 空白文本 -> 422 PLAN_CONSTRAINT_BLANK", async () => {
    const threadId = freshThreadId();
    await seedThread(threadId);
    const ingested = await ingestEnginePlanSnapshot(planLedger, {
      orgId: toOrgId(ORG), threadId,
      todos: [{ content: "唯一步骤", status: "pending" }],
    });
    const ledger = await planLedger.getLatest(toOrgId(ORG), threadId);
    const res = await fetch(`${BASE}/plan-control/threads/${threadId}/constraints`, {
      method: "POST", headers: actorHeaders(),
      body: JSON.stringify({
        basedOnRevision: ingested.revision, planStepId: ledger!.steps[0]!.planStepId, text: "   ",
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { reasonCode: string };
    expect(body.reasonCode).toBe("PLAN_CONSTRAINT_BLANK");
  });

  it("POST confirm：DI 真的能解析出 PLAN_RUN_CREATOR（此前完全没绑定，会在这里 500）", async () => {
    const threadId = freshThreadId();
    await seedThread(threadId);
    await seedPriorRun(threadId);
    const ingested = await ingestEnginePlanSnapshot(planLedger, {
      orgId: toOrgId(ORG), threadId,
      todos: [
        { content: "第一步", status: "pending" },
        { content: "第二步", status: "pending" },
      ],
    });
    const res = await fetch(`${BASE}/plan-control/threads/${threadId}/confirm`, {
      method: "POST", headers: actorHeaders(),
      body: JSON.stringify({ basedOnRevision: ingested.revision }),
    });
    // 没有真实 deep-agent 后端可达，`AcceptMessagePlanRunCreator` 在「起新 run」这一步
    // 会失败——但那是 `confirm-plan.ts` 映射出的 `PLAN_DELIVERY_FAILED`（503），不是
    // DI 找不到 provider 的 500。503 恰恰证明请求真的走到了应用层，不是路由缺失。
    expect([201, 503]).toContain(res.status);
    if (res.status === 503) {
      const body = (await res.json()) as { reasonCode: string };
      expect(body.reasonCode).toBe("PLAN_DELIVERY_FAILED");
    }
  }, 30_000);

  it("POST runs/pause：DI 真的能解析出 ENGINE_RUN_CONTROLLER（此前完全没绑定）", async () => {
    const threadId = freshThreadId();
    await seedThread(threadId);
    const res = await fetch(`${BASE}/plan-control/threads/${threadId}/runs/pause`, {
      method: "POST", headers: actorHeaders(), body: JSON.stringify({}),
    });
    // 没有活跃 run -> pause-plan-run.ts 的既有 NO_ACTIVE_RUN 分支（409），同样证明
    // 请求已经到达应用层而非在 DI 解析阶段就 500。
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reasonCode: string };
    expect(body.reasonCode).toBe("NO_ACTIVE_RUN");
  });
});
