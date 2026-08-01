/**
 * F112 —— 批准闸门的信任核心两条：六项披露全非空（I-28），暂停期间零副作用（I-27）。
 *
 * ## 这个文件里最重要的两条断言
 *
 * 1. **I-28**：`createApprovalRequest` 的响应体六项披露字段（标题与状态 / 调用链 /
 *    模型 / token 预算 / 数据范围 / 三出口）逐条非空，`exits` 恰好三个——这是契约本身，
 *    不是枚举成员数。
 * 2. **I-27**：`status === "paused"` 期间目标动作副作用恒为 0——这里的形式是「批准前
 *    `chat_background_tasks` 里没有任何行属于这次请求；批准之后才有」。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f112-sixfields";
const PROJECT = "proj-f112-sixfields";
const THREAD = "f112-t-sixfields";
const MODEL_LOCAL = "f112-model-local-a";

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

interface CreateApprovalOut {
  requestId: string;
  status: string;
  callChain: string[];
  models: string[];
  budget: { tokens: number; amount: number; currency: string };
  dataScope: { name: string; confidential: boolean }[];
  exits: string[];
  expiresAt: string;
  backgroundHint: string;
}

async function insertModel(id: string, kind: "self-hosted" | "closed-api", unitPrice: number) {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO models
         (id, org_id, kind, shape, vendor, display_name, capability_tags, context_window,
          unit_price, compliance_attrs, status)
       VALUES ($1,$2,$3,'single','acme',$4,'{}',8000,$5,'{}','已启用')`,
      [id, ORG, kind, id, unitPrice],
    ),
  );
}

async function createApprovalRequest(userId: string, body: Record<string, unknown>) {
  const r = await fetch(`${BASE}/chat/threads/${THREAD}/approval-requests`, {
    method: "POST",
    headers: as(userId),
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as CreateApprovalOut };
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
  await resetOrgs(ORG);
});

beforeAll(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-fac", "consultant", null);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, groupId: null,
    visibilityScope: "plenary", createdBy: "u-fac", title: "批准闸门",
  });
  await insertModel(MODEL_LOCAL, "self-hosted", 12);
}, 60_000);

describe("I-28：六项披露字段全部非空", () => {
  it("createApprovalRequest 返回的六项披露逐条非空，且恰好三出口", async () => {
    const { status, body } = await createApprovalRequest("u-fac", {
      threadId: THREAD,
      agentId: "scout",
      action: "读取欧洲电价数据库",
      dataScope: [{ name: "电价曲线", confidential: false }],
      proposedModels: [MODEL_LOCAL],
      estimatedTokens: 800_000,
    });

    expect(status).toBe(200);
    expect(body.status).toBe("paused");
    expect(body.callChain.length).toBeGreaterThan(0);
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.budget.tokens).toBeGreaterThanOrEqual(0);
    expect(body.budget.amount).toBeGreaterThanOrEqual(0);
    expect(body.budget.currency.length).toBeGreaterThan(0);
    expect(body.dataScope.length).toBeGreaterThan(0);
    // 恰好三个——契约本身，不是「枚举成员数恰好等于长度」这种巧合。
    expect(body.exits).toHaveLength(3);
    expect(new Set(body.exits)).toEqual(new Set(["approve", "reparam", "decline"]));
    expect(body.backgroundHint.length).toBeGreaterThan(0);
    expect(body.expiresAt.length).toBeGreaterThan(0);
  });
});

describe("I-27：paused 期间零副作用", () => {
  it("批准前没有任何后台任务；批准后才恰好一个", async () => {
    const { status, body } = await createApprovalRequest("u-fac", {
      threadId: THREAD,
      agentId: "ledger",
      action: "生成收益测算报告",
      dataScope: [{ name: "项目库", confidential: false }],
      proposedModels: [MODEL_LOCAL],
      estimatedTokens: 400_000,
    });
    expect(status).toBe(200);
    expect(body.status).toBe("paused");

    const before = await asApp(ORG, async (c) => {
      const r = await c.query(
        "SELECT count(*)::int AS n FROM chat_background_tasks WHERE approval_request_id = $1",
        [body.requestId],
      );
      return (r.rows[0] as { n: number }).n;
    });
    expect(before).toBe(0);

    const decideR = await fetch(`${BASE}/chat/approval-requests/${body.requestId}/decide`, {
      method: "POST",
      headers: as("u-fac"),
      body: JSON.stringify({
        requestId: body.requestId,
        exit: "approve",
        expectedStatus: "paused",
        newModels: null,
        newBudget: null,
        newDataScope: null,
      }),
    });
    expect(decideR.status).toBe(200);
    const decideBody = (await decideR.json()) as { taskId: string | null };
    expect(decideBody.taskId).not.toBeNull();

    const after = await asApp(ORG, async (c) => {
      const r = await c.query(
        "SELECT count(*)::int AS n FROM chat_background_tasks WHERE approval_request_id = $1",
        [body.requestId],
      );
      return (r.rows[0] as { n: number }).n;
    });
    expect(after).toBe(1);
  });
});
