/**
 * F112 —— D-U1／I-32：含机密的数据范围 ⇒ 本轮模型集合**全部**本地，云端本轮不可用，
 * 服务端 gateway 拒绝，不是界面提示（chat 束 domain.md E 组）。
 *
 * ## 口径说明——为什么这份测试断言的是"整轮"而不是"分流"
 *
 * `domain.md` I-32 明确标注这条不变量在两个口径下写法不同（🔴 待裁决）：
 *   ① 含机密 ⇒ 整轮模型集合全部本地，云端本轮不可用（D-U1／`feature_list.json` 逐字）；
 *   ② 机密只路由本地、云端可并存承接非机密。
 * 本仓已有的先例（F51 `decideModelRoute`，`domain/model/route-call.ts`，已合入）对
 * "含机密但请求的是非 self-hosted 模型" 判的是 `CONFIDENTIAL_ROUTE_VIOLATION`——一次
 * 拒绝，不是部分放行。本文件断言的正是与该先例一致的口径①：**只要提议的模型集合里
 * 混入任何一个非本地模型，且数据范围含机密，就整体拒绝**，不看集合里是否也有本地模型
 * 陪同——不是"没有本地模型兜底才报错"。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f112-localonly";
const PROJECT = "proj-f112-localonly";
const THREAD = "f112-t-localonly";
const MODEL_LOCAL = "f112-model-local-b";
const MODEL_CLOUD = "f112-model-cloud-b";

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

async function insertModel(id: string, kind: "self-hosted" | "closed-api") {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO models
         (id, org_id, kind, shape, vendor, display_name, capability_tags, context_window,
          unit_price, compliance_attrs, status)
       VALUES ($1,$2,$3,'single','acme',$4,'{}',8000,10,'{}','已启用')`,
      [id, ORG, kind, id],
    ),
  );
}

async function createApprovalRequest(body: Record<string, unknown>) {
  const r = await fetch(`${BASE}/chat/threads/${THREAD}/approval-requests`, {
    method: "POST",
    headers: as("u-fac"),
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
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
    visibilityScope: "plenary", createdBy: "u-fac", title: "机密路由",
  });
  await insertModel(MODEL_LOCAL, "self-hosted");
  await insertModel(MODEL_CLOUD, "closed-api");
}, 60_000);

describe("含机密 + 仅云端模型 → 拒绝", () => {
  it("422 MODEL_POLICY_VIOLATION，不出卡", async () => {
    const { status, body } = await createApprovalRequest({
      threadId: THREAD,
      agentId: "warden",
      action: "分析客户机密合同条款",
      dataScope: [{ name: "客户合同", confidential: true }],
      proposedModels: [MODEL_CLOUD],
      estimatedTokens: 100_000,
    });
    expect(status).toBe(422);
    expect((body as { reasonCode?: string }).reasonCode).toBe("MODEL_POLICY_VIOLATION");
  });
});

describe("含机密 + 本地与云端混合 → 仍然拒绝（不是分流放行）", () => {
  it("422 MODEL_POLICY_VIOLATION——本地模型陪同不能免除云端那部分的拒绝", async () => {
    const { status, body } = await createApprovalRequest({
      threadId: THREAD,
      agentId: "warden",
      action: "分析客户机密合同条款（混合模型）",
      dataScope: [{ name: "客户合同", confidential: true }],
      proposedModels: [MODEL_LOCAL, MODEL_CLOUD],
      estimatedTokens: 100_000,
    });
    expect(status).toBe(422);
    expect((body as { reasonCode?: string }).reasonCode).toBe("MODEL_POLICY_VIOLATION");
  });
});

describe("含机密 + 仅本地模型 → 放行", () => {
  it("200，整轮走本地", async () => {
    const { status, body } = await createApprovalRequest({
      threadId: THREAD,
      agentId: "warden",
      action: "分析客户机密合同条款（合规）",
      dataScope: [{ name: "客户合同", confidential: true }],
      proposedModels: [MODEL_LOCAL],
      estimatedTokens: 100_000,
    });
    expect(status).toBe(200);
    expect((body as { status?: string }).status).toBe("paused");
    expect((body as { models?: string[] }).models).toEqual([MODEL_LOCAL]);
  });
});

describe("不含机密 + 云端模型 → 放行（约束只在含机密时生效）", () => {
  it("200，云端模型在非机密数据范围下可用", async () => {
    const { status, body } = await createApprovalRequest({
      threadId: THREAD,
      agentId: "scout",
      action: "检索公开行业报告",
      dataScope: [{ name: "公开报告", confidential: false }],
      proposedModels: [MODEL_CLOUD],
      estimatedTokens: 50_000,
    });
    expect(status).toBe(200);
    expect((body as { status?: string }).status).toBe("paused");
  });
});
